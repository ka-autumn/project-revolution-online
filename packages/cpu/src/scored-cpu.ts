import {
  activatedAbilitiesOf,
  courageOf,
  hasDream,
  hopeOf,
  moveCostingAbilitiesOf,
  nextInt,
  squareInDirection,
} from '@revolution/engine'
import type {
  Card,
  CardId,
  CardInstance,
  ChoiceAnswer,
  DuelPerspective,
  DuelView,
  EffectStep,
  LegalAction,
  Player,
  Random,
  Square,
  UnitCard,
  UnitOnSquare,
  WireCandidate,
  WireChoice,
} from '@revolution/engine'
import {
  SQUARES,
  cardBasePoints,
  fighterOf,
  fighterOfCard,
  forecastBattle,
  positionBasePoints,
  seenBasePoints,
  smashDamageFrom,
  unitBasePoints,
} from './forecast.js'
import type { Fighter } from './forecast.js'
import type { ActionView, ChoiceView, CpuPlayer } from './player.js'
import { keyOfWire, probeChoice, probeEffect, viewFrom } from './probe.js'
import type { ProbeSetting } from './probe.js'
import {
  areaFor,
  countIn,
  energyColorsOf,
  findVisible,
  levelSatisfied,
  opponentOf,
  releasedEnergyOf,
  sameSquare,
  smashCountOf,
  trustOf,
  unitsOf,
  visibleIn,
} from './sight.js'
import type { SeenUnit } from './sight.js'
import { nextSmasher } from './smash-order.js'

/**
 * 場面ごとに手へ点数を付けて選ぶ CPU（ADR-0060 の段階 2、#366）。
 *
 * 行える手それぞれに点数を付け、いちばん高い手を選ぶ。同じ点数の手が複数あれば、乱数で選ぶ。
 * `優先権を放棄する` は 0 点で、点数が正の手が残っている間は放棄しない。
 *
 * 効果の損得は、効果を空回しして出てくる命令から判定する（ADR-0062、`probe.ts`）。カードを
 * 名指ししない（ADR-0002）。
 */

/** 選ばない手の点数。 */
const NEVER = -Infinity
/** エネルギーを 1 枚使うことの点数。得にならないプレイで優先権を放棄しないことを防ぐ。 */
const ENERGY_USE = 50
/** 目標の枚数に届くまでの、エネルギーを置く手の点数。ほかのどの手より先に置く。 */
const ENERGY_BELOW_TARGET = 5000
/** 目標の枚数を超えて、エネルギーを 1 枚増やすことの点数。 */
const ENERGY_ABOVE_TARGET = 300
/** 手札がエネルギーより多い時、その差 1 枚につき、エネルギーを増やす点数に足す点数。 */
const ENERGY_PER_SURPLUS_CARD = 200
/** 手札のほかのカードが要るのに、エネルギーゾーンに無い色を追加する点数。 */
const MISSING_COLOR = 400
/** デッキが分からない時の、エネルギーの目標の枚数。ほとんどのカードはレベル 7 以下である。 */
const DEFAULT_ENERGY_TARGET = 7
/** 負けるバトルの後に、続けて倒しきれる時に見込む割合。 */
const FOLLOW_UP_RATIO = 0.8
/** ユニットを移動するたびに引く点数。行ったり来たりしないようにする。 */
const MOVE_COST = 20
/** トラップを伏せる点数。 */
const SET_TRAP = 150
/** 起動型能力・トラップ・「勇気」を使う時に引く点数。使えば無くなるもの・支払うもの。 */
const ABILITY_COST = 100
/** 同じ点数とみなす差。 */
const EPSILON = 1e-6

/** 点数を付ける時に、何度も参照するもの。 */
interface Context {
  readonly view: ActionView
  readonly perspective: DuelPerspective
  readonly me: Player
  readonly units: readonly SeenUnit[]
}

/** 盤面のどこかで見えているカード。 */
function cardOf(perspective: DuelPerspective, id: CardId): Card | undefined {
  return findVisible(perspective, id)?.card
}

/** そのユニットを、効果に見せる値にする。 */
function onSquare(unit: SeenUnit): UnitOnSquare {
  return { id: unit.id, square: unit.square, card: unit.card, controller: unit.controller }
}

// ---------------------------------------------------------------------------------------------
// エネルギー
// ---------------------------------------------------------------------------------------------

/**
 * エネルギーの目標の枚数。自分のデッキのカードの最大レベルである。
 *
 * それだけあれば、デッキのどのカードもレベルを満たせる（総合ルール 第1部 第2章 3-1）。
 */
export function energyTargetOf(deck: readonly Card[]): number {
  if (deck.length === 0) return DEFAULT_ENERGY_TARGET
  return Math.max(...deck.map((card) => card.level))
}

