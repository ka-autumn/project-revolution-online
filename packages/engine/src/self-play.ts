import type { Deck } from './deck.js'
import type { DuelState } from './duel.js'
import { hasEnded } from './duel.js'
import { cardIdsOf, checkBoardInvariants } from './invariant.js'
import type { InvariantViolation } from './invariant.js'
import { applyLegalAction, legalActions } from './legal-action.js'
import type { LegalAction } from './legal-action.js'
import { nextInt } from './random.js'
import type { Random } from './random.js'
import type { Chooser } from './resolve.js'
import { prepareDuel } from './setup.js'
import type { DuelSetup, SeatedViolation } from './setup.js'

/**
 * 合法手からランダムに選ぶ `Chooser`（ADR-0005）。
 *
 * エンジンは I/O を持てず、選択は外から渡してもらう必要がある（`resolve.ts` の
 * `Chooser`）。`Chooser` は呼ばれるたびに 1 つ選んで返すだけの形をしていて、次に使う
 * 乱数列を呼び出し元に返せないため、この関数の外に閉じ込めた乱数列を、呼ばれるたびに
 * 内側で進める。呼び終えた後に残った乱数列は `current` で読み出せるので、次の行動の選択に
 * 使う。
 */
export function randomChooser(random: Random): { readonly chooser: Chooser; readonly current: () => Random } {
  let state = random
  const chooser: Chooser = (candidates) => {
    const picked = nextInt(state, candidates.length)
    state = picked.random
    return candidates[picked.value]
  }
  return { chooser, current: () => state }
}

/**
 * 合法手の中から次に行う 1 つを選ぶプレイヤー（ADR-0005）。
 *
 * 合法手が無ければ `undefined`。乱数を使うプレイヤーは、使った分だけ進めた乱数列を返す。
 * `playSelfPlay` はこれを差し替えられるので、ランダムに選ぶだけのファザ役の代わりに、
 * 決まった手を返すプレイヤーを挿して対戦を決定的に進めることができる。ただし署名は盤面
 * `DuelState` を受け取らないため、その手を打った結果を評価する探索プレイヤーはこれでは
 * 書けない（それには `applyLegalAction(state, ...)` で先に進めた盤面が要る）。人間の入力も、
 * エンジンが I/O を持てない（ADR-0001）ため、この同期的なコールバックとしては挿せない。
 */
export type ActionPicker = (
  actions: readonly LegalAction[],
  random: Random,
) => { readonly action: LegalAction; readonly random: Random } | undefined

/** 合法手から 1 つランダムに選ぶ、既定の `ActionPicker`。 */
export const pickRandomAction: ActionPicker = (actions, random) => {
  if (actions.length === 0) return undefined

  const picked = nextInt(random, actions.length)
  const action = actions[picked.value]
  return action === undefined ? undefined : { action, random: picked.random }
}

/** 自己対戦の回し方。デュエル 1 本でも複数シードでも同じ（ADR-0005）。 */
export interface SelfPlayPolicy {
  /**
   * 完走とみなさずに打ち切る、行った手数の上限。無限ループそのものを検出するわけではなく、
   * この回数まで決着しなければ「無限ループの疑いがある」ものとして扱う（ADR-0005）。
   */
  readonly maxActions: number
  /** 次に行う手を選ぶプレイヤー。省略すればランダムに選ぶ（`pickRandomAction`）。 */
  readonly pickAction?: ActionPicker
}

export interface SelfPlayOptions extends SelfPlayPolicy {
  readonly setup: DuelSetup
}

export type SelfPlayResult =
  | { readonly kind: '決着'; readonly state: DuelState; readonly actionsTaken: number }
  | { readonly kind: '手数上限'; readonly state: DuelState; readonly actionsTaken: number }
  | {
      readonly kind: '不変条件違反'
      readonly state: DuelState
      readonly violations: readonly InvariantViolation[]
      readonly actionsTaken: number
    }
  | { readonly kind: 'デッキ不備'; readonly violations: readonly SeatedViolation[] }

