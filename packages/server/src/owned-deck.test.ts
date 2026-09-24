import { describe, expect, it } from 'vitest'
import { defineUnit } from '@revolution/engine'
import type { Card } from '@revolution/engine'
import type { CardPool } from './deck.js'
import {
  DECK_CARD_LIMIT,
  DECK_DESCRIPTION_LIMIT,
  DECK_NAME_LIMIT,
  readDeck,
  sortCards,
  violationsOf,
} from './owned-deck.js'

/**
 * 持ち主が組んだデッキの決まり（ADR-0021）。
 *
 * サーバはカードを知れない（ADR-0002）ので、架空のテストカードと架空の識別子で組む。
 */

const POOL: CardPool = Object.fromEntries(
  Array.from({ length: 15 }, (_, index): [string, Card] => [
    `TEST-${index}`,
    defineUnit({ name: `テスト・デッキ${index}`, level: 0, bp: 100, sp: 100, moveIcon: ['上'] }),
  ]),
)

/** 構築戦の最小枚数（60 枚）を満たす、15 種類 × 4 枚の並び。 */
const FULL = Object.keys(POOL).flatMap((key) => Array.from({ length: 4 }, () => key))

function draft(overrides: Partial<Record<'name' | 'description' | 'cards', unknown>> = {}) {
  return { name: 'わたしのデッキ', description: '', cards: ['TEST-0'], ...overrides }
}

describe('並びを揃える', () => {
  it('識別子の文字列としての順に並ぶ', () => {
    expect(sortCards(['TEST-2', 'TEST-10', 'TEST-1', 'TEST-2'])).toEqual(['TEST-1', 'TEST-10', 'TEST-2', 'TEST-2'])
  })

  /** 同じ中身のデッキが 1 つに決まる（ADR-0021）。 */
  it('置いた順が違っても、同じ中身なら同じ並びになる', () => {
    expect(sortCards(['TEST-3', 'TEST-1', 'TEST-3'])).toEqual(sortCards(['TEST-3', 'TEST-3', 'TEST-1']))
  })

  it('渡した並びは変えない', () => {
    const cards = ['TEST-2', 'TEST-1']
    sortCards(cards)

    expect(cards).toEqual(['TEST-2', 'TEST-1'])
  })
})

describe('デッキを読む', () => {
  it('揃えた並びで通る', () => {
    expect(readDeck(draft({ cards: ['TEST-1', 'TEST-0', 'TEST-1'] }), POOL)).toEqual({
      kind: '決まった',
      deck: { name: 'わたしのデッキ', description: '', cards: ['TEST-0', 'TEST-1', 'TEST-1'] },
    })
  })

  /** 60 枚に届くまで、組みかけは必ず規定を満たしていない（ADR-0021）。 */
  it('構築戦の規定を満たしていなくても通る', () => {
    expect(readDeck(draft({ cards: [] }), POOL).kind).toBe('決まった')
  })

  it('名前の前後の空白は落とす', () => {
    const reading = readDeck(draft({ name: '  わたしのデッキ  ' }), POOL)

    expect(reading.kind === '決まった' && reading.deck.name).toBe('わたしのデッキ')
  })

  it('名前が空なら断る', () => {
    expect(readDeck(draft({ name: '   ' }), POOL)).toEqual({ kind: '断る', reason: 'デッキの名前を入れてください' })
  })

  it('名前に改行が入っていたら断る', () => {
    expect(readDeck(draft({ name: 'わたしの\nデッキ' }), POOL)).toEqual({
      kind: '断る',
      reason: 'デッキの名前に使えない文字が入っています',
    })
  })

  it(`名前は ${DECK_NAME_LIMIT} 文字まで`, () => {
    expect(readDeck(draft({ name: 'あ'.repeat(DECK_NAME_LIMIT) }), POOL).kind).toBe('決まった')
    expect(readDeck(draft({ name: 'あ'.repeat(DECK_NAME_LIMIT + 1) }), POOL)).toEqual({
      kind: '断る',
      reason: `デッキの名前は ${DECK_NAME_LIMIT} 文字までです`,
    })
  })

  it('解説は空でよい', () => {
    expect(readDeck(draft({ description: '' }), POOL).kind).toBe('決まった')
  })

  it(`解説は ${DECK_DESCRIPTION_LIMIT} 文字まで`, () => {
    expect(readDeck(draft({ description: 'あ'.repeat(DECK_DESCRIPTION_LIMIT) }), POOL).kind).toBe('決まった')
    expect(readDeck(draft({ description: 'あ'.repeat(DECK_DESCRIPTION_LIMIT + 1) }), POOL)).toEqual({
      kind: '断る',
      reason: `デッキの解説は ${DECK_DESCRIPTION_LIMIT} 文字までです`,
    })
  })

  /**
   * ペアになっていないサロゲートは、書き込む先（`node:sqlite`）が U+FFFD に置き換えて保存する。
   * 読む段階で断れば、返事や一覧に載る値が置き場の値と食い違うことがない。
   */
  it('名前にペアになっていないサロゲートが入っていたら断る', () => {
    expect(readDeck(draft({ name: `わたしの${String.fromCodePoint(0xd800)}デッキ` }), POOL)).toEqual({
      kind: '断る',
      reason: 'デッキの名前に使えない文字が入っています',
    })
  })

  it('解説にペアになっていないサロゲートが入っていたら断る', () => {
    expect(readDeck(draft({ description: `メモ${String.fromCodePoint(0xdc00)}` }), POOL)).toEqual({
      kind: '断る',
      reason: 'デッキの解説に使えない文字が入っています',
    })
  })

  it(`カードは ${DECK_CARD_LIMIT} 枚まで`, () => {
    expect(readDeck(draft({ cards: Array.from({ length: DECK_CARD_LIMIT }, () => 'TEST-0') }), POOL).kind).toBe(
      '決まった',
    )
    expect(readDeck(draft({ cards: Array.from({ length: DECK_CARD_LIMIT + 1 }, () => 'TEST-0') }), POOL)).toEqual({
      kind: '断る',
      reason: `デッキに入れられるのは ${DECK_CARD_LIMIT} 枚までです`,
    })
  })

  /** 画面から来た任意の文字列を置き場に入れない。 */
  it('プールに無いカードが入っていたら断る', () => {
    expect(readDeck(draft({ cards: ['TEST-0', 'どこにもない'] }), POOL)).toEqual({
      kind: '断る',
      reason: '使えないカードが入っています',
    })
  })

  it('受け継いだ名前はカードとして通さない', () => {
    expect(readDeck(draft({ cards: ['toString'] }), POOL).kind).toBe('断る')
  })

  it('型の違うものは断る', () => {
    expect(readDeck(draft({ name: 1 }), POOL).kind).toBe('断る')
    expect(readDeck(draft({ description: undefined }), POOL).kind).toBe('断る')
    expect(readDeck(draft({ cards: 'TEST-0' }), POOL).kind).toBe('断る')
    expect(readDeck(draft({ cards: [0] }), POOL).kind).toBe('断る')
  })
})

describe('構築戦の規定を確かめる', () => {
  // 総合ルール 第3部 第1章 3-1（ADR-0006）
  it('満たしていれば空', () => {
    expect(violationsOf(FULL, POOL)).toEqual([])
  })

  // 総合ルール 第3部 第1章 3-1（ADR-0006）
  it('足りなければ、あと何枚かが分かる', () => {
    expect(violationsOf(FULL.slice(1), POOL)).toEqual([{ kind: '枚数不足', count: 59, minimum: 60 }])
  })
})
