import { cannot, done } from './action.js'
import type { ActionOutcome, ActionViolation } from './action.js'
import { areaOf } from './board.js'
import type { Square } from './board.js'
import { hasDream } from './card.js'
import type { Card } from './card.js'
import { payEnergyCost, satisfiesLevel } from './cost.js'
import {
  cardsIn,
  cardsInResolveZone,
  cardsOn,
  findInZone,
  moveToResolveZone,
  moveToSquare,
  moveToZone,
} from './duel.js'
import type { CardId, DuelState } from './duel.js'
import type { Effect } from './effect.js'
import type { Player } from './player.js'
import { activePlayerMayAct, grantPriorityToInactive } from './priority.js'
import { resolveEffect } from './resolve.js'
import type { Chooser } from './resolve.js'

/**
 * プレイするカードの宣言（総合ルール 第4部 第6章 1-1）。
 *
 * どのカードをプレイするかは engine が選べないのでプレイヤーから受け取る。どのエネルギーを
 * フリーズしてコストを支払うか（同 1-3）と、効果の中の選択（同 第8章 2-3）は、宣言では
 * なくその場の選択なので `chooser` が答える。
 */
export interface PlayDeclaration {
  readonly card: CardId
  /**
   * ユニットをプレイする時に指定するスクエア（総合ルール 第2部 第20章 1-3）。
   *
   * ユニット以外をプレイする時には指定しない。
   */
  readonly square?: Square
}

/**
 * 手札またはプランゾーンにあるカードを、その種別のカードとしてプレイする
 * （総合ルール 第4部 第6章 1、第2部 第20章 1・2）。
 *
 * カードのプレイができるのは、アクティブプレイヤーが、バトル中以外の自分のメインフェイズの
 * 間、バンクが空で優先権を持っている時である（同 第20章 1-1・2-1）。
 *
 * 宣言してからコストを支払い、バンクを使用せず直ちに解決される（同 第4部 第6章 1-1〜1-4）。
 * 解決が終わると非アクティブプレイヤーが優先権を獲得する（同 1-5）。カードがプレイされた
 * 時に誘発する能力（同 1-5）はまだ扱えない。誘発型能力を持てるのはスクエアにいるユニット
 * だけ（`bank.ts` の `trigger`）で、プレイされたカードはまだスクエアにいないためである。
 *
 * トラップはここではプレイできない。トラップはトラップとしてしかプレイできない
 * （同 第2部 第20章 3-1）ので `playAsTrap` を使う。
 */
export function playCard(state: DuelState, declaration: PlayDeclaration, chooser: Chooser): ActionOutcome {
  if (!activePlayerMayAct(state, 'メインフェイズ')) return cannot('行える時ではない')

  const player = state.turn.active
  const inHand = findInZone(state, player, '手札', declaration.card)
  const asPlan = findInZone(state, player, 'プランゾーン', declaration.card)
  const instance = inHand ?? asPlan
  if (instance === undefined) return cannot('そのゾーンにない')
  // プランゾーンからプレイできるのは「夢」を持つカードだけである（総合ルール 第5部 第1章 2）。
  if (inHand === undefined && !hasDream(instance.card)) return cannot('プランゾーンからプレイできない')

  const { card } = instance
  if (card.type === 'トラップ') return cannot('トラップとしてしかプレイできない')

  if (card.type === 'ユニット') {
    const { square } = declaration
    if (square === undefined) return cannot('指定できないスクエア')

    const violation = checkSquare(state, player, square)
    if (violation !== undefined) return cannot(violation)

    const paid = payUseCost(state, player, card, chooser)
    if (typeof paid === 'string') return cannot(paid)

    return done(grantPriorityToInactive(placePlayedUnit(paid, instance.id, square, player)))
  }

  const paid = payUseCost(state, player, card, chooser)
  if (typeof paid === 'string') return cannot(paid)

  return done(grantPriorityToInactive(resolveInResolveZone(paid, instance.id, card.effect, player, chooser)))
}

/**
 * 手札にあるカードを、トラップとして裏向きにプレイする（総合ルール 第2部 第20章 3-1）。
 *
 * トラップ以外のカードもトラップとしてプレイできる。「夢」を持つカードであっても、
 * プランゾーンからプレイしてトラップゾーンに置くことはできない（同 3-1）。
 *
 * レベルを満たす必要も、コストを支払う必要もない（同 3-2）。バンクを使用せず即座に解決され
 * （同 3-3）、自分の支配下で自分のトラップゾーンにリリース状態で裏向きに置かれる（同 3-4）。
 *
 * 表向きか裏向きかは盤面が持っていない。トラップゾーンに置かれたカードは裏向きであり
 * （同 3-4）、そこから動かない限り表向きになることもないため、置かれている場所から決まる。
 * 相手に見せない情報として扱うのは、視点ごとに盤面を射影する側の仕事である（ADR-0004）。
 */
export function playAsTrap(state: DuelState, card: CardId): ActionOutcome {
  if (!activePlayerMayAct(state, 'メインフェイズ')) return cannot('行える時ではない')

  const player = state.turn.active
  if (findInZone(state, player, '手札', card) === undefined) return cannot('そのゾーンにない')
  // 自分のトラップゾーンにカードがなければプレイできる（総合ルール 第2部 第20章 3-1）。
  if (cardsIn(state, player, 'トラップゾーン').length > 0) return cannot('トラップゾーンが空ではない')

  return done(grantPriorityToInactive(moveToZone(state, card, 'トラップゾーン')))
}

