import { describe, expect, it } from 'vitest'
import { CONSTRUCTED_DECK_MINIMUM, defineUnit } from '@revolution/engine'
import type { Card } from '@revolution/engine'
import { COPIES_PER_CARD, buildDeck, checkDecks, setupFromDecks } from './deck.js'
import type { CardSet } from './deck.js'
import type { Deck } from '@revolution/engine'

/**
 * カードのまとまりからデッキを組むところ（#105）。
 *
 * **カードを知らない。** 実カードを名指しするのは、これを呼ぶ側（非公開）である。ここで使うのは
 * エンジンの中で定義した架空のカードで、確かめるのは枚数と規定への適合だけである。
 */

/** その名前で `count` 種類のカードを持つまとまり。 */
function setOf(prefix: string, count: number): CardSet {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index): readonly [string, Card] => [
      `${prefix}-${index}`,
      defineUnit({ name: `テスト・${prefix}${index}`, level: 0, bp: 100, sp: 100 }),
    ]),
  )
}

/** トライアルデッキと同じ 20 種のまとまり。 */
const TWENTY = setOf('デッキ', 20)

describe('デッキを組む', () => {
  it('1 種につき 3 枚並べる', () => {
    const deck = buildDeck(setOf('小さい', 2))

    expect(deck).toHaveLength(2 * COPIES_PER_CARD)
  })

  /** 収録 20 種 × 3 枚で、構築戦の最小枚数（総合ルール 第3部 第1章 3-1）にちょうど届く。 */
  it('20 種なら構築戦の最小枚数にちょうど届く', () => {
    expect(buildDeck(TWENTY)).toHaveLength(CONSTRUCTED_DECK_MINIMUM)
  })

  /** 同じカードの実装が 3 つ並ぶ。1 枚につき 1 つの値なので、同一性で並ぶ。 */
  it('同じカードが 3 枚ずつ並ぶ', () => {
    const set = setOf('ひとつ', 1)
    const only = Object.values(set)[0]

    expect(buildDeck(set)).toEqual([only, only, only])
  })

  /** 鍵が何であるかは見ない。値だけを取り出す。 */
  it('鍵の付け方に関わらず組める', () => {
    expect(buildDeck({ 'まったく違う鍵': Object.values(TWENTY)[0] as Card })).toHaveLength(COPIES_PER_CARD)
  })
})

describe('デッキの不備を確かめる', () => {
  it('規定を満たしていれば、不備は無い', () => {
    expect(checkDecks([buildDeck(TWENTY), buildDeck(TWENTY)])).toEqual([])
  })

  /** 総合ルール 第3部 第1章 3-1。構築戦のデッキは 60 枚以上。 */
  it('枚数が足りなければ、何人目のデッキかが分かる', () => {
    const violations = checkDecks([buildDeck(TWENTY), buildDeck(setOf('少ない', 2))])

    expect(violations).toHaveLength(1)
    expect(violations[0]?.seat).toBe(1)
    expect(violations[0]?.violation.kind).toBe('枚数不足')
  })

  it('両方に不備があれば、両方とも出る', () => {
    const small = buildDeck(setOf('少ない', 2))

    expect(checkDecks([small, small]).map((each) => each.seat)).toEqual([0, 1])
  })
})

describe('部屋に渡すもの', () => {
  const decks: readonly [Deck, Deck] = [buildDeck(TWENTY), buildDeck(setOf('相手', 20))]

  it('渡されたデッキをそのまま渡す', () => {
    const setup = setupFromDecks(decks)()

    expect(setup.decks).toBe(decks)
  })

  /**
   * 呼ぶたびに違うシードを返す（ADR-0005）。同じシードを返すと、どの部屋も同じ山札の並びに
   * なる。**たまたま同じ値が 2 回続くことはありうる**ので、何度か引いて 1 つでも違えばよい。
   */
  it('呼ぶたびにシードが変わる', () => {
    const setup = setupFromDecks(decks)
    const seeds = new Set(Array.from({ length: 20 }, () => setup().seed))

    expect(seeds.size).toBeGreaterThan(1)
  })

  /**
   * **セットを通さなくてよい。** デッキはただのカードの並びなので、枚数を変えたデッキも
   * そのまま渡せる。総合ルール 第3部 第1章 3-1 は同名 4 枚までなので、4 枚積みも規定の内側。
   */
  it('セットを通さずに組んだデッキも渡せる', () => {
    const [four, two] = [Object.values(TWENTY)[0] as Card, Object.values(TWENTY)[1] as Card]
    const handmade: Deck = [
      ...Array.from({ length: 4 }, () => four),
      ...Array.from({ length: 2 }, () => two),
      ...buildDeck(setOf('のこり', 18)),
    ]

    const setup = setupFromDecks([handmade, buildDeck(TWENTY)])()

    expect(setup.decks[0]).toHaveLength(4 + 2 + 18 * COPIES_PER_CARD)
    expect(checkDecks([setup.decks[0]])).toEqual([])
  })
})
