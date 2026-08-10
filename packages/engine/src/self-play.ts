import type { Deck } from './deck.js'
import type { DuelState } from './duel.js'
import { hasEnded } from './duel.js'
import { cardIdsOf, checkBoardInvariants } from './invariant.js'
import type { InvariantViolation } from './invariant.js'
import { applyLegalAction, legalActions } from './legal-move.js'
import type { LegalAction } from './legal-move.js'
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
 * `playRandomSelfPlay` はこれを差し替えられるので、ランダムに選ぶだけのファザ役以外に、
 * 人間の入力や探索によるプレイヤーを挿すこともできる。
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

export interface SelfPlayOptions {
  readonly setup: DuelSetup
  /**
   * 完走とみなさずに打ち切る手数の上限。無限ループそのものを検出するわけではなく、この
   * 回数まで決着しなければ「無限ループの疑いがある」ものとして扱う（ADR-0005）。
   */
  readonly maxMoves: number
  /** 次に行う手を選ぶプレイヤー。省略すればランダムに選ぶ（`pickRandomAction`）。 */
  readonly pickAction?: ActionPicker
}

export type SelfPlayResult =
  | { readonly kind: '決着'; readonly state: DuelState; readonly moves: number }
  | { readonly kind: '手数上限'; readonly state: DuelState; readonly moves: number }
  | {
      readonly kind: '不変条件違反'
      readonly state: DuelState
      readonly violations: readonly InvariantViolation[]
      readonly moves: number
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
export function playRandomSelfPlay(options: SelfPlayOptions): SelfPlayResult {
  const prepared = prepareDuel(options.setup)
  if (prepared.kind !== '準備完了') return prepared

  const pickAction = options.pickAction ?? pickRandomAction
  const initialCardIds = cardIdsOf(prepared.state)
  let state = prepared.state
  let random = prepared.random

  for (let move = 0; move < options.maxMoves; move += 1) {
    const picked = pickAction(legalActions(state), random)
    // `優先権を放棄する` は終了していない限り必ず合法手にある（`legal-move.ts`）ため、
    // 実際には起こらない。起こったならそれ自体が不変条件の崩れなので、そう報告する。
    if (picked === undefined) {
      return { kind: '不変条件違反', state, violations: [{ kind: '終了していないのに合法手が無い' }], moves: move }
    }

    const { chooser, current } = randomChooser(picked.random)
    state = applyLegalAction(state, picked.action, chooser)
    random = current()

    const violations = checkBoardInvariants(state, initialCardIds)
    if (violations.length > 0) return { kind: '不変条件違反', state, violations, moves: move + 1 }

    if (hasEnded(state)) return { kind: '決着', state, moves: move + 1 }
  }

  return { kind: '手数上限', state, moves: options.maxMoves }
}

/** 複数シード分の自己対戦をまとめて回すのに必要なもの（ADR-0005）。 */
export interface SelfPlayBatchOptions {
  /** 両プレイヤーのデッキ。シードだけを変えて何度も同じデッキで対戦させる。 */
  readonly decks: readonly [Deck, Deck]
  /** 対戦させるシードの並び。 */
  readonly seeds: readonly number[]
  readonly maxMoves: number
  readonly pickAction?: ActionPicker
}

export type SelfPlayBatchResult =
  | { readonly kind: '全て決着'; readonly moves: ReadonlyMap<number, number> }
  | { readonly kind: '失敗'; readonly seed: number; readonly result: SelfPlayResult }

/**
 * 複数のシードで自己対戦を回し、失敗を集約する（ADR-0005）。
 *
 * ファザとして大量の自己対戦を回すには、1 本ずつ `playRandomSelfPlay` を呼ぶだけでは
 * 済まず、どのシードで何が起きたかを集約する層が要る。最初に失敗したシードが見つかれば
 * そこで打ち切り、そのシードと結果を返す。すべて決着すれば、シードごとの決着までの手数を
 * 返す。
 */
export function runSelfPlayBatch(options: SelfPlayBatchOptions): SelfPlayBatchResult {
  const moves = new Map<number, number>()

  for (const seed of options.seeds) {
    const result = playRandomSelfPlay({
      setup: { decks: options.decks, seed },
      maxMoves: options.maxMoves,
      pickAction: options.pickAction,
    })
    if (result.kind !== '決着') return { kind: '失敗', seed, result }
    moves.set(seed, result.moves)
  }

  return { kind: '全て決着', moves }
}
