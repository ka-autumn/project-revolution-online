import { MAX_ATTEMPTS, connect, connectingLink } from './connection.js'
import type { Connection, Link } from './connection.js'
import { NOT_SIGNED_IN, indexOfSquare } from '@revolution/engine'
import type {
  CardId,
  DeckId,
  DuelFormat,
  LoggedEvent,
  OpponentKind,
  Player,
  RecipeKey,
  RecipeListOrder,
  RestrictionChoice,
  RoomCode,
  WireRoomRules,
  WireShare,
} from '@revolution/engine'
import {
  applyToBuilder,
  autoLabelsOf,
  cardDetailOf,
  checkView,
  choosableDecks,
  closedBuilder,
  confirmView,
  deckColorChoices,
  deckLabelChoices,
  deckRefusal,
  deckRows,
  draftOf,
  draftToSave,
  duplicatedDeckName,
  filterOwnedDeckRows,
  hasUnsavedChanges,
  hasUnusableCards,
  isCpuChoosable,
  joinRefusal,
  judgedRulesOf,
  judgedRulesOfRoom,
  levelBreakdownOf,
  lobbyDecks,
  newDraft,
  ownedDeckRows,
  presetRows,
  poolRows,
  POOL_BATCH,
  seatableDecks,
  seatedChoice,
  sentChoice,
  startedEditing,
  starTotalOf,
  typeCountsOf,
  withCard,
  withoutCard,
} from './deck-builder.js'
import type { Builder, DeckDraft, LobbyDeck, PoolView } from './deck-builder.js'
import {
  abilityLabels,
  actionViews,
  automaticAction,
  choicePicking,
  choiceView,
  abilityListSource,
  isAbilityChoice,
  offBoardCandidates,
  pickView,
  showsChoicePicker,
} from './input-model.js'
import type { AimKind, PickSelection } from './input-model.js'
import { filterChoicesOf, filterPool } from './pool-filter.js'
import {
  closedRecipeUrlOf,
  myShareRows,
  recipeCardRows,
  recipeKeyFromPath,
  recipeSummaryRows,
  recipeUrlOf,
  rememberPendingRecipe,
  shareDraftOf,
  shareLinkOf,
  shareRowsOf,
} from './recipe.js'
import {
  KEEP_FOCUS,
  KEEP_FOCUS_INSTEAD,
  KEEP_SCROLL,
  actionsElement,
  choiceElement,
  chooseZoneListElement,
  choosePickerElement,
  choosesFrom,
  confirmElement,
  deckEditorElement,
  deckListElement,
  duelElement,
  awaitingElement,
  leaveElement,
  lobbyElement,
  myShareListElement,
  nameElement,
  overlayElement,
  askElement,
  pickElement,
  recipeElement,
  recipeListElement,
  shareDialogElement,
  sheetDetailElement,
  viewPileElement,
  waitingForOverlayElement,
} from './render.js'
import type {
  AskHandlers,
  BoardPicking,
  ChosenRules,
  DeckEditorHandlers,
  DeckListHandlers,
  ListZone,
  MyShareHandlers,
  PeekProps,
  PhoneListOptions,
  RecipeListHandlers,
  RecipeViewHandlers,
  ShareDialogHandlers,
} from './render.js'
import { applyMessage, connecting, roomOf } from './session.js'
import type { Session } from './session.js'
import {
  DECKS_PER_PAGE,
  boardView,
  cutInViews,
  lobbyView,
  opponentName,
  overlayDurationMs,
  pagedOf,
  priorityReason,
  roomListView,
  showsOverlay,
  transitionViews,
  visibleCardViewsIn,
  zoneOf,
} from './view-model.js'
import type { Overlay, HandRefusal, RoomTab } from './view-model.js'
import { closedByCancel, escapeTopLayer, focusBefore, markDialog, settleFocus } from './dialog-focus.js'
import { PHONE_WIDTH_QUERY, initialPhone, isPhoneWidth, reducePhone, returnedToPhone, settlePhone, takePending, takeScroll } from './phone.js'
import type { PhoneControl, PhonePending, PhoneScroll, PhoneState } from './phone.js'
import { settlePhoneScroll } from './phone-scroll.js'
import { settlePhoneBoard, watchControls } from './phone-board.js'
import { peekAimOf } from './phone-peek.js'
import { wireFingerOnHand } from './phone-touch.js'
import { settlePhoneFocus } from './phone-focus.js'
import { openPayList, settlePayState } from './pay-list.js'
import type { PayEvent, PayState } from './pay-list.js'

/**
 * クライアントの起動点。
 *
 * 受け取った盤面を描き、選んだものを送るだけで、対戦のルールの判断は持たない（ADR-0010）。
 * 行える手はサーバが盤面と一緒に送る。ロビーでのデッキの判定は、その範囲の外である（ADR-0029）。
 *
 * 4 つに分けている。届いたものを畳む純粋な関数（`session.ts`）、それを画面に出す値にする
 * 純粋な関数（`view-model.ts`）、DOM にするところ（`render.ts`）、そしてソケットを張って
 * この 3 つを繋ぐところ（ここ）である。テストがあるのは前の 2 つまでで、DOM を触る層は
 * 薄く保っている。
 */

export interface MountOptions {
  /** サーバの WebSocket の URL。 */
  readonly url: string
  /** 誰であるかを名乗る合言葉（ADR-0009）。 */
  readonly participant: string
  /**
   * 直に入る部屋の合言葉。指していなければロビーから始める（#175）。
   *
   * 合言葉を知っている相手と待ち合わせる時だけ要る。ふだんはロビーで部屋を作るか選ぶので、
   * **打つ前に決めておくものは何も無い。**
   */
  readonly room?: RoomCode
  /**
   * 直に開くレシピの鍵（ADR-0022）。`/recipe/<鍵>` を開いた時に、`main.ts` がここへ渡す。
   *
   * 指していなければ、ふだんどおりロビーから始める。**ログインしている人にしか開けない**
   * ——ログインを持たない立て方や、まだ名前を決めていない間は、開けない理由を出す。
   */
  readonly recipe?: RecipeKey
  /**
   * ログインを始める先（ADR-0019、`server` の `sign-in.ts`）。
   *
   * **ログインしているかどうかを画面は判断しない。** 繋ぎに行き、サーバが「ログインしていない」
   * と返したらここへ送るだけである。何を行えるかを決めるのはサーバである（ADR-0010）。
   */
  readonly signInUrl: string
}

/** ログインへ一度送ったことを覚えておく先の名前。 */
const SIGN_IN_TRIED = 'revolution.signInTried'

/**
 * ログインへ送る。**同じタブでは一度だけ。** 送ったなら `true`。
 *
 * 繰り返しを止めるためにある。ログインは通ったのに Cookie が握手に付いてこない場合
 * （同じ登録可能ドメインの下に無い、`SameSite` に弾かれる、ADR-0019）、送り続けると画面と
 * Google の間を往復し続け、**何が悪いのかが読めないまま止まる。** 一度で止めれば、断られた
 * 理由がそのまま画面に出る。
 *
 * 覚えられないブラウザでは繰り返しを防げないが、それでも送る。**送らなければログインできない
 * のに対し、繰り返しはタブを閉じれば止まる。**
 */
function goToSignIn(url: string): boolean {
  try {
    if (sessionStorage.getItem(SIGN_IN_TRIED) !== null) return false

    sessionStorage.setItem(SIGN_IN_TRIED, '送った')
  } catch {
    // 覚えられなかった。送るほうを採る。
  }

  location.assign(url)
  return true
}

/** 送ったことを忘れる。次にログインが要る場面では、また送れるようにするため。 */
function forgetSignIn(): void {
  try {
    sessionStorage.removeItem(SIGN_IN_TRIED)
  } catch {
    // 覚えていないなら忘れることも要らない。
  }
}

/**
 * 盤面より前の様子を 1 行で。
 *
 * 繋がっていない間は、サーバから届いたものより先にそれを出す。**何回目かまで出す**のは、
 * 止まって見える時間に、待てば戻るのか戻らないのかが分かるようにするためである（ADR-0016）。
 */
function statusOf(session: Session, link: Link): string | undefined {
  switch (link.kind) {
    case '諦めた':
      return '繋がりませんでした。ページを再読み込みしてください'
    case '繋ごうとしている':
      return link.attempt === 0
        ? '繋いでいます'
        : `繋がりが切れました。繋ぎ直しています（${link.attempt}/${MAX_ATTEMPTS} 回目）`
    case '繋がっている':
      break
  }

  switch (session.stage.kind) {
    case '繋いでいる':
      return '待っています'
    case '名前を決める':
      // 名前を決めるところが自分で全部を出す（`nameElement`）ので、上に足す 1 行は要らない。
      return undefined
    case 'ロビー':
      // ロビーは自分で全部を出す（`lobbyElement`）ので、上に足す 1 行は要らない。
      return undefined
    case '相手を待っている':
      // 待っている画面が見出しを自分で出す（`awaitingElement`）ので、上に足す 1 行は要らない。
      return undefined
    case '打っている':
      return session.stage.board === undefined ? '盤面を待っています' : undefined
  }
}

/**
 * 操作のしかた（#94）。
 *
 * ボタンの並びは一覧性があり、それはそれで分かりやすい。クリックは盤面と手を目で往復せずに
 * 済む。**どちらがよいかは場面によるので、切り替えられるようにしている。**
 */
type PickMode = 'クリック' | 'ボタン'

/** いま盤面をどう操作しているか。`selection` が選びかけ。 */
interface Picking {
  readonly mode: PickMode
  /** 選びかけ（カード・山札・聞いて選び終えた手）。何も選んでいなければ空。 */
  readonly selection: PickSelection
  readonly onAim: (aim: AimKind) => void
  readonly onCard: (card: CardId) => void
  /** 山札を押した（#249）。もう一度押したら外す。 */
  readonly onDeck: () => void
  /** 選びかけを捨てる。手を送る時に呼ぶ。描き直さない（届く盤面が描き直す）。 */
  readonly onCancel: () => void
  /**
   * 選びかけを外して描き直す（#249）。「カードの選択をやめる」・押せるもの以外を押す・Esc の
   * 共通の出口。何も送らない。
   */
  readonly onDeselect: () => void
  readonly onMode: (mode: PickMode) => void
}

/**
 * 対戦画面だけで使う、盤面をまたぐ選び方（ADR-0027）。カードの一覧の開閉と、「選ぶ」一覧での
 * 選びかけを持つ。盤面をクリックして操作する `Picking` とは別に持つ——一覧は行える手が
 * 何であっても（クリック・ボタンのどちらの操作のしかたでも）出るので、その状態を混ぜない。
 */
interface DuelInteraction {
  /**
   * 開いている一覧（捨札・リムーブの中身を見る。スマートフォンでは、エネルギー・スマッシュの中身も）。
   * 無ければ何も開いていない。
   */
  readonly viewingPile: { readonly player: Player; readonly zone: ListZone } | undefined
  readonly onOpenPile: (player: Player, zone: ListZone) => void
  readonly onClosePile: () => void
  /**
   * 一覧で最後に押したカード（スマートフォン、ADR-0034）。上の段に詳細を出す。まだ押していなければ
   * `undefined`。`redraw` が偽なら覚えるだけで描き直さない（押すことが描き直しになる一覧）。
   */
  readonly listShown: CardId | undefined
  readonly onListShow: (card: CardId, redraw: boolean) => void
  /**
   * 開いている、コストを払う一覧（スマートフォン、ADR-0034）。払うカードが無いゾーンの一覧は見るだけで、ここは
   * 空になる。答えたあとの盤面でいったん閉じ、選択が続けば開き直す（`pay-list.ts`）。
   */
  readonly payState: PayState | undefined
  /** 払う答えを 1 枚分送った。描き直さない（届く返事が描き直す）。 */
  readonly onPayAnswered: () => void
  /** 行動をやめる答えを送った。描き直さない。 */
  readonly onPayCancelled: () => void
  /** 「選ぶ」一覧で選びかけている候補の番号。まだ無ければ `undefined`。 */
  readonly pickerPicked: number | undefined
  readonly onPickerPick: (index: number | undefined) => void
  /** 答えて（選ばない・これに決める・戻る・取り消す）次の状況に移る。選びかけを捨てる。 */
  readonly onPickerAnswered: () => void
}

/** 操作のしかたを切り替えるところ。 */
function modeElement(picking: Picking): HTMLElement {
  const node = document.createElement('div')
  node.className = 'mode'
  // ラベルは見せず、グループの名前で読ませる（ADR-0027）。
  node.setAttribute('role', 'group')
  node.setAttribute('aria-label', '操作のしかた')

  for (const mode of ['クリック', 'ボタン'] as const) {
    const button = document.createElement('button')
    button.className = picking.mode === mode ? 'mode--選択中' : ''
    button.textContent = mode
    button.setAttribute('aria-pressed', String(picking.mode === mode))
    button.addEventListener('click', () => picking.onMode(mode))
    node.append(button)
  }

  return node
}

function line(className: string, text: string): HTMLElement {
  const node = document.createElement('p')
  node.className = className
  node.textContent = text

  return node
}

/**
 * ロビーで押せるものと、打ち込みかけている部屋の名前（#175）。
 *
 * 名前をここに持つのは、**画面が丸ごと描き直される**（`draw`）ためである。ほかの人が部屋を
 * 作ればロビーが届いて描き直しが起きるので、入力欄に置いたままにすると打ち込みかけが消える。
 */
