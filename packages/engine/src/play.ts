import { cannot, done } from './action.js'
import type { ActionOutcome, ActionViolation } from './action.js'
import { triggerAppearance } from './bank.js'
import { areaOf } from './board.js'
import type { Square } from './board.js'
import { hasDream, hasGuts } from './card.js'
import type { Card, UnitCard } from './card.js'
import { payEnergyCost, satisfiesLevel } from './cost.js'
import { checkCourageCondition } from './courage.js'
import {
  cardsIn,
  cardsInResolveZone,
  cardsOn,
  findInZone,
  hasEnded,
  moveToResolveZone,
  moveToSquare,
  moveToZone,
} from './duel.js'
import type { CardId, DuelState } from './duel.js'
import type { Effect, UnitOnSquare } from './effect.js'
import type { Player } from './player.js'
import { activePlayerMayAct, grantPriorityToInactive } from './priority.js'
import { resolveEffect } from './resolve.js'
import type { Chooser } from './resolve.js'
import { checkIntrusion, trapRightOf } from './trap.js'
import type { PlayerZone } from './zone.js'

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
 * 解決が終わると非アクティブプレイヤーが優先権を獲得する（同 1-5）。プレイされたユニットが
 * スクエアに置かれたことで誘発する「登場した時」（同 第2部 第20章 1-4-a）は誘発する
 * （`placePlayedUnit`）が、それとは別の、カードがプレイされたこと自体に誘発する能力
 * （同 第4部 第6章 1-5）はまだ扱えない。誘発型能力を持てるのはスクエアにいるユニットだけ
 * （`bank.ts` の `trigger`）で、ストラテジー・トラップはスクエアにいないためである。
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

    // プレイされたゾーンは、登場した後には分からなくなる（プランゾーンは無くなる、
    // 総合ルール 第2部 第21章 3-3）。ここで捕まえて誘発の判定まで運ぶ。
    const from: PlayerZone = inHand === undefined ? 'プランゾーン' : '手札'
    return done(grantPriorityToInactive(placePlayedUnit(paid, instance.id, card, square, player, from)))
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
 * トラップを発動できるのは、そのトラップの発動条件が満たされて発動する権利を得ている間だけ
 * である（同 3-8、`trap.ts` の `trapRightOf`）。バトルやスマッシュ判定が進行中なら、
 * 発動条件が満たされていても権利は発生していない（同 3-8 ただし書き）。発動条件を持たない
 * トラップ以外のカードは、トラップゾーンにあっても発動できない（同 3-6）。発動条件のうち
 * 実装しているのは「侵入」だけなので（`trap.ts`）、それ以外の条件で権利を得ることはまだ無い。
 *
 * レベルを満たし（同 3-9）、コストを支払って（同 3-10）、リゾルブゾーンで解決される
 * （同 3-11）。
 */
export function activateTrap(state: DuelState, card: CardId, chooser: Chooser): ActionOutcome {
  // 勝敗が決まったデュエルは即座に終了する（総合ルール 第3部 第3章 3）ので、そこから先に
  // 優先権は発生しない。他の行動は `activePlayerMayAct` が同じことを見ている。
  if (hasEnded(state)) return cannot('行える時ではない')

  const player = state.turn.priority
  const instance = findInZone(state, player, 'トラップゾーン', card)
  if (instance === undefined) return cannot('そのゾーンにない')
  const trap = instance.card
  if (trap.type !== 'トラップ') return cannot('発動できるカードではない')
  const occasion = trapRightOf(state, card)
  if (occasion === undefined) return cannot('発動する権利がない')

  const paid = payUseCost(state, player, trap, chooser)
  if (typeof paid === 'string') return cannot(paid)

  // 発動条件を満たしたできごとを効果に渡す（`effect.ts` の `TrapEffect`）。ここで束ねるのは、
  // きっかけを知っているのが発動する経路だけだからである。解決する側（`resolveEffect`）は
  // どの経路から来た効果かを知らないままでよい。
  const resolved = resolveInResolveZone(paid, card, (duel) => trap.effect(duel, occasion), player, chooser, [
    occasion.invader,
  ])
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
 * 第20章 1-4）。ただし「根性」を持つユニットは、そのかわりにリリース状態で置かれる
 * （同 第5部 第6章 2）。
 *
 * プレイされたユニットがスクエアに置かれることを「登場する」と表現する（同 1-4-a）。
 * 登場したことで、置かれたそのユニット自身の「登場した時」に誘発する能力が誘発する
 * （`triggerAppearance`）。効果によってスクエアに置かれる場合はここを通らないので誘発しない。
 * 「根性」が効果によって置かれる時には働かない（同 第5部 第6章 3）のも、ここを通らない
 * ことがそのまま境目になっている。
 */
function placePlayedUnit(
  state: DuelState,
  id: CardId,
  card: UnitCard,
  square: Square,
  player: Player,
  from: PlayerZone,
): DuelState {
  const orientation = hasGuts(card) ? 'リリース' : 'フリーズ'
  const moved = moveToSquare(state, id, square, { controller: player, orientation })
  const placed = triggerAppearance(moved, id, { kind: '登場', square, from })
  // 置かれたユニットが相手のトラップのトリガーアイコンのスクエアに置かれたなら「侵入」に
  // なり、そのトラップの支配者が発動する権利を得る（総合ルール 第2部 第20章 3-6）。相手から
  // 見て味方エリアか中央エリアなら、あわせて「勇気」の起動条件も満たされる（同 第5部 第2章 2）。
  const unit: UnitOnSquare = { id, square, card, controller: player }
  const invaded = checkCourageCondition(checkIntrusion(placed, unit), unit)
  if (areaOf(player, square) !== '中央エリア') return invaded

  // 中央エリアのスクエアを指定してプレイされたユニットは、ルールエフェクトによって捨札に
  // 置かれる（総合ルール 第4部 第14章 4-9）。効果によって中央エリアに置かれたユニットとは
  // 区別されるので、プレイしたこちらが覚えておく。
  return { ...invaded, playedIntoCenter: [...invaded.playedIntoCenter, id] }
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
 *
 * `handed` は、`DuelView` を通さずに効果へ直接渡したユニット（`resolve.ts` の
 * `EffectContext.handed`）。発動したトラップが、きっかけに載っている侵入してきた敵を
 * 渡す場合に使う。
 */
function resolveInResolveZone(
  state: DuelState,
  id: CardId,
  effect: Effect,
  controller: Player,
  chooser: Chooser,
  handed?: readonly UnitOnSquare[],
): DuelState {
  const placed = moveToResolveZone(state, id)
  const resolved = resolveEffect(placed, effect, { controller, chooser, handed })

  const stillResolving = cardsInResolveZone(resolved).some((each) => each.id === id)
  return stillResolving ? moveToZone(resolved, id, '捨札') : resolved
}