/**
 * エネルギーを置く手の点数。置けるのはエネルギーフェイズに 1 枚だけである（総合ルール 第3部 第7章 1）。
 *
 * 目標の枚数に届くまでは必ず置き、手札に持っておく基礎点が低いカードから置く。手札のほかのカードが
 * 要る色を追加するカードは、先に置く。目標を超えた後は、エネルギーを 1 枚増やす得が、そのカードを手札に
 * 持っておく基礎点を上回る時だけ置く。手札がエネルギーより多いほど、増やす得は大きい。
 */
function energyScore(context: Context, id: CardId): number {
  const { perspective, me } = context
  const card = cardOf(perspective, id)
  if (card === undefined) return NEVER

  const hand = visibleIn(perspective, me, '手札').filter((each) => each.id !== id)
  const colors = energyColorsOf(perspective, me)
  const missing = new Set(hand.flatMap((each) => each.card.colors).filter((color) => !colors.has(color)))
  const addsColor = card.colors.filter((color) => missing.has(color)).length * MISSING_COLOR
  const keep = keepBasePoints(card)

  const placed = countIn(perspective, me, 'エネルギーゾーン')
  if (placed < energyTargetOf(context.view.deck)) return ENERGY_BELOW_TARGET - keep + addsColor

  const surplus = Math.max(0, hand.length + 1 - placed)
  return ENERGY_ABOVE_TARGET + surplus * ENERGY_PER_SURPLUS_CARD - keep + addsColor
}

/** カードを手札に持っておく基礎点。エネルギーに置くカードを選ぶのに使う。 */
function keepBasePoints(card: Card): number {
  return cardBasePoints(card) * 0.5
}

// ---------------------------------------------------------------------------------------------
// ユニットのプレイと移動
// ---------------------------------------------------------------------------------------------

/** 攻め込む先にいる敵を倒した時の、上乗せの点数。味方エリアの敵は、次に＋500 でスマッシュしてくる。 */
function threatOf(me: Player, enemy: SeenUnit): number {
  const opponent = enemy.controller
  return smashDamageFrom(opponent, enemy.square, enemy.sp) * (areaFor(me, enemy.square) === '味方エリア' ? 1 : 0.5)
}

/**
 * そのユニットをその移動先へ移動する時に、追加コストとしてフリーズするエネルギーの枚数
 * （総合ルール 第4部 第6章 2-2・2-3）。見積もれなければ `Infinity`（移動できないものとして扱う）。
 *
 * 追加コストを課す能力は、スクエアにいるユニットが持つ（`move.ts` の `payMoveCosts` と同じ取得方法）。
 */
function moveCostOf(perspective: DuelPerspective, unit: SeenUnit, destination: Square): number {
  const occasion = { kind: '移動' as const, unit: onSquare(unit), destination }
  let total = 0
  for (const source of unitsOf(perspective)) {
    for (const ability of moveCostingAbilitiesOf(source.card)) {
      try {
        const view = viewFrom({ perspective, controller: source.controller, self: onSquare(source) })
        total += ability.moveCost(view, occasion)?.energiesFrozen ?? 0
      } catch {
        return Infinity
      }
    }
  }
  return total
}

/** プレイするためのコストを、残りのリリース状態のエネルギーで支払えるか（総合ルール 第1部 第2章 3-2・3-4）。 */
function payableBy(card: Card, released: readonly CardInstance[], energyLeft: number): boolean {
  if (card.level === 0) return true
  if (energyLeft <= 0) return false
  return card.colors.length === 0 || released.some((energy) => energy.card.colors.some((color) => card.colors.includes(color)))
}

/**
 * 負けるバトルの後に、同じターンのうちに倒しきれるか。
 *
 * 手札のユニットを、残りのリリース状態のエネルギーでプレイするか（相手の敵エリアにはプレイ
 * できない、総合ルール 第2部 第20章 1-3）、すでにいる味方ユニットを移動して攻め込む。移動に追加
 * コストがあれば、それも残りのエネルギーで支払えなければならない（同 第4部 第6章 2-2・2-3）。
 * レベル 0 のカードは、エネルギーをフリーズせずにプレイできる（同 第1部 第2章 3-4）。プランで
 * めくれるカードは見込まない。
 */
function canFinish(
  context: Context,
  enemy: SeenUnit,
  damage: number,
  exclude: { readonly card?: CardId; readonly unit?: CardId; readonly energyUsed: number },
): boolean {
  const { perspective, me } = context
  const target: Fighter = { ...fighterOf(enemy), damage }

  const released = releasedEnergyOf(perspective, me)
  const energyLeft = released.length - exclude.energyUsed
  if (areaFor(me, enemy.square) !== '敵エリア') {
    const byPlay = visibleIn(perspective, me, '手札').some(
      (each) =>
        each.id !== exclude.card &&
        each.card.type === 'ユニット' &&
        levelSatisfied(perspective, me, each.card) &&
        payableBy(each.card, released, energyLeft) &&
        !forecastBattle(fighterOfCard(each.card), target).defenderSurvives,
    )
    if (byPlay) return true
  }

  return context.units.some(
    (unit) =>
      unit.controller === me &&
      unit.released &&
      unit.id !== exclude.unit &&
      unit.card.moveIcon.some((direction) => {
        const reached = squareInDirection(me, unit.square, direction)
        return reached !== undefined && sameSquare(reached, enemy.square)
      }) &&
      moveCostOf(perspective, unit, enemy.square) <= energyLeft &&
      !forecastBattle(fighterOf(unit), target).defenderSurvives,
  )
}

