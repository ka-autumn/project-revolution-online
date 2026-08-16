import { describe, expect, it } from 'vitest'
import { defineUnit } from '@revolution/engine'
import type { Card, Deck } from '@revolution/engine'
import { checkDecks, setupFromDecks } from './deck.js'

/**
 * 持ち込まれたデッキを、部屋に渡せる形にするところ（#105）。
 *
 * **デッキの組み方は持たない。** 何をどの枚数入れるかは持ち込む側が決めることで、ここが見るのは
 * 規定への適合だけである。実カードを名指しするのも持ち込む側（非公開）なので、ここで使うのは
 * エンジンの中で定義した架空のカードになる。
 */

function someCard(name: string): Card {
  return defineUnit({ name: `テスト・${name}`, level: 0, bp: 100, sp: 100 })
}

/** すべて違う名前の `count` 枚のデッキ。中身が何であるかは、ここでは関わらない。 */
function deckOf(prefix: string, count: number): Deck {
  return Array.from({ length: count }, (_, index) => someCard(`${prefix}${index}`))
}

/** 構築戦の規定を満たすデッキ（総合ルール 第3部 第1章 3-1、60 枚以上）。 */
const LEGAL = deckOf('規定内', 60)

describe('デッキの不備を確かめる', () => {
  it('規定を満たしていれば、不備は無い', () => {
    expect(checkDecks([LEGAL, LEGAL])).toEqual([])
  })

  // 総合ルール 第3部 第1章 3-1
  it('枚数が足りなければ、何人目のデッキかが分かる', () => {
    const violations = checkDecks([LEGAL, deckOf('少ない', 10)])

    expect(violations).toHaveLength(1)
    expect(violations[0]?.seat).toBe(1)
    expect(violations[0]?.violation.kind).toBe('枚数不足')
  })

  it('両方に不備があれば、両方とも出る', () => {
    const small = deckOf('少ない', 10)

    expect(checkDecks([small, small]).map((each) => each.seat)).toEqual([0, 1])
  })

  /**
   * 総合ルール 第3部 第1章 3-1。同名のカードはデッキに 4 枚まで。
   *
   * **枚数だけを見ているのではない**ことを、60 枚あるが同名が多すぎるデッキで確かめる。
   */
  it('同名が多すぎれば、枚数が足りていても不備になる', () => {
    const same = someCard('同じ名前')

    const violations = checkDecks([Array.from({ length: 60 }, () => same)])

    expect(violations.map((each) => each.violation.kind)).toContain('同名の入れすぎ')
  })

  it('デッキが 1 つでも確かめられる', () => {
    expect(checkDecks([LEGAL])).toEqual([])
  })
})

describe('部屋に渡すもの', () => {
  const decks: readonly [Deck, Deck] = [LEGAL, deckOf('相手', 60)]

  /** 組み直さない。持ち込まれたものをそのまま渡す。 */
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
   * **積み方を問わない。** デッキはただのカードの並びなので、同名を 4 枚入れたデッキも
   * そのまま渡せる（総合ルール 第3部 第1章 3-1 は同名 4 枚まで）。「セット全部を一律に積む」
   * ような取り決めは、ここではなく持ち込む側が持つ。
   */
  it('積み方を問わずに渡せる', () => {
    const four = someCard('4 枚積み')
    const handmade: Deck = [...Array.from({ length: 4 }, () => four), ...deckOf('のこり', 56)]

    const setup = setupFromDecks([handmade, LEGAL])()

    expect(setup.decks[0]).toHaveLength(60)
    expect(checkDecks([setup.decks[0]])).toEqual([])
  })
})
