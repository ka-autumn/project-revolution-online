import type { Card } from './card.js'

/**
 * デュエルに持ち込むカードの束。デュエル開始時に持ち主の山札になる
 * （総合ルール 第2部 第21章 2-1）。
 *
 * 並びは持ち主が置いた順であって、シャッフル前の順である。
 */
export type Deck = readonly Card[]

/** 構築戦のデッキの最小枚数（総合ルール 第3部 第1章 3-1）。 */
export const CONSTRUCTED_DECK_MINIMUM = 60

/** 同じ日本語版のカード名を持つカードをデッキに入れられる枚数（総合ルール 第3部 第1章 3-1）。 */
export const SAME_NAME_MAXIMUM = 4

/** デッキに入れられるスターアイコンの個数（総合ルール 第2部 第7章 2）。 */
export const STAR_ICON_MAXIMUM = 15

/** 構築戦の規定を満たしていない点。 */
export type DeckViolation =
  | { readonly kind: '枚数不足'; readonly count: number; readonly minimum: number }
  | { readonly kind: '同名の入れすぎ'; readonly name: string; readonly count: number; readonly maximum: number }
  | { readonly kind: 'スターアイコンの入れすぎ'; readonly stars: number; readonly maximum: number }

/**
 * 構築戦のデッキが規定を満たしているか調べる。満たしていれば空の並びを返す。
 *
 * 限定戦（総合ルール 第3部 第1章 3-3）は枚数も制限も別なので、ここでは扱わない。
 */
export function checkConstructedDeck(deck: Deck): readonly DeckViolation[] {
  const violations: DeckViolation[] = []

  if (deck.length < CONSTRUCTED_DECK_MINIMUM) {
    violations.push({ kind: '枚数不足', count: deck.length, minimum: CONSTRUCTED_DECK_MINIMUM })
  }

  for (const [name, count] of countByName(deck)) {
    if (count > SAME_NAME_MAXIMUM) {
      violations.push({ kind: '同名の入れすぎ', name, count, maximum: SAME_NAME_MAXIMUM })
    }
  }

  const stars = total(deck, (card) => card.stars)
  // リバーススターアイコン 1 個につき上限が 1 個増える（総合ルール 第2部 第7章 3）。
  const maximum = STAR_ICON_MAXIMUM + total(deck, (card) => card.reverseStars)
  if (stars > maximum) {
    violations.push({ kind: 'スターアイコンの入れすぎ', stars, maximum })
  }

  return violations
}

function total(deck: Deck, count: (card: Card) => number): number {
  return deck.reduce((sum, card) => sum + count(card), 0)
}

/**
 * カード名ごとの枚数。
 *
 * 数えるのは日本語版のカード名（総合ルール 第3部 第1章 3-1）であって、カードの実装が
 * 同じかどうかではない。同じ名前の別のカードは同じ名前として数える。
 */
function countByName(deck: Deck): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const card of deck) {
    counts.set(card.name, (counts.get(card.name) ?? 0) + 1)
  }
  return counts
}