/** これから入るユニット。 */
interface Arrival {
  readonly card: UnitCard
  readonly bp: number
  readonly sp: number
  readonly fighter: Fighter
  /** 手札から出すならそのカード、移動するならそのユニット。 */
  readonly from: { readonly card?: CardId; readonly unit?: CardId; readonly energyUsed: number }
  /** プレイして入るか。中央エリアにプレイしたユニットは、そこに残らない。 */
  readonly played: boolean
}

/**
 * ユニットがそのスクエアに入る手の点数。プレイも移動も同じ。
 *
 * 敵がいればバトルになる（総合ルール 第3部 第11章 1）。倒せる敵の基礎点から、失う味方の基礎点を
 * 引く。相打ちも、得になれば選ぶ。勝って残るなら、そのスクエアにいることの基礎点を足す。敵がいなければ、そのスクエアにいることの基礎点だけである。
 *
 * 負けるバトルでも、同じターンのうちに続けて倒しきれる見込みがあれば選ぶ（`canFinish`）。BP で負ける
 * ユニットのいるスクエアにも、この時だけはユニットを出す。#366 の完了条件「BP で負けるユニットのいる
 * スクエアには、ユニットを出さない」の例外として、開発者と決定した。
 *
 * 中央エリアにプレイしたユニットは、バトルが発生しなければすぐに、発生すればバトルの終了時に、
 * 捨札に置かれる（総合ルール 第2部 第20章 1-5）。中央エリアへのプレイは、敵を倒すためにユニットを
 * 手放す手である。
 */
function arrivalScore(context: Context, arrival: Arrival, square: Square): number {
  const { perspective, me } = context
  const enemy = context.units.find((unit) => unit.controller !== me && sameSquare(unit.square, square))
  const staying = {
    card: arrival.card,
    bp: arrival.bp,
    sp: arrival.sp,
    fighter: arrival.fighter,
    ...(arrival.from.unit === undefined ? {} : { moving: arrival.from.unit }),
  }
  const discarded = arrival.played && areaFor(me, square) === '中央エリア'
  if (enemy === undefined) return discarded ? NEVER : positionBasePoints(perspective, me, square, staying)

  const forecast = forecastBattle(arrival.fighter, fighterOf(enemy))
  const own = unitBasePoints(arrival.bp, arrival.sp)
  const loss = forecast.attackerSurvives && !discarded ? 0 : own

  if (!forecast.defenderSurvives) {
    const stay = forecast.attackerSurvives && !discarded ? positionBasePoints(perspective, me, square, staying) : 0
    return seenBasePoints(enemy) + threatOf(me, enemy) - loss + stay
  }

  const finish = canFinish(context, enemy, forecast.defenderDamage, arrival.from)
    ? (seenBasePoints(enemy) + threatOf(me, enemy)) * FOLLOW_UP_RATIO
    : 0
  return finish - loss
}

/** 登場した時に誘発する能力の損得。登場させたものとして効果を回す。 */
function appearanceScore(context: Context, card: UnitCard, square: Square, id: CardId): number {
  const arriving: SeenUnit = {
    id,
    card,
    square,
    controller: context.me,
    bp: card.bp,
    sp: card.sp,
    damage: 0,
    released: true,
  }
  const setting: ProbeSetting = {
    perspective: context.perspective,
    controller: context.me,
    self: onSquare(arriving),
    arriving,
  }

  return card.abilities.reduce((sum, ability) => {
    if (ability.kind !== '誘発型能力' || ability.event !== '登場した時') return sum
    return sum + (probeEffect(setting, ability.effect) ?? 0)
  }, 0)
}

function playScore(context: Context, id: CardId, square: Square | undefined): number {
  const card = cardOf(context.perspective, id)
  if (card === undefined) return NEVER

  if (card.type === 'ユニット') {
    if (square === undefined) return NEVER
    const arrival: Arrival = {
      card,
      bp: card.bp,
      sp: card.sp,
      fighter: fighterOfCard(card),
      from: { card: id, energyUsed: card.level === 0 ? 0 : 1 },
      played: true,
    }
    return arrivalScore(context, arrival, square) + appearanceScore(context, card, square, id) - ENERGY_USE
  }

  if (card.type === 'トラップ') return NEVER

  const effect = probeEffect({ perspective: context.perspective, controller: context.me }, card.effect)
  return effect === undefined ? NEVER : effect - ENERGY_USE - keepBasePoints(card) * 0.2
}

