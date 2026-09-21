import { describe, expect, it } from 'vitest'
import type { WireOwnedDeck, WirePoolCard, WireRecipe, WireShare } from '@revolution/engine'
import { myShareRows, recipeCardRows, recipeLinkOf, recipePathOf, shareDraftOf, shareRowsOf } from './recipe.js'

/**
 * レシピと共有を扱うところ（ADR-0022）。
 *
 * **ここにルールの判断は無い。** 規定を満たしているかはサーバが決める。ここで確かめるのは、
 * 届いたものが画面に出す形にちゃんと直ることだけである。
 */

describe('リンク', () => {
  // 実物の鍵は sha256 の 16 進数（`server` の `recipe.ts` の `recipeKeyOf`）だが、ここでは
  // 読みやすい文字列で確かめる。
  it('画面の側のパスを組み立てる', () => {
    expect(recipePathOf('かぎ1')).toBe(`/recipe/${encodeURIComponent('かぎ1')}`)
  })

  // ?participant= が付いてくると、席に座れる合言葉を渡すことになる（ADR-0022）ので、区切り文字を
  // 含む値が渡されてもパスの区切りが増えないことを確かめる。
  it('区切り文字が入っていても、パスの区切りが増えない', () => {
    expect(recipePathOf('かぎ/1?a=b')).toBe('/recipe/%E3%81%8B%E3%81%8E%2F1%3Fa%3Db')
  })

  it('渡す先の原点とパスを繋いでリンクにする', () => {
    expect(recipeLinkOf('https://example.com', 'かぎ1')).toBe(`https://example.com/recipe/${encodeURIComponent('かぎ1')}`)
  })
})

describe('共有する下書き', () => {
  const DECK: WireOwnedDeck = { id: 'デッキ1', name: 'わたしのデッキ', description: 'かいせつ', cards: ['TEST-0'] }

  // 完了条件: 共有する時の初期値はそのデッキの名前と解説（ADR-0022）。
  it('初期値はそのデッキの名前と解説', () => {
    expect(shareDraftOf(DECK)).toEqual({
      deck: 'デッキ1',
      name: 'わたしのデッキ',
      description: 'かいせつ',
      visibility: 'リンクを知っている人だけ',
      format: undefined,
      restriction: undefined,
    })
  })

  it('公開の段階の既定は、リンクを知っている人だけ', () => {
    expect(shareDraftOf(DECK).visibility).toBe('リンクを知っている人だけ')
  })
})

describe('レシピの画面', () => {
  const RECIPE: WireRecipe = {
    key: 'かぎ1',
    cards: ['TEST-0', 'TEST-0', 'TEST-1'],
    shares: [
      { id: '共有1', recipe: 'かぎ1', sharer: 'ぬし', name: 'ひとつめ', description: 'かいせつ1', visibility: '一覧に載せる', revoked: false },
      { id: '共有2', recipe: 'かぎ1', sharer: 'べつのひと', name: 'ふたつめ', description: '', visibility: 'リンクを知っている人だけ', revoked: false },
    ],
  }

  const POOL: readonly WirePoolCard[] = [
    {
      key: 'TEST-0',
      face: { type: 'ユニット', name: 'テスト・カードＡ', level: 0, colors: [], stars: 0, reverseStars: 0, attributes: [], text: [], bp: 0, sp: 0, moveIcon: [] },
      expansions: [],
    },
    {
      key: 'TEST-1',
      face: { type: 'ユニット', name: 'テスト・カードＢ', level: 0, colors: [], stars: 0, reverseStars: 0, attributes: [], text: [], bp: 0, sp: 0, moveIcon: [] },
      expansions: [],
    },
  ]

  // 完了条件: レシピの画面には、共有を全部並べる（共有者・名前・解説）。
  it('共有を全部並べる', () => {
    expect(shareRowsOf(RECIPE)).toEqual([
      { id: '共有1', sharer: 'ぬし', name: 'ひとつめ', description: 'かいせつ1' },
      { id: '共有2', sharer: 'べつのひと', name: 'ふたつめ', description: '' },
    ])
  })

  // 完了条件 3: レシピには「何が何枚か」だけが写され、カードの姿は焼き付けられていない——プールを引く。
  it('プールを引いて、何が何枚かを出す', () => {
    expect(recipeCardRows(POOL, RECIPE.cards)).toEqual([
      { name: 'テスト・カードＡ', count: 2 },
      { name: 'テスト・カードＢ', count: 1 },
    ])
  })

  /** ADR-0021。取り下げられたカードを含むレシピは、そのまま残る。 */
  it('プールに無いカードは、それと分かる形で出す', () => {
    expect(recipeCardRows(POOL, ['どこにもない'])).toEqual([{ name: '（取り下げられたカード）', count: 1 }])
  })
})

describe('自分の共有', () => {
  const SHARES: readonly WireShare[] = [
    { id: '共有1', recipe: 'かぎ1', sharer: 'わたし', name: 'ひとつめ', description: '', visibility: 'リンクを知っている人だけ', revoked: false },
    { id: '共有2', recipe: 'かぎ2', sharer: 'わたし', name: 'ふたつめ', description: '', visibility: '一覧に載せる', revoked: true },
  ]

  // 完了条件 5: 取り消した共有も、取り消した本人には見える。
  it('取り消したものも、そうと分かる形で並ぶ', () => {
    expect(myShareRows(SHARES)).toEqual([
      { id: '共有1', recipe: 'かぎ1', name: 'ひとつめ', description: '', visibility: 'リンクを知っている人だけ', revoked: false },
      { id: '共有2', recipe: 'かぎ2', name: 'ふたつめ', description: '', visibility: '一覧に載せる', revoked: true },
    ])
  })
})
