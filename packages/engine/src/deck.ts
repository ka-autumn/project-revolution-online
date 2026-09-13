import type { Card } from './card.js'

/**
 * デュエルに持ち込むカードの束。デュエル開始時に持ち主の山札になる
 * （総合ルール 第2部 第21章 2-1）。
 *
 * 並びは持ち主が置いた順であって、シャッフル前の順である。
 */
export type Deck = readonly Card[]

/**
 * デュエルの形式（総合ルール 第3部 第1章 3）。形式ごとに、デッキの規定が決まる。
 *
 * **数え上げられるので、列挙で持つ**（ADR-0021）。いまは構築戦（同 3-1）だけである。限定戦
 * （同 3-3）とパートナーバトル（同 3-2）を足すときは、ここに 1 つ足して `checkDeckForFormat` に
 * 規定をぶら下げる。
 */
export type DuelFormat = '構築戦'

/** 選べる形式のすべて。**画面に並べるためにある**——型は実行時に数え上げられない。 */
export const DUEL_FORMATS: readonly DuelFormat[] = ['構築戦']

/** 構築戦のデッキの最小枚数（総合ルール 第3部 第1章 3-1）。 */
export const CONSTRUCTED_DECK_MINIMUM = 60

/** 同じ日本語版のカード名を持つカードをデッキに入れられる枚数（総合ルール 第3部 第1章 3-1）。 */
export const SAME_NAME_MAXIMUM = 4

/** デッキに入れられるスターアイコンの個数（総合ルール 第2部 第7章 2）。 */
export const STAR_ICON_MAXIMUM = 15

/**
 * カード名ごとの、デッキに入れてよい枚数（フロアルール Version 1.12 第2部 第1章 1-1）。
 *
 * **禁止と制限を分けずに、1 枚あたりの上限で持つ。** 禁止は上限 0 枚であって、別の種類のものでは
 * ない。**載っていないカードに上限は無い。**
 *
 * **鍵はカード名である。** 制限は同名のカードに掛かるので、決まりの単位と書き方の単位を揃える。
 * 同名かどうかは `sameNameKey` で決まるので、空白の入り方が違う名前も同じカードを指す。
 */
export type CardLimits = Readonly<Record<string, number>>

/** デッキの規定を満たしていない点。 */
export type DeckViolation =
  | { readonly kind: '枚数不足'; readonly count: number; readonly minimum: number }
  | { readonly kind: '同名の入れすぎ'; readonly name: string; readonly count: number; readonly maximum: number }
  | { readonly kind: 'スターアイコンの入れすぎ'; readonly stars: number; readonly maximum: number }
  | {
      readonly kind: '禁止／制限の入れすぎ'
      readonly name: string
      readonly count: number
      readonly maximum: number
    }

/**
 * その形式のデッキの規定を満たしているか調べる。満たしていれば空の並びを返す。
 *
 * **禁止／制限の上限は当てない。** どのリストを使うかは形式ではなく部屋が決める（ADR-0021）ので、
 * 別に当てる（`checkCardLimits`）。
 */
export function checkDeckForFormat(deck: Deck, format: DuelFormat): readonly DeckViolation[] {
  switch (format) {
    case '構築戦':
      return checkConstructedDeck(deck)
  }
}

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

  for (const { name, count } of countByName(deck).values()) {
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

/**
 * デッキが禁止／制限の上限を超えていないか調べる（フロアルール Version 1.12 第2部 第1章 1-1）。
 * 超えていなければ空の並びを返す。
 *
 * **同名のカードに違う上限が付いていれば、小さいほうを使う。** 空白の入り方だけが違う名前で
 * 2 行載ることがありうる。どちらかを捨てると、厳しいほうを書いた意図が消える。
 */
export function checkCardLimits(deck: Deck, limits: CardLimits): readonly DeckViolation[] {
  const maximums = new Map<string, number>()
  for (const [name, limit] of Object.entries(limits)) {
    const key = sameNameKey(name)
    maximums.set(key, Math.min(limit, maximums.get(key) ?? limit))
  }

  const violations: DeckViolation[] = []
  for (const [key, { name, count }] of countByName(deck)) {
    const maximum = maximums.get(key)
    if (maximum !== undefined && count > maximum) {
      violations.push({ kind: '禁止／制限の入れすぎ', name, count, maximum })
    }
  }

  return violations
}

/**
 * 同名かどうかを比べるための、カード名の鍵。**同名の判定はここ 1 つである。**
 *
 * 数えるのは日本語版のカード名で（総合ルール 第3部 第1章 3-1）、（ ）でくくられた文も名前の
 * 一部である（第2部 第6章 1-1）。**空白が入っているかどうかは無視する**（フロアルール Version 1.12
 * 第2部 第1章 1-1）——「松岡美羽」と「松岡 美羽」は同名である。半角も全角も同じに扱う。
 *
 * 同名の 4 枚までと、禁止／制限の上限の両方がここを通る。**判定を分けると、片方だけ空白を
 * 無視する形が書けてしまう。** 同名の扱いを変える効果を持つカードが入るときも、直すのはここである。
 */
export function sameNameKey(name: string): string {
  return name.replace(/\s/gu, '')
}

function total(deck: Deck, count: (card: Card) => number): number {
  return deck.reduce((sum, card) => sum + count(card), 0)
}

/**
 * 同名のカードごとの枚数。鍵は `sameNameKey` で、名前はデッキで最初に出てきたものの書き方である。
 *
 * カードの実装が同じかどうかではなく名前で数える（総合ルール 第3部 第1章 3-1）。同じ名前の
 * 別のカードは同じ名前として数える。
 */
function countByName(deck: Deck): ReadonlyMap<string, { readonly name: string; readonly count: number }> {
  const counts = new Map<string, { readonly name: string; readonly count: number }>()
  for (const card of deck) {
    const key = sameNameKey(card.name)
    const counted = counts.get(key)
    counts.set(key, { name: counted?.name ?? card.name, count: (counted?.count ?? 0) + 1 })
  }
  return counts
}