/**
 * このメインフェイズに、そのユニットをもう移動したか。
 *
 * ユニットを移動できるのはメインフェイズだけである（総合ルール 第3部 第8章 2-5）。ログの、いまの
 * メインフェイズに入った後の行動を参照する。
 */
function movedThisPhase(perspective: DuelPerspective, id: CardId): boolean {
  const log = perspective.log
  for (let index = log.length - 1; index >= 0; index -= 1) {
    const event = log[index]?.event
    if (event === undefined) continue
    if (event.kind === '進行が変わった' && event.to.phase === 'メインフェイズ') return false
    if (event.kind === '行動した' && event.action === 'ユニットを移動する' && event.card === id) return true
  }
  return false
}

/** そのプレイヤーから見た、エリアの前後。味方エリアが 0、敵エリアが 2。 */
function depthOf(me: Player, square: Square): number {
  const area = areaFor(me, square)
  return area === '味方エリア' ? 0 : area === '中央エリア' ? 1 : 2
}

/** そのユニットを移動先へ動かした後の盤面の射影。点数を比べるためだけに使う。 */
function movedPerspective(perspective: DuelPerspective, id: CardId, destination: Square): DuelPerspective {
  const from = perspective.squares.findIndex((cards) => cards.some((card) => card.id === id))
  const moving = perspective.squares[from]?.find((card) => card.id === id)
  if (moving === undefined) return perspective

  const to = SQUARES.findIndex((square) => sameSquare(square, destination))
  return {
    ...perspective,
    squares: perspective.squares.map((cards, index) =>
      index === from ? cards.filter((card) => card.id !== id) : index === to ? [...cards, moving] : cards,
    ),
  }
}

/**
 * 手札のユニットをいまプレイした時の、いちばん高い点数。プレイできるユニットが無ければ 0。
 *
 * プレイできるのは、自分のユニットのいない味方エリアか中央エリアのスクエアである（総合ルール
 * 第2部 第20章 1-3）。
 */
function bestUnitPlay(context: Context): number {
  const { perspective, me } = context
  // レベル 0 のカードは、エネルギーをフリーズせずにプレイできる（総合ルール 第1部 第2章 3-4）。
  const released = releasedEnergyOf(perspective, me).length

  let best = 0
  for (const each of visibleIn(perspective, me, '手札')) {
    if (each.card.type !== 'ユニット' || !levelSatisfied(perspective, me, each.card)) continue
    if (each.card.level > 0 && released === 0) continue
    for (const square of SQUARES) {
      if (areaFor(me, square) === '敵エリア') continue
      if (context.units.some((unit) => unit.controller === me && sameSquare(unit.square, square))) continue
      best = Math.max(best, playScore(context, each.id, square))
    }
  }
  return best
}

/** 「下がる」移動で、場所の基礎点がこれだけ上がらなければ移動しない。 */
const RETREAT_MARGIN = 100

/**
 * ユニットを移動する手の点数（総合ルール 第3部 第8章 2-5）。目的のある移動にだけ点数を付ける。
 *
 * - 攻め込む: 移動先に敵がいる。バトルの予測で点数を付ける。
 * - 前へ進む: 敵エリアに近づく。スマッシュのダメージが増える（同 第3部 第9章 1）。
 * - 場所を空ける: 横へ動く。空けたスクエアに手札のユニットをプレイすると、プレイの点数が上がる時だけ
 *   選ぶ。点数には、その後のプレイの点数を含める。信頼を持つユニットを中央のラインへ動かす時も選ぶ。
 * - 下がる: 味方エリアの側へ戻る。場所の基礎点が一定以上上がる時だけ選ぶ。BP が高く SP が低い
 *   ユニットが、敵を倒した後に味方エリアへ戻って守る、などである。
 *
 * 前へ進む移動と攻め込む移動は、同じメインフェイズに何回でも行う。場所を空ける移動と下がる移動は、
 * そのユニットがこのメインフェイズにまだ移動していない時だけにする。行ったり来たりしないためである。
 */
function moveScore(context: Context, id: CardId, destination: Square): number {
  const { perspective, me } = context
  const unit = context.units.find((each) => each.id === id)
  if (unit === undefined) return NEVER

  const fighter = fighterOf(unit)
  const energyUsed = moveCostOf(perspective, unit, destination)
  const arrival: Arrival = { card: unit.card, bp: unit.bp, sp: unit.sp, fighter, from: { unit: id, energyUsed }, played: false }
  const leaving = positionBasePoints(perspective, me, unit.square, { card: unit.card, bp: unit.bp, sp: unit.sp, fighter })
  const gain = arrivalScore(context, arrival, destination) - leaving - MOVE_COST

  const attacking = context.units.some((each) => each.controller !== me && sameSquare(each.square, destination))
  const step = depthOf(me, destination) - depthOf(me, unit.square)
  if (attacking || step > 0) return gain
  if (movedThisPhase(perspective, id)) return NEVER

  if (step < 0) return gain >= RETREAT_MARGIN ? gain : NEVER

  // 横へ動く。空けた後に手札のユニットをプレイした時の点数で比べる。
  const moved = movedPerspective(perspective, id, destination)
  const after = bestUnitPlay({ ...context, perspective: moved, units: unitsOf(moved) })
  const now = bestUnitPlay(context)
  const toMiddle = trustOf(unit.card) && destination.column === 1
  if (after <= now && !toMiddle) return NEVER
  return gain + after
}