/**
 * トラップゾーンにあるトラップを発動する（総合ルール 第2部 第20章 3-8〜3-11）。
 *
 * 発動するのは優先権を持っているプレイヤーである。カードのプレイと違い、自分のメインフェイズ
 * であることもバンクが空であることも要らない（同 3-8）。
 *
 * 本来、トラップを発動できるのは、そのトラップの発動条件が満たされて発動する権利を得ている
 * 間だけである（同 3-8）。発動条件は《 》でくくられたテキストとトリガーアイコンで書かれる
 * （同 3-6）が、盤面がまだどちらも持っていないため、権利の有無は判定できない。ここでは、
 * 優先権を持っている間はいつでも発動できるものとして扱う。発動条件を持たないトラップ以外の
 * カードは、トラップゾーンにあっても発動できない（同 3-6）。
 *
 * レベルを満たし（同 3-9）、コストを支払って（同 3-10）、リゾルブゾーンで解決される
 * （同 3-11）。
 */
export function activateTrap(state: DuelState, card: CardId, chooser: Chooser): ActionOutcome {
  const player = state.turn.priority
  const instance = findInZone(state, player, 'トラップゾーン', card)
  if (instance === undefined) return cannot('そのゾーンにない')
  if (instance.card.type !== 'トラップ') return cannot('発動できるカードではない')

  const paid = payUseCost(state, player, instance.card, chooser)
  if (typeof paid === 'string') return cannot(paid)

  const resolved = resolveInResolveZone(paid, card, instance.card.effect, player, chooser)
  return done(grantPriorityToInactive(resolved))
}

/**
 * レベルを満たしていることを確かめ、使用コストを支払う（総合ルール 第4部 第6章 1-3）。
 * 満たしていないか支払えなければ、その理由を返す。
 *
 * 返り値が理由かどうかは `typeof` で見分ける。`ActionViolation` は文字列で、盤面は
 * オブジェクトなので取り違えようがない。
 */
function payUseCost(
  state: DuelState,
  player: Player,
  card: Card,
  chooser: Chooser,
): DuelState | ActionViolation {
  if (!satisfiesLevel(state, player, card)) return 'レベルを満たしていない'
  return payEnergyCost(state, player, card, chooser) ?? 'コストを支払えない'
}

/**
 * ユニットをプレイする時に指定できるスクエアか（総合ルール 第2部 第20章 1-3）。
 *
 * 指定できるのは、自分のユニットのない味方エリアまたは中央エリアのスクエアである。
 * エリアはプレイするプレイヤーから見て判断する（同 第22章 6-1）。
 */
function checkSquare(state: DuelState, player: Player, square: Square): ActionViolation | undefined {
  if (areaOf(player, square) === '敵エリア') return '指定できないスクエア'

  const occupied = cardsOn(state, square).some(
    (each) => each.controller === player && each.card.type === 'ユニット',
  )
  return occupied ? '指定できないスクエア' : undefined
}

/**
 * プレイされたユニットを、解決の最後に指定されたスクエアに置く（総合ルール 第4部
 * 第8章 2-7）。プレイしたプレイヤーの支配下で、フリーズ状態で置かれる（同 第2部
 * 第20章 1-4）。
 *
 * プレイされたユニットがスクエアに置かれることを「登場する」と表現する（同 1-4-a）が、
 * 「登場した時」に誘発する能力はまだ誘発させない。誘発するのは置かれたそのユニットの能力
 * だけで、いまある `trigger` はスクエアにいるユニット全部を見てしまうためである。登場を
 * 実装する時に足す。
 */
function placePlayedUnit(state: DuelState, id: CardId, square: Square, player: Player): DuelState {
  const placed = moveToSquare(state, id, square, { controller: player, orientation: 'フリーズ' })
  if (areaOf(player, square) !== '中央エリア') return placed

  // 中央エリアのスクエアを指定してプレイされたユニットは、ルールエフェクトによって捨札に
  // 置かれる（総合ルール 第4部 第14章 4-9）。効果によって中央エリアに置かれたユニットとは
  // 区別されるので、プレイしたこちらが覚えておく。
  return { ...placed, playedIntoCenter: [...placed.playedIntoCenter, id] }
}

/**
 * プレイされたストラテジー・超必殺ストラテジー！や、発動されたトラップを、リゾルブゾーンで
 * 解決する（総合ルール 第4部 第8章 2-1・2-2）。
 *
 * 解決の最後に、リゾルブゾーンにあるなら持ち主の捨札に置かれる（同 2-7）。効果によって
 * リゾルブゾーンから別のゾーンへ動いていた場合は、そこに残る。
 *
 * 効果はカードから引かずに受け取る。カードはリゾルブゾーンへ移した後さらに動くことがあり、
 * 解決している途中でカードを引き直せないためである。
 */
function resolveInResolveZone(
  state: DuelState,
  id: CardId,
  effect: Effect,
  controller: Player,
  chooser: Chooser,
): DuelState {
  const placed = moveToResolveZone(state, id)
  const resolved = resolveEffect(placed, effect, { controller, chooser })

  const stillResolving = cardsInResolveZone(resolved).some((each) => each.id === id)
  return stillResolving ? moveToZone(resolved, id, '捨札') : resolved
}
