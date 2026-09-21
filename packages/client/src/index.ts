import { MAX_ATTEMPTS, connect, connectingLink } from './connection.js'
import type { Connection, Link } from './connection.js'
import { NOT_SIGNED_IN, indexOfSquare } from '@revolution/engine'
import type {
  CardId,
  DeckId,
  DuelFormat,
  LoggedEvent,
  OpponentKind,
  RecipeKey,
  RecipeListOrder,
  RestrictionChoice,
  RoomCode,
} from '@revolution/engine'
import {
  applyToBuilder,
  cardDetailOf,
  checkView,
  closedBuilder,
  confirmView,
  deckRows,
  draftOf,
  draftToSave,
  hasUnsavedChanges,
  hasUnusableCards,
  newDraft,
  ownedDeckRows,
  poolRows,
  seatableDecks,
  seatedChoice,
  withCard,
  withoutCard,
} from './deck-builder.js'
import type { Builder, DeckDraft } from './deck-builder.js'
import { actionViews, automaticAction, choicePicking, choiceView, pickView } from './input-model.js'
import { filterChoicesOf, filterPool } from './pool-filter.js'
import { myShareRows, recipeCardRows, recipeLinkOf, recipePathOf, recipeSummaryRows, shareDraftOf, shareRowsOf } from './recipe.js'
import {
  KEEP_FOCUS,
  KEEP_SCROLL,
  actionsElement,
  boardElement,
  choiceElement,
  confirmElement,
  deckEditorElement,
  deckListElement,
  leaveElement,
  lobbyElement,
  myShareListElement,
  nameElement,
  overlayElement,
  pickElement,
  recipeElement,
  recipeListElement,
  shareDialogElement,
  waitingForOverlayElement,
} from './render.js'
import type {
  ChosenRules,
  DeckEditorHandlers,
  DeckListHandlers,
  MyShareHandlers,
  RecipeListHandlers,
  RecipeViewHandlers,
  ShareDialogHandlers,
} from './render.js'
import { applyMessage, connecting, roomOf } from './session.js'
import type { Session } from './session.js'
import {
  boardView,
  cutInViews,
  lobbyView,
  opponentLine,
  overlayDurationMs,
  priorityReason,
  showsOverlay,
  transitionViews,
} from './view-model.js'
import type { Overlay } from './view-model.js'

/**
 * クライアントの起動点。
 *
 * 受け取った盤面を描き、選んだものを送るだけで、**ルールの判断は持たない**（ADR-0010）。
 * 行える手はサーバが盤面と一緒に送る。
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
      return '相手を待っています。この部屋はロビーに出ているので、選んで入ってもらえます'
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

/** いま盤面をどう操作しているか。`card` は選びかけのカード。 */
interface Picking {
  readonly mode: PickMode
  readonly card: CardId | undefined
  readonly onCard: (card: CardId) => void
  /** 選びかけをやめる。 */
  readonly onCancel: () => void
  readonly onMode: (mode: PickMode) => void
}

/** 操作のしかたを切り替えるところ。 */
function modeElement(picking: Picking): HTMLElement {
  const node = document.createElement('div')
  node.className = 'mode'
  node.append(line('mode__label', '操作のしかた'))

  for (const mode of ['クリック', 'ボタン'] as const) {
    const button = document.createElement('button')
    button.className = `choice__button${picking.mode === mode ? ' choice__button--選択中' : ''}`
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
 * 描き直す前に打ち込んでいた入力欄の印（`render.ts` の `KEEP_FOCUS`）と、打っていた位置。
 * 打っていなければ `undefined`。
 */
interface Typing {
  readonly key: string
  readonly start: number | null
  readonly end: number | null
}

function typingIn(root: HTMLElement): Typing | undefined {
  const active = document.activeElement
  if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) || !root.contains(active)) {
    return undefined
  }
  const key = active.dataset[KEEP_FOCUS]
  if (key === undefined) return undefined

  // 数を打つ欄は、打っている位置を読めない（読むと投げるブラウザがある）。
  try {
    return { key, start: active.selectionStart, end: active.selectionEnd }
  } catch {
    return { key, start: null, end: null }
  }
}

/** 作り直した入力欄に、打っていた人の手を戻す。 */
function restoreTyping(root: HTMLElement, typing: Typing | undefined): void {
  if (typing === undefined) return

  for (const node of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-keep-focus]')) {
    if (node.dataset[KEEP_FOCUS] !== typing.key) continue

    node.focus()
    try {
      if (typing.start !== null && typing.end !== null) node.setSelectionRange(typing.start, typing.end)
    } catch {
      // 位置を置けない欄（数を打つ欄）は、手を戻すだけにする。
    }
    return
  }
}

