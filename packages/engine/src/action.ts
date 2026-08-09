import { payPlanCost } from './cost.js'
import { cardsIn, findInZone, moveToZone, topOfLibrary } from './duel.js'
import type { CardId, DuelState } from './duel.js'
import type { Player } from './player.js'
import { activePlayerMayAct, grantPriorityToInactive } from './priority.js'
import type { Chooser } from './resolve.js'

/**
 * 行動が行えなかった理由。
 *
 * 行えない行動を engine が黙って無視すると、入力の誤りとルールによる禁止の区別がつかなく
 * なる。どちらもプレイヤーの入力であって呼ぶ側の誤りではないので、例外ではなく値で返す。
 */
export type ActionViolation =
  /** 優先権・フェイズ・バンクのいずれかの条件を満たしていない（総合ルール 第3部 第7章 1・第8章 2）。 */
  | '行える時ではない'
  /** そのカードが、その行動を行えるゾーンにない。 */
  | 'そのゾーンにない'
  /** 「夢」を持たないカードはプランゾーンからプレイできない（総合ルール 第5部 第1章 2）。 */
  | 'プランゾーンからプレイできない'
  /** トラップはトラップとしてしかプレイできない（総合ルール 第2部 第20章 3-1）。 */
  | 'トラップとしてしかプレイできない'
  /** 発動条件を持たないカードは発動できない（総合ルール 第2部 第20章 3-6）。 */
  | '発動できるカードではない'
  /** 総合ルール 第1部 第2章 3-1。 */
  | 'レベルを満たしていない'
  /** 総合ルール 第1部 第2章 3-2。 */
  | 'コストを支払えない'
  /** ユニットを置けないスクエアを指定した（総合ルール 第2部 第20章 1-3）。 */
  | '指定できないスクエア'
  /** すでにトラップゾーンにカードがある（総合ルール 第2部 第20章 3-1）。 */
  | 'トラップゾーンが空ではない'

/** プレイヤーが行動を 1 つ行った結果。 */
export type ActionOutcome =
  | { readonly kind: '行った'; readonly state: DuelState }
  | { readonly kind: '行えない'; readonly violation: ActionViolation }

export function done(state: DuelState): ActionOutcome {
  return { kind: '行った', state }
}

export function cannot(violation: ActionViolation): ActionOutcome {
  return { kind: '行えない', violation }
}

/**
 * 自分の手札を 1 枚選んで、持ち主のエネルギーゾーンに表向きにリリース状態で置く
 * （総合ルール 第3部 第7章 1）。この特別な行動はバンクを使用しない。
 *
 * 置けるのはそのエネルギーフェイズに 1 枚だけである（同）。行った後もバンクは空のまま
 * 優先権が戻ってくるので、行ったかどうかを `Turn` が覚えている。
 *
 * 特別な行動を行った後、非アクティブプレイヤーが優先権を獲得する（同 第4部 第5章 2）。
 */
export function placeEnergy(state: DuelState, card: CardId): ActionOutcome {
  if (!activePlayerMayAct(state, 'エネルギーフェイズ')) return cannot('行える時ではない')
  if (state.turn.energyPlaced) return cannot('行える時ではない')

  const player = state.turn.active
  if (findInZone(state, player, '手札', card) === undefined) return cannot('そのゾーンにない')

  const placed = moveToZone(state, card, 'エネルギーゾーン')
  return done(grantPriorityToInactive({ ...placed, turn: { ...placed.turn, energyPlaced: true } }))
}

/**
 * プランする（総合ルール 第3部 第8章 2-3）。
 *
 * コストとして自分のエネルギーかスマッシュを 1 枚フリーズし、効果として自分の山札の
 * 1 番上のカードを表返す。すでにプランゾーンにカードがあるなら、そのカードを捨札に置いて
 * から、次の山札の 1 番上のカードを表返す。
 *
 * 「プランする」ことは起動型能力である（同）ため、バンクを使用せず直ちに解決され、その後
 * 非アクティブプレイヤーが優先権を獲得する（同 第4部 第6章 1-4・1-5）。
 *
 * 山札が空なら表返すカードが無い。実行できない行動は実行されない（同 第1部 第1章 3）
 * だけで、コストはすでに支払われている。
 */
export function plan(state: DuelState, chooser: Chooser): ActionOutcome {
  if (!activePlayerMayAct(state, 'メインフェイズ')) return cannot('行える時ではない')

  const player = state.turn.active
  const paid = payPlanCost(state, player, chooser)
  if (paid === undefined) return cannot('コストを支払えない')

  return done(grantPriorityToInactive(turnUpTopOfLibrary(paid, player)))
}

/**
 * トラップの廃棄（総合ルール 第2部 第20章 3-12）。自分のトラップゾーンにあるカードを
 * 自分の捨札に置く。
 *
 * バンクを使用せず即座に解決される（同 3-13）。
 */
export function discardTrap(state: DuelState, card: CardId): ActionOutcome {
  if (!activePlayerMayAct(state, 'メインフェイズ')) return cannot('行える時ではない')

  const player = state.turn.active
  if (findInZone(state, player, 'トラップゾーン', card) === undefined) return cannot('そのゾーンにない')

  return done(grantPriorityToInactive(moveToZone(state, card, '捨札')))
}

/**
 * 山札の 1 番上のカードを表返してプランゾーンに置く。
 *
 * すでにプランゾーンにカードがあるなら、先にそれを捨札に置く（総合ルール 第3部
 * 第8章 2-3）。プランゾーンにあるカードは同時に山札の 1 番上のカードでもある
 * （同 第2部 第21章 3-1）ので、それを取り除いて初めて次のカードが 1 番上になる。
 */
function turnUpTopOfLibrary(state: DuelState, player: Player): DuelState {
  const [current] = cardsIn(state, player, 'プランゾーン')
  const cleared = current === undefined ? state : moveToZone(state, current.id, '捨札')

  const top = topOfLibrary(cleared, player)
  if (top === undefined) return cleared

  return moveToZone(cleared, top.id, 'プランゾーン')
}
