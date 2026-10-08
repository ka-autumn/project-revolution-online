/**
 * スマートフォンの並べ方でだけ持つ、画面の中の状態（ADR-0034）。
 *
 * どのタブを見ているか・シートを開いているか・畳んだ欄を開いているか。通信にも、保存するデータにも
 * 混ぜない。幅 769px 以上（PC）では、この状態があっても何も出さない・何も変えない——呼ぶ側（`index.ts`）が
 * `isPhoneWidth` が偽の間は `PhoneControl` を渡さず、描く側（`render.ts`）は渡されなければスマートフォン向けの
 * 部品を作らない。幅を戻したときに PC の画面が壊れないのは、そのためである。
 */

/** `style.css` のスマートフォンの並べ方の境目と同じ。食い違うと、並べ方と部品の出入りがずれる。 */
export const PHONE_WIDTH_QUERY = '(max-width: 768px)'

/** いま、スマートフォンの並べ方か。描く環境に画面が無ければ（テスト）偽。 */
export function isPhoneWidth(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PHONE_WIDTH_QUERY).matches
}

export type LobbyMode = '対人戦' | 'CPU戦'
export type BuilderTab = '探す' | 'デッキ'

/** 描き直したあとに 1 度だけ行う、手の置き直し。 */
export type PhonePending =
  /** 開いたシートの中へ。 */
  | { readonly kind: 'シートの中へ' }
  /** シートを閉じたので、開いた元の押せるものへ（`opener` は `data-phone-opener` の値）。 */
  | { readonly kind: '元へ'; readonly opener: string }

/**
 * デッキ構築でタブを押した時点の、ページの見え方。測るのは描く側（`phone-scroll.ts`）で、ここでは値として受け取る。
 * `stuck` は、タブの帯が画面の上に付いて残っているか（ページを帯の位置より下までスクロールしているか）。
 */
export interface ScrollSight {
  readonly top: number
  readonly stuck: boolean
}

/** 描き直したあとに 1 度だけ行う、ページのスクロールの置き直し。 */
export type PhoneScroll =
  /** 前に見ていた位置へ。 */
  | { readonly kind: '位置へ'; readonly top: number }
  /** タブの帯のすぐ下（タブの帯が上に付いた状態で、中身の先頭が出る位置）へ。 */
  | { readonly kind: 'タブの帯の下へ' }
  /** 確かめた結果の文が見える位置へ。 */
  | { readonly kind: '確かめた結果へ' }

export interface PhoneState {
  /** ロビーで、対人戦・CPU戦のどちらの中身を出すか。 */
  readonly lobbyMode: LobbyMode
  /** ロビーで、使用するデッキの一覧と対戦ルールのシートを開いているか。 */
  readonly deckSheet: boolean
  /** デッキ一覧で、絞り込みを開いているか。 */
  readonly listFilter: boolean
  /** デッキ構築で、どちらのタブを見ているか。 */
  readonly builderTab: BuilderTab
  /** デッキ構築で、タブごとに前に見ていたスクロールの位置。見ていなければ（または上に付く前なら）持たない。 */
  readonly builderScroll: Readonly<Partial<Record<BuilderTab, number>>>
  /** デッキ構築で、描き直したあとに行うスクロールの置き直し。 */
  readonly scroll: PhoneScroll | undefined
  /** デッキ構築で、絞り込みを開いているか。 */
  readonly builderFilter: boolean
  /** デッキ構築で、上の段（解説・ラベル・形式・禁止／制限リスト）を開いているか。 */
  readonly builderSettings: boolean
  /** デッキ構築で、詳細のシートを開いているカード。 */
  readonly sheetCard: string | undefined
  /** 開いているシートを開いた押せるものの印。閉じたとき、手をここへ戻す。 */
  readonly opener: string | undefined
  readonly pending: PhonePending | undefined
}

export function initialPhone(): PhoneState {
  return {
    lobbyMode: '対人戦',
    deckSheet: false,
    listFilter: false,
    builderTab: '探す',
    builderScroll: {},
    scroll: undefined,
    builderFilter: false,
    builderSettings: false,
    sheetCard: undefined,
    opener: undefined,
    pending: undefined,
  }
}