/**
 * 印（`render.ts` の `KEEP_SCROLL`）の付いた一覧の、スクロールした位置。描き直した後に戻す。
 *
 * **一覧を丸ごと作り直す**ので、位置は要素と一緒に消える。印の値で、作り直した後の要素と結び付ける。
 */
function scrollPositions(root: HTMLElement): ReadonlyMap<string, number> {
  const positions = new Map<string, number>()
  for (const node of root.querySelectorAll<HTMLElement>('[data-keep-scroll]')) {
    const key = node.dataset[KEEP_SCROLL]
    if (key !== undefined) positions.set(key, node.scrollTop)
  }

  return positions
}

function restoreScroll(root: HTMLElement, positions: ReadonlyMap<string, number>): void {
  for (const node of root.querySelectorAll<HTMLElement>('[data-keep-scroll]')) {
    const top = positions.get(node.dataset[KEEP_SCROLL] ?? '')
    if (top !== undefined) node.scrollTop = top
  }
}

/**
 * 操作するところをひとまとめにする器（#128）。
 *
 * 盤面より上に置き、スクロールしても見えたままにする（`style.css` の `.controls`）。**中身は
 * 場面で入れ替わるが、置き場所は変わらない。** 盤面は 2 人ぶんのゾーンとスクエアで縦に長く、
 * 手が下にあると打つたびに往復することになる。見て確かめるのが盤面で、打つのがここである。
 */