interface Lobby {
  readonly name: string
  /**
   * 選んでいるデッキ（ADR-0021）。まだ選んでいなければ `undefined`。
   *
   * 名前と同じ理由でここに持つ。**画面は丸ごと描き直される**ので、選んだものを `select` に
   * 置いたままにすると、ほかの人が部屋を作るたびに選び直しになる。
   */
  readonly deck: DeckId | undefined
  /** CPU の席に座らせるものとして選んでいるデッキ（#195）。`deck` と同じ理由でここに持つ。 */
  readonly cpuDeck: DeckId | undefined
  /** 作る部屋のルールとして選んでいるもの（ADR-0021）。デッキと同じ理由でここに持つ。 */
  readonly rules: ChosenRules
  /** 使用するデッキのページ（0 から）。描き直しても動かないよう、ここに持つ。 */
  readonly deckPage: number
  /** 「…」のメニューを開いているデッキ。 */
  readonly menu: DeckId | undefined
  /** 対戦部屋一覧のタブ・探す文字・ページ。 */
  readonly roomTab: RoomTab
  readonly roomQuery: string
  readonly roomPage: number
  readonly onDeckPage: (page: number) => void
  readonly onMenu: (deck: DeckId | undefined) => void
  readonly onRoomTab: (tab: RoomTab) => void
  readonly onRoomQuery: (query: string) => void
  readonly onRoomPage: (page: number) => void
  readonly onName: (name: string) => void
  readonly onDeck: (deck: DeckId) => void
  readonly onCpuDeck: (deck: DeckId) => void
  readonly onFormat: (format: DuelFormat) => void
  readonly onRestriction: (restriction: RestrictionChoice) => void
  readonly onCreate: (name: string, against: OpponentKind) => void
  readonly onJoin: (code: RoomCode) => void
  /** 部屋を出てロビーに戻る。断るのはサーバである（`server` の `room.ts` の `canLeave`）。 */
  readonly onLeave: () => void
}

/**
 * 表示名を決めるところで押せるものと、打ち込みかけている名前（ADR-0020）。
 *
 * 打ち込みかけをここに持つのは、部屋の名前と同じ理由である（`Lobby`）。**画面は丸ごと描き直され
 * る**ので、入力欄に置いたままにすると、繋ぎ直しなどで描き直しが起きた時に消える。
 */
interface Naming {
  readonly draft: string
  readonly onDraft: (value: string) => void
  readonly onDecide: (name: string) => void
  /** 断りの返事が届いて、まだ描き直していないか。呼ぶと下ろす。 */
  readonly takeRefusalArrived: () => boolean
}

/**
 * デッキを組むところの状態と、押せるもの（#193）。
 *
 * `checking` は、いまの組みかけへの確かめた結果をまだ待っているか（`deck-builder.ts` の `checkView`）。
 */
interface DeckBuilding {
  readonly builder: Builder
  readonly checking: boolean
  readonly list: DeckListHandlers
  readonly editor: DeckEditorHandlers
  /** 尋ねていること（`Builder.confirming`）への答え。 */
  readonly confirm: { readonly onConfirm: () => void; readonly onCancel: () => void }
  /** ロビーから開く。組めない立て方では `undefined`。 */
  readonly onBuild: (() => void) | undefined
  /** 共有するダイアログで押せるもの（ADR-0022）。尋ねていなければ `undefined`。 */
  readonly sharing: ShareDialogHandlers | undefined
  readonly myShares: MyShareHandlers
  readonly recipeList: RecipeListHandlers
  readonly recipeView: RecipeViewHandlers
}

/**
 * 描き直す前に手を置いていた要素の印（`render.ts` の `KEEP_FOCUS`）と、打っていた位置。
 *
 * 手を置いていたのは入力欄とは限らない。押して選ぶ行・「…」・タブ・ページ送り・カルーセルも
 * 描き直しで作り直されるので、同じ印で手を戻す。入力欄でなければ、位置は持たない（`null`）。
 * 手が印の付いた要素に無ければ `undefined`。名前は、入力欄だけだった頃のまま残している。
 */
interface Typing {
  readonly key: string
  readonly start: number | null
  readonly end: number | null
}

/** 手のある要素の印。入力欄なら、打っていた位置も。 */
function typingIn(root: HTMLElement): Typing | undefined {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !root.contains(active)) return undefined

  const key = active.dataset[KEEP_FOCUS]
  if (key === undefined) return undefined
  // 押して選ぶ行・「…」・ページ送りのように打ち込む欄でないものは、手を戻すだけにする。
  if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) return { key, start: null, end: null }

  // 数を打つ欄は、打っている位置を読めない（読むと投げるブラウザがある）。
  try {
    return { key, start: active.selectionStart, end: active.selectionEnd }
  } catch {
    return { key, start: null, end: null }
  }
}

/**
 * 作り直した要素に、手を戻す。入力欄なら、打っていた位置も戻す。
 *
 * 戻し先が押せなくなっていたら（端のページへ移ったあとの「‹」「›」）、その要素が持つ代わりの印
 * （`KEEP_FOCUS_INSTEAD`）の要素へ移す。押せない要素には手を置けない。
 */
