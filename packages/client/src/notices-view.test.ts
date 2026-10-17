import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Notice } from '@revolution/notices'
import {
  LOADING_NOTICES,
  NOTICES_TIMEOUT_MS,
  NOTICE_PANEL_LIMIT,
  type NoticesState,
  createNoticesFeed,
  fetchNotices,
  initialNotices,
  newsPanelKindOf,
  listItemKey,
  noticesInTab,
  noticeLabelOf,
  noticeParagraphsOf,
  noticeRowOf,
  noticesLoaded,
  panelNotices,
  reduceNotices,
  siblingsOf,
  takeNoticesPending,
} from './notices-view.js'

function notice(id: string, kind: Notice['kind'], extra: Partial<Notice> = {}): Notice {
  return { id, kind, date: '2026-01-01', title: `題 ${id}`, summary: `要約 ${id}`, body: [`本文 ${id}`], ...extra }
}

const SAMPLE: readonly Notice[] = [
  notice('a', 'お知らせ'),
  notice('b', '更新', { version: '1.2' }),
  notice('c', '修正'),
  notice('d', null),
  notice('e', '更新'),
  notice('f', '修正'),
  notice('g', 'お知らせ'),
]

function loaded(notices: readonly Notice[] = SAMPLE): NoticesState {
  return reduceNotices(initialNotices(), { kind: '読めた', notices })
}