// ---------------------------------------------------------------------------------------------
// トラップ・起動型能力・「勇気」・プラン
// ---------------------------------------------------------------------------------------------

/** 自分のトラップを、満たされたきっかけで発動した時の損得。きっかけが複数あれば、いちばん得なもの。 */
function trapScore(context: Context, id: CardId): number {
  const card = cardOf(context.perspective, id)
  if (card === undefined || card.type !== 'トラップ') return NEVER

  const effect = card.effect as (view: DuelView, occasion: unknown) => EffectStep<void>
  const scores = context.perspective.trapConditionsMet
    .filter((met) => met.trap === id)
    .flatMap((met) => {
      const score = probeEffect({ perspective: context.perspective, controller: context.me }, (view) =>
        effect(view, met.occasion),
      )
      return score === undefined ? [] : [score]
    })
  if (scores.length === 0) return NEVER
  return Math.max(...scores) - ABILITY_COST
}

function activationScore(context: Context, id: CardId, index: number): number {
  const unit = context.units.find((each) => each.id === id)
  const ability = unit === undefined ? undefined : activatedAbilitiesOf(unit.card)[index]
  if (unit === undefined || ability === undefined) return NEVER

  const score = probeEffect({ perspective: context.perspective, controller: context.me, self: onSquare(unit) }, ability.effect)
  return score === undefined ? NEVER : score - ABILITY_COST
}

/**
 * 「勇気」の起動の損得（総合ルール 第5部 第2章 2）。置かれた相手のユニットに X のダメージを与える。
 * 起動したカードは手札から無くなる。
 */
function courageScore(context: Context, id: CardId): number {
  const card = cardOf(context.perspective, id)
  const courage = card === undefined ? undefined : courageOf(card)
  if (card === undefined || courage === undefined) return NEVER

  const targets = context.perspective.courageConditionsMet
    .filter((met) => met.satisfied.includes(id))
    .flatMap((met) => context.units.filter((unit) => unit.id === met.placed.id))
  const scores = targets.map((unit) =>
    unit.damage + courage.amount >= unit.bp ? seenBasePoints(unit) + threatOf(context.me, unit) : courage.amount * 0.2,
  )
  if (scores.length === 0) return NEVER
  return Math.max(...scores) - keepBasePoints(card) - ABILITY_COST
}

/** 山札がこの枚数以下なら、プランしない。山札が 0 枚になれば敗北する（総合ルール 第3部 第3章 2）。 */
const PLAN_LIBRARY_FLOOR = 10
/** 手札に加われば有利だとみなす、カードの基礎点。 */
const GOOD_CARD = 2000
/** 盤面のユニットの基礎点が、相手をこれだけ上回っていれば、勝てそうだとみなす。 */
const WINNING_MARGIN = 4000

/** 次の相手のターンに、相手にスマッシュされうるか。相手のユニットが、スマッシュできる場所にいるか、前へ進める。 */
function mayBeSmashed(context: Context): boolean {
  const opponent = opponentOf(context.me)
  return context.units.some(
    (unit) =>
      unit.controller === opponent &&
      (areaFor(opponent, unit.square) !== '味方エリア' || unit.card.moveIcon.includes('上')),
  )
}

/** そのカードの希望が、自分が受けたダメージで発動するか（総合ルール 第5部 第3章 2）。 */
function hopeFires(context: Context, card: Card): boolean {
  if (hopeOf(card) === undefined) return false
  return levelSatisfied(context.perspective, context.me, card)
}

/** 手札に加われば有利になりそうなカードか。次のターンにレベルを満たせて、基礎点が高い。 */
function goodInHand(context: Context, card: Card): boolean {
  const { perspective, me } = context
  const energy = countIn(perspective, me, 'エネルギーゾーン')
  if (card.level > energy + 1) return false

  if (card.type === 'ユニット') return unitBasePoints(card.bp, card.sp) >= GOOD_CARD
  if (card.type === 'トラップ') return false
  const effect = probeEffect({ perspective, controller: me }, card.effect)
  return (effect ?? 0) >= GOOD_CARD / 2
}

/**
 * 盤面と手札で勝てそうか。
 *
 * 次のターンのスマッシュで相手のスマッシュが 7 枚に届く見込みがあるか（総合ルール 第3部 第3章 1、
 * 第3部 第9章 1）、盤面のユニットの基礎点が相手を大きく上回っている。
 */
