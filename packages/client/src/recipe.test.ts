import { describe, expect, it } from 'vitest'
import type { PublicShareCard, ToClient, WireOwnedDeck, WirePoolCard, WireRecipe, WireShare } from '@revolution/engine'
import type { KeyValueStorage } from './recipe.js'
import {
  closedRecipeUrlOf,
  myShareRows,
  copyOutcomeOf,
  publicCardSections,
  recipeCardRows,
  recipeKeyFromPath,
  recipePathOf,
  recipeUrlOf,
  rememberPendingRecipe,
  rememberPendingShare,
  shareDraftOf,
  shareKeyFromPath,
  shareLinkOf,
  sharePathOf,
  shareRowsOf,
  takePendingRecipe,
  takePendingShare,
} from './recipe.js'

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

  // `recipePathOf` の逆。`main.ts` が URL を直に開いた時の鍵を読むのに使う。
  it('画面の側のパスから鍵を読み戻す', () => {
    expect(recipeKeyFromPath(`/recipe/${encodeURIComponent('かぎ1')}`)).toBe('かぎ1')
  })

  it('レシピのパスでなければ、鍵は無い', () => {
    expect(recipeKeyFromPath('/')).toBeUndefined()
    expect(recipeKeyFromPath('/deck')).toBeUndefined()
  })

  /**
   * `decodeURIComponent` は壊れた percent-encoding に投げる。ここで拾わずに投げさせると、
   * `main.ts` はトップレベルで呼んでいるので画面が真っ白になる（`server` の `serve.ts` の
   * `handlePublicShare` と同じ理由で、鍵が無いのと同じ形に倒す）。
   */
  it('壊れた percent-encoding では、投げずに鍵が無いものとして読む', () => {
    expect(recipeKeyFromPath('/recipe/%zz')).toBeUndefined()
  })
})

/** `/share/<鍵>` の公開ページ（ADR-0022、#197）。`recipe/<鍵>` とは別のパスを持つ。 */
describe('共有 1 つのリンク', () => {
  it('画面の側のパスを組み立てる', () => {
    expect(sharePathOf('かぎ1')).toBe(`/share/${encodeURIComponent('かぎ1')}`)
  })

  it('区切り文字が入っていても、パスの区切りが増えない', () => {
    expect(sharePathOf('かぎ/1?a=b')).toBe('/share/%E3%81%8B%E3%81%8E%2F1%3Fa%3Db')
  })

  it('渡す先の原点とパスを繋いでリンクにする', () => {
    expect(shareLinkOf('https://example.com', 'かぎ1')).toBe(`https://example.com/share/${encodeURIComponent('かぎ1')}`)
  })

  it('画面の側のパスから鍵を読み戻す', () => {
    expect(shareKeyFromPath(`/share/${encodeURIComponent('かぎ1')}`)).toBe('かぎ1')
  })

  it('共有のパスでなければ、鍵は無い', () => {
    expect(shareKeyFromPath('/')).toBeUndefined()
    expect(shareKeyFromPath('/recipe/かぎ1')).toBeUndefined()
  })

  it('壊れた percent-encoding では、投げずに鍵が無いものとして読む', () => {
    expect(shareKeyFromPath('/share/%zz')).toBeUndefined()
  })

  /**
   * レシピ画面を開いて閉じても、問い合わせ文字列（`?server=`・`?participant=`）が元のまま残る
   * こと（ADR-0022）。README がこれを現役の手段として案内している。
   */
  it('レシピ画面を開く URL は、問い合わせ文字列を残す', () => {
    expect(recipeUrlOf('かぎ1', '?server=ws%3A%2F%2Fexample&participant=わたし')).toBe(
      `/recipe/${encodeURIComponent('かぎ1')}?server=ws%3A%2F%2Fexample&participant=わたし`,
    )
  })

  it('問い合わせ文字列が無ければ、そのまま足さない', () => {
    expect(recipeUrlOf('かぎ1', '')).toBe(`/recipe/${encodeURIComponent('かぎ1')}`)
  })

  it('レシピ画面を閉じて戻す URL も、問い合わせ文字列を残す', () => {
    expect(closedRecipeUrlOf('?server=ws%3A%2F%2Fexample')).toBe('/?server=ws%3A%2F%2Fexample')
  })

  it('問い合わせ文字列が無ければ、根のパスに戻す', () => {
    expect(closedRecipeUrlOf('')).toBe('/')
  })
})

/**
 * 未ログインで `/recipe/<鍵>` を開き、ログインを終えた直後にそのレシピが開けるようにする
 * （ADR-0022）。
 *
 * **`sessionStorage` を直に使わない。** ブラウザの外（vitest は Node で走る）には無いので、
 * 最小限の形（`KeyValueStorage`）を渡せるようにして、偽物で確かめる。
 */
