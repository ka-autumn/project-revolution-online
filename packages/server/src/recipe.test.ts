import { describe, expect, it } from 'vitest'
import type { RestrictionList } from './deck.js'
import { DECK_DESCRIPTION_LIMIT, DECK_NAME_LIMIT } from './owned-deck.js'
import { isRecipeListOrder, isShareVisibility, recipeKeyOf, readShareRequest, wireShareOf } from './recipe.js'
import type { StoredShare } from './recipe.js'

/**
 * レシピと共有の決まり（ADR-0022）。
 *
 * サーバはカードを知れない（ADR-0002）ので、架空のテストカードと架空の識別子で組む。
 */

function request(overrides: Partial<Record<'name' | 'description' | 'visibility', unknown>> = {}) {
  return { name: 'わたしのレシピ', description: '', visibility: 'リンクを知っている人だけ', ...overrides }
}

describe('レシピの鍵', () => {
  // 完了条件 2: 同じ中身のデッキを共有すると、レシピは1つに決まる。
  it('同じ中身なら、誰が渡しても同じ鍵になる', () => {
    expect(recipeKeyOf(['TEST-0', 'TEST-1', 'TEST-1'])).toBe(recipeKeyOf(['TEST-0', 'TEST-1', 'TEST-1']))
  })

  it('並びが違うだけの同じ中身は、同じ鍵になる', () => {
    expect(recipeKeyOf(['TEST-1', 'TEST-0', 'TEST-1'])).toBe(recipeKeyOf(['TEST-1', 'TEST-1', 'TEST-0']))
  })

  it('中身が違えば、違う鍵になる', () => {
    expect(recipeKeyOf(['TEST-0'])).not.toBe(recipeKeyOf(['TEST-1']))
  })

  it('渡した並びは変えない', () => {
    const cards = ['TEST-2', 'TEST-1']
    recipeKeyOf(cards)

    expect(cards).toEqual(['TEST-2', 'TEST-1'])
  })

  /** 識別子の切れ目をまたいで同じ中身に見えてしまわないこと（区切り文字の混同）を確かめる。 */
  it('要素の切れ目が違えば、まとめて繋いだ時に同じ文字列になる並びでも、違う鍵になる', () => {
    expect(recipeKeyOf(['ab', 'c'])).not.toBe(recipeKeyOf(['a', 'bc']))
  })
})

describe('共有の下書きを読む', () => {
  it('揃っていれば通る', () => {
    expect(readShareRequest(request())).toEqual({
      kind: '決まった',
      name: 'わたしのレシピ',
      description: '',
      visibility: 'リンクを知っている人だけ',
    })
  })

  it('一覧に載せるも選べる', () => {
    expect(readShareRequest(request({ visibility: '一覧に載せる' })).kind).toBe('決まった')
  })

  it('名前の前後の空白は落とす', () => {
    const reading = readShareRequest(request({ name: '  わたしのレシピ  ' }))

    expect(reading.kind === '決まった' && reading.name).toBe('わたしのレシピ')
  })

  it('名前が空なら断る', () => {
    expect(readShareRequest(request({ name: '   ' }))).toEqual({
      kind: '断る',
      reason: '共有する名前を入れてください',
    })
  })

  it('名前に改行が入っていたら断る', () => {
    expect(readShareRequest(request({ name: 'わたしの\nレシピ' })).kind).toBe('断る')
  })

  it(`名前は ${DECK_NAME_LIMIT} 文字まで`, () => {
    expect(readShareRequest(request({ name: 'あ'.repeat(DECK_NAME_LIMIT) })).kind).toBe('決まった')
    expect(readShareRequest(request({ name: 'あ'.repeat(DECK_NAME_LIMIT + 1) }))).toEqual({
      kind: '断る',
      reason: `共有する名前は ${DECK_NAME_LIMIT} 文字までです`,
    })
  })

  it(`解説は ${DECK_DESCRIPTION_LIMIT} 文字まで`, () => {
    expect(readShareRequest(request({ description: 'あ'.repeat(DECK_DESCRIPTION_LIMIT) })).kind).toBe('決まった')
    expect(readShareRequest(request({ description: 'あ'.repeat(DECK_DESCRIPTION_LIMIT + 1) }))).toEqual({
      kind: '断る',
      reason: `共有する解説は ${DECK_DESCRIPTION_LIMIT} 文字までです`,
    })
  })

  it('公開の段階が読めなければ断る', () => {
    expect(readShareRequest(request({ visibility: 'こうかい' }))).toEqual({
      kind: '断る',
      reason: '公開の段階が読めません',
    })
  })

  it('型の違うものは断る', () => {
    expect(readShareRequest(request({ name: 1 })).kind).toBe('断る')
    expect(readShareRequest(request({ description: undefined })).kind).toBe('断る')
    expect(readShareRequest(request({ visibility: undefined })).kind).toBe('断る')
  })
})