describe('一覧の絞り込み', () => {
  it('「すべて」は、種別の分からない件も含めて、ファイルの順のまま全部を返す（ADR-0045）', () => {
    expect(noticesInTab(SAMPLE, 'すべて').map((each) => each.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
  })

  it('種別のタブは、その種別の件だけを返し、種別の分からない件を出さない（ADR-0045）', () => {
    expect(noticesInTab(SAMPLE, '更新').map((each) => each.id)).toEqual(['b', 'e'])
    expect(noticesInTab(SAMPLE, '修正').map((each) => each.id)).toEqual(['c', 'f'])
    expect(noticesInTab(SAMPLE, 'お知らせ').map((each) => each.id)).toEqual(['a', 'g'])
  })

  it('パネルは先頭から 5 件までで、並べ替えない', () => {
    expect(NOTICE_PANEL_LIMIT).toBe(5)
    expect(panelNotices(SAMPLE).map((each) => each.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(panelNotices(SAMPLE.slice(0, 2)).map((each) => each.id)).toEqual(['a', 'b'])
  })

  it('前後の件は、並びの中の隣で、端では持たない', () => {
    const near = siblingsOf(SAMPLE, 'c')
    expect([near?.newer?.id, near?.older?.id]).toEqual(['b', 'd'])
    const first = siblingsOf(SAMPLE, 'a')
    expect([first?.newer, first?.older?.id]).toEqual([undefined, 'b'])
    const last = siblingsOf(SAMPLE, 'g')
    expect([last?.newer?.id, last?.older]).toEqual(['f', undefined])
  })

  it('並びに無い件の前後は無い', () => {
    expect(siblingsOf(SAMPLE, 'zzz')).toBeUndefined()
  })
})

describe('取れた結果', () => {
  it('最初は読み込み中で、窓は開いていない', () => {
    const state = initialNotices()
    expect(state.load).toBe(LOADING_NOTICES)
    expect(state.window).toBeUndefined()
  })

  it('読めたら、件を持つ。空なら「まだありません」の扱い', () => {
    expect(noticesLoaded(loaded())?.map((each) => each.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
    expect(noticesLoaded(loaded([]))).toEqual([])
    expect(noticesLoaded(initialNotices())).toBeUndefined()
  })

  it('取れた後に別の結果が届いても、差し替えない（ロビーを開いたままのうちは変わらない、ADR-0045）', () => {
    const first = loaded()
    expect(reduceNotices(first, { kind: '読めた', notices: [] })).toBe(first)
  })
})

describe('パネルの形', () => {
  it('取りに行っている間は「読み込み中」で、畳まない側（件なしと同じ扱い）に入る', () => {
    expect(newsPanelKindOf(initialNotices())).toBe('読み込み中')
  })

  it('読めても 0 件なら「件なし」。畳むのは「件あり」の時だけ', () => {
    expect(newsPanelKindOf(loaded([]))).toBe('件なし')
    expect(newsPanelKindOf(loaded())).toBe('件あり')
    expect(newsPanelKindOf(loaded([notice('a', null)]))).toBe('件あり')
  })
})

describe('窓', () => {
  it('「すべて見る」で全件の窓を開く。「すべて」のタブ、手は窓の中へ', () => {
    const state = reduceNotices(loaded(), { kind: '一覧を開く', opener: 'お知らせ-すべて見る' })
    expect(state.window).toEqual({ kind: '一覧', tab: 'すべて' })
    expect(takeNoticesPending(state).pending).toEqual({ kind: '窓の中へ' })
  })

  it('タブを替えると、絞り込みだけが変わる', () => {
    const open = reduceNotices(loaded(), { kind: '一覧を開く', opener: 'o' })
    const state = reduceNotices(open, { kind: '絞り込む', tab: '修正' })
    expect(state.window).toEqual({ kind: '一覧', tab: '修正' })
  })

  it('開いていない時に、絞り込みは何も変えない', () => {
    const state = loaded()
    expect(reduceNotices(state, { kind: '絞り込む', tab: '修正' })).toBe(state)
  })

  it('パネルの件を押すと中身の窓を開き、閉じると、その件へ手を戻す', () => {
    const open = reduceNotices(loaded(), { kind: 'パネルから開く', id: 'b', opener: 'パネル-b' })
    expect(open.window).toEqual({ kind: '中身', id: 'b', origin: { kind: 'パネル' } })
    expect(takeNoticesPending(open).pending).toEqual({ kind: '窓の中へ' })

    const closed = reduceNotices(takeNoticesPending(open).state, { kind: '閉じる' })
    expect(closed.window).toBeUndefined()
    expect(takeNoticesPending(closed).pending).toEqual({ kind: '元へ', key: 'パネル-b', scroll: undefined })
  })

  it('全件の窓から中身を開き、「一覧へ」で、絞り込みと押した件とスクロールの位置へ戻る', () => {
    let state = reduceNotices(loaded(), { kind: '一覧を開く', opener: 'お知らせ-すべて見る' })
    state = reduceNotices(state, { kind: '絞り込む', tab: '更新' })
    state = reduceNotices(state, { kind: '一覧から開く', id: 'e', scroll: 120 })
    expect(state.window).toEqual({ kind: '中身', id: 'e', origin: { kind: '一覧', tab: '更新', scroll: 120 } })

    const back = reduceNotices(takeNoticesPending(state).state, { kind: '一覧へ' })
    expect(back.window).toEqual({ kind: '一覧', tab: '更新' })
    expect(takeNoticesPending(back).pending).toEqual({ kind: '元へ', key: listItemKey('e'), scroll: 120 })
  })

  it('全件の窓から開いた中身の窓を閉じると、手は「すべて見る」へ戻る', () => {
    let state = reduceNotices(loaded(), { kind: '一覧を開く', opener: 'お知らせ-すべて見る' })
    state = reduceNotices(state, { kind: '一覧から開く', id: 'a', scroll: 0 })
    const closed = reduceNotices(takeNoticesPending(state).state, { kind: '閉じる' })
    expect(takeNoticesPending(closed).pending).toEqual({ kind: '元へ', key: 'お知らせ-すべて見る', scroll: undefined })
  })

  it('パネルから開いた中身の窓に「一覧へ」は無い。押しても何も変わらない', () => {
    const state = reduceNotices(loaded(), { kind: 'パネルから開く', id: 'a', opener: 'パネル-a' })
    expect(reduceNotices(state, { kind: '一覧へ' })).toBe(state)
  })

  it('前後へ移る範囲は、パネルから開いたなら全件、全件の窓からなら絞り込んだ並び', () => {
    const fromPanel = reduceNotices(loaded(), { kind: 'パネルから開く', id: 'e', opener: 'パネル-e' })
    const next = reduceNotices(fromPanel, { kind: '移る', to: 'older' })
    expect(next.window).toMatchObject({ kind: '中身', id: 'f' })
    // パネルの 5 件を越えて、6 件目・7 件目へも進める。
    const end = reduceNotices(reduceNotices(next, { kind: '移る', to: 'older' }), { kind: '移る', to: 'older' })
    expect(end.window).toMatchObject({ kind: '中身', id: 'g' })

    let filtered = reduceNotices(loaded(), { kind: '一覧を開く', opener: 'o' })
    filtered = reduceNotices(filtered, { kind: '絞り込む', tab: '修正' })
    filtered = reduceNotices(filtered, { kind: '一覧から開く', id: 'c', scroll: 0 })
    expect(reduceNotices(filtered, { kind: '移る', to: 'older' }).window).toMatchObject({ id: 'f' })
    expect(reduceNotices(filtered, { kind: '移る', to: 'newer' })).toBe(filtered)
  })

  it('移ると、一覧のスクロール位置は捨て、一覧へ戻る時はいま読んでいる件へ手を戻す', () => {
    let state = reduceNotices(loaded(), { kind: '一覧を開く', opener: 'お知らせ-すべて見る' })
    state = reduceNotices(state, { kind: '一覧から開く', id: 'a', scroll: 40 })
    state = reduceNotices(state, { kind: '移る', to: 'older' })
    expect(state.window).toMatchObject({ id: 'b', origin: { kind: '一覧', tab: 'すべて', scroll: undefined } })
    // 一覧へ戻る時は、いま読んでいる件へ手を戻す。
    const back = reduceNotices(state, { kind: '一覧へ' })
    expect(takeNoticesPending(back).pending).toEqual({ kind: '元へ', key: listItemKey('b'), scroll: undefined })
  })

  it('端で移ろうとしても何も変わらない', () => {
    const first = reduceNotices(loaded(), { kind: 'パネルから開く', id: 'a', opener: 'パネル-a' })
    expect(reduceNotices(first, { kind: '移る', to: 'newer' })).toBe(first)
  })

  it('開いていないのに閉じても何も変わらない', () => {
    const state = loaded()
    expect(reduceNotices(state, { kind: '閉じる' })).toBe(state)
  })

  it('取れる前（読み込み中）は窓を開けない', () => {
    const state = initialNotices()
    expect(reduceNotices(state, { kind: '一覧を開く', opener: 'o' })).toBe(state)
    expect(reduceNotices(state, { kind: 'パネルから開く', id: 'a', opener: 'o' })).toBe(state)
  })

  it('並びに無い件は開けない', () => {
    const state = loaded()
    expect(reduceNotices(state, { kind: 'パネルから開く', id: 'zzz', opener: 'o' })).toBe(state)
  })

  it('手の置き直しは 1 度だけ渡す', () => {
    const open = reduceNotices(loaded(), { kind: 'パネルから開く', id: 'a', opener: 'o' })
    const taken = takeNoticesPending(open)
    expect(taken.pending).toEqual({ kind: '窓の中へ' })
    expect(takeNoticesPending(taken.state).pending).toBeUndefined()
  })
})

describe('取りに行く', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const FILE = JSON.stringify({
    notices: [
      { id: 'a', kind: '更新', date: '2026-01-01', title: 't', summary: 's', body: ['b'] },
      { id: 'b', kind: '未知', date: '2026-01-02', title: 't', summary: 's', body: ['b'] },
      { id: 'c', date: '2026-01-02', title: 't', summary: 's', body: ['b'] },
    ],
  })

  function responding(body: string, init: ResponseInit = { status: 200 }): typeof fetch {
    return vi.fn(async () => new Response(body, init)) as unknown as typeof fetch
  }

  it('読めた件だけを返す。1 件読めなくても、ほかは並ぶ。知らない種別は kind が null で残る', async () => {
    const result = await fetchNotices('https://example.test/notices.json', responding(FILE))
    expect(result.map((each) => [each.id, each.kind])).toEqual([
      ['a', '更新'],
      ['b', null],
    ])
  })

  it('余分なヘッダーを付けない（置き場は事前の問い合わせに応えない）', async () => {
    const fetchFn = responding(FILE)
    await fetchNotices('https://example.test/notices.json', fetchFn)
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit | undefined]
    expect(url).toBe('https://example.test/notices.json')
    expect(init?.headers).toBeUndefined()
    expect(init?.method ?? 'GET').toBe('GET')
  })

  it('URL が無ければ、取りに行かず、空を返す', async () => {
    const fetchFn = responding(FILE)
    expect(await fetchNotices(undefined, fetchFn)).toEqual([])
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('空の URL も、無いものとして扱う', async () => {
    const fetchFn = responding(FILE)
    expect(await fetchNotices('', fetchFn)).toEqual([])
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('通信が失敗したら、投げずに空を返す', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError('network')
    }) as unknown as typeof fetch
    expect(await fetchNotices('https://example.test/notices.json', failing)).toEqual([])
  })

  it('置き場が無い（404）・止まっている（5xx）なら、空を返す', async () => {
    expect(await fetchNotices('https://example.test/notices.json', responding('Not Found', { status: 404 }))).toEqual([])
    expect(await fetchNotices('https://example.test/notices.json', responding('Unavailable', { status: 503 }))).toEqual([])
  })

  it('JSON として読めない・形が違うなら、空を返す', async () => {
    expect(await fetchNotices('https://example.test/notices.json', responding('<html>'))).toEqual([])
    expect(await fetchNotices('https://example.test/notices.json', responding('[]'))).toEqual([])
    expect(await fetchNotices('https://example.test/notices.json', responding('{"notices":{}}'))).toEqual([])
  })

  it('本文を読み出す途中で失敗しても、投げずに空を返す', async () => {
    const broken = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => {
        throw new TypeError('aborted')
      },
    })) as unknown as typeof fetch
    expect(await fetchNotices('https://example.test/notices.json', broken)).toEqual([])
  })

  it('10 秒たっても応えなければ、打ち切って空を返す', async () => {
    vi.useFakeTimers()
    expect(NOTICES_TIMEOUT_MS).toBe(10_000)
    const hanging = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    ) as unknown as typeof fetch
    const pending = fetchNotices('https://example.test/notices.json', hanging)
    await vi.advanceTimersByTimeAsync(NOTICES_TIMEOUT_MS)
    expect(await pending).toEqual([])
  })

  it('打ち切りの前に応えたなら、打ち切りの待ちを残さない', async () => {
    vi.useFakeTimers()
    await fetchNotices('https://example.test/notices.json', responding(FILE))
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('1 行に出すもの', () => {
  it('種別の分からない件は、札を出さない', () => {
    expect(noticeRowOf(notice('d', null)).badge).toBeUndefined()
    expect(noticeRowOf(notice('a', '修正')).badge).toBe('修正')
  })

  it('版が無ければ、版を出さない', () => {
    expect(noticeRowOf(notice('a', '更新')).version).toBeUndefined()
    expect(noticeRowOf(notice('a', '更新', { version: '1.2' })).version).toBe('1.2')
  })

  it('本文の引用の段落は、引用として印を付ける', () => {
    const paragraphs = noticeParagraphsOf(notice('a', '更新', { body: ['前置き', { quote: '引いた文' }, '後書き'] }))
    expect(paragraphs).toEqual([
      { text: '前置き', quoted: false },
      { text: '引いた文', quoted: true },
      { text: '後書き', quoted: false },
    ])
  })

  it('読み上げの名前は、札が無ければ種別を言わない', () => {
    expect(noticeLabelOf(notice('a', '修正'))).toBe('修正「題 a」')
    expect(noticeLabelOf(notice('d', null))).toBe('お知らせ「題 d」')
  })
})

describe('取りに行く時機', () => {
  const FILE = JSON.stringify({ notices: [{ id: 'a', kind: '更新', date: '2026-01-01', title: 't', summary: 's', body: ['b'] }] })

  function deferred(): { fetchFn: typeof fetch; calls: Array<(body: string) => void> } {
    const calls: Array<(body: string) => void> = []
    const fetchFn = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          calls.push((body) => resolve(new Response(body, { status: 200 })))
        }),
    ) as unknown as typeof fetch
    return { fetchFn, calls }
  }

  it('URL が無ければ、取りに行かずに、すぐ「まだありません」になる', () => {
    const fetchFn = vi.fn() as unknown as typeof fetch
    const feed = createNoticesFeed({ url: undefined, fetchFn, onChange: vi.fn() })
    feed.settle(true)
    expect(noticesLoaded(feed.state())).toEqual([])
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('ロビーを出した時に取りに行き、取れたら描き直しを頼む。出している間は取り直さない', async () => {
    const { fetchFn, calls } = deferred()
    const onChange = vi.fn()
    const feed = createNoticesFeed({ url: 'https://example.test/n.json', fetchFn, onChange })
    feed.settle(true)
    feed.settle(true)
    feed.settle(true)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(feed.state().load).toBe(LOADING_NOTICES)

    calls[0]?.(FILE)
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    expect(noticesLoaded(feed.state())?.map((each) => each.id)).toEqual(['a'])
  })

  it('取れなくても、描き直しを頼み、「まだありません」になる', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError('network')
    }) as unknown as typeof fetch
    const onChange = vi.fn()
    const feed = createNoticesFeed({ url: 'https://example.test/n.json', fetchFn: failing, onChange })
    feed.settle(true)
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    expect(noticesLoaded(feed.state())).toEqual([])
  })

  it('ロビーを離れて戻ったら、取り直す。離れている間に届いた古い結果は捨てる', async () => {
    const { fetchFn, calls } = deferred()
    const onChange = vi.fn()
    const feed = createNoticesFeed({ url: 'https://example.test/n.json', fetchFn, onChange })
    feed.settle(true)
    feed.settle(false)
    calls[0]?.(FILE)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onChange).not.toHaveBeenCalled()
    expect(feed.state().load).toBe(LOADING_NOTICES)

    feed.settle(true)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('出し直したあとに、前の取得の結果が先に届いても、使わない', async () => {
    const { fetchFn, calls } = deferred()
    const onChange = vi.fn()
    const feed = createNoticesFeed({ url: 'https://example.test/n.json', fetchFn, onChange })
    feed.settle(true)
    feed.settle(false)
    feed.settle(true)
    calls[0]?.(JSON.stringify({ notices: [] }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(feed.state().load).toBe(LOADING_NOTICES)

    calls[1]?.(FILE)
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    expect(noticesLoaded(feed.state())?.map((each) => each.id)).toEqual(['a'])
  })

  it('ロビーを離れたら、開いていた窓も捨てる', () => {
    const feed = createNoticesFeed({ url: undefined, onChange: vi.fn() })
    feed.settle(true)
    feed.send({ kind: '一覧を開く', opener: 'o' })
    expect(feed.state().window).toBeDefined()
    feed.settle(false)
    expect(feed.state().window).toBeUndefined()
  })

  it('手の置き直しは 1 度だけ渡す', () => {
    const feed = createNoticesFeed({ url: undefined, onChange: vi.fn() })
    feed.settle(true)
    feed.send({ kind: '一覧を開く', opener: 'o' })
    expect(feed.takePending()).toEqual({ kind: '窓の中へ' })
    expect(feed.takePending()).toBeUndefined()
  })
})