/**
 * 合法手から選ぶプレイヤーで、デュエルを 1 本最後まで自己対戦させる（ADR-0005）。
 *
 * シードから常に同じ対戦になる。失敗した対戦を、そのシードだけで丸ごと再生できること
 * （`options.setup.seed`、同）が、この関数の値の大半を占める。
 *
 * 盤面の不変条件（カードの総数が変わらない、ダメージが負にならないなど、`invariant.ts`）が
 * 崩れていないかを、行動を行うたびに確かめる。決着させた行動そのものが盤面を崩していないか
 * も見えるように、決着したかどうかを確かめる前に必ず不変条件を確かめる。崩れていればそこで
 * 打ち切り、その盤面と崩れた条件を返す。手数が上限に達しても決着しなければ、無限ループの
 * 疑いとして打ち切る。
 */
export function playSelfPlay(options: SelfPlayOptions): SelfPlayResult {
  const prepared = prepareDuel(options.setup)
  if (prepared.kind !== '準備完了') return prepared

  const pickAction = options.pickAction ?? pickRandomAction
  const initialCardIds = cardIdsOf(prepared.state)
  let state = prepared.state
  let random = prepared.random

  for (let actionsTaken = 0; actionsTaken < options.maxActions; actionsTaken += 1) {
    const picked = pickAction(legalActions(state), random)
    // `優先権を放棄する` は終了していない限り必ず合法手にある（`legal-action.ts`）ため、
    // 実際には起こらない。起こったならそれ自体が不変条件の崩れなので、そう報告する。
    if (picked === undefined) {
      return { kind: '不変条件違反', state, violations: [{ kind: '終了していないのに合法手が無い' }], actionsTaken }
    }

    const { chooser, current } = randomChooser(picked.random)
    state = applyLegalAction(state, picked.action, chooser)
    random = current()

    const violations = checkBoardInvariants(state, initialCardIds)
    if (violations.length > 0) return { kind: '不変条件違反', state, violations, actionsTaken: actionsTaken + 1 }

    if (hasEnded(state)) return { kind: '決着', state, actionsTaken: actionsTaken + 1 }
  }

  return { kind: '手数上限', state, actionsTaken: options.maxActions }
}

/** 複数シード分の自己対戦をまとめて回すのに必要なもの（ADR-0005）。 */
export interface SelfPlayBatchOptions extends SelfPlayPolicy {
  /** 両プレイヤーのデッキ。シードだけを変えて何度も同じデッキで対戦させる。 */
  readonly decks: readonly [Deck, Deck]
  /** 対戦させるシードの並び。 */
  readonly seeds: readonly number[]
}

export type SelfPlayBatchResult =
  | { readonly kind: '全て決着'; readonly actionsTaken: ReadonlyMap<number, number> }
  | {
      readonly kind: '失敗'
      /** 決着しなかったシードすべて（シードと、その `playSelfPlay` の結果の組）。 */
      readonly failures: readonly { readonly seed: number; readonly result: SelfPlayResult }[]
    }

/**
 * 複数のシードで自己対戦を回し、失敗を集約する（ADR-0005）。
 *
 * ファザとして大量の自己対戦を回すには、1 本ずつ `playSelfPlay` を呼ぶだけでは済まず、
 * どのシードで何が起きたかを集約する層が要る。1 回の実行から学べることを最大化するため、
 * 最初に失敗したシードで打ち切らず、すべてのシードを回しきってから、決着しなかったシード
 * すべてを返す。すべて決着すれば、シードごとの決着までの手数を返す。
 */
export function runSelfPlayBatch(options: SelfPlayBatchOptions): SelfPlayBatchResult {
  const actionsTaken = new Map<number, number>()
  const failures: { readonly seed: number; readonly result: SelfPlayResult }[] = []

  for (const seed of options.seeds) {
    const result = playSelfPlay({
      setup: { decks: options.decks, seed },
      maxActions: options.maxActions,
      pickAction: options.pickAction,
    })
    if (result.kind === '決着') actionsTaken.set(seed, result.actionsTaken)
    else failures.push({ seed, result })
  }

  return failures.length > 0 ? { kind: '失敗', failures } : { kind: '全て決着', actionsTaken }
}
