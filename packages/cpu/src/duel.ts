import { applyWithAnswers, hasEnded, prepareDuel, splitRandom } from '@revolution/engine'
import type { ChoiceAnswer, Deck, DuelState, Player, Random, Seat } from '@revolution/engine'
import { actionViewOf, choiceViewOf } from './player.js'
import type { CpuPlayer } from './player.js'

/**
 * CPU 同士で 1 回のデュエルを打つ（ADR-0060 の段階 1、#365）。2 つの CPU を比べる時に使う
 * （`compare.ts`）。
 *
 * 進め方は、部屋が人と CPU を打たせる道筋（`server` の `room.ts` の `advance`）と同じである。
 * 行動を答えの並びで適用し（`applyWithAnswers`、ADR-0008）、選ぶことがあればその人に答えさせて、
 * 答えを 1 つ追加して適用し直す。CPU に渡すものは必ず射影を通す（`player.ts`）。
 */

/** 1 つの席に着く CPU と、その CPU が使うデッキ。 */
export interface CpuDuelSeat {
  readonly cpu: CpuPlayer
  readonly deck: Deck
}

export interface CpuDuelOptions {
  /** 席の順に並べる。先攻・後攻はシードから決まる（`prepareDuel`）。 */
  readonly seats: readonly [CpuDuelSeat, CpuDuelSeat]
  /** シャッフル・先攻後攻・CPU が使う乱数のシード。 */
  readonly seed: number
  /**
   * 決着とみなさずに打ち切る、行った手の数の上限。選択への答えは件数に入れない。
   *
   * 終わらない手順に落ちても止まるようにするためにある。届いたら決着していないものとして扱う。
   */
  readonly maxActions: number
}

export type CpuDuelResult =
  | {
      readonly kind: '決着'
      /** 勝った席。引き分けなら `undefined`。 */
      readonly winner: Seat | undefined
      /** 先攻になった席。 */
      readonly first: Seat
      readonly actionsTaken: number
    }
  | { readonly kind: '手数上限'; readonly first: Seat; readonly actionsTaken: number }

/** そのプレイヤー（先攻・後攻）が着いている席。 */
function seatOfPlayer(first: Seat, player: Player): Seat {
  return player === '先攻' ? first : first === 0 ? 1 : 0
}

/**
 * CPU 同士で 1 回のデュエルを打つ。
 *
 * 同じ設定なら、必ず同じ結果になる。乱数はすべてシードから決まる。
 */
export function playCpuDuel(options: CpuDuelOptions): CpuDuelResult {
  const [seat0, seat1] = options.seats
  const prepared = prepareDuel({ decks: [seat0.deck, seat1.deck], seed: options.seed })
  if (prepared.kind !== '準備完了') {
    throw new Error(`デッキが構築戦の規定を満たしていません: ${JSON.stringify(prepared.violations)}`)
  }

  const { first } = prepared
  // CPU が手を選ぶ乱数列は、盤面の乱数列（シャッフル）とは別に、席ごとに切り出す。部屋で CPU が
  // 使う列も、盤面のものとは別である（`setup.ts` の `DuelPreparation.random`）。
  const firstRandom = splitRandom(prepared.random)
  const randoms: [Random, Random] = [firstRandom, splitRandom(firstRandom)]
  const cpuOf = (player: Player): { readonly seat: Seat; readonly cpu: CpuPlayer } => {
    const seat = seatOfPlayer(first, player)
    return { seat, cpu: options.seats[seat].cpu }
  }

  let state: DuelState = prepared.state
  let actionsTaken = 0
  while (!hasEnded(state)) {
    if (actionsTaken >= options.maxActions) return { kind: '手数上限', first, actionsTaken }

    const acting = cpuOf(state.turn.priority)
    const picked = acting.cpu.pickAction(actionViewOf(state, state.turn.priority), randoms[acting.seat])
    // 優先権を持つプレイヤーは、終わっていない限り必ず放棄できる（`legal-action.ts`）。
    if (picked === undefined) throw new Error('CPU が手を選ばなかった')
    randoms[acting.seat] = picked.random

    const answers: ChoiceAnswer[] = []
    for (;;) {
      const progress = applyWithAnswers(state, picked.action, answers)
      if (progress.kind === '進んだ') {
        state = progress.state
        break
      }

      const answering = cpuOf(progress.choice.player)
      const answered = answering.cpu.answer(choiceViewOf(progress.board, progress.choice), randoms[answering.seat])
      randoms[answering.seat] = answered.random
      answers.push(answered.answer)
    }
    actionsTaken += 1
  }

  const result = state.result
  const winner = result?.kind === '勝利' ? seatOfPlayer(first, result.winner) : undefined
  return { kind: '決着', winner, first, actionsTaken }
}