export type PhoneAction =
  | { readonly kind: 'ロビーのモード'; readonly mode: LobbyMode }
  | { readonly kind: 'デッキのシートを開く'; readonly opener: string }
  | { readonly kind: 'デッキのシートを閉じる' }
  | { readonly kind: '一覧の絞り込みを開閉' }
  | { readonly kind: 'デッキ構築のタブ'; readonly tab: BuilderTab; readonly sight: ScrollSight }
  /** 下の帯の規定外の印から、「デッキ」のタブの確かめた結果を見に行く。 */
  | { readonly kind: '確かめた結果を見る'; readonly sight: ScrollSight }
  | { readonly kind: '構築の絞り込みを開閉' }
  | { readonly kind: '構築の設定を開閉' }
  | { readonly kind: 'カードのシートを開く'; readonly card: string; readonly opener: string }
  | { readonly kind: 'カードのシートを閉じる' }

/** 状態を進める。シートを開けば手は中へ、閉じれば開いた元へ戻す。 */
export function reducePhone(state: PhoneState, action: PhoneAction): PhoneState {
  switch (action.kind) {
    case 'ロビーのモード':
      return { ...state, lobbyMode: action.mode }
    case 'デッキのシートを開く':
      return { ...state, deckSheet: true, opener: action.opener, pending: { kind: 'シートの中へ' } }
    case 'デッキのシートを閉じる':
      return state.deckSheet ? closedSheet({ ...state, deckSheet: false }) : state
    case '一覧の絞り込みを開閉':
      return { ...state, listFilter: !state.listFilter }
    case 'デッキ構築のタブ':
      return switchedBuilderTab(state, action.tab, action.sight, false)
    case '確かめた結果を見る':
      return switchedBuilderTab(state, 'デッキ', action.sight, true)
    case '構築の絞り込みを開閉':
      return { ...state, builderFilter: !state.builderFilter }
    case '構築の設定を開閉':
      return { ...state, builderSettings: !state.builderSettings }
    case 'カードのシートを開く':
      // 開いたままのシートで別のカードを開くことは無いが、あっても元は最初に開いた押せるものを残す。
      return { ...state, sheetCard: action.card, opener: state.sheetCard === undefined ? action.opener : state.opener, pending: { kind: 'シートの中へ' } }
    case 'カードのシートを閉じる':
      return state.sheetCard === undefined ? state : closedSheet({ ...state, sheetCard: undefined })
  }
}

/**
 * タブを切り替える。離れるタブの位置を覚え、着いたタブでは次の順で置く場所を決める。
 *
 * - 確かめた結果を見に来たなら、その文の位置（覚えていた位置より優先）。
 * - タブの帯がまだ上に付いていない（ページの上の方にいる）なら、動かさない。
 * - 前に見ていた位置があればそこ、無ければタブの帯のすぐ下。
 *
 * 帯が上に付く前の位置は覚えない。そこはタブの帯の下ではなく、ページの上の方だから。
 */
function switchedBuilderTab(state: PhoneState, tab: BuilderTab, sight: ScrollSight, reveal: boolean): PhoneState {
  if (tab === state.builderTab) return reveal ? { ...state, scroll: { kind: '確かめた結果へ' } } : state

  const { [state.builderTab]: _left, ...kept } = state.builderScroll
  const builderScroll = sight.stuck ? { ...kept, [state.builderTab]: sight.top } : kept
  const remembered = state.builderScroll[tab]
  const scroll: PhoneScroll | undefined = reveal
    ? { kind: '確かめた結果へ' }
    : !sight.stuck
      ? undefined
      : remembered === undefined
        ? { kind: 'タブの帯の下へ' }
        : { kind: '位置へ', top: remembered }

  return { ...state, builderTab: tab, builderScroll, scroll }
}

/** スクロールの置き直しを 1 度だけ渡す（渡したら消す）。 */
export function takeScroll(state: PhoneState): { readonly scroll: PhoneScroll | undefined; readonly state: PhoneState } {
  if (state.scroll === undefined) return { scroll: undefined, state }

  return { scroll: state.scroll, state: { ...state, scroll: undefined } }
}

function closedSheet(state: PhoneState): PhoneState {
  return { ...state, opener: undefined, pending: state.opener === undefined ? undefined : { kind: '元へ', opener: state.opener } }
}

/** どの画面を出しているか。出していない画面の状態は、次に開いたときに持ち越さない。 */
export interface ShownScreens {
  readonly lobby: boolean
  readonly deckList: boolean
  readonly editor: boolean
}