function winning(context: Context): boolean {
  const { perspective, me } = context
  const opponent = opponentOf(me)
  const damage = context.units
    .filter((unit) => unit.controller === me)
    .reduce((sum, unit) => sum + smashDamageFrom(me, unit.square, unit.sp), perspective.damage[opponent])
  if (smashCountOf(perspective, opponent) + Math.floor(damage / 1000) >= 7) return true

  const basePointsOf = (player: Player): number =>
    context.units.filter((unit) => unit.controller === player).reduce((sum, unit) => sum + seenBasePoints(unit), 0)
  return basePointsOf(me) - basePointsOf(opponent) >= WINNING_MARGIN
}

/**
 * いまのプランを残す理由があるか。プランすると、いまのプランは捨札に置かれる（総合ルール 第3部
 * 第8章 2-3）。
 *
 * - 夢を持ち、いまプレイできる。プランより先にプレイする（同 第2部 第21章 3、第5部 第1章）。
 * - 相手にスマッシュされうる時に、発動できる希望を持っている（同 第5部 第3章）。
 * - スマッシュされる見込みが低い時に、手札に加われば有利になりそう。プランは次のドローで手札に
 *   加わる（同 第2部 第21章 3-1）。
 * - 盤面と手札で勝てそうなので、山札を減らしてまで探す理由が無い。
 */
function keepsPlan(context: Context, plan: Card): boolean {
  const { perspective, me } = context
  if (hasDream(plan) && levelSatisfied(perspective, me, plan) && releasedEnergyOf(perspective, me).length > 0) return true

  const threatened = mayBeSmashed(context)
  if (threatened && hopeFires(context, plan)) return true
  if (!threatened && goodInHand(context, plan)) return true
  return winning(context)
}

/**
 * プランする手の点数（総合ルール 第3部 第8章 2-3）。エネルギーかスマッシュを 1 枚フリーズして、
 * 山札の 1 番上を表にする。プランゾーンにカードがあれば、それを捨札に置いて次の 1 枚を表にする。
 *
 * リリース状態のスマッシュがあれば、それで支払える（同 第2部 第21章 7-5）ので、ほとんど損が無い。
 * エネルギーで支払うのは、手札にレベルを満たすカードが無く、エネルギーが余っている時だけにする。
 *
 * プランゾーンにカードがあれば、それを残す理由が無い時だけプランする（`keepsPlan`）。山札が少ない
 * 時はプランしない。
 */
function planScore(context: Context): number {
  const { perspective, me } = context
  if (countIn(perspective, me, '山札') <= PLAN_LIBRARY_FLOOR) return NEVER

  const releasedSmash = perspective.zones[me]['スマッシュゾーン'].some(
    (card) => card.kind === '見えていない' && card.orientation === 'リリース',
  )
  const playable = visibleIn(perspective, me, '手札').filter((each) => levelSatisfied(perspective, me, each.card))
  const spareEnergy = releasedEnergyOf(perspective, me).length > playable.length
  if (!releasedSmash && !spareEnergy) return NEVER

  const plan = visibleIn(perspective, me, 'プランゾーン')[0]
  if (plan !== undefined && keepsPlan(context, plan.card)) return NEVER

  const base = releasedSmash ? 120 : 60
  return plan === undefined ? base : base - 20
}

// ---------------------------------------------------------------------------------------------
// 手を選ぶ
// ---------------------------------------------------------------------------------------------

function scoreAction(context: Context, action: LegalAction): number {
  switch (action.kind) {
    case '優先権を放棄する':
      return 0
    case 'エネルギーを置く':
      return energyScore(context, action.card)
    case 'プランする':
      return planScore(context)
    case 'スマッシュする':
      // スマッシュする順番は `nextSmasher` が決定する。ここに来るのは、もうスマッシュしない時である。
      return NEVER
    case 'トラップを廃棄する':
      return NEVER
    case 'カードをプレイする':
      return playScore(context, action.declaration.card, action.declaration.square)
    case 'トラップとしてプレイする':
      return cardOf(context.perspective, action.card)?.type === 'トラップ' ? SET_TRAP : NEVER
    case 'トラップを発動する':
      return trapScore(context, action.card)
    case 'ユニットを移動する':
      return moveScore(context, action.unit, action.destination)
    case '起動型能力を起動する':
      return activationScore(context, action.unit, action.ability)
    case '「勇気」を起動する':
      return courageScore(context, action.card)
  }
}

/** いちばん点数の高い手。同じ点数なら乱数で選ぶ。 */
function pickBest<T>(
  items: readonly T[],
  scoreOf: (item: T) => number,
  random: Random,
): { readonly item: T; readonly random: Random } | undefined {
  const scored = items.map((item) => ({ item, score: scoreOf(item) }))
  const top = Math.max(...scored.map((each) => each.score))
  const best = scored.filter((each) => each.score >= top - EPSILON)
  if (best.length === 0) return undefined
  if (best.length === 1) return best[0] === undefined ? undefined : { item: best[0].item, random }

  const picked = nextInt(random, best.length)
  const chosen = best[picked.value]
  return chosen === undefined ? undefined : { item: chosen.item, random: picked.random }
}

