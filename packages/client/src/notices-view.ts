/**
 * ロビーのお知らせの、取り方と窓の状態（ADR-0045、ADR-0029）。
 *
 * 画面は丸ごと描き直される（`index.ts` の `draw`）ので、取れた結果と、開いている窓・絞り込み・
 * 手の置き直しはここに持つ。描く側（`render.ts`）は読むだけで、押した動きは `reduceNotices` で進める。
 *
 * 形の読み取りは `@revolution/notices` の `readNotices` に任せる。ここでは別の判定を作らず、読めた件だけを使う。
 */
import { NOTICE_KINDS, type Notice, type NoticeKind, readNotices } from '@revolution/notices'

/** パネルに並べる件数。ファイルの順（新しい順）の先頭から数える。 */
export const NOTICE_PANEL_LIMIT = 5

/**
 * 取りに行って応えを待つ上限。置き場が応えない間、「読み込んでいます…」が出続けないように打ち切る。
 * 打ち切ったら、読めない時と同じく「お知らせはまだありません」を出す。
 */
export const NOTICES_TIMEOUT_MS = 10_000

/** 全件の窓の絞り込み。「すべて」には、種別の分からない件も出る。 */
export type NoticeTab = 'すべて' | NoticeKind

export const NOTICE_TABS: readonly NoticeTab[] = ['すべて', ...NOTICE_KINDS]

/** 取りに行っている間。取れたら（読めなくても）`読めた` になり、件が空なら「まだありません」を出す。 */
export const LOADING_NOTICES = { kind: '読み込み中' } as const

export type NoticesLoad = typeof LOADING_NOTICES | { readonly kind: '読めた'; readonly notices: readonly Notice[] }

/** 中身の窓を、どこから開いたか。前後へ移る範囲と、「一覧へ」「閉じる」の戻り先が決まる。 */
export type NoticeOrigin =
  | { readonly kind: 'パネル' }
  /** `scroll` は、押した時の一覧のスクロール位置。前後へ移ると、その位置は合わなくなるので持たない。 */
  | { readonly kind: '一覧'; readonly tab: NoticeTab; readonly scroll: number | undefined }

export type NoticeWindow =
  | { readonly kind: '一覧'; readonly tab: NoticeTab }
  | { readonly kind: '中身'; readonly id: string; readonly origin: NoticeOrigin }

/** 描き直したあとに 1 度だけ行う、手の置き直し。 */
export type NoticesPending =
  /** 開いた窓の中へ（全件の窓は選んでいるタブ、中身の窓は題）。 */
  | { readonly kind: '窓の中へ' }
  /** 閉じた、または一覧へ戻ったので、`key`（`data-keep-focus` の値）の要素へ。`scroll` があれば一覧をその位置へ。 */
  | { readonly kind: '元へ'; readonly key: string; readonly scroll: number | undefined }

export interface NoticesState {
  readonly load: NoticesLoad
  readonly window: NoticeWindow | undefined
  /** 窓を開いた元の押せるものの印（`data-keep-focus` の値）。閉じたとき、手をここへ戻す。 */
  readonly opener: string | undefined
  readonly pending: NoticesPending | undefined
}

export function initialNotices(): NoticesState {
  return { load: LOADING_NOTICES, window: undefined, opener: undefined, pending: undefined }
}

export type NoticesAction =
  | { readonly kind: '読めた'; readonly notices: readonly Notice[] }
  | { readonly kind: '一覧を開く'; readonly opener: string }
  | { readonly kind: '絞り込む'; readonly tab: NoticeTab }
  | { readonly kind: 'パネルから開く'; readonly id: string; readonly opener: string }
  | { readonly kind: '一覧から開く'; readonly id: string; readonly scroll: number }
  | { readonly kind: '移る'; readonly to: 'newer' | 'older' }
  /** `opener` は、パネルから開いた中身の窓で押した時に開く全件の窓の、手の戻し先（「すべて見る」の印）。 */
  | { readonly kind: '一覧へ'; readonly opener: string }
  | { readonly kind: '閉じる' }

/** 一覧の中の 1 件の印（`data-keep-focus`）。 */
export function listItemKey(id: string): string {
  return `お知らせ一覧-${id}`
}

/** 取れた件。取りに行っている間は `undefined`。 */
export function noticesLoaded(state: NoticesState): readonly Notice[] | undefined {
  return state.load.kind === '読めた' ? state.load.notices : undefined
}

/** パネルの形。読み込み中・件なしは畳まず、件がある時だけスマートフォンで畳む（ADR-0034）。 */
export type NewsPanelKind = '読み込み中' | '件なし' | '件あり'

