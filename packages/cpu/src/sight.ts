import { BATTLE_SPACE, areaOf, hasPep, hasTrust } from '@revolution/engine'
import type {
  Area,
  Card,
  CardId,
  CardInstance,
  DuelPerspective,
  Player,
  PlayerZone,
  Square,
  UnitCard,
} from '@revolution/engine'

/**
 * 射影した盤面（`DuelPerspective`）を、CPU が点数を付けるために参照する関数（ADR-0060 の段階 2、#366）。
 *
 * どれも射影した盤面だけを参照する。見えていないカードは参照できず、枚数だけが分かる。
 */

/** そのプレイヤーの相手。 */
export function opponentOf(player: Player): Player {
  return player === '先攻' ? '後攻' : '先攻'
}

/** スクエアにいるユニット 1 枚。継続効果を適用した後の値を持つ。 */
export interface SeenUnit {
  readonly id: CardId
  readonly card: UnitCard
  readonly square: Square
  readonly controller: Player
  readonly bp: number
  readonly sp: number
  readonly damage: number
  readonly released: boolean
}

/** スクエアにいるユニットすべて。 */
export function unitsOf(perspective: DuelPerspective): readonly SeenUnit[] {
  return BATTLE_SPACE.flatMap((square, index) =>
    (perspective.squares[index] ?? []).flatMap((instance): SeenUnit[] => {
      if (instance.card.type !== 'ユニット') return []

      const effective = perspective.effective.find((each) => each.card === instance.id)
      return [
        {
          id: instance.id,
          card: instance.card,
          square,
          controller: instance.controller,
          bp: effective?.bp ?? instance.card.bp,
          sp: effective?.sp ?? instance.card.sp,
          damage: instance.damage,
          released: instance.orientation === 'リリース',
        },
      ]
    }),
  )
}

/** そのスクエアにいるユニット。 */
export function unitOn(perspective: DuelPerspective, square: Square): readonly SeenUnit[] {
  return unitsOf(perspective).filter((unit) => sameSquare(unit.square, square))
}

export function sameSquare(a: Square, b: Square): boolean {
  return a.row === b.row && a.column === b.column
}

/** そのプレイヤーから見た、そのスクエアのエリア。 */
export function areaFor(player: Player, square: Square): Area {
  return areaOf(player, square)
}

/** そのゾーンで見えているカード。 */
export function visibleIn(perspective: DuelPerspective, player: Player, zone: PlayerZone): readonly CardInstance[] {
  return perspective.zones[player][zone].flatMap((card) => (card.kind === '見えている' ? [card.instance] : []))
}

/** そのゾーンのカードの枚数。見えていないカードも含める。 */
export function countIn(perspective: DuelPerspective, player: Player, zone: PlayerZone): number {
  return perspective.zones[player][zone].length
}

/**
 * そのプレイヤーのスマッシュの枚数（総合ルール 第2部 第21章 7-2）。
 *
 * スマッシュは裏向きのカードだけである。希望ステップで表向きに置かれたカードは含めない
 * （同 第3部 第19章 1）。表向きのカードは両方のプレイヤーに見えているので、見えていないカードが
 * スマッシュにあたる。
 */
export function smashCountOf(perspective: DuelPerspective, player: Player): number {
  return perspective.zones[player]['スマッシュゾーン'].filter((card) => card.kind === '見えていない').length
}

/** そのプレイヤーのプランゾーンにあるカード。無ければ `undefined`。プランは公開情報である。 */
export function planOf(perspective: DuelPerspective, player: Player): Card | undefined {
  return visibleIn(perspective, player, 'プランゾーン')[0]?.card
}

/** 射影した盤面で見えているカード。見えていなければ `undefined`。 */
export function findVisible(perspective: DuelPerspective, id: CardId): CardInstance | undefined {
  const onSquares = perspective.squares.flat().find((card) => card.id === id)
  if (onSquares !== undefined) return onSquares

  for (const zones of Object.values(perspective.zones)) {
    for (const cards of Object.values(zones)) {
      for (const card of cards) {
        if (card.kind === '見えている' && card.instance.id === id) return card.instance
      }
    }
  }
  return perspective.resolveZone.find((card) => card.id === id)
}

/** そのプレイヤーのエネルギーゾーンにあるカードの色の集まり。エネルギーゾーンは公開情報である。 */
export function energyColorsOf(perspective: DuelPerspective, player: Player): ReadonlySet<string> {
  return new Set(visibleIn(perspective, player, 'エネルギーゾーン').flatMap((each) => each.card.colors))
}

/** そのプレイヤーのリリース状態のエネルギーの枚数。 */
export function releasedEnergyOf(perspective: DuelPerspective, player: Player): readonly CardInstance[] {
  return visibleIn(perspective, player, 'エネルギーゾーン').filter((each) => each.orientation === 'リリース')
}

/**
 * そのカードのレベルを、そのプレイヤーのエネルギーゾーンが満たしているか（総合ルール 第1部 第2章 3-1）。
 * engine の `satisfiesLevel` と同じ判定を、射影した盤面で行う。
 */
export function levelSatisfied(perspective: DuelPerspective, player: Player, card: Card): boolean {
  const energy = visibleIn(perspective, player, 'エネルギーゾーン')
  if (energy.length < card.level) return false

  return card.colors.every((color) => energy.some((each) => each.card.colors.includes(color)))
}

/** 元気を持つか（総合ルール 第5部 第8章）。 */
export function pepOf(card: Card): boolean {
  return hasPep(card)
}

/** 信頼を持つか（総合ルール 第5部 第4章）。 */
export function trustOf(card: Card): boolean {
  return hasTrust(card)
}
