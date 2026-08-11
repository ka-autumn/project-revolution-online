import { describe, expect, it } from 'vitest'
import { checkConstructedDeck, defineUnit } from './index.js'
import type { Card, Deck } from './index.js'

function testUnit(name: string, stars = 0, reverseStars = 0): Card {
  return defineUnit({ name, level: 1, bp: 1000, sp: 1000, stars, reverseStars })
}

/** 構築戦の規定を満たす最小のデッキ。15 種類のカードを 4 枚ずつで 60 枚。 */
function legalDeck(): Deck {
  return Array.from({ length: 15 }, (_, index) => testUnit(`テストユニット${index}`)).flatMap((card) => [
    card,
    card,
    card,
    card,
  ])
}

/**
 * スターアイコンを持つカードを `count` 枚含む 60 枚のデッキ。1 枚あたり `stars` 個。
 *
 * 残りはスターアイコンを持たないカードで埋める。同名 4 枚の規定に引っかからないよう、
 * 4 枚ごとに別の名前にする。
 */
function withStars(stars: number, count: number, ...extra: readonly Card[]): Deck {
  const starred = Array.from({ length: count }, (_, index) =>
    testUnit(`★${stars} のテストユニット${Math.floor(index / 4)}`, stars),
  )
  return [...starred, ...legalDeck().slice(count), ...extra]
}

// 総合ルール 第3部 第1章 3-1（ADR-0006）
describe('構築戦のデッキ', () => {
  it('規定を満たすデッキには違反がない', () => {
    expect(checkConstructedDeck(legalDeck())).toEqual([])
  })

  it('60 枚未満は枚数が足りない', () => {
    const deck = legalDeck().slice(1)

    expect(checkConstructedDeck(deck)).toEqual([{ kind: '枚数不足', count: 59, minimum: 60 }])
  })

  it('60 枚を超えていてもよい', () => {
    const deck = [...legalDeck(), testUnit('もう 1 種類のテストユニット')]

    expect(checkConstructedDeck(deck)).toEqual([])
  })

  it('同じカード名は 4 枚まで', () => {
    const deck = [...legalDeck(), testUnit('テストユニット0')]

    expect(checkConstructedDeck(deck)).toEqual([
      { kind: '同名の入れすぎ', name: 'テストユニット0', count: 5, maximum: 4 },
    ])
  })

  // 総合ルール 第2部 第6章 1-1 の【例】（ADR-0006）
  it.each([
    ['大佛はずむ（♂）', '大佛はずむ'],
    ['天狐空幻（♂）', '天狐空幻（♀）'],
  ])('括弧内だけが違う「%s」と「%s」は別のカード名として数える', (firstName, secondName) => {
    const first = testUnit(firstName)
    const second = testUnit(secondName)
    const deck = [...legalDeck(), first, first, first, first, second, second, second, second]

    expect(checkConstructedDeck(deck)).toEqual([])
  })

  // 総合ルール 第2部 第7章 2
  it('スターアイコンは合計 15 個まで', () => {
    expect(checkConstructedDeck(withStars(1, 15))).toEqual([])
    expect(checkConstructedDeck(withStars(1, 16))).toEqual([
      { kind: 'スターアイコンの入れすぎ', stars: 16, maximum: 15 },
    ])
  })

  // 総合ルール 第2部 第7章 4
  it('数字の書かれたスターアイコンは、その数字分のスターとして数える', () => {
    // ★3 のカードなら 5 枚で 15 個、6 枚で 18 個になる。枚数で数えていれば
    // どちらも上限に収まってしまう。
    expect(checkConstructedDeck(withStars(3, 5))).toEqual([])
    expect(checkConstructedDeck(withStars(3, 6))).toEqual([
      { kind: 'スターアイコンの入れすぎ', stars: 18, maximum: 15 },
    ])
  })

  // 総合ルール 第2部 第7章 3 の【例】（ADR-0006）
  it('リバーススターアイコン 1 個につきスターアイコンの上限が 1 個増える', () => {
    const reverseStar = testUnit('テストリバーススター', 0, 1)

    expect(checkConstructedDeck(withStars(1, 16, reverseStar))).toEqual([])
    expect(checkConstructedDeck(withStars(1, 17, reverseStar))).toEqual([
      { kind: 'スターアイコンの入れすぎ', stars: 17, maximum: 16 },
    ])
  })

  it('入れすぎているカード名が複数あれば、そのすべてが返る', () => {
    const deck = [...legalDeck(), testUnit('テストユニット0'), testUnit('テストユニット3')]

    expect(checkConstructedDeck(deck)).toEqual([
      { kind: '同名の入れすぎ', name: 'テストユニット0', count: 5, maximum: 4 },
      { kind: '同名の入れすぎ', name: 'テストユニット3', count: 5, maximum: 4 },
    ])
  })
})