function controls(): HTMLElement {
  const node = document.createElement('div')
  node.className = 'controls'

  return node
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
): void {
  // 打ち込みかけの場所は描き直すと消える。打っていた人には返す（`lobbyElement`）。
  const typing = document.activeElement?.classList.contains('lobby__name') === true
  const typingName = document.activeElement?.classList.contains('naming__input') === true
  const typingDeck = typingIn(root)
  const scrolled = scrollPositions(root)
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
    root.append(
      nameElement(naming.draft, stage.reason, { onDraft: naming.onDraft, onDecide: naming.onDecide }, typingName),
    )
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
    root.append(
      deckListElement(
        ownedDeckRows(owned),
        stage.presets,
        builder.waiting.kind !== '無し',
        builder.refusal,
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
          description: draft.description,
          count: draft.cards.length,
          unsaved: hasUnsavedChanges(draft, owned),
          savable: builder.waiting.kind === '無し' && !hasUnusableCards(pool, draft),
          check: checkView(draft, building.checking, session.checked, pool),
          // 絞り込むのはプールの一覧だけである。デッキに入っているカードは、条件に合わなくても出す。
          pool: poolRows(filterPool(pool, builder.filter), draft),
          poolTotal: pool.length,
          filter: builder.filter,
          filterChoices: filterChoicesOf(pool),
          filterOpen: builder.filterOpen,
          deck: deckRows(pool, draft),
          detail: (key) => cardDetailOf(pool, key),
          pinned: builder.pinned,
          restrictions: stage.restrictions,
          rules: builder.rules,
          refusal: builder.refusal,
          // 共有できるのは保存してあるデッキだけである（ADR-0022）。まだ無い識別子は渡せない。
          canShare: draft.deck !== undefined,
        },
        building.editor,
      ),
    )
  }

  // 自分が出した共有を並べるところ（ADR-0022）。繋いだ時から届いているので、尋ね直さない。
  if (builderOpen && builder.screen === '自分の共有') {
    root.append(
      myShareListElement(myShareRows(session.myShares ?? []), (recipe) => recipeLinkOf(location.origin, recipe), building.myShares),
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
      root.append(leaveElement('ロビーに戻る', building.recipeView.onClose))
    } else if (view.recipe === undefined) {
      // 鍵を知らない場合と、共有が 1 つも残っていない場合の両方がここに来る（ADR-0022）。
      root.append(line('status', 'このレシピは開けません'))
      root.append(leaveElement('ロビーに戻る', building.recipeView.onClose))
    } else {
      root.append(
        recipeElement(recipeCardRows(pool, view.recipe.cards), shareRowsOf(view.recipe), builder.waiting.kind !== '無し', building.recipeView),
      )
    }
  }

  // 尋ねている間は、組むところの上に重ねる。**ブラウザの確認ダイアログは使わない**（`confirmElement`）。
  if (builderOpen && builder.confirming !== undefined) {
    root.append(confirmElement(confirmView(builder.confirming), building.confirm.onConfirm, building.confirm.onCancel))
  }

  // 共有するダイアログも、同じく画面の中に重ねる（ADR-0022）。
  if (builderOpen && builder.sharing !== undefined && building.sharing !== undefined) {
    const sharing = builder.sharing
    root.append(
      shareDialogElement(
        sharing,
        stage.restrictions,
        sharing.kind === '共有した' ? recipeLinkOf(location.origin, sharing.share.recipe) : undefined,
        building.sharing,
      ),
    )
  }

  // ロビーは繋がっている間だけ出す。作る・入るは送らないと何も起きないので、押せる形で出さない。
  if (stage.kind === 'ロビー' && connected && !builderOpen && !viewingRecipeWithoutLogin) {
    // **席に着くのに選ぶのは自分のデッキである**（ADR-0021、#194）。既製デッキはデッキを組む
    // ところでコピーしてから使う。**デッキを持てない立て方でだけ、既製デッキがここに並ぶ。**
    const seatable = seatableDecks(session.ownedDecks, stage.presets)
    root.append(
      lobbyElement(
        lobbyView(stage.rooms),
        lobby.name,
        seatable,
        // 選んでいなければ、サーバが決めた既定を選んだ状態で出す。**どれを既定にするかを決めるのは
        // サーバである**（ADR-0010）——前に選んだものが残っているかを見るのもそちらで、ここは
        // もう無いデッキを選んだ状態にしないだけである。
        seatedChoice(seatable, lobby.deck, stage.chosen),
        // CPU の席に座らせるデッキも、選べるのは同じ棚である（#195）。
        seatedChoice(seatable, lobby.cpuDeck, stage.cpuChosen),
        stage.restrictions,
        lobby.rules,
        {
          onCreate: lobby.onCreate,
          onJoin: lobby.onJoin,
          onName: lobby.onName,
          onDeck: lobby.onDeck,
          onCpuDeck: lobby.onCpuDeck,
          onFormat: lobby.onFormat,
          onRestriction: lobby.onRestriction,
          ...(building.onBuild === undefined ? {} : { onBuild: building.onBuild }),
        },
        typing,
      ),
    )
  }

  // 待っている間は、やめて戻れる。相手が来ないまま閉じ込められない（#175）。
  if (stage.kind === '相手を待っている' && connected) {
    root.append(leaveElement('やめてロビーに戻る', lobby.onLeave))
  }

  if (stage.kind === '打っている' && stage.board !== undefined) {
    const board = stage.board
    // 演出が出ている間は手を送れない（#115）ので、盤面の上でも押せなくする。
    const clicking = connected && picking.mode === 'クリック' && !showsOverlay(overlay)
    const view =
      clicking && stage.choice === undefined
        ? pickView(board, stage.actions, picking.card, stage.passOutcome)
        : undefined
    // 選ぶのを待たれている間は、盤面に出ている候補を盤面から押せるようにする（#94）。答えるのは
    // 番号のままで、押したところがどの番号かは `choicePicking` が持っている。
    const answering = clicking && stage.choice !== undefined ? choicePicking(board, stage.choice) : undefined
    const answer = (found: number | undefined): void => {
      if (found !== undefined) connection.send({ kind: '選ぶ', answer: found })
    }
    const boardData = boardView(board)
    const boardNode = boardElement(
      boardData,
      view !== undefined
        ? {
            pickable: view.pickable,
            picked: view.picked,
            squares: view.destinations,
            onCard: (card) => picking.onCard(card),
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
              onSquare: (square) => answer(answering.answerOfSquare(square)),
              onHidden: (at) => answer(answering.answerOfHidden(at)),
            }
          : undefined,
    )

    const controlArea = controls()
    // どのフェイズの誰の優先権かは、打つ前に見るものなので操作するところの一番上に置く。
    controlArea.append(line('controls__turn', boardData.turn))
    // 誰と打っているか（ADR-0020）。**上には置かない**——部屋が続く限り変わらないもので、毎手
    // 見るのは優先権のほうである。盤面の見出しに混ぜないのは、`boardView` を盤面だけから
    // 組み立てる切り分けを崩さないためである（相手が誰かは `席についた` から来る）。
    controlArea.append(line('controls__opponent', opponentLine(stage.opponent)))

    // 相手が閉じたまま戻らないと、画面は相手の優先権のまま動かなくなる（#175）。**止まって
    // いる理由を読めるようにする。** 回線が切れただけなら戻ってくる（ADR-0016）ので、待つか
    // やめるかは人が決める。
    if (connected && !stage.opponentConnected) {
      controlArea.append(line('controls__offline', '相手の繋がりが切れています。戻るのを待つか、やめてロビーに戻れます'))
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
    if (reason !== undefined) controlArea.append(line('controls__reason', reason))

    // 操作のしかたの切り替えは、行える手の見出しに添える（`render.ts` の `titleRow`）。
    const mode = modeElement(picking)

    // 選んでいる間は行える手が無い（`session.ts`）。どちらか一方だけが出る。
    if (!connected) {
      // 繋がっていない間は手を出さない。**押せなくするだけでは足りない。** 出ている手は切れる
      // 前の盤面のもので、繋ぎ直した先でまだ行えるとは限らない（ADR-0016）。何が起きているかは
      // 一番上の 1 行に出ている（`statusOf`）。
      controlArea.append(line('controls__offline', '繋がるまで打てません'))
    } else if (stage.choice !== undefined) {
      controlArea.append(
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
    } else if (showsOverlay(overlay)) {
      // 演出が出ている間は行える手を出さない（#115）。**待ち行列は実際の盤面より遅れている**
      // ので、出ている演出のフェイズと、行える手が指すフェイズが食い違う。押せなくするだけ
      // では食い違いが画面に残るので、手そのものを出さない。
      //
      // 選んでいる途中（`stage.choice`）は止めない。あれはすでに始まっている行動の中の選択
      // であって、待ち行列の遅れとは関係が無い。止めると、演出が消えるまで解決が進まなくなる。
      controlArea.append(waitingForOverlayElement(mode))
    } else if (view !== undefined) {
      // クリックで操作する（#94）。盤面の上で示せない手だけをここに出す。
      controlArea.append(
        pickElement(
          view,
          {
            onAction: (action) => {
              picking.onCancel()
              connection.send({ kind: '行動する', action })
            },
            onCancel: () => picking.onCancel(),
          },
          mode,
        ),
      )
    } else {
      controlArea.append(
        actionsElement(
          actionViews(board, stage.actions, stage.passOutcome),
          (action) => connection.send({ kind: '行動する', action }),
          mode,
        ),
      )
    }

    // ロビーに戻る口を出すのは、投げ出せる対戦の間だけである（`server` の `room.ts` の
    // `canLeave`）。決着した後はどちらの対戦でも戻れて、CPU との対戦と、相手が繋がっていない
    // 対戦は途中でも戻れる。**断るのはサーバである。** ここで決めているのは、押す口を出すか
    // どうかだけである。
    if (connected && (stage.opponent.kind === 'CPU' || !stage.opponentConnected || board.result !== undefined)) {
      controlArea.append(
        leaveElement(board.result === undefined ? 'やめてロビーに戻る' : 'ロビーに戻る', lobby.onLeave),
      )
    }

    // 操作するところを盤面より上に置く（#128）。盤面は縦に長いので、下にあると打つたびに
    // 往復することになる。
    root.append(controlArea)
    root.append(boardNode)

    // 盤面より上に重ねる層なので最後に足す。押せる場所は塞がない（`style.css`）。
    if (showsOverlay(overlay)) root.append(overlayElement(overlay))
  }

  // 組むところは、断られた理由を自分で持って出す（`Builder.refusal`）。二重に出さない。
  if (session.refusal !== undefined && !builderOpen) {
    root.append(line('refusal', `行えませんでした: ${session.refusal}`))
  }

  restoreScroll(root, scrolled)
  restoreTyping(root, typingDeck)
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
  // 打ち込みかけている表示名（ADR-0020）。尋ねられるたびに、いま付いている名前から始める。
  let nameDraft = ''
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

  // 盤面をクリックして操作する（#94）。選びかけているカードは**盤面が届くたびに捨てる**。
  // 届いた手は入れ替わっており、選びかけの手がまだ行えるとは限らないためである。
  let mode: PickMode = 'クリック'
  let pickedCard: CardId | undefined

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

  const picking = (): Picking => ({
    mode,
    card: pickedCard,
    onCard: (card) => {
      // 同じカードをもう一度押したら、選ぶのをやめる。
      pickedCard = pickedCard === card ? undefined : card
      redraw()
    },
    onCancel: () => {
      pickedCard = undefined
    },
    onMode: (next) => {
      mode = next
      pickedCard = undefined
      redraw()
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
    updateBuilder({ ...builder, screen: 'デッキを組む', draft, pinned: undefined, refusal: undefined })
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
    },
    editor: {
      onName: (name) => {
        // 描き直さない。入力欄の値はブラウザが持っている（`lobby` の `onName` と同じ）。
        if (builder.draft !== undefined) updateBuilder({ ...builder, draft: { ...builder.draft, name } })
      },
      onDescription: (description) => {
        if (builder.draft !== undefined) updateBuilder({ ...builder, draft: { ...builder.draft, description } })
      },
      onEdited: () => redraw(),
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
        updateBuilder({ ...builder, filter })
        redraw()
        const list = root.querySelector<HTMLElement>(`[data-keep-scroll="プール"]`)
        if (list !== null) list.scrollTop = 0
      },
      onFilterOpen: (filterOpen) => {
        updateBuilder({ ...builder, filterOpen })
        redraw()
      },
      onBack: () => {
        const draft = builder.draft
        const owned = session.ownedDecks ?? []
        if (draft === undefined || !hasUnsavedChanges(draft, owned)) return backToList()

        // **保存していない変更は、ここで捨てると戻らない。** 捨てるかどうかは人が決める。
        updateBuilder({ ...builder, confirming: { kind: '変更を捨てる' } })
        redraw()
      },
      onShare: () => {
        // 共有できるのは保存してあるデッキだけである（`view.canShare`、ADR-0022）。組みかけの
        // 打ち込みではなく、**いま自分のデッキとして残っているものの名前・解説**を初期値にする。
        const deck = session.ownedDecks?.find((each) => each.id === builder.draft?.deck)
        if (deck === undefined) return

        updateBuilder({ ...builder, sharing: { kind: '打ち込み中', draft: shareDraftOf(deck), sending: false, refusal: undefined } })
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
    updateBuilder({ ...builder, screen: 'デッキを選ぶ', draft: undefined, pinned: undefined, refusal: undefined })
    redraw()
  }

  /**
   * リンクをコピーする（ADR-0022）。**組み立てるのは呼ぶ側**（`recipe.ts` の `recipeLinkOf`）——
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
        history.pushState(null, '', recipePathOf(key))
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
        history.replaceState(null, '', '/')
      } catch {
        // 戻せなくても、画面を閉じることはできる。
      }
    }
    redraw()
  }

  /** 一覧を、選んだ並べ方で尋ね直す（ADR-0022）。 */
  function requestRecipeList(order: RecipeListOrder): void {
    updateBuilder({ ...builder, screen: 'レシピの一覧', recipeOrder: order, refusal: undefined })
    connection.send({ kind: 'レシピの一覧を見る', order })
    redraw()
  }

  const lobby = (): Lobby => ({
    name: roomName,
    deck: chosenDeck,
    cpuDeck: chosenCpuDeck,
    rules: { format: chosenFormat, restriction: chosenRestriction },
    onName: (name) => {
      // 描き直さない。入力欄の値はブラウザが持っていて、覚えるのは描き直しに備えるためである。
      roomName = name
    },
    onDeck: (deck) => {
      // 描き直さない。選んだものは `select` が持っている（`onName` と同じ）。
      // 空の選択肢（`render.ts` の `deckPicker`）が選ばれたら、選んでいないことにする。
      chosenDeck = deck === '' ? undefined : deck
    },
    onCpuDeck: (deck) => {
      chosenCpuDeck = deck === '' ? undefined : deck
    },
    onFormat: (format) => {
      // 描き直さない。選んだものは `select` が持っている（`onDeck` と同じ）。
      chosenFormat = format
    },
    onRestriction: (restriction) => {
      chosenRestriction = restriction
    },
    onCreate: (name, against) => {
      // 合言葉を決めるのはサーバなので、入る先はここで決められない（#175）。届いてから分かる。
      pendingRoom = undefined
      connection.send({
        kind: '部屋を作る',
        name,
        against,
        deck: chosenDeck,
        cpuDeck: chosenCpuDeck,
        format: chosenFormat,
        restriction: chosenRestriction,
      })
    },
    onJoin: (code) => {
      pendingRoom = code
      connection.send({ kind: '部屋に入る', room: code, deck: chosenDeck })
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
    try {
      draw(root, session, link, connection, overlay, picking(), lobby(), naming(), building())
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

      session = applyMessage(session, message)
      const wasEditing = builder.screen === 'デッキを組む'
      updateBuilder(applyToBuilder(builder, message))
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
      // 盤面が入れ替わったら、選びかけは捨てる（#94）。
      pickedCard = undefined
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
      // **切れている間に送ったものは届いていない**（`connection.ts`）ので、返事も来ない。待つのを
      // やめて、繋がり直したら確かめ直す。組みかけは画面が持っているので消えない。
      if (value.kind !== '繋がっている') updateBuilder({ ...builder, waiting: { kind: '無し' }, checking: 0 })
      else scheduleCheck()
      redraw()
    },
  })

  redraw()

  return () => {
    if (overlayTimer !== undefined) clearTimeout(overlayTimer)
    connection.close()
  }
}
