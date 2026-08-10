import type { DuelState } from './duel.js'
import { hasEnded } from './duel.js'
import { cardIdsOf, checkBoardInvariants } from './invariant.js'
import type { InvariantViolation } from './invariant.js'
import { applyMove, legalMoves } from './legal-move.js'
import type { Move } from './legal-move.js'
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

/** 合法手から 1 つランダムに選ぶ。合法手が無ければ `undefined`。 */
function pickMove(
  moves: readonly Move[],
  random: Random,
): { readonly move: Move; readonly random: Random } | undefined {
  if (moves.length === 0) return undefined

  const picked = nextInt(random, moves.length)
  const move = moves[picked.value]
  return move === undefined ? undefined : { move, random: picked.random }
}

export interface SelfPlayOptions {
  readonly setup: DuelSetup
  /**
   * 完走とみなさずに打ち切る手数の上限。無限ループそのものを検出するわけではなく、この
   * 回数まで決着しなければ「無限ループの疑いがある」ものとして扱う（ADR-0005）。
   */
  readonly maxMoves: number
}

export type SelfPlayResult =
  | { readonly kind: '決着'; readonly state: DuelState; readonly moves: number }
  | { readonly kind: '手数上限'; readonly state: DuelState }
  | {
      readonly kind: '不変条件違反'
      readonly state: DuelState
      readonly violations: readonly InvariantViolation[]
      readonly moves: number
    }
  | { readonly kind: 'デッキ不備'; readonly violations: readonly SeatedViolation[] }

/**
 * 合法手からランダムに選ぶだけのプレイヤーで、デュエルを 1 本最後まで自己対戦させる
 * （ADR-0005）。
 *
 * シードから常に同じ対戦になる。失敗した対戦を、そのシードだけで丸ごと再生できること
 * （`options.setup.seed`、同）が、この関数の値の大半を占める。
 *
 * 盤面の不変条件（カードの総数が変わらない、ダメージが負にならないなど、`invariant.ts`）が
 * 崩れていないかを、行動を行うたびに確かめる。崩れていればそこで打ち切り、その盤面と
 * 崩れた条件を返す。手数が上限に達しても決着しなければ、無限ループの疑いとして打ち切る。
 */
export function playRandomSelfPlay(options: SelfPlayOptions): SelfPlayResult {
  const prepared = prepareDuel(options.setup)
  if (prepared.kind !== '準備完了') return prepared

  const initialCardIds = cardIdsOf(prepared.state)
  let state = prepared.state
  let random = prepared.random

  for (let move = 0; move < options.maxMoves; move += 1) {
    if (hasEnded(state)) return { kind: '決着', state, moves: move }

    const violations = checkBoardInvariants(state, initialCardIds)
    if (violations.length > 0) return { kind: '不変条件違反', state, violations, moves: move }

    const picked = pickMove(legalMoves(state), random)
    // `優先権を放棄する` は終了していない限り必ず合法手にある（`legal-move.ts`）ため、
    // 実際には起こらない。起こったならそれ自体が不変条件の崩れなので、そう報告する。
    if (picked === undefined) {
      return { kind: '不変条件違反', state, violations: ['終了していないのに合法手が 1 つも無い'], moves: move }
    }

    const { chooser, current } = randomChooser(picked.random)
    state = applyMove(state, picked.move, chooser)
    random = current()
  }

  return { kind: '手数上限', state }
}