export function newsPanelKindOf(state: NoticesState): NewsPanelKind {
  const notices = noticesLoaded(state)
  if (notices === undefined) return '読み込み中'

  return notices.length === 0 ? '件なし' : '件あり'
}

/** タブに当てはまる件。「すべて」はすべて（種別の分からない件を含む）、種別のタブはその種別だけ。並べ替えない。 */
export function noticesInTab(notices: readonly Notice[], tab: NoticeTab): readonly Notice[] {
  return tab === 'すべて' ? notices : notices.filter((each) => each.kind === tab)
}

export function panelNotices(notices: readonly Notice[]): readonly Notice[] {
  return notices.slice(0, NOTICE_PANEL_LIMIT)
}

/** 並びの中の隣の件。ファイルは新しい順なので、手前が新しい方、後ろが古い方。端の向きは持たない。 */
export function siblingsOf(
  notices: readonly Notice[],
  id: string,
): { readonly newer: Notice | undefined; readonly older: Notice | undefined } | undefined {
  const at = notices.findIndex((each) => each.id === id)
  if (at < 0) return undefined

  return { newer: notices[at - 1], older: notices[at + 1] }
}

/** 中身の窓で前後へ移る範囲。全件の窓から開いたなら絞り込んだ並び、パネルから開いたなら全件。 */
export function sequenceOf(notices: readonly Notice[], origin: NoticeOrigin): readonly Notice[] {
  return origin.kind === '一覧' ? noticesInTab(notices, origin.tab) : notices
}

export function reduceNotices(state: NoticesState, action: NoticesAction): NoticesState {
  if (action.kind === '読めた') {
    // 取れた後は差し替えない。開いたままのロビーには、その場では出さない（ADR-0045）。
    return state.load.kind === '読み込み中' ? { ...state, load: { kind: '読めた', notices: action.notices } } : state
  }

  const notices = noticesLoaded(state)
  if (notices === undefined) return state
  const shown = state.window

  switch (action.kind) {
    case '一覧を開く':
      return { ...state, window: { kind: '一覧', tab: 'すべて' }, opener: action.opener, pending: { kind: '窓の中へ' } }
    case '絞り込む':
      return shown?.kind === '一覧' && shown.tab !== action.tab ? { ...state, window: { kind: '一覧', tab: action.tab } } : state
    case 'パネルから開く':
      return notices.some((each) => each.id === action.id)
        ? {
            ...state,
            window: { kind: '中身', id: action.id, origin: { kind: 'パネル' } },
            opener: action.opener,
            pending: { kind: '窓の中へ' },
          }
        : state
    case '一覧から開く':
      return shown?.kind === '一覧' && noticesInTab(notices, shown.tab).some((each) => each.id === action.id)
        ? {
            ...state,
            window: { kind: '中身', id: action.id, origin: { kind: '一覧', tab: shown.tab, scroll: action.scroll } },
            pending: { kind: '窓の中へ' },
          }
        : state
    case '移る': {
      if (shown?.kind !== '中身') return state
      const near = siblingsOf(sequenceOf(notices, shown.origin), shown.id)
      const target = action.to === 'newer' ? near?.newer : near?.older
      if (target === undefined) return state
      const origin: NoticeOrigin = shown.origin.kind === '一覧' ? { ...shown.origin, scroll: undefined } : shown.origin

      return { ...state, window: { kind: '中身', id: target.id, origin } }
    }
    case '一覧へ':
      if (shown?.kind !== '中身') return state
      // 全件の窓から開いたなら、開いた時の絞り込みの全件の窓へ戻る。パネルから開いたなら、「すべて」の全件の窓を開く
      // （閉じた時の手の戻し先は、その窓を開く「すべて見る」になる）。
      if (shown.origin.kind === 'パネル') {
        return {
          ...state,
          window: { kind: '一覧', tab: 'すべて' },
          opener: action.opener,
          pending: { kind: '元へ', key: listItemKey(shown.id), scroll: undefined },
        }
      }

      return {
        ...state,
        window: { kind: '一覧', tab: shown.origin.tab },
        pending: { kind: '元へ', key: listItemKey(shown.id), scroll: shown.origin.scroll },
      }
    case '閉じる':
      if (shown === undefined) return state

      return {
        ...state,
        window: undefined,
        opener: undefined,
        pending: state.opener === undefined ? undefined : { kind: '元へ', key: state.opener, scroll: undefined },
      }
  }
}

