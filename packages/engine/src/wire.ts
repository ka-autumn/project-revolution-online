import type { Square } from './board.js'
import type { Card, UnitCard } from './card.js'
import type { CardId, CardInstance, CourageConditionMet, DuelResult, TrapConditionMet } from './duel.js'
import type { UnitOnSquare } from './effect.js'
import type { Orientation } from './orientation.js'
import type {
  DuelPerspective,
  VisibleAbility,
  VisibleBattle,
  VisibleCard,
  VisibleCreatedAbility,
} from './perspective.js'
import { PLAYERS } from './player.js'
import type { Player } from './player.js'
import type { SmashJudgment } from './smash.js'
import type { Turn } from './turn.js'
import { PLAYER_ZONES } from './zone.js'
import type { PlayerZone } from './zone.js'

/**
 * カードを指す名前（ADR-0002 / ADR-0004）。
 *
 * **engine はこの中身を読まない。** カードの同一性は番号だが、その番号を知っているのはカードを
 * 実装している側であって、engine ではない。名前の付け方も引き直し方も外から渡してもらう
 * （`toWire` の `numberOf`、`fromWire` の `cardOf`）。engine にとっては、往復して同じカードに
 * 戻れる不透明な文字列でしかない。
 *
 * カード名ではないことに注意する。同じ名前のカードが複数あり（総合ルール 第3部 第1章 3-1 の
 * 「同名のカードはデッキに 4 枚まで」が成り立つのはそのためである）、名前では 1 枚を指せない。
 */
export type CardNumber = string

/** 通信に載せる形にした `CardInstance`。カードそのものの代わりに番号を持つ。 */
export interface WireCardInstance {
  readonly id: CardId
  readonly card: CardNumber
  readonly owner: Player
  readonly controller: Player
  readonly orientation: Orientation
  readonly damage: number
}

/** 通信に載せる形にした `VisibleCard`。見えていない側は元から番号を持たない。 */
export type WireVisibleCard =
  | { readonly kind: '見えている'; readonly instance: WireCardInstance }
  | { readonly kind: '見えていない'; readonly orientation: Orientation }

/** 通信に載せる形にした `UnitOnSquare`。 */
export interface WireUnitOnSquare {
  readonly id: CardId
  readonly square: Square
  readonly card: CardNumber
  readonly controller: Player
}

/** 通信に載せる形にした `TrapConditionMet`。 */
export interface WireTrapConditionMet {
  readonly trap: CardId
  readonly occasion: { readonly kind: '侵入'; readonly invader: WireUnitOnSquare }
}

/** 通信に載せる形にした `CourageConditionMet`。 */
export interface WireCourageConditionMet {
  readonly player: Player
  readonly satisfied: readonly CardId[]
  readonly placed: WireUnitOnSquare
}

/**
 * サーバがクライアントへ送る、視点ごとの盤面（ADR-0004）。
 *
 * `DuelPerspective` が「誰に何が見えてよいか」を決めた形であるのに対して、これは「それをどう
 * 送るか」を決めた形である。**違いはカードの持ち方だけで、それ以外はそのまま写している。**
 * 能力の効果はすでに射影の側で落ちている（`perspective.ts` の `VisibleAbility`）。
 *
 * 残っていた `CardInstance.card` も、カードのデータと効果（関数）を持つ `Card` そのものなので
 * 送れない。かわりに番号（`CardNumber`）を載せ、受け取った側が自分の持つカードの実装から引き
 * 直す。engine がカードを知らないまま（ADR-0002）両側で同じ盤面を持てるのは、この引き直しを
 * 外に出しているからである。
 *
 * **この型は JSON にできるものだけでできている。** 関数も `Map` も `Set` も含まない。
 */
export interface WirePerspective {
  readonly viewer: Player
  readonly squares: readonly (readonly WireCardInstance[])[]
  readonly zones: Readonly<Record<Player, Readonly<Record<PlayerZone, readonly WireVisibleCard[]>>>>
  readonly damage: Readonly<Record<Player, number>>
  readonly turn: Turn
  readonly bank: readonly VisibleAbility[]
  readonly resolveZone: readonly WireCardInstance[]
  readonly triggered: readonly VisibleAbility[]
  readonly createdAbilities: readonly VisibleCreatedAbility[]
  readonly playedIntoCenter: readonly CardId[]
  readonly trapConditionsMet: readonly WireTrapConditionMet[]
  readonly courageConditionsMet: readonly WireCourageConditionMet[]
  readonly battle: VisibleBattle | undefined
  readonly smashJudgments: readonly SmashJudgment[]
  readonly result: DuelResult | undefined
}

/** カードを番号で呼ぶ。カードを実装している側が渡す。 */
export type CardNaming = (card: Card) => CardNumber

/** 番号からカードを引き直す。カードを実装している側が渡す。 */
export type CardLookup = (number: CardNumber) => Card