describe('未ログインで開こうとしたレシピを預ける', () => {
  /** 中身を持つだけの偽物。`sessionStorage` の代わりに渡す。 */
  function fakeStorage(initial: Readonly<Record<string, string>> = {}): KeyValueStorage {
    const data = new Map(Object.entries(initial))
    return {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value)
      },
      removeItem: (key) => {
        data.delete(key)
      },
    }
  }

  it('預けた鍵が、そのまま取り出せる', () => {
    const storage = fakeStorage()

    rememberPendingRecipe(storage, 'かぎ1')

    expect(takePendingRecipe(storage)).toBe('かぎ1')
  })

  /** 取り出したら忘れる。次にログインが要る場面で、古い鍵を誤って開かないようにするため。 */
  it('取り出すと、忘れる', () => {
    const storage = fakeStorage()
    rememberPendingRecipe(storage, 'かぎ1')

    takePendingRecipe(storage)

    expect(takePendingRecipe(storage)).toBeUndefined()
  })

  it('預けていなければ、無い', () => {
    expect(takePendingRecipe(fakeStorage())).toBeUndefined()
  })

  /** 覚えられないブラウザ（`index.ts` の `goToSignIn` と同じ作法）でも落ちない。 */
  it('書き込めなくても、投げない', () => {
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error('使えない')
      },
      setItem: () => {
        throw new Error('使えない')
      },
      removeItem: () => {
        throw new Error('使えない')
      },
    }

    expect(() => rememberPendingRecipe(throwing, 'かぎ1')).not.toThrow()
    expect(takePendingRecipe(throwing)).toBeUndefined()
  })
})

/** `/share/<鍵>` の「ログインする」に乗る前の預かり（ADR-0022、#197）。作りは上と同じ。 */
describe('未ログインで開いていた共有の鍵を預ける', () => {
  function fakeStorage(initial: Readonly<Record<string, string>> = {}): KeyValueStorage {
    const data = new Map(Object.entries(initial))
    return {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value)
      },
      removeItem: (key) => {
        data.delete(key)
      },
    }
  }

  it('預けた鍵が、そのまま取り出せる', () => {
    const storage = fakeStorage()

    rememberPendingShare(storage, '公開鍵1')

    expect(takePendingShare(storage)).toBe('公開鍵1')
  })

  it('取り出すと、忘れる', () => {
    const storage = fakeStorage()
    rememberPendingShare(storage, '公開鍵1')

    takePendingShare(storage)

    expect(takePendingShare(storage)).toBeUndefined()
  })

  it('預けていなければ、無い', () => {
    expect(takePendingShare(fakeStorage())).toBeUndefined()
  })

  it('書き込めなくても、投げない', () => {
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error('使えない')
      },
      setItem: () => {
        throw new Error('使えない')
      },
      removeItem: () => {
        throw new Error('使えない')
      },
    }

    expect(() => rememberPendingShare(throwing, '公開鍵1')).not.toThrow()
    expect(takePendingShare(throwing)).toBeUndefined()
  })

  /** レシピの預かりとは別の場所に持つ。片方だけ開いていた場合に、もう片方の古い値と混ざらない。 */
  it('レシピの預かりとは別の場所に持つ', () => {
    const storage = fakeStorage()
    rememberPendingRecipe(storage, 'かぎ1')
    rememberPendingShare(storage, '公開鍵1')

    expect(takePendingShare(storage)).toBe('公開鍵1')
    expect(takePendingRecipe(storage)).toBe('かぎ1')
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
      {
        id: '共有1',
        key: '公開鍵1',
        recipe: 'かぎ1',
        sharer: 'ぬし',
        name: 'ひとつめ',
        description: 'かいせつ1',
        visibility: '一覧に載せる',
        revoked: false,
        format: '構築戦',
        restriction: { id: 'リスト1', name: 'テストのリスト' },
      },
      {
        id: '共有2',
        key: '公開鍵2',
        recipe: 'かぎ1',
        sharer: 'べつのひと',
        name: 'ふたつめ',
        description: '',
        visibility: 'リンクを知っている人だけ',
        revoked: false,
        format: '構築戦',
        restriction: undefined,
      },
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
      {
        id: '共有1',
        sharer: 'ぬし',
        name: 'ひとつめ',
        description: 'かいせつ1',
        rulesLabel: '構築戦・テストのリストで確かめて共有',
      },
      { id: '共有2', sharer: 'べつのひと', name: 'ふたつめ', description: '', rulesLabel: '構築戦・制限なしで確かめて共有' },
    ])
  })

  // 書き込むだけでなく、確かめた形式とリストをレシピの画面に出す（ADR-0022）。
  it('制限なしで確かめたなら、そう出す', () => {
    expect(shareRowsOf(RECIPE)[1]?.rulesLabel).toBe('構築戦・制限なしで確かめて共有')
  })

  it('リストを当てて確かめたなら、その名前を出す', () => {
    expect(shareRowsOf(RECIPE)[0]?.rulesLabel).toBe('構築戦・テストのリストで確かめて共有')
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
    {
      id: '共有1',
      key: '公開鍵1',
      recipe: 'かぎ1',
      sharer: 'わたし',
      name: 'ひとつめ',
      description: '',
      visibility: 'リンクを知っている人だけ',
      revoked: false,
      format: '構築戦',
      restriction: undefined,
    },
    {
      id: '共有2',
      key: '公開鍵2',
      recipe: 'かぎ2',
      sharer: 'わたし',
      name: 'ふたつめ',
      description: '',
      visibility: '一覧に載せる',
      revoked: true,
      format: '構築戦',
      restriction: undefined,
    },
  ]

  // 完了条件 5: 取り消した共有も、取り消した本人には見える。
  it('取り消したものも、そうと分かる形で並ぶ', () => {
    expect(myShareRows(SHARES)).toEqual([
      { id: '共有1', key: '公開鍵1', recipe: 'かぎ1', name: 'ひとつめ', description: '', visibility: 'リンクを知っている人だけ', revoked: false },
      { id: '共有2', key: '公開鍵2', recipe: 'かぎ2', name: 'ふたつめ', description: '', visibility: '一覧に載せる', revoked: true },
    ])
  })
})