/** 手の置き直しを 1 度だけ渡す（渡したら消す）。 */
export function takeNoticesPending(state: NoticesState): { readonly pending: NoticesPending | undefined; readonly state: NoticesState } {
  if (state.pending === undefined) return { pending: undefined, state }

  return { pending: state.pending, state: { ...state, pending: undefined } }
}

/** 一覧・パネルの 1 行に出すもの。札は種別の分からない件には出さない。版が無ければ出さない。 */
export interface NoticeRow {
  readonly id: string
  /** 種別の札。種別が分からない件は `undefined`（札を出さない）。 */
  readonly badge: NoticeKind | undefined
  readonly version: string | undefined
  readonly date: string
  readonly title: string
  readonly summary: string
}

export function noticeRowOf(notice: Notice): NoticeRow {
  return {
    id: notice.id,
    badge: notice.kind ?? undefined,
    version: notice.version,
    date: notice.date,
    title: notice.title,
    summary: notice.summary,
  }
}

/** 本文の 1 段落。引用の段落は、枠で囲んで描く。 */
export interface NoticeParagraph {
  readonly text: string
  readonly quoted: boolean
}

export function noticeParagraphsOf(notice: Notice): readonly NoticeParagraph[] {
  return notice.body.map((block) => (typeof block === 'string' ? { text: block, quoted: false } : { text: block.quote, quoted: true }))
}

/** 中身の窓の読み上げ用の名前。札が無ければ種別を言わない。 */
export function noticeLabelOf(notice: Notice): string {
  return notice.kind === null ? `お知らせ「${notice.title}」` : `${notice.kind}「${notice.title}」`
}

/**
 * 置き場からお知らせを取る。どの失敗でも投げず、読めた件だけを返す（読めなければ空）。
 *
 * 取りに行く失敗や遅れが、ロビーの描画や、部屋を作る・入る操作を止めないようにするためである（ADR-0045）。
 * `url` が無ければ（手元の開発・公開リポジトリだけを clone した人の環境）取りに行かない。
 *
 * 余分なヘッダーを付けない。置き場は事前の問い合わせ（OPTIONS）に応えない（405）ので、
 * ヘッダーを付けて事前の問い合わせが飛ぶと、ブラウザは読めなくなる。素の GET だけにする。
 */
export async function fetchNotices(url: string | undefined, fetchFn: typeof fetch = fetch): Promise<readonly Notice[]> {
  if (url === undefined || url === '') return []

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NOTICES_TIMEOUT_MS)
  try {
    const response = await fetchFn(url, { signal: controller.signal })
    if (!response.ok) return []
    const reading = readNotices(await response.text())

    return reading.ok ? reading.notices : []
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

export interface NoticesFeedOptions {
  /** 置き場の URL（`VITE_NOTICES_URL`）。無ければ取りに行かない。 */
  readonly url: string | undefined
  readonly fetchFn?: typeof fetch
  /** 取れたとき（描き直しを頼む）。 */
  readonly onChange: () => void
}

/**
 * お知らせの状態と、取りに行く時機を持つ。ロビーを出した時に 1 度だけ取りに行き、ロビーを離れたら
 * 状態を捨てる（次に出した時に取り直す）。開いたままのロビーでは取り直さない（ADR-0045）。
 *
 * 取りに行っている間にロビーを離れた・出し直した場合、古い結果は捨てる。
 */
export interface NoticesFeed {
  state(): NoticesState
  send(action: NoticesAction): void
  /** ロビーを出しているか、を伝える。描き直しのたびに呼んでよい（変わった時だけ動く）。 */
  settle(shown: boolean): void
  /** 手の置き直しを 1 度だけ渡す。 */
  takePending(): NoticesPending | undefined
}

export function createNoticesFeed(options: NoticesFeedOptions): NoticesFeed {
  let current = initialNotices()
  let shown = false
  let run = 0

  const start = (): void => {
    const mine = ++run
    if (options.url === undefined || options.url === '') {
      current = reduceNotices(initialNotices(), { kind: '読めた', notices: [] })
      return
    }
    void fetchNotices(options.url, options.fetchFn).then((notices) => {
      if (mine !== run || !shown) return
      current = reduceNotices(current, { kind: '読めた', notices })
      options.onChange()
    })
  }

  return {
    state: () => current,
    send: (action) => {
      current = reduceNotices(current, action)
    },
    settle: (nowShown) => {
      if (nowShown === shown) return
      shown = nowShown
      current = initialNotices()
      if (shown) start()
      else run++
    },
    takePending: () => {
      const taken = takeNoticesPending(current)
      current = taken.state
      return taken.pending
    },
  }
}