/**
 * 完了条件 2: 公開の段階は 2 値だけ読める。共有する時とあとから変える時の両方が、ここを通る
 * （`readShareRequest` と `serve.ts` の `共有の公開範囲を変える`）。
 */
describe('公開の段階として読めるか', () => {
  it('決まった 2 値だけを通す', () => {
    expect(isShareVisibility('リンクを知っている人だけ')).toBe(true)
    expect(isShareVisibility('一覧に載せる')).toBe(true)
  })

  it('知らない文字列は断る', () => {
    expect(isShareVisibility('こうかい')).toBe(false)
  })

  it('型の違うものは断る', () => {
    expect(isShareVisibility(undefined)).toBe(false)
    expect(isShareVisibility(null)).toBe(false)
    expect(isShareVisibility({})).toBe(false)
    expect(isShareVisibility(['一覧に載せる'])).toBe(false)
    expect(isShareVisibility(true)).toBe(false)
  })
})

describe('一覧の並べ方として読めるか', () => {
  it('決まった 2 値だけを通す', () => {
    expect(isRecipeListOrder('新着')).toBe(true)
    expect(isRecipeListOrder('コピー数')).toBe(true)
  })

  it('知らない文字列と、型の違うものは断る', () => {
    expect(isRecipeListOrder('人気順')).toBe(false)
    expect(isRecipeListOrder(undefined)).toBe(false)
    expect(isRecipeListOrder({})).toBe(false)
    expect(isRecipeListOrder(true)).toBe(false)
  })
})

/** 書き込むだけでなく、確かめた形式とリストを読み出せる（ADR-0022）。 */
describe('共有を通信に載せる形にする', () => {
  const RESTRICTIONS: readonly RestrictionList[] = [{ id: 'リスト1', name: 'テストのリスト', limits: {} }]

  function share(overrides: Partial<StoredShare> = {}): StoredShare {
    return {
      id: '共有1',
      recipe: 'かぎ1',
      owner: 'ぬし',
      name: 'わたしのレシピ',
      description: '',
      visibility: 'リンクを知っている人だけ',
      sharedAt: 0,
      revoked: false,
      format: '構築戦',
      restriction: undefined,
      ...overrides,
    }
  }

  it('確かめた形式が出る', () => {
    expect(wireShareOf(share(), () => 'ぬし', RESTRICTIONS).format).toBe('構築戦')
  })

  it('制限なしで確かめたなら、リストは無い', () => {
    expect(wireShareOf(share({ restriction: undefined }), () => 'ぬし', RESTRICTIONS).restriction).toBeUndefined()
  })

  it('当てたリストは、識別子と名前で出る', () => {
    expect(wireShareOf(share({ restriction: 'リスト1' }), () => 'ぬし', RESTRICTIONS).restriction).toEqual({
      id: 'リスト1',
      name: 'テストのリスト',
    })
  })

  /** ADR-0021 の `rulesRestored` と同じ理由。立てる時にリストを差し替えた後は、指す先が無い。 */
  it('渡された一覧に無い識別子は、リストが無いものとして出る', () => {
    expect(wireShareOf(share({ restriction: 'しらないリスト' }), () => 'ぬし', RESTRICTIONS).restriction).toBeUndefined()
  })
})
