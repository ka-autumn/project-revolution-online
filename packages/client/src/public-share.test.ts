import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadPublicShare } from './public-share.js'

/**
 * `/share/<鍵>` を尋ねる `loadPublicShare`（ADR-0022、#197）。
 *
 * DOM には触れない関数なので、`fetch` を差し替えるだけで確かめられる。描くところ
 * （`mountPublicShare`・`render.ts`）はこのリポジトリの流儀どおりテストしない——判断のある
 * ロジックはここまでに切り出してある（`recipe.ts` の `copyOutcomeOf` と同じ考え方）。
 */
describe('/share/<鍵> を読む', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('200 なら、読めた中身をそのまま返す', async () => {
    const body = { name: 'わたしのレシピ', authenticated: false }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) }),
    )

    expect(await loadPublicShare('https://duel.example.com', 'かぎ1')).toEqual({ kind: '読めた', share: body })
  })

  it('200 でなければ、開けなかったとして返す', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))

    expect(await loadPublicShare('https://duel.example.com', 'しらない鍵')).toEqual({ kind: '開けなかった' })
  })

  /** 繋がらない（オフライン、CORS で弾かれた等）と `fetch` 自体が投げる。 */
  it('fetch が投げても、開けなかったとして返す', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('繋がらない')))

    expect(await loadPublicShare('https://duel.example.com', 'かぎ1')).toEqual({ kind: '開けなかった' })
  })

  it('JSON として読めなくても、開けなかったとして返す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.reject(new Error('JSON でない')) }),
    )

    expect(await loadPublicShare('https://duel.example.com', 'かぎ1')).toEqual({ kind: '開けなかった' })
  })

  it('サーバの置き場と鍵から URL を組み立てる', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    vi.stubGlobal('fetch', fetchSpy)

    await loadPublicShare('https://duel.example.com', 'かぎ/1?a=b')

    expect(fetchSpy).toHaveBeenCalledWith(
      `https://duel.example.com/share/${encodeURIComponent('かぎ/1?a=b')}`,
      expect.objectContaining({ credentials: 'include' }),
    )
  })
})
