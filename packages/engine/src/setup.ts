import type { Card } from './card.js'
import { checkConstructedDeck } from './deck.js'
import type { Deck, DeckViolation } from './deck.js'
import { emptyDuelState, instantiate, putInZone } from './duel.js'
import type { CardInstance, DuelState } from './duel.js'
import { record } from './log.js'
import type { Player } from './player.js'
import { nextInt, randomFromSeed, shuffle } from './random.js'
import type { Random } from './random.js'

/**
 * デュエルに参加する 2 人のうちどちらか。
 *
 * 先攻・後攻はデッキをシャッフルした後にランダムに決まる（総合ルール 第3部 第1章 5）
 * ため、準備に入る時点の 2 人は `Player` では指せない。デッキを渡された順で指す。
 */
export type Seat = 0 | 1

const SEATS = [0, 1] as const satisfies readonly Seat[]

/** デュエルの準備に必要なもの。 */
export interface DuelSetup {
  /** 2 人のデッキ。並びは席の順であって、先攻・後攻の順ではない。 */
  readonly decks: readonly [Deck, Deck]
  /** シャッフルと先攻・後攻の決定に使う乱数のシード（ADR-0005）。 */
  readonly seed: number
}

/** どの席のデッキがどう規定を満たしていないか。 */
export interface SeatedViolation {
  readonly seat: Seat
  readonly violation: DeckViolation
}

export type DuelPreparation =
  | {
      readonly kind: '準備完了'
      readonly state: DuelState
      /** 先攻になった席。もう一方が後攻になる。 */
      readonly first: Seat
      /** 準備で使った続きの乱数列。デュエル中に乱数が要るならここから続ける。 */
      readonly random: Random
    }
  | { readonly kind: 'デッキ不備'; readonly violations: readonly SeatedViolation[] }

/** デュエルの開始時に引く手札の枚数（総合ルール 第3部 第1章 6）。 */
export const OPENING_HAND_SIZE = 5

/**
 * デュエルの準備を行い、最初の盤面を作る（総合ルール 第3部 第1章）。
 *
 * デッキをシャッフルし、先攻・後攻を決め、それぞれが 5 枚の手札を引くところまで。同じ
 * シードからは常に同じ盤面ができる（ADR-0005）。
 *
 * 構築戦の規定を満たさないデッキがあれば、盤面を作らずに違反を返す。不正なデッキは
 * 呼ぶ側の誤りではなくプレイヤーの入力なので、例外ではなく値で返す。
 *
 * シャッフルはデッキごとに 1 回だけ行う。相手のデッキもシャッフルできる（同 4）が、
 * 何回シャッフルしても結果は不規則な順番であることに変わりがなく、盤面には現れない。
 *
 * できあがる盤面は、先攻のプレイヤーの第 1 ターンのリリースフェイズから始まっている
 * （総合ルール 第3部 第4章 1）。そこから先の進行は `progress.ts` の仕事である。
 *
 * パートナーバトル（同 3-2）と限定戦（同 3-3）は選択ルールなので扱わない。マッチの
 * 2 本目以降で先攻・後攻を負けたプレイヤーが決める（同 5）のは、マッチを実装する時に足す。
 */
export function prepareDuel(setup: DuelSetup): DuelPreparation {
  const violations = SEATS.flatMap((seat) =>
    checkConstructedDeck(setup.decks[seat]).map((violation): SeatedViolation => ({ seat, violation })),
  )
  if (violations.length > 0) return { kind: 'デッキ不備', violations }

  // 乱数を使う順番は総合ルールの手順どおりにする。シャッフル（同 4）が先で、
  // 先攻・後攻の決定（同 5）が後。ここを入れ替えるとシードから再生できなくなる。
  const shuffledOfSeat0 = shuffle(numbered(setup.decks[0]), randomFromSeed(setup.seed))
  const shuffledOfSeat1 = shuffle(numbered(setup.decks[1]), shuffledOfSeat0.random)
  const shuffled = [shuffledOfSeat0.value, shuffledOfSeat1.value] as const

  // `nextInt` は 0 か 1 を返すが、その範囲は型に出ないので `Seat` に絞り直す。
  const decided = nextInt(shuffledOfSeat1.random, SEATS.length)
  const first: Seat = decided.value === 0 ? 0 : 1

  let state = emptyDuelState()
  for (const seat of SEATS) {
    const player: Player = seat === first ? '先攻' : '後攻'
    state = deal(state, player, library(shuffled[seat], player))
  }

  return { kind: '準備完了', state: recordOpening(state), first, random: decided.random }
}

/**
 * 最初のターンに入ったことをログに積む（#133）。
 *
 * 進行の移り変わりを積むのは `progress.ts` だが、**最初のターンだけはそこを通らない。**
 * デュエルは先攻のプレイヤーの第 1 ターンから始まる（総合ルール 第3部 第4章 1）ので、
 * どこかから移ってくるわけではない。積まなければ、誰の何ターン目から始まったのかがログの
 * どこにも残らない。
 *
 * 移ってくる元が無いので `from` は `undefined` になる（`log.ts` の `進行が変わった`）。
 */
function recordOpening(state: DuelState): DuelState {
  const { turn } = state
  return record(state, {
    kind: '進行が変わった',
    from: undefined,
    to: { turn: turn.number, active: turn.active, phase: turn.phase },
  })
}

/** シャッフルしても変わらない番号をカードに振る。 */
interface NumberedCard {
  readonly card: Card
  /** デッキに置かれた順の番号。 */
  readonly number: number
}

function numbered(deck: Deck): readonly NumberedCard[] {
  return deck.map((card, index) => ({ card, number: index }))
}

/**
 * シャッフルされたデッキをデュエルに持ち込む。並びの先頭が山札の 1 番上になる。
 *
 * 識別子はシャッフル前のデッキでの番号から作る。同じカード名のカードが 4 枚まで入る
 * （総合ルール 第3部 第1章 3-1）ためカード名では指せない。
 */
function library(deck: readonly NumberedCard[], owner: Player): readonly CardInstance[] {
  return deck.map(({ card, number }) => instantiate({ id: `${owner}-${number}`, card, owner }))
}

/**
 * 山札を置き、その上から 5 枚を手札にする（総合ルール 第3部 第1章 6）。
 *
 * 山札と手札以外のゾーンには何も置かない。デュエルの開始時には、それらはすべて空である
 * （総合ルール 第2部 第21章 3-1・5-1・6-1・7-1・8-1・9-1）。
 */
function deal(state: DuelState, player: Player, cards: readonly CardInstance[]): DuelState {
  const drawn = putInZone(state, player, '手札', cards.slice(0, OPENING_HAND_SIZE))
  return putInZone(drawn, player, '山札', cards.slice(OPENING_HAND_SIZE))
}