function restoreTyping(root: HTMLElement, typing: Typing | undefined): void {
  if (typing === undefined) return

  const find = (key: string): HTMLElement | undefined =>
    [...root.querySelectorAll<HTMLElement>('[data-keep-focus]')].find((node) => node.dataset[KEEP_FOCUS] === key)

  let node = find(typing.key)
  if (node instanceof HTMLButtonElement && node.disabled) {
    const instead = node.dataset[KEEP_FOCUS_INSTEAD]
    node = instead === undefined ? undefined : find(instead)
  }
  if (node === undefined) return

  node.focus()
  try {
    if (typing.start !== null && typing.end !== null && (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) {
      node.setSelectionRange(typing.start, typing.end)
    }
  } catch {
    // 位置を置けない欄（数を打つ欄）は、手を戻すだけにする。
  }
}

/** 縦・横、それぞれのスクロールした位置。 */
interface ScrollPosition {
  readonly top: number
  readonly left: number
}

/**
 * 印（`render.ts` の `KEEP_SCROLL`）の付いた一覧の、スクロールした位置。描き直した後に戻す。
 *
 * **一覧を丸ごと作り直す**ので、位置は要素と一緒に消える。印の値で、作り直した後の要素と結び付ける。
 * 縦（`scrollTop`）だけでなく横（`scrollLeft`）も戻す——1 行表示を狭い幅で横にスクロールした状態で
 * ＋・−を押すと描き直しが起きるが、横の位置まで戻さないと、そのたびに左端へ戻ってしまう（#207）。
 */
function scrollPositions(root: HTMLElement): ReadonlyMap<string, ScrollPosition> {
  const positions = new Map<string, ScrollPosition>()
  for (const node of root.querySelectorAll<HTMLElement>('[data-keep-scroll]')) {
    const key = node.dataset[KEEP_SCROLL]
    if (key !== undefined) positions.set(key, { top: node.scrollTop, left: node.scrollLeft })
  }

  return positions
}

function restoreScroll(root: HTMLElement, positions: ReadonlyMap<string, ScrollPosition>): void {
  for (const node of root.querySelectorAll<HTMLElement>('[data-keep-scroll]')) {
    const at = positions.get(node.dataset[KEEP_SCROLL] ?? '')
    if (at === undefined) continue

    node.scrollTop = at.top
    node.scrollLeft = at.left
  }
}

/**
 * 払う一覧を開いた直後に、押した方のゾーンの見出しが見える位置へ送る（ADR-0034）。片方のゾーンしか無ければ
 * 動かない。描いたあと（`restoreScroll` で位置を戻したあと）に呼ぶ。
 */
function revealPayZone(root: HTMLElement, zone: ListZone): void {
  const sections = [...root.querySelectorAll<HTMLElement>('.picker__section')]
  sections.find((each) => each.dataset.zone === zone)?.scrollIntoView({ block: 'start' })
}

/**
 * 選び直した CPU のデッキのサムネイルが見えるところまで、列を横に送る（ADR-0029）。見えていれば動かさない。
 *
 * 描き直したあと（`restoreScroll` で位置を戻したあと）に呼ぶ。先に送ると、戻した位置で上書きされる。
 * ページ全体や縦の位置は動かさないので、`scrollIntoView` ではなく、列の `scrollLeft` だけを動かす。
 */
function revealPickedCpuDeck(root: HTMLElement): void {
  const strip = root.querySelector<HTMLElement>('.lobby__thumbs')
  const thumb = strip?.querySelector<HTMLElement>('[aria-checked="true"]')
  if (strip === null || strip === undefined || thumb === null || thumb === undefined) return

  const area = strip.getBoundingClientRect()
  const at = thumb.getBoundingClientRect()
  if (at.left < area.left) strip.scrollLeft -= area.left - at.left
  else if (at.right > area.right) strip.scrollLeft += at.right - area.right
}

/**
 * ロビーを出しているか。組むところ・レシピを開いている間や、繋がっていない間は出さない。
 * `draw` が出すかどうかを決めるのと、ロビーの見え方の状態を整えるのが、同じ答えを見る。
 */
function lobbyIsShown(session: Session, link: Link, builder: Builder): boolean {
  const stage = session.stage
  const connected = link.kind === '繋がっている'
  const loaded = session.pool !== undefined && session.ownedDecks !== undefined
  const builderOpen = stage.kind === 'ロビー' && connected && builder.screen !== '閉じている' && loaded
  // `/recipe/<鍵>` を直に開いたが、ログインを持たない立て方だった（ADR-0022）。
  const viewingRecipeWithoutLogin = stage.kind === 'ロビー' && connected && builder.screen === 'レシピ' && session.pool === undefined

  return stage.kind === 'ロビー' && connected && !builderOpen && !viewingRecipeWithoutLogin
}

/**
 * 共有した本人に渡すリンク（ADR-0022、#197）。
 *
 * `共有した` は共有した本人にだけ届く返事で、サーバが必ず公開の鍵を添える
 * （`server` の `wireShareOf` の `ownerFacing`）。届かないのは通信の形が壊れている場合だけ
 * なので、投げて気付けるようにする（`recipe.ts` の `myShareRows` と同じ考え方）。
 */
function ownShareLinkOf(share: WireShare): string {
  if (share.key === undefined) throw new Error('自分の共有に公開の鍵がありません')

  return shareLinkOf(location.origin, share.key)
}

/**
 * いまの状態を丸ごと描き直す。
 *
 * 差分を当てずに毎回作り直している。盤面も差分ではなくまるごと届く（`wire.ts`）ので、
 * 追いつかせるものが無い。
 *
 * `overlay` は盤面の一部ではなく、いま出す分だけを呼ぶ側（`mount` のタイマー）が渡す。
 * ここで毎回作り直しても、CSS の `animation` を使っていないのでちらつかない
 * （`style.css` の `.overlay-layer`）。
 */
function draw(
  root: HTMLElement,
  session: Session,
  link: Link,
  connection: Connection,
  overlay: Overlay,
  picking: Picking,
  lobby: Lobby,
  naming: Naming,
  building: DeckBuilding,
  duel: DuelInteraction,
  phone: PhoneControl | undefined,
  phonePending: PhonePending | undefined,
): void {
  // 打ち込みかけの場所は描き直すと消える。打っていた人には返す（`lobbyElement`）。
  const typing = document.activeElement?.classList.contains('lobby__name') === true
  // 「これにする」をマウスで押すと手はボタンにあるので、断りの返事による描き直しでは押した経路によらず返す。
  const refusalArrived = naming.takeRefusalArrived()
  const typingName = refusalArrived || document.activeElement?.classList.contains('naming__input') === true
  const typingDeck = typingIn(root)
  const scrolled = scrollPositions(root)
  // 対戦画面の手の置き場所（盤面・ダイアログ・一覧）。描き直す前に印を取り、あとで戻す。
  // ダイアログが新しく開いたときだけ中へ移す——すでに中に居るなら、描き直すたびに先頭へ戻さない
  // （#207、#251）。
  const focusMemory = focusBefore(root)
  root.replaceChildren()

  const status = statusOf(session, link)
  if (status !== undefined) root.append(line('status', status))

  // 繋がっていない間は打てない。送っても捨てられる（`connection.ts`）ので、押せる形で出さない。
  // **盤面は出したままにする。** 見えているものは切れる前にサーバから届いたもので、読むぶんには
  // 正しい。繋ぎ直せばいまの盤面が届いて置き換わる（ADR-0016）。
  const connected = link.kind === '繋がっている'

  const stage = session.stage
  // 名前を決めるまで、ほかへは進めない（ADR-0020）。ロビーと同じく、送れる間だけ出す。
  if (stage.kind === '名前を決める' && connected) {
    root.append(nameElement(naming.draft, stage.reason, { onDraft: naming.onDraft, onDecide: naming.onDecide }))
    // 描き直しで打ち込みかけの場所を見失わないように、打っていた人には返す。
    // 画面に置いた後でなければ、フォーカスは移らない。
    const input = root.querySelector<HTMLInputElement>('.naming__input')
    if (typingName && input !== null) {
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
    }
  }

  // デッキを組むところはロビーから開く（#193）。**ロビーの代わりに出す。** 部屋に入ったり名前を
  // 尋ねられたりしてロビーを離れたら出さないが、組みかけは覚えたままにする。
  const { builder } = building
  const pool = session.pool
  const owned = session.ownedDecks
  const builderOpen =
    stage.kind === 'ロビー' && connected && builder.screen !== '閉じている' && pool !== undefined && owned !== undefined
  // `/recipe/<鍵>` を直に開いたが、ログインを持たない立て方だった（ADR-0022）。**プールが届か
  // ないので、識別子から名前を出す手立てが無い。** `builderOpen` には乗せず、ここだけ別に出す。
  const viewingRecipeWithoutLogin =
    stage.kind === 'ロビー' && connected && builder.screen === 'レシピ' && pool === undefined

  if (builderOpen && builder.screen === 'デッキを選ぶ') {
    const allRows = ownedDeckRows(pool, owned)
    root.append(
      deckListElement(
        {
          decks: filterOwnedDeckRows(allRows, builder.deckSearch, builder.deckColorFilter, builder.deckLabelFilter),
          total: allRows.length,
          allColors: deckColorChoices(allRows),
          allLabels: deckLabelChoices(allRows),
          search: builder.deckSearch,
          colorFilter: builder.deckColorFilter,
          labelFilter: builder.deckLabelFilter,
          presets: presetRows(pool, stage.presets),
          waiting: builder.waiting.kind !== '無し',
          refusal: builder.refusal,
          phone,
        },
        building.list,
      ),
    )
  }

  if (builderOpen && builder.screen === 'デッキを組む' && builder.draft !== undefined) {
    const draft = builder.draft
    root.append(
      deckEditorElement(
        {
          name: draft.name,
          editingName: builder.editingName,
          description: draft.description,
          count: draft.cards.length,
          unsaved: hasUnsavedChanges(draft, owned),
          saved: draft.deck !== undefined,
          savable: builder.waiting.kind === '無し' && !hasUnusableCards(pool, draft),
          check: checkView(draft, building.checking, session.checked, pool),
          // 絞り込むのはプールの一覧だけである。デッキに入っているカードは、条件に合わなくても出す。
          pool: poolRows(filterPool(pool, builder.filter), draft),
          poolTotal: pool.length,
          poolView: builder.poolView,
          poolShown: builder.poolShown,
          filter: builder.filter,
          filterChoices: filterChoicesOf(pool),
          filterOpen: builder.filterOpen,
          openFolds: builder.openFilterFolds,
          detailOpen: builder.detailOpen,
          deck: deckRows(pool, draft),
          detail: (key) => cardDetailOf(pool, key),
          pinned: builder.pinned,
          restrictions: stage.restrictions,
          rules: builder.rules,
          refusal: builder.refusal,
          labels: autoLabelsOf(pool, draft, undefined),
          levelBars: levelBreakdownOf(pool, draft),
          typeCounts: typeCountsOf(pool, draft),
          starTotal: starTotalOf(pool, draft),
          modal: builder.modal,
          phone,
        },
        building.editor,
      ),
    )
  }

  // 自分が出した共有を並べるところ（ADR-0022）。繋いだ時から届いているので、尋ね直さない。
  if (builderOpen && builder.screen === '自分の共有') {
    root.append(
      myShareListElement(myShareRows(session.myShares ?? []), (key) => shareLinkOf(location.origin, key), building.myShares),
    )
  }

  // 「一覧に載せる」共有があるレシピの一覧（ADR-0022）。届くまでは読み込み中を出す。
  if (builderOpen && builder.screen === 'レシピの一覧') {
    const list = session.recipeList
    if (list === undefined) root.append(line('status', '読み込んでいます'))
    else root.append(recipeListElement(recipeSummaryRows(list.recipes), list.order, building.recipeList))
  }

  // レシピの画面（ADR-0022、`/recipe/<鍵>`）。ログインを持たない立て方では開けない。
  if (viewingRecipeWithoutLogin) {
    root.append(line('status', 'ログインしていないと開けません'))
    root.append(leaveElement('ロビーに戻る', building.recipeView.onClose))
  }
  if (builderOpen && builder.screen === 'レシピ') {
    const view = session.recipeView
    if (builder.viewingRecipeLoading || view === undefined) {
      root.append(line('status', '読み込んでいます'))
      root.append(leaveElement('デッキの一覧に戻る', building.recipeView.onClose))
    } else if (view.recipe === undefined) {
      // 鍵を知らない場合と、共有が 1 つも残っていない場合の両方がここに来る（ADR-0022）。
      root.append(line('status', 'このレシピは開けません'))
      root.append(leaveElement('デッキの一覧に戻る', building.recipeView.onClose))
    } else {
      root.append(
        recipeElement(recipeCardRows(pool, view.recipe.cards), shareRowsOf(view.recipe), builder.waiting.kind !== '無し', building.recipeView),
      )
    }
  }

  // デッキ構築の窓（確認・共有）は、ロビーのデッキの「…」からも開く（ADR-0029）ので、組むところが
  // 開いていなくても、ロビーにいて組める立て方なら出す。
  const buildingDialogs = stage.kind === 'ロビー' && connected && pool !== undefined && owned !== undefined

  // 尋ねている間は、組むところの上に重ねる。**ブラウザの確認ダイアログは使わない**（`confirmElement`）。
  if (buildingDialogs && builder.confirming !== undefined) {
    root.append(confirmElement(confirmView(builder.confirming), building.confirm.onConfirm, building.confirm.onCancel))
  }

  // 共有するダイアログも、同じく画面の中に重ねる（ADR-0022）。
  if (buildingDialogs && builder.sharing !== undefined && building.sharing !== undefined) {
    const sharing = builder.sharing
    root.append(
      shareDialogElement(
        sharing,
        stage.restrictions,
        sharing.kind === '共有した' ? ownShareLinkOf(sharing.share) : undefined,
        building.sharing,
      ),
    )
  }

  // ロビーは繋がっている間だけ出す。作る・入るは送らないと何も起きないので、押せる形で出さない。
  if (stage.kind === 'ロビー' && lobbyIsShown(session, link, builder)) {
    // **席に着くのに選ぶのは自分のデッキである**（ADR-0021、#194）。既製デッキはデッキを組む
    // ところでコピーしてから使う。**デッキを持てない立て方でだけ、既製デッキがここに並ぶ。**
    const seatable = seatableDecks(session.ownedDecks, stage.presets)
    // 選んでいるルールに合わないかは、CPU のデッキの選べる・選べないにだけ効く（ADR-0029、#243）。
    const judged = judgedRulesOf(lobby.rules, stage.restrictions)
    const shownDecks = lobbyDecks(pool, owned, stage.presets, judged)
    // 使用するデッキは、使えないカードが入っていなければ選べる。選べないものは選んだ状態にもしない——
    // 前に選んでいたデッキや、サーバが既定にしたデッキがそれなら、「デッキを選んでください」を出す。
    const choosable = choosableDecks(seatable, shownDecks)
    const chosenDeck = seatedChoice(choosable, lobby.deck, stage.chosen)
    // 入れるかは、選んでいるデッキをその部屋のルールで判定する。部屋のルールが届いていない（古いサーバ）
    // なら判定しない。ロビーで選んでいるルールには左右されない。
    const refusalUnder = (rules: WireRoomRules): HandRefusal | undefined =>
      joinRefusal(shownDecks, chosenDeck, judgedRulesOfRoom(rules, stage.restrictions))
    root.append(
      lobbyElement(
        {
          own: stage.own,
          rooms: lobbyView(stage.rooms, refusalUnder),
          name: lobby.name,
          decks: shownDecks,
          // 選んでいなければ、サーバが決めた既定を選んだ状態で出す。どれを既定にするかを決めるのは
          // サーバである（ADR-0010）——前に選んだものが残っているかを見るのもそちらで、ここは
          // もう無いデッキを選んだ状態にしないだけである。
          chosenDeck,
          // CPU の席に座らせるデッキも、選べるのは同じ棚である（#195）。
          chosenCpuDeck: seatedChoice(choosableDecks(seatable, shownDecks, isCpuChoosable), lobby.cpuDeck, stage.cpuChosen),
          restrictions: stage.restrictions,
          rules: lobby.rules,
          deckPage: lobby.deckPage,
          menu: lobby.menu,
          roomTab: lobby.roomTab,
          roomQuery: lobby.roomQuery,
          roomPage: lobby.roomPage,
          waiting: builder.waiting.kind !== '無し',
          phone,
        },
        {
          onCreate: lobby.onCreate,
          onJoin: lobby.onJoin,
          onName: lobby.onName,
          onDeck: lobby.onDeck,
          onCpuDeck: lobby.onCpuDeck,
          onFormat: lobby.onFormat,
          onRestriction: lobby.onRestriction,
          onDeckPage: lobby.onDeckPage,
          onMenu: lobby.onMenu,
          onRoomTab: lobby.onRoomTab,
          onRoomQuery: lobby.onRoomQuery,
          onRoomPage: lobby.onRoomPage,
          ...(building.onBuild === undefined ? {} : { onBuild: building.onBuild }),
          // 「…」のメニューは、デッキ一覧の各デッキの操作と同じもの（ADR-0029）。組めない立て方では出さない。
          ...(building.onBuild === undefined
            ? {}
            : {
                deckActions: {
                  onOpen: building.list.onOpen,
                  onDuplicate: building.list.onDuplicate,
                  onShare: building.list.onShare,
                  onDelete: building.list.onDelete,
                },
              }),
        },
        typing,
      ),
    )
  }

  // 待っている間は、やめて戻れる。相手が来ないまま閉じ込められない（#175）。
  if (stage.kind === '相手を待っている' && connected) {
    root.append(awaitingElement(lobby.onLeave))
  }

  if (stage.kind === '打っている' && stage.board !== undefined) {
    const board = stage.board
    // スマートフォンでは、操作のしかたの切り替えを出さず、クリックモードで描く（ADR-0034）。切り替えた値
    // （`picking.mode`）は書き換えない。幅が PC に戻れば、その値で描く。
    const clickMode = phone !== undefined || picking.mode === 'クリック'
    // 演出が出ている間は手を送れない（#115）ので、盤面の上でも押せなくする。
    const clicking = connected && clickMode && !showsOverlay(overlay)
    const view =
      clicking && stage.choice === undefined
        ? pickView(board, stage.actions, picking.selection, stage.passOutcome)
        : undefined
    // 盤面に出ている候補がどれかは、操作のしかた・演出・繋がりとは関係なく決まる（#207）。
    // 一覧を出すかどうか（`offBoard` 以下）はここから決める。
    const structuralPicking = stage.choice !== undefined ? choicePicking(board, stage.choice) : undefined
    // クリックで選ぶのを待たれている間は、盤面に出ている候補を盤面から押せるようにする（#94）。
    // 答えるのは番号のままで、押したところがどの番号かは `choicePicking` が持っている。
    const answering = clicking ? structuralPicking : undefined
    const answer = (found: number | undefined): void => {
      if (found !== undefined) connection.send({ kind: '選ぶ', answer: found })
    }
    const boardData = boardView(board)
    const cardsById = visibleCardViewsIn(board)
    const boardPicking: BoardPicking | undefined =
      view !== undefined
        ? {
            pickable: view.pickable,
            picked: view.picked,
            squares: view.destinations,
            onCard: (card) => picking.onCard(card),
            ...(view.picked === undefined && !view.deck ? {} : { onBlank: picking.onDeselect }),
            ...(view.deckPickable ? { deck: { picked: view.deck }, onDeck: picking.onDeck } : {}),
            ...(view.trapZone === undefined
              ? {}
              : {
                  trapZone: { label: view.trapZone.label },
                  onTrapZone: () => {
                    const zone = view.trapZone
                    if (zone === undefined) return
                    picking.onCancel()
                    connection.send({ kind: '行動する', action: zone.action })
                  },
                }),
            onSquare: (square) => {
              const destination = view.destinations.find((each) => indexOfSquare(each.square) === indexOfSquare(square))
              if (destination === undefined) return
              picking.onCancel()
              connection.send({ kind: '行動する', action: destination.action })
            },
          }
        : answering !== undefined
          ? {
              pickable: answering.pickable,
              picked: undefined,
              squares: answering.squares,
              // 裏向きのカードは識別子を持たないので、置き場所で押す（#127）。
              hidden: answering.hidden,
              onCard: (card) => answer(answering.answerOf(card)),
              // やめられるかは、パネルの「この行動をやめる」と同じ判断（`choiceView` の `mayCancel`）。
              ...(stage.choice !== undefined && choiceView(board, stage.choice).mayCancel
                ? { onCancelChoice: () => connection.send({ kind: '取り消す' }) }
                : {}),
              onSquare: (square) => answer(answering.answerOfSquare(square)),
              onHidden: (at) => answer(answering.answerOfHidden(at)),
            }
          : undefined

    // 操作のしかたの切り替えは、行える手の見出しに添える（`render.ts` の `titleRow`）。スマートフォンでは出さない。
    const mode = phone === undefined ? modeElement(picking) : undefined

    const controlsChildren: HTMLElement[] = []

    // 相手が閉じたまま戻らないと、画面は相手の優先権のまま動かなくなる（#175）。**止まって
    // いる理由を読めるようにする。** 回線が切れただけなら戻ってくる（ADR-0016）ので、待つか
    // やめるかは人が決める。
    if (connected && !stage.opponentConnected) {
      controlsChildren.push(line('controls__offline', '相手の繋がりが切れています。戻るのを待つか、やめてロビーに戻れます'))
    }

    // 相手が何をして優先権が回ってきたのかを、打つところに 1 行で出す（#147）。
    //
    // **出すのは、人が打つかどうかを決める場面だけである。** 放棄しか行えない場面は自動で送る
    // （`automaticAction`）ので、出しても読む間が無い。演出中と選択中も、打つ手を決める場面
    // ではない。
    const reason =
      stage.choice === undefined && !showsOverlay(overlay) && automaticAction(session) === undefined
        ? priorityReason(board, stage.fresh)
        : undefined
    if (reason !== undefined) controlsChildren.push(line('controls__reason', reason))

    // 選ぶのを待たれている間、盤面に見えていない置き場から選ぶ候補だけなら、番号のボタンの
    // かわりにカードの一覧を出す（ADR-0027）。一覧は盤面の上に重ねるので、ここには積まない。
    const offBoard = stage.choice !== undefined ? offBoardCandidates(stage.choice, structuralPicking) : []
    // 繋がっていない間は「選ぶ」一覧も出さない。「繋がっていない間は手を出さない」と同じ決まりを、
    // 一覧にも適用する。
    //
    // 候補が全部能力の選択（`isAbilityChoice`）は、クリックモードのときだけ同じ一覧に出す
    // （ADR-0031）。ボタンモードは番号のボタンのままである。`clicking` は使わない。演出が出て
    // いる間も選択は止まらない（#115）ので、カードの一覧と同じく、演出中も出す。
    const showsPicker =
      connected &&
      stage.choice !== undefined &&
      (showsChoicePicker(stage.choice, offBoard) || (clickMode && isAbilityChoice(stage.choice)))

    // 選んでいる間は行える手が無い（`session.ts`）。どちらか一方だけが出る。
    if (!connected) {
      // 繋がっていない間は手を出さない。**押せなくするだけでは足りない。** 出ている手は切れる
      // 前の盤面のもので、繋ぎ直した先でまだ行えるとは限らない（ADR-0016）。何が起きているかは
      // 一番上の 1 行に出ている（`statusOf`）。
      controlsChildren.push(line('controls__offline', '繋がるまで打てません'))
    } else if (stage.choice !== undefined && !showsPicker) {
      controlsChildren.push(
        choiceElement(
          // 盤面から押せる候補は、ここに二重に出さない（#150）。押せるかどうかを決めているのは
          // `answering` そのものなので、演出が出ている間（`clicking` が false）は渡らず、
          // 候補は全部ボタンとして並ぶ。
          choiceView(board, stage.choice, answering),
          {
            onAnswer: (answer) => connection.send({ kind: '選ぶ', answer }),
            onRewind: () => connection.send({ kind: 'ひとつ戻る' }),
            onCancel: () => connection.send({ kind: '取り消す' }),
          },
          mode,
        ),
      )
    } else if (stage.choice === undefined && showsOverlay(overlay)) {
      // 演出が出ている間は行える手を出さない（#115）。**待ち行列は実際の盤面より遅れている**
      // ので、出ている演出のフェイズと、行える手が指すフェイズが食い違う。押せなくするだけ
      // では食い違いが画面に残るので、手そのものを出さない。
      //
      // 選んでいる途中（`stage.choice`）は止めない。あれはすでに始まっている行動の中の選択
      // であって、待ち行列の遅れとは関係が無い。止めると、演出が消えるまで解決が進まなくなる。
      controlsChildren.push(waitingForOverlayElement(mode))
    } else if (stage.choice === undefined && view !== undefined) {
      // クリックで操作する（#94）。パネルには、優先権の放棄と案内文だけを出す。
      controlsChildren.push(
        pickElement(
          view,
          {
            onAction: (action) => {
              picking.onCancel()
              connection.send({ kind: '行動する', action })
            },
            onCancel: picking.onDeselect,
          },
          mode,
        ),
      )
    } else if (stage.choice === undefined) {
      controlsChildren.push(
        actionsElement(
          actionViews(board, stage.actions, stage.passOutcome),
          (action) => connection.send({ kind: '行動する', action }),
          mode,
        ),
      )
    }
    // `showsPicker` の間、行える手のかわりに一覧が出るので、ここには何も積まない。一覧は
    // 盤面・操作パネルの上に重なり、その中に戻る・取り消す口も持つ（`choosePickerElement`）。

    // ロビーに戻る口を出すのは、投げ出せる対戦の間だけである（`server` の `room.ts` の
    // `canLeave`）。決着した後はどちらの対戦でも戻れて、CPU との対戦と、相手が繋がっていない
    // 対戦は途中でも戻れる。**断るのはサーバである。** ここで決めているのは、押す口を出すか
    // どうかだけである。
    //
    // 決着した後の口は、左の列ではなく決着の帯の下（画面の中央下部）に出す（`overlayElement`、
    // ADR-0027）。両方に出すと、同じ名前のボタンが 2 つ並び、読み上げで区別がつかない。
    const leavesAfterResult = connected && board.result !== undefined
    if (connected && board.result === undefined && (stage.opponent.kind === 'CPU' || !stage.opponentConnected)) {
      controlsChildren.push(leaveElement('やめてロビーに戻る', lobby.onLeave))
    }

    // 選びかけの番号が、いま一覧に並んでいる候補に無ければ、選んでいない扱いにする。前の選択の
    // 番号が残っていても、「これに決める」で無効な番号を送らせない（#207）。
    const pickerPicked = offBoard.some(({ index }) => index === duel.pickerPicked) ? duel.pickerPicked : undefined

    // スマートフォンの一覧は画面いっぱいに出て右の列が無いので、最後に押したカードの詳細を上の段に出す（ADR-0034）。
    const phoneList: PhoneListOptions | undefined =
      phone === undefined
        ? undefined
        : { shown: duel.listShown === undefined ? undefined : cardsById.get(duel.listShown), onShow: duel.onListShow }

    const choosePicker =
      showsPicker && stage.choice !== undefined
        ? (() => {
            const choice = stage.choice as NonNullable<typeof stage.choice>
            const meta = choiceView(board, choice, answering)
            // 能力を選ぶ一覧は、開いた時点で発生源のカードの詳細を上の段に出す。札を押したら、押した札の発生源に替わる。
            const source = isAbilityChoice(choice) ? abilityListSource(choice) : undefined
            const pickerList: PhoneListOptions | undefined =
              phoneList === undefined || phoneList.shown !== undefined || source === undefined
                ? phoneList
                : { ...phoneList, shown: cardsById.get(source) }
            return choosePickerElement(
              meta.asking,
              offBoard,
              (id) => cardsById.get(id),
              pickerPicked,
              choice.answered,
              meta.mayDecline,
              meta.mayRewind,
              meta.mayCancel,
              {
                onPick: duel.onPickerPick,
                onConfirm: (index) => {
                  duel.onPickerAnswered()
                  connection.send({ kind: '選ぶ', answer: index })
                },
                onDecline: () => {
                  duel.onPickerAnswered()
                  connection.send({ kind: '選ぶ', answer: '選ばない' })
                },
                onRewind: () => {
                  duel.onPickerAnswered()
                  connection.send({ kind: 'ひとつ戻る' })
                },
                onCancel: () => {
                  duel.onPickerAnswered()
                  connection.send({ kind: '取り消す' })
                },
              },
              isAbilityChoice(choice) ? abilityLabels(board, choice) : [],
              pickerList,
            )
          })()
        : undefined
    // 続けて届いた選択は、見出しやボタンの文字が同じになりうる。届いた選択ごとに別のダイアログとして
    // 扱う（`dialog-focus.ts` の `markDialog`）。
    if (choosePicker !== undefined && stage.choice !== undefined) markDialog(choosePicker, stage.choice)

    // 選んだカードの手を聞くダイアログ（#249）。出すのは `view` が立つ間（繋がっていて、演出が
    // 出ておらず、選ぶのを待たれていない）だけで、そうでなければ `view` が無いので開かない。
    const askHandlers: AskHandlers = {
      onChoose: (option) => {
        if ('send' in option) {
          picking.onCancel()
          connection.send({ kind: '行動する', action: option.send })
        } else {
          picking.onAim(option.aim)
        }
      },
      onCancel: () => {
        closedByCancel()
        picking.onDeselect()
      },
    }
    // スマートフォンでは、選んだカードで行える手を下からのシートで出し、上の段にカードの詳細を一緒に出す
    // （ADR-0034）。聞くことが無く、行き先を押して決まるだけの手も、先にシートで手を選ばせる。
    const sheetCard = view?.picked === undefined ? undefined : cardsById.get(view.picked)
    // 行える手が「行き先を押して決まる 1 種類」だけのカードは、シートを挟まず、すぐ行き先を光らせて、盤面を
    // 隠さない低い帯で詳細を見せる（ADR-0034）。帯の「詳細」から、いつものシートに詳細だけを出せる。
    const peekAim = phone === undefined ? undefined : peekAimOf(view?.sheet)
    const peek: PeekProps | undefined =
      phone !== undefined && peekAim !== undefined && view?.picked !== undefined && sheetCard?.kind === '表'
        ? {
            card: sheetCard,
            place: boardData.squares.some((row) => row.some((square) => square.cards.some((each) => each.kind === '表' && each.id === sheetCard.id)))
              ? 'スクエア'
              : '手札など',
            aim: peekAim,
            onDetail: () => phone.send({ kind: '対戦のカードを見る', card: sheetCard.id }),
            // 「カードの選択をやめる」と同じ処理。
            onCancel: askHandlers.onCancel,
          }
        : undefined
    // 詳細だけを見るシート（押せないカードをタップした）。手は無く、閉じる口は「閉じる」。選んでいる間は出さない
    // （帯から開いた詳細は、選んでいる間も出す。閉じても行き先の選択は続く）。
    const viewed = phone?.state.viewedCard
    const viewedCard = viewed === undefined ? undefined : cardsById.get(viewed.card)
    const viewedSheet =
      phone !== undefined && viewed !== undefined && viewedCard?.kind === '表' && (view?.sheet === undefined || peek !== undefined)
        ? askElement(
            { heading: viewedCard.name, lead: 'カードの詳細', options: [] },
            { onChoose: () => undefined, onCancel: () => phone.send({ kind: '対戦のカードを閉じる' }) },
            sheetDetailElement(viewedCard),
          )
        : undefined
    const dialog =
      phone !== undefined
        ? view?.sheet !== undefined && peek === undefined
          ? askElement(view.sheet, askHandlers, sheetDetailElement(sheetCard))
          : viewedSheet
        : view?.ask !== undefined
          ? askElement(view.ask, askHandlers)
          : undefined
    // 選びかけが替わる（別のカードを選ぶ・行き先を絞る）たびに、別のダイアログとして扱う。
    if (dialog !== undefined) markDialog(dialog, viewedSheet !== undefined && viewed !== undefined ? viewed : picking.selection)

    // 捨札・リムーブの中身を見る一覧（ADR-0027）。押す前に選んでいる（`duel.viewingPile`）ものだけ出す。
    // スマートフォンでは、エネルギー・スマッシュの中身もこの一覧で見る。コストの選択中は、その一覧が
    // 払うカードを選ぶ一覧になる（ADR-0034）。払う一覧は、払い終えるまで開いたままにする（`pay-list.ts`）。
    const viewingPileElement =
      duel.viewingPile !== undefined
        ? (() => {
            const side = duel.viewingPile.player === stage.seat ? boardData.own : boardData.opponent
            const zone = zoneOf(side, duel.viewingPile.zone)
            const close = (): void => {
              closedByCancel()
              duel.onClosePile()
            }
            if (phoneList === undefined) return viewPileElement(zone, close)

            const paying = duel.payState?.kind === '開いている' ? duel.payState.list : undefined
            if (paying === undefined) return viewPileElement(zone, close, { ...phoneList, whose: side.whose })

            // 払えるゾーンは、開いたときに決めたものを並べる。払い終えて空になったゾーンは出さない。
            const zones = paying.zones.map((each) => zoneOf(side, each)).filter((each) => each.cards.length > 0)
            if (zones.length === 0) return undefined

            // 答えを送ったあと返事を待つ間と、演出が出ている間は、押せるカードの無い一覧になる。
            const choosing = answering !== undefined && boardPicking !== undefined && stage.choice !== undefined ? boardPicking : undefined
            const paid: BoardPicking | undefined =
              choosing === undefined
                ? undefined
                : {
                    ...choosing,
                    onCard: (card) => {
                      duel.onPayAnswered()
                      choosing.onCard(card)
                    },
                    onHidden: (at) => {
                      duel.onPayAnswered()
                      choosing.onHidden?.(at)
                    },
                  }
            return chooseZoneListElement(
              zones,
              side.whose,
              paid,
              {
                onClose: close,
                // やめられるかは、パネルの「この行動をやめる」と同じ判断（`choiceView` の `mayCancel`）。
                ...(choosing?.onCancelChoice === undefined
                  ? {}
                  : {
                      onCancel: () => {
                        duel.onPayCancelled()
                        choosing.onCancelChoice?.()
                      },
                    }),
              },
              phoneList,
            )
          })()
        : undefined
    // 開くたびに別の一覧として扱う。盤面が届いて枚数が変わっても、同じ一覧の描き直しである。
    if (viewingPileElement !== undefined && duel.viewingPile !== undefined) markDialog(viewingPileElement, duel.viewingPile)

    // 演出・決着の層。決着は溜めない演出とは別で、消えずに出続ける（`overlayElement`）。
    const overlayNode =
      showsOverlay(overlay) || boardData.result !== undefined
        ? overlayElement(overlay, boardData.result, leavesAfterResult ? lobby.onLeave : undefined)
        : undefined

    // 能力を選ぶ一覧で選びかけの札があれば、その発生源のカードを詳細の既定にする（ADR-0031）。
    const pickedCandidate = showsPicker && stage.choice !== undefined && pickerPicked !== undefined ? stage.choice.candidates[pickerPicked] : undefined
    const detailDefault = pickedCandidate?.kind === '能力' ? pickedCandidate.source : undefined

    root.append(
      duelElement({
        view: boardData,
        ownName: stage.own,
        opponentName: opponentName(stage.opponent),
        controlsChildren,
        picking: boardPicking,
        clickMode,
        ...(phone === undefined ? {} : { phone }),
        ...(peek === undefined ? {} : { peek }),
        onOpenPile: duel.onOpenPile,
        viewingPile: viewingPileElement,
        choosePicker,
        ...(dialog === undefined ? {} : { dialog }),
        overlay: overlayNode,
        cardsById,
        ...(detailDefault === undefined ? {} : { detailDefault }),
      }),
    )
  }

  // 組むところは、断られた理由を自分で持って出す（`Builder.refusal`）。二重に出さない。
  if (session.refusal !== undefined && !builderOpen) {
    root.append(line('refusal', `行えませんでした: ${session.refusal}`))
  }

  restoreScroll(root, scrolled)
  restoreTyping(root, typingDeck)
  // スマートフォンのシートの手の置き直しと、外の止め方（ADR-0034）。手の置き直しは、直前の `restoreTyping` を上書きする。
  settlePhoneFocus(root, phonePending)

  settleFocus(root, focusMemory)
}

/** 組みかけのデッキを覚えておく先の名前（#193）。 */
const DRAFT_KEY = 'revolution.deckDraft'

/**
 * 覚えておいた組みかけ。無ければ `undefined`。
 *
 * **保存するまでサーバには無い**ので、読み込み直しで消えないようにブラウザに置く。読めないもの
 * （書き換えられた、形が変わった）は無かったものとして扱う——組みかけが消えるだけで、画面は開く。
 */
function rememberedDraft(): DeckDraft | undefined {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (raw === null) return undefined

    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const { deck, name, description, cards } = parsed as Record<string, unknown>
    if (deck !== undefined && typeof deck !== 'string') return undefined
    if (typeof name !== 'string' || typeof description !== 'string') return undefined
    if (!Array.isArray(cards) || !cards.every((card) => typeof card === 'string')) return undefined

    return { deck, name, description, cards }
  } catch {
    return undefined
  }
}