function pickAction(view: ActionView, random: Random): { readonly action: LegalAction; readonly random: Random } | undefined {
  if (view.actions.length === 0) return undefined

  const { perspective } = view
  const context: Context = { view, perspective, me: perspective.viewer, units: unitsOf(perspective) }

  const smashing = view.actions.flatMap((action) => (action.kind === 'スマッシュする' ? [action.unit] : []))
  if (smashing.length > 0) {
    const next = nextSmasher(perspective, context.me, smashing)
    const action = view.actions.find((each) => each.kind === 'スマッシュする' && each.unit === next)
    if (action !== undefined) return { action, random }
  }

  const picked = pickBest(view.actions, (action) => scoreAction(context, action), random)
  return picked === undefined ? undefined : { action: picked.item, random: picked.random }
}

// ---------------------------------------------------------------------------------------------
// 選択に答える
// ---------------------------------------------------------------------------------------------

/** 候補が指すカード。見えていなければ `undefined`。 */
function candidateCard(perspective: DuelPerspective, candidate: WireCandidate): Card | undefined {
  return candidate.kind === '見えている' ? cardOf(perspective, candidate.card) : undefined
}

/**
 * コストとしてフリーズするエネルギーの点数。手札のほかのカードが要る色を持つエネルギーほど残す。
 */
function costScore(perspective: DuelPerspective, me: Player, candidate: WireCandidate): number {
  const card = candidateCard(perspective, candidate)
  if (card === undefined) return 0

  const needed = visibleIn(perspective, me, '手札').filter((each) =>
    each.card.colors.some((color) => card.colors.includes(color)),
  ).length
  return -needed
}

/**
 * 効果が選ばせている候補ごとの点数（ADR-0062）。
 *
 * 発生源のカードの効果を空回しして、候補を 1 つずつ選んだ時の損得を比べる。支配者が相手の効果なら、
 * 損得の向きを反対にする（`letOpponentChooseFromMyHand` など）。回せなければ `undefined`。
 *
 * 限界: `ChoiceView` には、選択がどの能力から来たかが含まれない。そのため、発生源のカードの効果・
 * 能力を順に回し、候補の並びが同じ選択が最初に見つかった能力で点数を付ける。1 枚のカードに、同じ
 * 候補の並びから選ぶ能力が 2 つあり、効果の向きが逆（強化と破壊など）だと、別の能力の損得で答える
 * ことがある。この PR（#366）では直さず、限界として残すことを開発者と決定した。
 */
function probedTargets(
  perspective: DuelPerspective,
  choice: WireChoice,
): { readonly scores: readonly number[]; readonly declined: number } | undefined {
  if (choice.source === undefined) return undefined
  const instance = findVisible(perspective, choice.source)
  if (instance === undefined) return undefined

  const { card } = instance
  const controller = instance.controller
  const sign = controller === choice.player ? 1 : -1
  const unit = unitsOf(perspective).find((each) => each.id === instance.id)
  const setting: ProbeSetting = {
    perspective,
    controller,
    ...(unit === undefined ? {} : { self: onSquare(unit) }),
  }

  const starts: ((view: DuelView) => EffectStep<void>)[] = []
  if (card.type === 'ストラテジー' || card.type === '超必殺ストラテジー！') starts.push(card.effect)
  if (card.type === 'トラップ') {
    const effect = card.effect as (view: DuelView, occasion: unknown) => EffectStep<void>
    for (const met of perspective.trapConditionsMet.filter((each) => each.trap === instance.id)) {
      starts.push((view) => effect(view, met.occasion))
    }
    starts.push((view) => effect(view, undefined))
  }
  for (const ability of card.abilities) {
    if ('effect' in ability && typeof ability.effect === 'function') starts.push(ability.effect as (view: DuelView) => EffectStep<void>)
  }

  const keys = choice.candidates.map(keyOfWire)
  for (const start of starts) {
    const probed = probeChoice(setting, start, keys)
    if (probed === undefined) continue
    if (probed.scores.every((score) => score === undefined)) continue

    // 見積もれなかった候補は、`sign` によらず最低点にする。`sign * NEVER` は、支配者が相手の時に
    // 最高点になってしまう。
    return {
      scores: probed.scores.map((score) => (score === undefined ? NEVER : sign * score)),
      declined: probed.declined === undefined ? NEVER : sign * probed.declined,
    }
  }
  return undefined
}