/**
 * 出していない画面のスマートフォン向けの状態を、最初に戻す。部屋に入る・繋がりが切れる・デッキ一覧へ移るで
 * 画面を離れたあと、戻ったときにシートが開いたままになったり、前のデッキのタブが残ったりしない。
 * 変わらなければ同じ値を返す（呼ぶ側が変化を見分けられる）。
 */
export function settlePhone(state: PhoneState, shown: ShownScreens): PhoneState {
  const initial = initialPhone()
  let next = state
  if (!shown.lobby && (next.deckSheet || next.lobbyMode !== initial.lobbyMode)) {
    next = { ...next, deckSheet: false, lobbyMode: initial.lobbyMode }
  }
  if (!shown.deckList && next.listFilter) next = { ...next, listFilter: false }
  if (
    !shown.editor &&
    (next.sheetCard !== undefined ||
      next.builderTab !== initial.builderTab ||
      Object.keys(next.builderScroll).length > 0 ||
      next.scroll !== undefined ||
      next.builderFilter ||
      next.builderSettings)
  ) {
    next = {
      ...next,
      sheetCard: undefined,
      builderTab: initial.builderTab,
      builderScroll: initial.builderScroll,
      scroll: undefined,
      builderFilter: false,
      builderSettings: false,
    }
  }
  if (next !== state && !next.deckSheet && next.sheetCard === undefined) next = { ...next, opener: undefined, pending: undefined }

  return next
}

/** 手の置き直しを 1 度だけ渡す（渡したら消す）。 */
export function takePending(state: PhoneState): { readonly pending: PhonePending | undefined; readonly state: PhoneState } {
  if (state.pending === undefined) return { pending: undefined, state }

  return { pending: state.pending, state: { ...state, pending: undefined } }
}

/**
 * 幅が PC からスマートフォンへ戻った直後の状態。シートを開いたままだったなら、作り直されたシートの中へ手を置き直す
 * （PC の幅の間に描き直されて、手はシートから離れている）。開いていなければ、そのまま返す。
 */
export function returnedToPhone(state: PhoneState): PhoneState {
  if (!state.deckSheet && state.sheetCard === undefined) return state

  return { ...state, pending: { kind: 'シートの中へ' } }
}

/** 呼ぶ側が描く側へ渡す窓口。PC の幅の間は渡さない（`isPhoneWidth`）。 */
export interface PhoneControl {
  readonly state: PhoneState
  readonly send: (action: PhoneAction) => void
}

/**
 * タブの並びの中で、矢印・Home・End で移る先。移らないキーなら `undefined`。端からは一周する。
 * 横に並べたタブなので、左右の矢印だけを見る。
 */
export function tabAfterKey<T>(tabs: readonly T[], current: T, key: string): T | undefined {
  const at = tabs.indexOf(current)
  if (at < 0 || tabs.length === 0) return undefined
  switch (key) {
    case 'ArrowRight':
      return tabs[(at + 1) % tabs.length]
    case 'ArrowLeft':
      return tabs[(at - 1 + tabs.length) % tabs.length]
    case 'Home':
      return tabs[0]
    case 'End':
      return tabs[tabs.length - 1]
    default:
      return undefined
  }
}

/**
 * 畳んでいても、いまの形式とリストが分かるようにする、デッキの設定の開閉のボタンの見出し。
 * 選んでいなければ、選ぶところ（`render.ts` の `rulesPicker`）が先頭を選んだ形で出すのと同じものを言う。
 */
export function rulesSummaryOf(
  formats: readonly string[],
  format: string | undefined,
  lists: readonly { readonly id: string; readonly name: string }[],
  restriction: { readonly kind: '制限なし' } | { readonly kind: '禁止／制限リスト'; readonly id: string } | undefined,
): string {
  const first = lists[0]?.name ?? '制限なし'
  const list =
    restriction === undefined
      ? first
      : restriction.kind === '制限なし'
        ? '制限なし'
        : (lists.find((each) => each.id === restriction.id)?.name ?? first)

  return `${format ?? formats[0] ?? ''}・${list}`
}

/** シートを開いた押せるものに付ける印（`data-phone-opener`）。閉じたとき、手をここへ戻す。 */
export const PHONE_OPENER = 'phoneOpener'
/** 開いているシートに付ける印（`data-phone-sheet`）。手を中へ移す先と、外を止めるときの基点になる。 */
export const PHONE_SHEET = 'phoneSheet'
/** シートの外を暗くした背面の class。外を止めても、押して閉じられるよう残す。 */
export const PHONE_BACKDROP = 'phone-backdrop'