/** `/share/<鍵>` の公開ページで、カードを種類ごとの枠に分ける（ADR-0022、#197）。 */
describe('公開ページのカードを種類ごとの枠に分ける', () => {
  function card(overrides: Partial<PublicShareCard> = {}): PublicShareCard {
    return { count: 1, name: 'てすと', type: 'ユニット', level: 0, colors: [], detail: undefined, ...overrides }
  }

  it('1 枚も無い種類の枠は出ない', () => {
    const sections = publicCardSections([card({ type: 'ユニット' })])

    expect(sections.map((section) => section.type)).toEqual(['ユニット'])
  })

  it('複数の種類があれば、CARD_TYPES の順に並ぶ', () => {
    const sections = publicCardSections([
      card({ name: 'とらっぷ', type: 'トラップ' }),
      card({ name: 'ゆにっと', type: 'ユニット' }),
      card({ name: 'すとらてじー', type: 'ストラテジー' }),
    ])

    expect(sections.map((section) => section.type)).toEqual(['ユニット', 'ストラテジー', 'トラップ'])
  })

  it('取り下げられたカード（type が undefined）は最後の枠にまとまる', () => {
    const sections = publicCardSections([card({ type: 'ユニット' }), card({ name: 'きえた', type: undefined })])

    expect(sections.map((section) => section.type)).toEqual(['ユニット', undefined])
    expect(sections.at(-1)?.cards.map((c) => c.name)).toEqual(['きえた'])
  })

  it('同じ種類は同じ枠にまとまる', () => {
    const sections = publicCardSections([card({ name: 'A' }), card({ name: 'B' })])

    expect(sections).toEqual([{ type: 'ユニット', cards: [card({ name: 'A' }), card({ name: 'B' })] }])
  })
})

/**
 * `/share/<鍵>` の「コピーする」が繋いだ後、サーバから届いたものをコピーの結果として読む
 * （ADR-0022、#197）。`public-share.ts` の `mountPublicShare` が使う。
 */
describe('コピーの結果を読む', () => {
  it('デッキを保存した → コピーできた', () => {
    const message: ToClient = { kind: 'デッキを保存した', deck: 'デッキ1', violations: [] }

    expect(copyOutcomeOf(message)).toEqual({ kind: 'コピーできた' })
  })

  it('名前を決めてほしい → 名前が要る', () => {
    const message: ToClient = { kind: '名前を決めてほしい', current: undefined, reason: undefined }

    expect(copyOutcomeOf(message)).toEqual({ kind: '名前が要る' })
  })

  it('行えなかった → 理由をそのまま持つ', () => {
    const message: ToClient = { kind: '行えなかった', reason: '共有は取り消されています' }

    expect(copyOutcomeOf(message)).toEqual({ kind: '行えなかった', reason: '共有は取り消されています' })
  })

  it('関係ないメッセージ（ロビーなど）は無視する', () => {
    const message: ToClient = { kind: 'ロビー', rooms: [], presets: [], chosen: undefined, cpuChosen: undefined, restrictions: [] }

    expect(copyOutcomeOf(message)).toBeUndefined()
  })
})