/**
 * 効果の空回しができない時の、候補の点数。
 *
 * 候補に味方と敵が混ざっていれば、敵を選ぶ。効果の対象になるのは、倒す・ダメージを与えるなど、
 * 敵に向けたものが多い。候補が味方だけなら、味方の点数を負のまま残し、選ばないことを選べる時は
 * 選ばない（`scoreChoice`）。効果の向きが分からない時に、味方を破壊するような外れ方を避けるため
 * である。それ以外（敵だけ、ユニット以外が混ざる）は、候補どうしに差を付けない。
 */
function fallbackTargets(perspective: DuelPerspective, choice: WireChoice): readonly number[] {
  const units = unitsOf(perspective)
  const sides = choice.candidates.map((candidate) => {
    if (candidate.kind !== '見えている') return 0
    const unit = units.find((each) => each.id === candidate.card)
    if (unit === undefined) return 0
    return unit.controller === choice.player ? -seenBasePoints(unit) : seenBasePoints(unit)
  })
  const mixed = sides.some((side) => side > 0) && sides.some((side) => side < 0)
  const alliesOnly = sides.every((side) => side < 0)
  return mixed || alliesOnly ? sides : sides.map(() => 0)
}

/** きっかけの候補の点数。きっかけになった相手のユニットの基礎点が高いほうを選ぶ。 */
function occasionScore(perspective: DuelPerspective, candidate: WireCandidate): number {
  if (candidate.kind !== 'きっかけ') return 0

  const occasion = candidate.occasion
  const id =
    occasion.kind === '侵入'
      ? occasion.invader.card
      : occasion.kind === '攻撃'
        ? occasion.attacker.card
        : occasion.kind === 'スマッシュ'
          ? occasion.smasher.card
          : occasion.unit.card
  const unit = unitsOf(perspective).find((each) => each.id === id)
  return unit === undefined ? 0 : seenBasePoints(unit)
}

/** 選択の候補それぞれの点数と、選ばないことの点数。 */
function scoreChoice(view: ChoiceView): { readonly scores: readonly number[]; readonly declined: number } {
  const { perspective, choice } = view
  const me = choice.player
  const byCandidate = (scoreOf: (candidate: WireCandidate) => number): { scores: number[]; declined: number } => ({
    scores: choice.candidates.map(scoreOf),
    declined: NEVER,
  })

  switch (choice.purpose) {
    case 'プレイのコスト':
    case '移動のコスト':
    case '起動のコスト':
      return byCandidate((candidate) => costScore(perspective, me, candidate))
    case 'プランのコスト':
      // スマッシュで支払えば、エネルギーを残せる（総合ルール 第2部 第21章 7-5）。
      return byCandidate((candidate) =>
        candidate.kind === '見えていない' && candidate.at?.zone === 'スマッシュゾーン'
          ? 1
          : costScore(perspective, me, candidate),
      )
    case '捨てる手札':
      return byCandidate((candidate) => -cardBasePoints(candidateCard(perspective, candidate) ?? DUMMY))
    case '山札から選ぶ':
      return byCandidate((candidate) => cardBasePoints(candidateCard(perspective, candidate) ?? DUMMY))
    // 「してもよい」（ADR-0064）。候補は「確認」の 1 つで、いまはいつも「はい」と答える。効果を空回しして
    // 「はい」と「いいえ」を比べるのは、手の選び方の改善（#366）で扱う。
    case 'してもよい':
      return byCandidate(() => 0)
    case 'トラップのきっかけ':
    case '勇気のきっかけ':
      return byCandidate((candidate) => occasionScore(perspective, candidate))
    case '効果の対象': {
      const probed = probedTargets(perspective, choice)
      if (probed !== undefined) return probed

      const scores = fallbackTargets(perspective, choice)
      return { scores, declined: scores.every((score) => score < 0) ? 0 : NEVER }
    }
    default:
      return byCandidate(() => 0)
  }
}

/** 基礎点を見積もれないカードの代わり。基礎点は 0 として扱う。 */
const DUMMY: Card = {
  type: 'ストラテジー',
  name: '',
  level: 0,
  colors: [],
  stars: 0,
  reverseStars: 0,
  attributes: [],
  makerSymbols: [],
  abilities: [],
  text: [],
  effect: function* () {},
} as unknown as Card

function answer(view: ChoiceView, random: Random): { readonly answer: ChoiceAnswer; readonly random: Random } {
  const { choice } = view
  if (choice.candidates.length === 0) return { answer: '選ばない', random }

  const { scores, declined } = scoreChoice(view)
  const indexes = choice.candidates.map((_, index) => index)
  const picked = pickBest(indexes, (index) => scores[index] ?? NEVER, random)
  const index = picked?.item ?? 0
  const top = scores[index] ?? NEVER

  // 選ばないことは、どの候補を選ぶよりも得な時だけ選ぶ。
  if (choice.mayDecline && declined > top) return { answer: '選ばない', random: picked?.random ?? random }
  return { answer: index, random: picked?.random ?? random }
}

/** 場面ごとに手へ点数を付けて選ぶ CPU。 */
export const scoredCpu: CpuPlayer = { pickAction, answer }