/** 組みかけを覚える。`undefined` なら忘れる。覚えられないブラウザでは、読み込み直すと消える。 */
function rememberDraft(draft: DeckDraft | undefined): void {
  try {
    if (draft === undefined) localStorage.removeItem(DRAFT_KEY)
    else localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // 覚えられなかった。組むことはできる。
  }
}

/**
 * 組み替えてから確かめに行くまでの間（ミリ秒）。
 *
 * **続けて押している間は送らない。** 1 枚ごとに送ると、60 枚入れる間に 60 回確かめることになる。
 * 手が止まったと読める程度に短くする。
 */
const CHECK_DELAY_MS = 300

/**
 * 画面を作って繋ぐ。返る関数を呼ぶと接続を閉じる。
 *
 * 繋がっているかは `Session` に入れていない。あれはサーバから届いたものを畳んだ形で、ソケットが
 * 生きているかはサーバの言い分ではないためである。
 */
export function mount(root: HTMLElement, options: MountOptions): () => void {
  let session = connecting()
  let link: Link = connectingLink()

  // ロビーで打ち込みかけている部屋の名前（#175）。
  let roomName = ''
  /**
   * ロビーで選んでいるデッキ（ADR-0021）。まだ選んでいなければ `undefined`。
   *
   * **選ばないまま作っても入っても構わない。** 選ばれなかった席は、サーバが決めた既定のデッキに
   * 座る（`server` の `room.ts` の `start`）。画面はどれが既定かを決めない（ADR-0010）。
   *
   * **既定が決まらないこともある**（#194）。前に選んでいたデッキを消した人がそれで、選ぶまで
   * 断られる。画面はそれを先回りして止めない——**何が起きるかを決めるのはサーバである。**
   */
  let chosenDeck: DeckId | undefined
  /** ロビーで選んでいる、CPU の席に座らせるデッキ（#195）。`chosenDeck` と同じ扱い。 */
  let chosenCpuDeck: DeckId | undefined
  /**
   * ロビーで選んでいる、作る部屋のルール（ADR-0021）。まだ選んでいなければ `undefined`。
   *
   * デッキと同じく、**選ばないまま作っても構わない。** 選ばなかったものはサーバが既定を当てる
   * （`server` の `room.ts` の `rulesFor`）。
   */
  let chosenFormat: DuelFormat | undefined
  let chosenRestriction: RestrictionChoice | undefined
  // ロビーの見え方の状態（ADR-0029）。使用するデッキのページ、開いている「…」のメニュー、
  // 対戦部屋一覧のタブ・探す文字・ページ。画面は丸ごと描き直されるので、ここに持つ。
  let lobbyDeckPage = 0
  let lobbyMenu: DeckId | undefined
  let lobbyRoomTab: RoomTab = 'すべて'
  let lobbyRoomQuery = ''
  let lobbyRoomPage = 0
  // スマートフォンの並べ方でだけ持つ状態（ADR-0034、`phone.ts`）。通信にも保存にも混ぜない。
  let phoneState: PhoneState = initialPhone()
  // 打ち込みかけている表示名（ADR-0020）。尋ねられるたびに、いま付いている名前から始める。
  let nameDraft = ''
  // 名前を断る返事が届いて、まだ描き直していない間は真。描き直しが入力欄へフォーカスを戻す印になる。
  let nameRefusalArrived = false
  // 押している最中（pointerdown から pointerup まで）か。押しているうちに描き直すと、押した要素が
  // click の前に作り直され、押したことが消える。
  let pointerHeld = false
  // 押している最中に描き直しを頼まれた。手を離したら描き直す。
  let redrawOnRelease = false
  // 変換中（IME で文字を組み立てている間）か。描き直すと入力欄が作り直され、組み立て中の文字が消える。
  let composing = false
  // 変換中に描き直しを頼まれた。確定したら 1 回だけ描き直す。
  let redrawAfterComposition = false
  // CPU のデッキを選び直した。次に描いたあと、選んだサムネイルが見えるところまで列を送る。
  let revealCpuDeck = false
  /**
   * 入ろうとしている部屋。届いたものがまだ無い間の入り先である（#175）。
   *
   * 入ってしまえば、いる部屋は届いたものから分かる（`session.ts` の `roomOf`）。ここに残るのは
   * 送ってから返事が来るまでの間と、合言葉を直に指して開いた時（`options.room`）だけである。
   */
  let pendingRoom: RoomCode | undefined = options.room
  /**
   * `/recipe/<鍵>` を直に開いて始まった時の、開こうとしているレシピ（ADR-0022）。
   *
   * **ロビーに着いたところで開く。** 名前を決める必要があるかもしれず（ADR-0020）、決まって
   * いなければそちらが先である。開いたら忘れる——`builder.viewingRecipe` が続きを持つ。
   */
  let pendingRecipe: RecipeKey | undefined = options.recipe

  // 盤面をクリックして操作する（#94）。選びかけは、行える手が入れ替わる時（盤面が届いた時など）に
  // 捨てる。届いた手は入れ替わっており、選びかけの手がまだ行えるとは限らないためである。
  let mode: PickMode = 'クリック'
  let selection: PickSelection = {}

  /**
   * 開いている一覧（捨札・リムーブの中身を見る、ADR-0027。スマートフォンでは、エネルギー・スマッシュの
   * 中身も、ADR-0034）。無ければ何も開いていない。
   */
  let viewingPile: { readonly player: Player; readonly zone: ListZone } | undefined
  /** 一覧で最後に押したカード（スマートフォン、ADR-0034）。開き直すたび、新しい選択が届くたびに捨てる。 */
  let listShown: CardId | undefined
  /**
   * いま開いている一覧が、コストの選択中に開いた「払うカードを選ぶ」一覧なら、その状態（スマートフォン、
   * ADR-0034）。答えたあとの盤面でいったん閉じ、選択が続けば開き直す予定を持つ。開閉は `pay-list.ts` が決める。
   */
  let payState: PayState | undefined
  /** 操作の帯の高さの変わり方を見張るのを止める（スマートフォンの対戦画面。描き直すたびに付け直す）。 */
  let stopWatchingControls: () => void = () => undefined
  /** 払う一覧を開いた直後に、押した方のゾーンの見出しへ送る。描いたあとに 1 度だけ行う。 */
  let payReveal: ListZone | undefined
  /** 払う一覧を開き直したあと、一覧のスクロールを戻す位置。描いたあとに 1 度だけ行う。 */
  let payScroll: number | undefined
  /**
   * 「選ぶ」一覧で、いま選びかけている候補の番号（ADR-0027）。まだ何も選んでいなければ
   * `undefined`。答えて（選ばない・これに決める）次の状況に移るたびに捨てる。
   */
  let pickerPicked: number | undefined

  // いま出している演出と、後から出す分の待ち行列（#96・#104）。フェイズ・ターンの切り替わりと
  // 効果解決のカットインは、出す中身は別だが同じ待ち行列を通る（`view-model.ts` の
  // `Overlay`）。`fresh` は盤面が届くたびに新しい配列で届く（`session.ts`）ので、参照を
  // 覚えておけば「前回と同じ盤面」を区別できる——`選んでほしい` の到着で `draw` をやり直しても、
  // 待ち行列を作り直さずに済む。
  //
  // **すぐに置き換えない。** 行える手が「優先権を放棄する」だけの場面はクライアントが自動で
  // 送る（`automaticAction`）ので、盤面がほぼ間を置かず届き続けることがある。届くたびに
  // 消して作り直すと、画面が描き直される前に次の盤面が届いて、一度も見えないまま消える。
  // **出し切ってから次へ進める**ことで、続けて起きても積み上がらず、かつ 1 つずつは必ず
  // 見える時間を確保する。
  const EMPTY_OVERLAY: Overlay = { transitions: [], cutIns: [] }
  let overlay: Overlay = EMPTY_OVERLAY
  let queue: Overlay[] = []
  let overlayTimer: ReturnType<typeof setTimeout> | undefined
  let lastFresh: readonly LoggedEvent[] | undefined

  const deselect = (): void => {
    if (selection.card === undefined && selection.deck !== true) return
    selection = {}
    redraw()
  }

  /**
   * 払う一覧に出来事を伝える。一覧は、開いているかどうかを見る一覧の状態（`viewingPile`）にも映す。
   * 開き直す予定は、閉じた状態で覚えておく。
   */
  const settlePay = (event: PayEvent): void => {
    const before = payState
    payState = settlePayState(before, event)
    if (payState?.kind === '開いている') {
      const { player, pressed } = payState.list
      if (before?.kind === '開き直す予定') {
        viewingPile = { player, zone: pressed }
        payScroll = before.scroll
      } else if (before === undefined) {
        // 届いた時点で開いた。押した方のゾーンの見出しから見せる。
        viewingPile = { player, zone: pressed }
        listShown = undefined
        payReveal = pressed
        payScroll = undefined
      }
    } else if (before?.kind === '開いている') {
      viewingPile = undefined
    }
  }

  /** 払う一覧も開き直す予定も捨てる。開いている一覧は閉じる。 */
  const dropPayList = (): void => {
    if (payState?.kind === '開いている') viewingPile = undefined
    payState = undefined
    payReveal = undefined
    payScroll = undefined
  }

  const picking = (): Picking => ({
    mode,
    selection,
    onAim: (aim) => {
      selection = { ...selection, aim }
      redraw()
    },
    onCard: (card) => {
      // 同じカードをもう一度押したら、選ぶのをやめる。選び直したら、聞いた答えも捨てる。
      selection = selection.card === card ? {} : { card }
      redraw()
    },
    onDeck: () => {
      selection = selection.deck === true ? {} : { deck: true }
      redraw()
    },
    onCancel: () => {
      selection = {}
    },
    onDeselect: deselect,
    onMode: (next) => {
      mode = next
      selection = {}
      redraw()
    },
  })

  const duelInteraction = (): DuelInteraction => ({
    viewingPile,
    onOpenPile: (player, zone) => {
      viewingPile = { player, zone }
      listShown = undefined
      // コストの選択中に、払うカードがあるゾーンのボタンを押したなら、払う一覧にする。
      const stage = session.stage
      payState =
        stage.kind === '打っている' && stage.board !== undefined ? openPayList(stage.board, stage.choice, player, zone) : undefined
      payReveal = payState === undefined ? undefined : zone
      payScroll = undefined
      redraw()
    },
    onClosePile: () => {
      viewingPile = undefined
      dropPayList()
      redraw()
    },
    listShown,
    onListShow: (card, again) => {
      listShown = card
      if (again) redraw()
    },
    payState,
    // 答えは送るだけで、描き直さない（`onPickerAnswered` と同じ）。次の選択が続くかは、届いたもので決める。
    onPayAnswered: () => {
      settlePay({ kind: '答えた' })
    },
    onPayCancelled: () => {
      settlePay({ kind: 'やめた' })
    },
    pickerPicked,
    onPickerPick: (index) => {
      pickerPicked = index
      redraw()
    },
    // 答えは送るだけで、描き直さない。届いた返事（新しい盤面か選んでほしい）が redraw を呼ぶ
    // （`applyMessage` 経由）——ここで呼ぶと、答えが届く前の古い状態のまま一瞬描き直される。
    onPickerAnswered: () => {
      pickerPicked = undefined
    },
  })

  const naming = (): Naming => ({
    draft: nameDraft,
    onDraft: (value) => {
      // 描き直さない。入力欄の値はブラウザが持っている（`lobby` の `onName` と同じ）。
      nameDraft = value
    },
    onDecide: (name) => {
      nameDraft = name
      connection.send({ kind: '名前を決める', name })
    },
    takeRefusalArrived: () => {
      const arrived = nameRefusalArrived
      nameRefusalArrived = false

      return arrived
    },
  })

  /**
   * デッキを組むところ（#193）。**組みかけは、読み込み直す前のものから始める。**
   *
   * 開くまでは出さない。開いた時に組みかけがあれば、一覧を挟まずにその続きから組む。
   */
  let builder: Builder = closedBuilder(rememberedDraft())
  /** 確かめに行くのを待っているタイマー。待っていなければ `undefined`（`CHECK_DELAY_MS`）。 */
  let checkTimer: ReturnType<typeof setTimeout> | undefined

  /** 組むところを変える。組みかけが変わったなら覚え直す。 */
  const updateBuilder = (next: Builder): void => {
    if (next.draft !== builder.draft) rememberDraft(next.draft)
    builder = next
  }

  /**
   * 少し間を置いて、いまの組みかけを確かめに行く。**間を置いている間に組み替えたら、置き直す。**
   *
   * 使えないカードが入っている間は送らない。サーバは断るだけで、何が足りないかは分からない。
   */
  const scheduleCheck = (): void => {
    if (checkTimer !== undefined) clearTimeout(checkTimer)
    checkTimer = undefined
    const draft = builder.draft
    const pool = session.pool
    if (builder.screen !== 'デッキを組む' || draft === undefined || pool === undefined) return
    if (hasUnusableCards(pool, draft)) return

    checkTimer = setTimeout(() => {
      checkTimer = undefined
      const current = builder.draft
      if (builder.screen !== 'デッキを組む' || current === undefined) return

      connection.send({
        kind: 'デッキを確かめる',
        cards: current.cards,
        format: builder.rules.format,
        restriction: builder.rules.restriction,
      })
      updateBuilder({ ...builder, checking: builder.checking + 1 })
      redraw()
    }, CHECK_DELAY_MS)
  }

  /** 組み始める。一覧から開いた時も、読み込み直した続きから始める時も通る。 */
  const startEditing = (draft: DeckDraft): void => {
    updateBuilder(startedEditing(builder, draft))
    scheduleCheck()
    redraw()
  }

  /** 組みかけを変える。**描き直して、確かめに行く。** */
  const editCards = (change: (draft: DeckDraft) => DeckDraft): void => {
    if (builder.draft === undefined) return

    updateBuilder({ ...builder, draft: change(builder.draft), refusal: undefined })
    scheduleCheck()
    redraw()
  }

  /** ✏️ で打ち込んでいる名前を決める。空なら元の名前のまま。打ち込んでいなければ何もせず `false`。 */
  const commitEditingName = (name: string): boolean => {
    if (builder.editingName === undefined || builder.draft === undefined) return false

    const trimmed = name.trim()
    updateBuilder({
      ...builder,
      editingName: undefined,
      draft: { ...builder.draft, name: trimmed === '' ? builder.draft.name : trimmed },
    })
    return true
  }

  const building = (): DeckBuilding => ({
    builder,
    checking: checkTimer !== undefined || builder.checking > 0,
    onBuild:
      session.pool === undefined || session.ownedDecks === undefined
        ? undefined
        : () => {
            if (builder.draft !== undefined) return startEditing(builder.draft)

            updateBuilder({ ...builder, screen: 'デッキを選ぶ', refusal: undefined })
            redraw()
          },
    list: {
      onOpen: (id) => {
        const deck = session.ownedDecks?.find((each) => each.id === id)
        if (deck !== undefined) startEditing(draftOf(deck))
      },
      onNew: () => startEditing(newDraft()),
      onCopy: (preset) => {
        if (builder.waiting.kind !== '無し') return

        // コピーしたデッキが届いたら、そのまま組み始める（`deck-builder.ts` の `applyToBuilder`）。
        connection.send({ kind: 'デッキをコピーする', origin: { kind: '既製デッキ', id: preset } })
        updateBuilder({ ...builder, waiting: { kind: 'コピー' }, refusal: undefined })
        redraw()
      },
      onDuplicate: (id) => {
        // 自分のデッキを新しいデッキとして保存し直す（ADR-0028）。`デッキをコピーする` の
        // `DeckOrigin` は既製デッキ・共有レシピしか指せないので、`デッキを保存する` を
        // `deck` 無しで送る。届いたら「コピー」した時と同じくそのまま組み始める。
        // 使えないカードが入っているデッキはサーバが断るので、画面でも押せない形にしてある。
        if (builder.waiting.kind !== '無し') return
        const source = session.ownedDecks?.find((each) => each.id === id)
        if (source === undefined) return

        connection.send({
          kind: 'デッキを保存する',
          deck: undefined,
          name: duplicatedDeckName(source.name),
          description: source.description,
          cards: source.cards,
        })
        updateBuilder({ ...builder, waiting: { kind: 'コピー' }, refusal: undefined })
        redraw()
      },
      onShare: (id) => {
        // 共有できるのは保存してあるデッキだけである（ADR-0022）。デッキ一覧の各デッキから開く
        // （ADR-0028。組むところの帯からは外した）。
        const deck = session.ownedDecks?.find((each) => each.id === id)
        if (deck === undefined) return

        updateBuilder({ ...builder, sharing: { kind: '打ち込み中', draft: shareDraftOf(deck), sending: false, refusal: undefined } })
        redraw()
      },
      onDelete: (deck, name) => {
        // **消したデッキは戻らない。** 押し間違いで消えないように尋ねる。消すのは答えてから。
        updateBuilder({ ...builder, confirming: { kind: 'デッキを消す', deck, name }, refusal: undefined })
        redraw()
      },
      onClose: () => {
        updateBuilder({ ...builder, screen: '閉じている', refusal: undefined })
        redraw()
      },
      onMyShares: () => {
        // 自分の共有は繋いだ時から届いている（`server` の `serve.ts`）ので、尋ね直さずに出す。
        updateBuilder({ ...builder, screen: '自分の共有', refusal: undefined })
        redraw()
      },
      onRecipeList: () => requestRecipeList(builder.recipeOrder),
      onSearch: (deckSearch) => {
        updateBuilder({ ...builder, deckSearch })
        redraw()
      },
      onColorFilter: (deckColorFilter) => {
        updateBuilder({ ...builder, deckColorFilter })
        redraw()
      },
      onLabelFilter: (deckLabelFilter) => {
        updateBuilder({ ...builder, deckLabelFilter })
        redraw()
      },
    },
    editor: {
      onEditNameStart: () => {
        if (builder.draft === undefined) return
        updateBuilder({ ...builder, editingName: builder.draft.name })
        redraw()
      },
      onEditName: (name) => {
        // 描き直さない。入力欄の値はブラウザが持っている（`onDescription` と同じ）。
        if (builder.editingName !== undefined) updateBuilder({ ...builder, editingName: name })
      },
      onEditNameCommit: (name) => {
        if (commitEditingName(name)) redraw()
      },
      onEditNameLeave: (name) => {
        if (!commitEditingName(name)) return

        // 欄を離れたのは、ほかのボタンを押したからかもしれない。ここで描き直すとそのボタンが click
        // の前に作り直され、押したことが消える。押したボタンの操作はいま決めた名前を読み、自分で
        // 描き直すので、こちらはその後に回す。マウスでは押している最中（mousedown）に離れるので
        // 手を離すまで待つ。タッチでは pointerup の後に離れ、click は同じ流れで続けて届くので、
        // 1 拍おけば足りる。
        if (pointerHeld) redrawOnRelease = true
        else setTimeout(redraw, 0)
      },
      onEditNameCancel: () => {
        updateBuilder({ ...builder, editingName: undefined })
        redraw()
      },
      onDescription: (description) => {
        // 描き直さない。解説の窓の入力欄の値はブラウザが持っている（`lobby` の `onName` と同じ）。
        if (builder.draft !== undefined) updateBuilder({ ...builder, draft: { ...builder.draft, description } })
      },
      onOpenModal: (modal) => {
        updateBuilder({ ...builder, modal })
        redraw()
      },
      onCloseModal: () => {
        // 解説の窓を閉じた時に、打ち込んだ内容を帯の「保存していない変更」に反映する。
        updateBuilder({ ...builder, modal: undefined })
        redraw()
      },
      onAdd: (key) => editCards((draft) => withCard(draft, key)),
      onRemove: (key) => editCards((draft) => withoutCard(draft, key)),
      onFormat: (format) => {
        updateBuilder({ ...builder, rules: { ...builder.rules, format } })
        scheduleCheck()
        redraw()
      },
      onRestriction: (restriction) => {
        updateBuilder({ ...builder, rules: { ...builder.rules, restriction } })
        scheduleCheck()
        redraw()
      },
      onPin: (key) => {
        updateBuilder({ ...builder, pinned: builder.pinned === key ? undefined : key })
        redraw()
      },
      onSave: () => {
        const draft = builder.draft
        const owned = session.ownedDecks
        if (draft === undefined || owned === undefined || builder.waiting.kind !== '無し') return

        const sending = draftToSave(draft, owned)
        connection.send({ kind: 'デッキを保存する', ...sending })
        updateBuilder({ ...builder, draft: sending, waiting: { kind: '保存', sent: sending }, refusal: undefined })
        redraw()
      },
      onFilter: (filter) => {
        // 一覧が変わるので、先頭から見せる。**打ち込んでいる手は `draw` が戻す。**
        updateBuilder({ ...builder, filter, poolShown: POOL_BATCH[builder.poolView] })
        redraw()
        const list = root.querySelector<HTMLElement>(`[data-keep-scroll="プール"]`)
        if (list !== null) list.scrollTop = 0
      },
      onFilterOpen: (filterOpen) => {
        updateBuilder({ ...builder, filterOpen })
        redraw()
      },
      onToggleFold: (key, open) => {
        // 描き直しで開いた状態を入れ直したときにも届く。覚えている開閉と同じなら何もしない。
        if (builder.openFilterFolds.has(key) === open) return
        const folds = new Set(builder.openFilterFolds)
        if (open) folds.add(key)
        else folds.delete(key)
        // 描き直さない。<details> の開閉はブラウザがすでに反映している。
        updateBuilder({ ...builder, openFilterFolds: folds })
      },
      onPoolView: (poolView) => {
        updateBuilder({ ...builder, poolView, poolShown: POOL_BATCH[poolView] })
        redraw()
        const list = root.querySelector<HTMLElement>(`[data-keep-scroll="プール"]`)
        if (list !== null) {
          list.scrollTop = 0
          list.scrollLeft = 0
        }
      },
      onShowMorePool: () => {
        updateBuilder({ ...builder, poolShown: builder.poolShown + POOL_BATCH[builder.poolView] })
        redraw()
      },
      onToggleDetail: () => {
        // 描き直さない。開閉は render.ts が押した場で class を直接切り替えている。
        updateBuilder({ ...builder, detailOpen: !builder.detailOpen })
      },
      onBack: () => {
        const draft = builder.draft
        const owned = session.ownedDecks ?? []
        if (draft === undefined || !hasUnsavedChanges(draft, owned)) return backToList()

        // **保存していない変更は、ここで捨てると戻らない。** 捨てるかどうかは人が決める。
        updateBuilder({ ...builder, confirming: { kind: '変更を捨てる' } })
        redraw()
      },
    },
    confirm: {
      onConfirm: () => {
        const confirming = builder.confirming
        updateBuilder({ ...builder, confirming: undefined })
        if (confirming?.kind === 'デッキを消す') {
          connection.send({ kind: 'デッキを消す', deck: confirming.deck })
          redraw()
        }
        if (confirming?.kind === '変更を捨てる') backToList()
        if (confirming?.kind === '共有を取り消す') {
          connection.send({ kind: '共有を取り消す', share: confirming.share })
          redraw()
        }
      },
      onCancel: () => {
        updateBuilder({ ...builder, confirming: undefined })
        redraw()
      },
    },
    sharing:
      builder.sharing === undefined
        ? undefined
        : {
            onName: (name) => {
              if (builder.sharing?.kind === '打ち込み中') {
                updateBuilder({ ...builder, sharing: { ...builder.sharing, draft: { ...builder.sharing.draft, name } } })
              }
            },
            onDescription: (description) => {
              if (builder.sharing?.kind === '打ち込み中') {
                updateBuilder({
                  ...builder,
                  sharing: { ...builder.sharing, draft: { ...builder.sharing.draft, description } },
                })
              }
            },
            onVisibility: (visibility) => {
              if (builder.sharing?.kind !== '打ち込み中') return
              updateBuilder({ ...builder, sharing: { ...builder.sharing, draft: { ...builder.sharing.draft, visibility } } })
              redraw()
            },
            onFormat: (format) => {
              if (builder.sharing?.kind !== '打ち込み中') return
              updateBuilder({ ...builder, sharing: { ...builder.sharing, draft: { ...builder.sharing.draft, format } } })
              redraw()
            },
            onRestriction: (restriction) => {
              if (builder.sharing?.kind !== '打ち込み中') return
              updateBuilder({
                ...builder,
                sharing: { ...builder.sharing, draft: { ...builder.sharing.draft, restriction } },
              })
              redraw()
            },
            onShare: () => {
              const sharing = builder.sharing
              if (sharing?.kind !== '打ち込み中' || sharing.sending) return

              connection.send({ kind: 'デッキを共有する', ...sharing.draft })
              updateBuilder({ ...builder, sharing: { ...sharing, sending: true, refusal: undefined } })
              redraw()
            },
            onCopyLink: copyLink,
            onClose: () => {
              updateBuilder({ ...builder, sharing: undefined })
              redraw()
            },
          },
    myShares: {
      onVisibility: (share, visibility) => connection.send({ kind: '共有の公開範囲を変える', share, visibility }),
      onRevoke: (share, name) => {
        // **取り消すと元に戻らない。** 押し間違いで消えないように尋ねる。
        updateBuilder({ ...builder, confirming: { kind: '共有を取り消す', share, name } })
        redraw()
      },
      onCopyLink: copyLink,
      onClose: () => {
        updateBuilder({ ...builder, screen: 'デッキを選ぶ', refusal: undefined })
        redraw()
      },
    },
    recipeList: {
      onOrder: requestRecipeList,
      onOpen: (key) => openRecipe(key, true),
      onClose: () => {
        updateBuilder({ ...builder, screen: 'デッキを選ぶ', refusal: undefined })
        redraw()
      },
    },
    recipeView: {
      onCopy: (share) => {
        if (builder.waiting.kind !== '無し') return

        // コピーしたレシピが届いたら、既製デッキのコピーと同じくそのまま組み始める
        // （`deck-builder.ts` の `applyToBuilder`）。
        connection.send({ kind: 'デッキをコピーする', origin: { kind: '共有レシピ', share } })
        updateBuilder({ ...builder, waiting: { kind: 'コピー' }, refusal: undefined })
        redraw()
      },
      onClose: closeRecipeScreens,
    },
  })

  /** 組みかけを捨てて、デッキの一覧に戻る。 */
  function backToList(): void {
    if (checkTimer !== undefined) clearTimeout(checkTimer)
    checkTimer = undefined
    updateBuilder({
      ...builder,
      screen: 'デッキを選ぶ',
      draft: undefined,
      pinned: undefined,
      refusal: undefined,
      modal: undefined,
      editingName: undefined,
    })
    redraw()
  }

  /**
   * リンクをコピーする（ADR-0022）。組み立てるのは呼ぶ側（`recipe.ts` の `shareLinkOf`）——
   * ここはブラウザに渡すだけである。
   *
   * コピーの手立てが無い（対応していないブラウザ、`https` でない）場合は諦める。押した人には
   * 画面に出ている値が見えているので、選んで自分でコピーできる。
   */
  function copyLink(link: string): void {
    void navigator.clipboard?.writeText(link).catch(() => {
      // コピーできなくても、リンクは画面に出ている。
    })
  }

  /**
   * レシピの画面を開く（ADR-0022、`/recipe/<鍵>`）。
   *
   * `pushUrl` は、画面の中で移動した時だけ真にする——URL を直に開いて始まった時は、すでにそこを
   * 指しているので揃え直さない。
   */
  function openRecipe(key: RecipeKey, pushUrl: boolean): void {
    updateBuilder({ ...builder, screen: 'レシピ', viewingRecipe: key, viewingRecipeLoading: true, refusal: undefined })
    connection.send({ kind: 'レシピを見る', recipe: key })
    if (pushUrl) {
      try {
        // **問い合わせ文字列（`location.search`）は残す。** `?server=`・`?participant=` は README
        // が現役の手段として案内している値で、落とすと開いて閉じた後の読み込み直しで消える。
        history.pushState(null, '', recipeUrlOf(key, location.search))
      } catch {
        // URL を揃えられなくても、開くことはできる。
      }
    }
    redraw()
  }

  /** レシピにまつわる画面を出て、デッキの一覧に戻る。開いていた URL も戻す。 */
  function closeRecipeScreens(): void {
    updateBuilder({ ...builder, screen: 'デッキを選ぶ', viewingRecipe: undefined, refusal: undefined })
    // **`/recipe/<鍵>` を直に開いていた時だけ戻す。** ほかの場所から来ていれば、URL は元から
    // 触っていない。
    if (location.pathname.startsWith('/recipe/')) {
      try {
        history.replaceState(null, '', closedRecipeUrlOf(location.search))
      } catch {
        // 戻せなくても、画面を閉じることはできる。
      }
    }
    redraw()
  }

  /**
   * ブラウザの「戻る」に応じて、いま出す画面を URL に合わせ直す（ADR-0022）。
   *
   * **一覧からレシピを開いた時にだけ URL を積む**（`recipeList.onOpen` の `openRecipe(key, true)`）
   * ので、戻る先が `/recipe/<鍵>` でなくなったら、開いた元の画面（一覧）へ戻す。**戻る操作その
   * ものに URL は積み直さない**——ブラウザがすでに動かしている。
   */
  function onPopState(): void {
    const key = recipeKeyFromPath(location.pathname)
    if (key !== undefined) {
      openRecipe(key, false)
      return
    }
    if (builder.screen === 'レシピ') {
      updateBuilder({ ...builder, screen: 'レシピの一覧', viewingRecipe: undefined, refusal: undefined })
      redraw()
    }
  }

  /** 一覧を、選んだ並べ方で尋ね直す（ADR-0022）。 */
  function requestRecipeList(order: RecipeListOrder): void {
    updateBuilder({ ...builder, screen: 'レシピの一覧', recipeOrder: order, refusal: undefined })
    connection.send({ kind: 'レシピの一覧を見る', order })
    redraw()
  }

  /**
   * サーバへ送る、選んでいるデッキ。画面に出している選択と揃える（`deck-builder.ts` の `sentChoice`）。
   * 選べないデッキ（自分のデッキは使えないカードが入っているもの、CPU のデッキはそれに加えてルールに
   * 合わないもの）は、選んだままなら、選んでいないものとして送る（ADR-0029）。ルールに合わない自分のデッキは
   * 選べるので、選んでいればそのまま送る。
   */
  const sentDeck = (picked: DeckId | undefined, choosable?: (deck: LobbyDeck) => boolean): DeckId | undefined => {
    const stage = session.stage

    const presets = stage.kind === 'ロビー' ? stage.presets : []
    const restrictions = stage.kind === 'ロビー' ? stage.restrictions : []
    // 画面に出している選択と同じ判定で揃える。
    const judged = judgedRulesOf({ format: chosenFormat, restriction: chosenRestriction }, restrictions)

    return sentChoice(lobbyDecks(session.pool, session.ownedDecks, presets, judged), picked, choosable)
  }

  /**
   * ロビーの見え方の状態を、いま画面に出るものに合わせる（ADR-0029）。描く前に呼ぶ——`draw` は読むだけにする。
   *
   * - ロビーを出していない間は、開いている「…」を閉じる。切断・繋ぎ直して部屋へ戻る・「デッキ一覧」を開く
   *   でロビーを離れても、戻った時に同じメニューが開いたままにならない。
   * - ページの番号は、描く時に収まる範囲（`pagedOf`）の値を覚え直す。覚え直さないと、範囲外になったあと
   *   件数が増えた時に、急に別のページへ飛ぶ。
   */
  const settleLobbyView = (): void => {
    const stage = session.stage
    if (stage.kind !== 'ロビー' || !lobbyIsShown(session, link, builder)) {
      lobbyMenu = undefined
      return
    }

    lobbyDeckPage = pagedOf(seatableDecks(session.ownedDecks, stage.presets), lobbyDeckPage, DECKS_PER_PAGE).page
    lobbyRoomPage = roomListView(lobbyView(stage.rooms), lobbyRoomTab, lobbyRoomQuery, lobbyRoomPage).paged.page
  }

  /**
   * スマートフォンの状態を、いま画面に出るものに合わせる（ADR-0034）。画面を離れたら、開いていたシートや
   * 畳んだ欄の開閉を最初に戻す。描く前に呼ぶ——`draw` は読むだけにする。
   */
  const settlePhoneView = (): void => {
    const stage = session.stage
    const loaded = session.pool !== undefined && session.ownedDecks !== undefined
    const builderOpen = stage.kind === 'ロビー' && link.kind === '繋がっている' && builder.screen !== '閉じている' && loaded
    const board = stage.kind === '打っている' ? stage.board : undefined
    phoneState = settlePhone(phoneState, {
      lobby: lobbyIsShown(session, link, builder),
      deckList: builderOpen && builder.screen === 'デッキを選ぶ',
      editor: builderOpen && builder.screen === 'デッキを組む' && builder.draft !== undefined,
      duel: board !== undefined,
    })
    // 詳細を見ているカードが盤面から見えなくなった（手札に戻って裏向きになった、など）なら、閉じる。
    if (phoneState.viewedCard !== undefined && (board === undefined || !visibleCardViewsIn(board).has(phoneState.viewedCard.card))) {
      phoneState = reducePhone(phoneState, { kind: '対戦のカードを閉じる' })
    }
  }

  /** 描き直しに渡す窓口。押した動きで状態を進め、描き直す。 */
  const phoneControl = (): PhoneControl => ({
    state: phoneState,
    send: (action) => {
      phoneState = reducePhone(phoneState, action)
      redraw()
    },
    settle: (action) => {
      phoneState = reducePhone(phoneState, action)
    },
  })

  const lobby = (): Lobby => ({
    name: roomName,
    deck: chosenDeck,
    cpuDeck: chosenCpuDeck,
    rules: { format: chosenFormat, restriction: chosenRestriction },
    deckPage: lobbyDeckPage,
    menu: lobbyMenu,
    roomTab: lobbyRoomTab,
    roomQuery: lobbyRoomQuery,
    roomPage: lobbyRoomPage,
    onDeckPage: (page) => {
      lobbyDeckPage = page
      lobbyMenu = undefined
      redraw()
    },
    onMenu: (deck) => {
      lobbyMenu = deck
      redraw()
    },
    onRoomTab: (tab) => {
      lobbyRoomTab = tab
      lobbyRoomPage = 0
      redraw()
    },
    onRoomQuery: (query) => {
      lobbyRoomQuery = query
      lobbyRoomPage = 0
      redraw()
    },
    onRoomPage: (page) => {
      lobbyRoomPage = page
      redraw()
    },
    onName: (name) => {
      // 描き直さない。入力欄の値はブラウザが持っていて、覚えるのは描き直しに備えるためである。
      roomName = name
    },
    onDeck: (deck) => {
      // 押して選ぶ行（`render.ts` の `deckRowElement`）は、選んだ印を描き直して出す。
      chosenDeck = deck
      redraw()
    },
    onCpuDeck: (deck) => {
      chosenCpuDeck = deck
      revealCpuDeck = true
      redraw()
    },
    onFormat: (format) => {
      chosenFormat = format
      // 選んだルールに合わない CPU のデッキと、押せない手の理由が変わるので、描き直す（ADR-0029）。
      redraw()
    },
    onRestriction: (restriction) => {
      chosenRestriction = restriction
      redraw()
    },
    onCreate: (name, against) => {
      // 合言葉を決めるのはサーバなので、入る先はここで決められない（#175）。届いてから分かる。
      pendingRoom = undefined
      lobbyMenu = undefined
      connection.send({
        kind: '部屋を作る',
        name,
        against,
        deck: sentDeck(chosenDeck),
        cpuDeck: sentDeck(chosenCpuDeck, isCpuChoosable),
        format: chosenFormat,
        restriction: chosenRestriction,
      })
    },
    onJoin: (code) => {
      pendingRoom = code
      lobbyMenu = undefined
      connection.send({ kind: '部屋に入る', room: code, deck: sentDeck(chosenDeck) })
    },
    onLeave: () => {
      pendingRoom = undefined
      connection.send({ kind: 'ロビーに戻る' })
    },
  })

  /**
   * 描き直す。**組み立てられなくても、白い画面にしない。**
   *
   * `draw` は組み立てる前に中身を捨てる（`replaceChildren`）ので、途中で投げると何も無い画面が
   * 残る。**何が起きたか読めないまま止まるのが一番重い**（#175 が繋がりについて書いたのと同じ
   * ことである）。届いたものが思っていた形と違うことは起こりうる——画面とサーバは別々に配られ、
   * 同時には入れ替わらない（ADR-0013、ADR-0015）。
   */
  const redraw = (): void => {
    // 変換中は描き直さない（すべての入力欄が対象）。作り直した欄は、変換中の文字を持たない。
    // ほかの人の操作による切り替わり（切断の表示など）も、例外なく待つ。確定したら 1 回描き直す
    // （`onCompositionEnd`）。変換が終わらないまま手が欄を離れた時（`compositionend` が来なかった時）に
    // 画面が止まらないよう、手が入力欄に無ければ、変換中とは見なさない。
    const active = document.activeElement
    const typingInField = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
    if (composing && typingInField) {
      redrawAfterComposition = true
      return
    }
    composing = false
    redrawAfterComposition = false
    try {
      settleLobbyView()
      settlePhoneView()
      // 手の置き直しは 1 度だけ。幅が PC のときは、状態を持っていても渡さず、使いもしない——取り出して捨てることもしない。
      let pending: PhonePending | undefined
      let scroll: PhoneScroll | undefined
      if (isPhoneWidth()) {
        const taken = takePending(phoneState)
        pending = taken.pending
        const scrolled = takeScroll(taken.state)
        phoneState = scrolled.state
        scroll = scrolled.scroll
      }
      const phone: PhoneControl | undefined = isPhoneWidth() ? phoneControl() : undefined
      draw(root, session, link, connection, overlay, picking(), lobby(), naming(), building(), duelInteraction(), phone, pending)
      // デッキ構築のタブを替えたあとのページのスクロール。描いて高さが決まってから置く。
      settlePhoneScroll(root, scroll)
      // 対戦画面の盤面を画面に合わせて縮め、捨札・リムーブのつまみの縦の位置を合わせる。描いて高さが決まってから測る。
      // 操作の帯の高さが描き直さずに変わったときも、測り直す。描き直すたびに新しい帯へ付け直す。
      stopWatchingControls()
      stopWatchingControls = () => undefined
      if (phone !== undefined) {
        settlePhoneBoard(root)
        stopWatchingControls = watchControls(root, () => {
          if (isPhoneWidth()) settlePhoneBoard(root)
        })
      }
      // 払う一覧を開いた直後は、押した方のゾーンの見出しが見える位置から出す。開き直したときは、前の位置へ戻す。
      if (payScroll !== undefined) {
        const top = payScroll
        payScroll = undefined
        payReveal = undefined
        const area = root.querySelector<HTMLElement>('.picker__zones')
        if (area !== null) area.scrollTop = top
      } else if (payReveal !== undefined) {
        const zone = payReveal
        payReveal = undefined
        revealPayZone(root, zone)
      }
      // 描いたあとに送る。先に送ると、`draw` が戻すスクロールの位置で上書きされる。
      if (revealCpuDeck) {
        revealCpuDeck = false
        revealPickedCpuDeck(root)
      }
    } catch (error) {
      console.error('画面を組み立てられませんでした:', error)
      root.replaceChildren(line('status', '画面を組み立てられませんでした。ページを再読み込みしてください'))
    }
  }

  /**
   * 待ち行列の先頭を出す。無ければ消える。呼ぶたびにタイマーを 1 つだけ張る。
   *
   * 出しておく長さは、後ろで待っている件数で決まる（`view-model.ts` の `overlayDurationMs`）。
   * 演出の間は打てない（#115）ので、溜まった分をそのままの長さで出すと待ち時間になる。
   */
  function showNextOverlay(): void {
    const [next, ...rest] = queue
    queue = rest
    overlay = next ?? EMPTY_OVERLAY
    if (next === undefined) return

    overlayTimer = setTimeout(() => {
      overlayTimer = undefined
      showNextOverlay()
      redraw()
    }, overlayDurationMs(queue.length))
  }

  /** 新しく届いた分を待ち行列に足す。何も出ていなければ、その場で出し始める。 */
  function enqueueOverlays(): void {
    const stage = session.stage
    if (stage.kind !== '打っている' || stage.fresh === lastFresh) return
    lastFresh = stage.fresh
    if (stage.board === undefined) return

    const transitions = transitionViews(stage.fresh, stage.board)
    const cutIns = cutInViews(stage.board, stage.fresh)
    if (transitions.length === 0 && cutIns.length === 0) return

    queue = [...queue, { transitions, cutIns }]
    if (overlayTimer === undefined) showNextOverlay()
  }

  /** 一度でも断られずに何かが届いたか。ログインへ送ったことを忘れるのは一度でよい。 */
  let signedIn = false

  const connection: Connection = connect({
    url: options.url,
    participant: options.participant,
    // 繋ぎ直した時に入り直す先。ロビーにいるなら何も送らない（ADR-0016、#175）。
    rejoining: () => roomOf(session) ?? pendingRoom,
    onMessage: (message) => {
      // ログインが要るなら、ログインへ送る（ADR-0019）。
      //
      // **送る前に繋ぎ直しを止める。** サーバは断ったあと接続を閉じるので、止めずにおくと
      // `connection.ts` がそれを切れたものとして扱い、**Google へ移るまでの間に「繋がりが
      // 切れました。繋ぎ直しています」を出す。** 断られたのは繋がったうえでのことなので、
      // 繋ぎ直しても同じ理由で断られる。送らなかった場合も止めるのは同じ理由である。
      if (message.kind === '行えなかった' && message.reason === NOT_SIGNED_IN) {
        connection.close()
        // **開こうとしていたレシピがあれば、ログインへ送る前に預ける**（ADR-0022）。ログインは
        // 別ページ（Google の画面）を経由するので、この画面の JS のメモリ（`pendingRecipe`）は
        // 戻ってきた時には残っていない。`main.ts` が戻ってきたところで拾う。
        if (pendingRecipe !== undefined) rememberPendingRecipe(sessionStorage, pendingRecipe)
        if (goToSignIn(options.signInUrl)) {
          // **移るまでの間、この画面は生きている。** 断られたことは出さない——人がすることは
          // 何も無く、次に起きることだけが読めればよい。
          root.replaceChildren(line('status', 'ログインへ移動しています'))
          return
        }
      } else if (!signedIn) {
        // 断られていないなら入れている。次にログインが要る場面で、また送れるようにしておく。
        signedIn = true
        forgetSignIn()
      }

      session = applyMessage(session, message, nameDraft)
      const wasEditing = builder.screen === 'デッキを組む'
      // コピー・複製の返事は、ロビーにいる時だけ組み始める（ADR-0029）。
      updateBuilder(applyToBuilder(builder, message, session.stage.kind === 'ロビー'))
      // コピーしたデッキが届いて組み始めたなら、そこから確かめる。
      if (!wasEditing && builder.screen === 'デッキを組む') scheduleCheck()
      // ロビーが届いたなら、どの部屋にもいない。入ろうとしていた先は残さない（#175）。
      if (session.stage.kind === 'ロビー' || message.kind === '行えなかった') pendingRoom = undefined
      // `/recipe/<鍵>` を直に開いていた時は、ロビーに着いたところで開く（ADR-0022）。名前を
      // 決める必要があれば（ADR-0020）、そちらが先に済んでからここへ来る。
      if (pendingRecipe !== undefined && session.stage.kind === 'ロビー') {
        const key = pendingRecipe
        pendingRecipe = undefined
        // ログインを持たない立て方では開けない（ADR-0022）。尋ねずに、開けない理由だけを出す
        // （`draw` が `session.pool` を見て決める）。
        const loading = session.pool !== undefined
        updateBuilder({ ...builder, screen: 'レシピ', viewingRecipe: key, viewingRecipeLoading: loading, refusal: undefined })
        if (loading) connection.send({ kind: 'レシピを見る', recipe: key })
      }
      // 名前を尋ねられたら、いま付いているものから打ち始められるようにする（ADR-0020）。
      // **打ち込みかけがあれば消さない。** 断られて尋ね直された時に、直そうとしていたものが
      // 消えてしまう。
      if (message.kind === '名前を決めてほしい' && nameDraft === '') nameDraft = message.current ?? ''
      if (message.kind === '名前を決めてほしい' && message.reason !== undefined) nameRefusalArrived = true
      // 行える手が入れ替わる時（盤面・選んでほしい・席についた）は、選びかけを捨てる（#94）。届いた
      // 手が変わると、選びかけの手がまだ行えるとは限らない。`相手の繋がり` のような、行える手を変えない
      // ものでは捨てない——ダイアログを読んでいる途中で閉じてしまう。
      if (message.kind === '盤面' || message.kind === '選んでほしい' || message.kind === '席についた') selection = {}
      // 「見る」「選ぶ」の状態は、席についた時点（入り直しを含む）で前の対局のものを持ち越さない。
      // 席は覚えているだけの値なので、次の対局で入れ替わると別の置き場を指してしまう（#207）。
      if (message.kind === '席についた') {
        viewingPile = undefined
        pickerPicked = undefined
        listShown = undefined
        dropPayList()
      }
      // 新しい選択が届いたら、選びかけの番号は前の選択のものなので捨てる。番号は選択ごとに
      // 振り直される（ADR-0008）ので、残すと範囲外や別の候補を指しうる。
      if (message.kind === '選んでほしい') {
        pickerPicked = undefined
        listShown = undefined
      }
      // 決着したら、どちらの状態も残さない。決着後は答えることも束を開くこともできる意味が
      // 無くなる（ADR-0010）うえ、次の対局に持ち越させないための重ねの備えでもある。
      if (message.kind === '盤面' && message.perspective.result !== undefined) {
        viewingPile = undefined
        pickerPicked = undefined
        listShown = undefined
        dropPayList()
      }
      // 払う一覧は、答えたあとの盤面でいったん閉じ、続く選択が一覧のゾーンの候補を含めば開き直す（ADR-0034）。
      // 盤面だけでは選択が続くか行動が終わったのか分からないので、待たずに、次に届くもので決める。
      // 候補が全部自分のエネルギー・スマッシュにある選択は、何も開いていなくても、届いた時点で払う一覧を開く
      // （スマートフォンの並べ方で、繋がっている間だけ）。
      const stage = session.stage
      if (payState !== undefined && stage.kind !== '打っている') dropPayList()
      else if (stage.kind === '打っている') {
        if (message.kind === '盤面') {
          if (payState !== undefined) {
            const scroll = root.querySelector<HTMLElement>('.picker__zones')?.scrollTop ?? 0
            settlePay({ kind: '盤面', actions: message.actions.length, scroll })
          }
        } else if (message.kind === '選んでほしい' && stage.board !== undefined) {
          settlePay({
            kind: '選んでほしい',
            board: stage.board,
            choice: message.choice,
            autoOpen: isPhoneWidth() && link.kind === '繋がっている',
          })
        } else if (message.kind === '行えなかった') settlePay({ kind: '断られた' })
      }
      // 開いている束が空になったら、見るものが無いので閉じる。払う一覧は、払い終えて空になるのを待たずに
      // 閉じるかどうかを上で決めている。
      if (
        viewingPile !== undefined &&
        payState === undefined &&
        session.stage.kind === '打っている' &&
        session.stage.board !== undefined &&
        session.stage.board.zones[viewingPile.player][viewingPile.zone].length === 0
      ) {
        viewingPile = undefined
      }
      enqueueOverlays()
      redraw()

      // 放棄しか行えない場面は押させずに送る。**描いてから送る**ので、進む前の盤面が一度は
      // 画面に出る。送った結果は次の盤面として届き、そこでまた同じ判断をする。
      //
      // **見るのは盤面が届いた時だけである。** 行える手が変わるのは盤面が届いた時だけ
      // （`session.ts`）で、ほかのものが届くたびに見ると、送った手が断られた（`行えなかった`）
      // 後にもう一度同じ手を送ることになり、断られ続ける。
      const automatic = message.kind === '盤面' ? automaticAction(session) : undefined
      if (automatic !== undefined) connection.send({ kind: '行動する', action: automatic })
    },
    onLinkChanged: (value) => {
      link = value
      // 切れたら、聞いている途中のダイアログは何も送らずに閉じる（#249）。繋ぎ直した先で、その手が
      // まだ行えるとは限らない（ADR-0016）。
      if (value.kind !== '繋がっている') {
        selection = {}
        // 繋ぎ直した先で、払っていた選択が続いているとは限らない。開き直す予定も残さない。
        dropPayList()
      }
      // **切れている間に送ったものは届いていない**（`connection.ts`）ので、返事も来ない。待つのを
      // やめて、繋がり直したら確かめ直す。組みかけは画面が持っているので消えない。
      if (value.kind !== '繋がっている') updateBuilder({ ...builder, waiting: { kind: '無し' }, checking: 0 })
      else scheduleCheck()
      redraw()
    },
  })

  const onPointerDown = (): void => {
    pointerHeld = true
  }
  const onPointerRelease = (): void => {
    pointerHeld = false
    if (!redrawOnRelease) return
    redrawOnRelease = false
    // click は pointerup の後に届く。押したボタンの操作が済んでから描き直す（押したのがボタンで
    // なければ、ここで初めて入力欄が消える）。
    setTimeout(redraw, 0)
  }

  // 変換の始まりと終わり。捕捉段で受ける——欄自身の `compositionend` の処理（確定した値で描き直す）が
  // 動く時には、すでに「変換中」が解けていなければ、その描き直しまで後に回ってしまう。
  const onCompositionStart = (): void => {
    composing = true
  }
  const onCompositionEnd = (): void => {
    composing = false
    if (!redrawAfterComposition) return

    // 欄自身の処理がこの後すぐ描き直すことがある。それで済めば（`redraw` が印を下ろす）、描き直さない。
    // `compositionend` の後に `input` が続くブラウザもあるので、1 拍おいてから見る。
    setTimeout(() => {
      if (redrawAfterComposition) redraw()
    }, 0)
  }

  // Esc は、ダイアログ・一覧が開いていれば、手がどこにあっても一番上の層の動きに回す（ADR-0033）。
  // 開いていなければ、選びかけを外す（#249）。何も選んでいなければ何もしない。
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    if (escapeTopLayer(root)) return
    // スマートフォンで開いているシート（ログ・行える手）があれば、それを閉じる。選びかけは外さない。
    if (isPhoneWidth() && phoneState.duelSheet !== undefined) {
      phoneState = reducePhone(phoneState, { kind: '対戦のシートを閉じる' })
      redraw()
      return
    }
    deselect()
  }

  // スマートフォンの幅と PC の幅を行き来したら、部品の出入りが変わるので描き直す（ADR-0034）。
  const phoneQuery = window.matchMedia(PHONE_WIDTH_QUERY)
  const onPhoneWidthChange = (): void => {
    // シートを開いたまま PC の幅を経て戻ったら、作り直したシートの中へ手を置き直す。
    if (isPhoneWidth()) phoneState = returnedToPhone(phoneState)
    redraw()
  }
  phoneQuery.addEventListener('change', onPhoneWidthChange)
  // 画面の大きさが変わったら、盤面を縮める率とつまみの位置を測り直す（描き直しは要らない）。
  const onResize = (): void => {
    if (isPhoneWidth()) settlePhoneBoard(root)
  }
  window.addEventListener('resize', onResize)
  // アドレスバーが出入りしても window の resize は届かないことがある。いま見えている高さ（visualViewport）の
  // 変わり方を見て、測り直す。
  window.visualViewport?.addEventListener('resize', onResize)
  // 手札に触れた指の下のカードを目立たせる（ADR-0034）。root に付けるので、描き直しても付いたまま。
  const unwireFinger = wireFingerOnHand(root, isPhoneWidth)

  redraw()
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('popstate', onPopState)
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('pointerup', onPointerRelease, true)
  window.addEventListener('pointercancel', onPointerRelease, true)
  window.addEventListener('compositionstart', onCompositionStart, true)
  window.addEventListener('compositionend', onCompositionEnd, true)

  return () => {
    if (overlayTimer !== undefined) clearTimeout(overlayTimer)
    if (checkTimer !== undefined) clearTimeout(checkTimer)
    dropPayList()
    phoneQuery.removeEventListener('change', onPhoneWidthChange)
    window.removeEventListener('resize', onResize)
    window.visualViewport?.removeEventListener('resize', onResize)
    stopWatchingControls()
    unwireFinger()
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('popstate', onPopState)
    window.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('pointerup', onPointerRelease, true)
    window.removeEventListener('pointercancel', onPointerRelease, true)
    window.removeEventListener('compositionstart', onCompositionStart, true)
    window.removeEventListener('compositionend', onCompositionEnd, true)
    connection.close()
  }
}