function instanceToWire(instance: CardInstance, numberOf: CardNaming): WireCardInstance {
  return { ...instance, card: numberOf(instance.card) }
}

function unitToWire(unit: UnitOnSquare, numberOf: CardNaming): WireUnitOnSquare {
  return { ...unit, card: numberOf(unit.card) }
}

function visibleToWire(visible: VisibleCard, numberOf: CardNaming): WireVisibleCard {
  return visible.kind === '見えている'
    ? { kind: '見えている', instance: instanceToWire(visible.instance, numberOf) }
    : visible
}

/**
 * 視点ごとの盤面を、通信に載せる形にする（ADR-0004）。
 *
 * 射影（`perspectiveOf`）を通した後のものを渡す。**完全な盤面をここに渡してはならない。**
 * 落とす仕事はこの関数ではなく射影が持っていて、ここは形を変えるだけである。
 */
export function toWire(perspective: DuelPerspective, numberOf: CardNaming): WirePerspective {
  const zonesOf = (owner: Player): Readonly<Record<PlayerZone, readonly WireVisibleCard[]>> =>
    Object.fromEntries(
      PLAYER_ZONES.map((zone): readonly [PlayerZone, readonly WireVisibleCard[]] => [
        zone,
        perspective.zones[owner][zone].map((card) => visibleToWire(card, numberOf)),
      ]),
    ) as Record<PlayerZone, readonly WireVisibleCard[]>

  return {
    ...perspective,
    squares: perspective.squares.map((square) => square.map((card) => instanceToWire(card, numberOf))),
    zones: Object.fromEntries(PLAYERS.map((owner) => [owner, zonesOf(owner)])) as WirePerspective['zones'],
    resolveZone: perspective.resolveZone.map((card) => instanceToWire(card, numberOf)),
    trapConditionsMet: perspective.trapConditionsMet.map((met) => ({
      ...met,
      occasion: { ...met.occasion, invader: unitToWire(met.occasion.invader, numberOf) },
    })),
    courageConditionsMet: perspective.courageConditionsMet.map((met) => ({
      ...met,
      placed: unitToWire(met.placed, numberOf),
    })),
  }
}

function instanceFromWire(instance: WireCardInstance, cardOf: CardLookup): CardInstance {
  return { ...instance, card: cardOf(instance.card) }
}

/**
 * ユニットとして引き直す。
 *
 * `UnitOnSquare` はユニットしか持てない（スクエアにあるユニット以外のカードは、ルールエフェクト
 * によって捨札に置かれる。総合ルール 第4部 第14章 4-3）。引き直した結果がユニットでなければ、
 * 送り手と受け手が違うカードを見ているということなので、そこで止める。
 */
function unitFromWire(unit: WireUnitOnSquare, cardOf: CardLookup): UnitOnSquare {
  const card = cardOf(unit.card)
  if (card.type !== 'ユニット') throw new Error(`ユニットのはずだった: ${unit.card}`)

  return { ...unit, card: card satisfies UnitCard }
}

function visibleFromWire(visible: WireVisibleCard, cardOf: CardLookup): VisibleCard {
  return visible.kind === '見えている'
    ? { kind: '見えている', instance: instanceFromWire(visible.instance, cardOf) }
    : visible
}

/**
 * 通信に載せた形から、視点ごとの盤面に戻す（ADR-0004）。
 *
 * `toWire` の逆で、番号からカードを引き直す。同じカードの実装を持っている限り、往復すると
 * 元の盤面に戻る。**戻るのは射影であって完全な盤面ではない。** 受け取った側がそこから先へ
 * デュエルを進めることはできず、それができるのは完全な盤面を持つサーバだけである。
 */
export function fromWire(wire: WirePerspective, cardOf: CardLookup): DuelPerspective {
  const zonesOf = (owner: Player): Readonly<Record<PlayerZone, readonly VisibleCard[]>> =>
    Object.fromEntries(
      PLAYER_ZONES.map((zone): readonly [PlayerZone, readonly VisibleCard[]] => [
        zone,
        wire.zones[owner][zone].map((card) => visibleFromWire(card, cardOf)),
      ]),
    ) as Record<PlayerZone, readonly VisibleCard[]>

  return {
    ...wire,
    squares: wire.squares.map((square) => square.map((card) => instanceFromWire(card, cardOf))),
    zones: Object.fromEntries(PLAYERS.map((owner) => [owner, zonesOf(owner)])) as DuelPerspective['zones'],
    resolveZone: wire.resolveZone.map((card) => instanceFromWire(card, cardOf)),
    trapConditionsMet: wire.trapConditionsMet.map(
      (met): TrapConditionMet => ({
        ...met,
        occasion: { ...met.occasion, invader: unitFromWire(met.occasion.invader, cardOf) },
      }),
    ),
    courageConditionsMet: wire.courageConditionsMet.map(
      (met): CourageConditionMet => ({ ...met, placed: unitFromWire(met.placed, cardOf) }),
    ),
  }
}
