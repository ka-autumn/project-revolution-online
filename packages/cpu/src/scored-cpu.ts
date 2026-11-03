import { activatedAbilitiesOf, courageOf, nextInt, squareInDirection } from '@revolution/engine'
import type {
  Card,
  CardId,
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
  cardWorth,
  fighterOf,
  fighterOfCard,
  forecastBattle,
  positionWorth,
  seenWorth,
  smashDamageFrom,
  unitWorth,
} from './forecast.js'
import type { Fighter } from './forecast.js'
import type { ActionView, ChoiceView, CpuPlayer } from './player.js'
import { keyOfWire, probeChoice, probeEffect } from './probe.js'
import type { ProbeSetting } from './probe.js'
import {
  areaFor,
  countIn,
  energyColorsOf,
  findVisible,
  levelSatisfied,
  releasedEnergyOf,
  sameSquare,
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
 * 目標の枚数に届くまでは必ず置き、手札に持っておく値打ちが低いカードから置く。手札のほかのカードが
 * 要る色を追加するカードは、先に置く。目標を超えた後は、エネルギーを 1 枚増やす得が、そのカードを手札に
 * 持っておく値打ちを上回る時だけ置く。手札がエネルギーより多いほど、増やす得は大きい。
 */
function energyScore(context: Context, id: CardId): number {
  const { perspective, me } = context
  const card = cardOf(perspective, id)
  if (card === undefined) return NEVER

  const hand = visibleIn(perspective, me, '手札').filter((each) => each.id !== id)
  const colors = energyColorsOf(perspective, me)
  const missing = new Set(hand.flatMap((each) => each.card.colors).filter((color) => !colors.has(color)))
  const addsColor = card.colors.filter((color) => missing.has(color)).length * MISSING_COLOR
  const keep = keepWorth(card)

  const placed = countIn(perspective, me, 'エネルギーゾーン')
  if (placed < energyTargetOf(context.view.deck)) return ENERGY_BELOW_TARGET - keep + addsColor

  const surplus = Math.max(0, hand.length + 1 - placed)
  return ENERGY_ABOVE_TARGET + surplus * ENERGY_PER_SURPLUS_CARD - keep + addsColor
}

/** カードを手札に持っておく値打ち。エネルギーに置くカードを選ぶのに使う。 */
function keepWorth(card: Card): number {
  return cardWorth(card) * 0.5
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
 * 負けるバトルの後に、同じターンのうちに倒しきれるか。
 *
 * 手札のユニットを、残りのリリース状態のエネルギーでプレイするか（相手の敵エリアにはプレイ
 * できない、総合ルール 第2部 第20章 1-3）、すでにいる味方ユニットを移動して攻め込む。プランで
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

  const energyLeft = releasedEnergyOf(perspective, me).length - exclude.energyUsed
  if (energyLeft > 0 && areaFor(me, enemy.square) !== '敵エリア') {
    const byPlay = visibleIn(perspective, me, '手札').some(
      (each) =>
        each.id !== exclude.card &&
        each.card.type === 'ユニット' &&
        levelSatisfied(perspective, me, each.card) &&
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
 * 敵がいればバトルになる（総合ルール 第3部 第11章 1）。倒せる敵の値打ちから、失う味方の値打ちを
 * 引く。相打ちも、得になれば選ぶ。負けるバトルでも、この後に続けて倒しきれるなら選ぶ。勝って残る
 * なら、そのスクエアにいることの値打ちを足す。敵がいなければ、そのスクエアにいることの値打ちだけである。
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
  if (enemy === undefined) return discarded ? NEVER : positionWorth(perspective, me, square, staying)

  const forecast = forecastBattle(arrival.fighter, fighterOf(enemy))
  const own = unitWorth(arrival.bp, arrival.sp)
  const loss = forecast.attackerSurvives && !discarded ? 0 : own

  if (!forecast.defenderSurvives) {
    const stay = forecast.attackerSurvives && !discarded ? positionWorth(perspective, me, square, staying) : 0
    return seenWorth(enemy) + threatOf(me, enemy) - loss + stay
  }

  const finish = canFinish(context, enemy, forecast.defenderDamage, arrival.from)
    ? (seenWorth(enemy) + threatOf(me, enemy)) * FOLLOW_UP_RATIO
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
  return effect === undefined ? NEVER : effect - ENERGY_USE - keepWorth(card) * 0.2
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

/**
 * ユニットを移動する手の点数。
 *
 * 1 回のメインフェイズで同じユニットを移動するのは、敵のいるスクエアへ攻め込む時を除いて 1 回だけに
 * する。点数の差が小さい場所どうしを、行ったり来たりしないようにするためである。
 */
function moveScore(context: Context, id: CardId, destination: Square): number {
  const unit = context.units.find((each) => each.id === id)
  if (unit === undefined) return NEVER

  const attacking = context.units.some((each) => each.controller !== context.me && sameSquare(each.square, destination))
  if (!attacking && movedThisPhase(context.perspective, id)) return NEVER

  const fighter = fighterOf(unit)
  const arrival: Arrival = { card: unit.card, bp: unit.bp, sp: unit.sp, fighter, from: { unit: id, energyUsed: 0 }, played: false }
  const leaving = positionWorth(context.perspective, context.me, unit.square, {
    card: unit.card,
    bp: unit.bp,
    sp: unit.sp,
    fighter,
  })
  return arrivalScore(context, arrival, destination) - leaving - MOVE_COST
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
    unit.damage + courage.amount >= unit.bp ? seenWorth(unit) + threatOf(context.me, unit) : courage.amount * 0.2,
  )
  if (scores.length === 0) return NEVER
  return Math.max(...scores) - keepWorth(card) - ABILITY_COST
}

/**
 * プランする手の点数（総合ルール 第3部 第8章 2-3）。エネルギーかスマッシュを 1 枚フリーズして、
 * 山札の 1 番上を表にする。
 *
 * プランゾーンにカードがある時にプランすると、そのカードは捨札に置かれ、山札が 1 枚減る。山札が
 * 0 枚になれば敗北する（同 第3部 第3章 2）ので、プランするのはプランゾーンが無い時だけにする。
 *
 * リリース状態のスマッシュがあれば、それで支払える（同 第2部 第21章 7-5）ので、ほとんど損が無い。
 * エネルギーで支払うのは、手札にプレイできるカードが無く、エネルギーが余っている時だけにする。
 */
function planScore(context: Context): number {
  const { perspective, me } = context
  if (countIn(perspective, me, 'プランゾーン') > 0) return NEVER

  const releasedSmash = perspective.zones[me]['スマッシュゾーン'].some(
    (card) => card.kind === '見えていない' && card.orientation === 'リリース',
  )
  if (releasedSmash) return 120

  const playable = visibleIn(perspective, me, '手札').filter((each) => levelSatisfied(perspective, me, each.card))
  return releasedEnergyOf(perspective, me).length > playable.length ? 60 : NEVER
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

    return {
      scores: probed.scores.map((score) => sign * (score ?? NEVER)),
      declined: probed.declined === undefined ? NEVER : sign * probed.declined,
    }
  }
  return undefined
}

/**
 * 効果の空回しができない時の、候補の点数。
 *
 * 候補に味方と敵が混ざっていれば、敵を選ぶ。効果の対象になるのは、倒す・ダメージを与えるなど、
 * 敵に向けたものが多い。混ざっていなければ、候補どうしに差を付けない。
 */
function fallbackTargets(perspective: DuelPerspective, choice: WireChoice): readonly number[] {
  const units = unitsOf(perspective)
  const sides = choice.candidates.map((candidate) => {
    if (candidate.kind !== '見えている') return 0
    const unit = units.find((each) => each.id === candidate.card)
    if (unit === undefined) return 0
    return unit.controller === choice.player ? -seenWorth(unit) : seenWorth(unit)
  })
  const mixed = sides.some((side) => side > 0) && sides.some((side) => side < 0)
  return mixed ? sides : sides.map(() => 0)
}

/** きっかけの候補の点数。きっかけになった相手のユニットの値打ちが高いほうを選ぶ。 */
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
  return unit === undefined ? 0 : seenWorth(unit)
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
      return byCandidate((candidate) => -cardWorth(candidateCard(perspective, candidate) ?? DUMMY))
    case '山札から選ぶ':
      return byCandidate((candidate) => cardWorth(candidateCard(perspective, candidate) ?? DUMMY))
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

/** 値打ちを見積もれないカードの代わり。値打ちは 0 として扱う。 */
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
