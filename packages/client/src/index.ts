import { connect } from './connection.js'
import type { Connection } from './connection.js'
import type { DuelEvent, RoomCode } from '@revolution/engine'
import { actionViews, automaticAction, choiceView } from './input-model.js'
import { actionsElement, boardElement, choiceElement, overlayElement } from './render.js'
import { applyMessage, connecting } from './session.js'
import type { Session } from './session.js'
import { boardView, cutInViews, transitionViews } from './view-model.js'
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

/** 演出を出しておく長さ（#96・#104）。押し付けがましくならない程度の初期値。 */
const OVERLAY_DURATION_MS = 2600

export interface MountOptions {
  /** サーバの WebSocket の URL。 */
  readonly url: string
  /** 誰であるかを名乗る合言葉（ADR-0009）。 */
  readonly participant: string
  /** 入る部屋の合言葉。 */
  readonly room: RoomCode
}

/** 盤面より前の様子を 1 行で。 */
function statusOf(session: Session, open: boolean): string | undefined {
  if (!open) return '繋がっていません'

  switch (session.stage.kind) {
    case '繋いでいる':
      return '部屋に入ろうとしています'
    case '相手を待っている':
      return '相手を待っています'
    case '打っている':
      return session.stage.board === undefined ? '盤面を待っています' : undefined
  }
}

function line(className: string, text: string): HTMLElement {
  const node = document.createElement('p')
  node.className = className
  node.textContent = text

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
  open: boolean,
  connection: Connection,
  overlay: Overlay,
): void {
  root.replaceChildren()

  const status = statusOf(session, open)
  if (status !== undefined) root.append(line('status', status))

  const stage = session.stage
  if (stage.kind === '打っている' && stage.board !== undefined) {
    const board = stage.board
    root.append(boardElement(boardView(board)))

    // 選んでいる間は行える手が無い（`session.ts`）。どちらか一方だけが出る。
    if (stage.choice !== undefined) {
      root.append(
        choiceElement(choiceView(board, stage.choice), {
          onAnswer: (answer) => connection.send({ kind: '選ぶ', answer }),
          onRewind: () => connection.send({ kind: 'ひとつ戻る' }),
          onCancel: () => connection.send({ kind: '取り消す' }),
        }),
      )
    } else {
      root.append(
        actionsElement(actionViews(board, stage.actions), (action) =>
          connection.send({ kind: '行動する', action }),
        ),
      )
    }

    // 盤面より上に重ねる層なので最後に足す。押せる場所は塞がない（`style.css`）。
    if (overlay.transitions.length > 0 || overlay.cutIns.length > 0) root.append(overlayElement(overlay))
  }

  if (session.refusal !== undefined) root.append(line('refusal', `行えませんでした: ${session.refusal}`))
}

/**
 * 画面を作って繋ぐ。返る関数を呼ぶと接続を閉じる。
 *
 * 繋がっているかは `Session` に入れていない。あれはサーバから届いたものを畳んだ形で、ソケットが
 * 生きているかはサーバの言い分ではないためである。
 */
export function mount(root: HTMLElement, options: MountOptions): () => void {
  let session = connecting()
  let open = false

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
  let lastFresh: readonly DuelEvent[] | undefined

  const redraw = (): void => draw(root, session, open, connection, overlay)

  /** 待ち行列の先頭を出す。無ければ消える。呼ぶたびにタイマーを 1 つだけ張る。 */
  function showNextOverlay(): void {
    const [next, ...rest] = queue
    queue = rest
    overlay = next ?? EMPTY_OVERLAY
    if (next === undefined) return

    overlayTimer = setTimeout(() => {
      overlayTimer = undefined
      showNextOverlay()
      redraw()
    }, OVERLAY_DURATION_MS)
  }

  /** 新しく届いた分を待ち行列に足す。何も出ていなければ、その場で出し始める。 */
  function enqueueOverlays(): void {
    const stage = session.stage
    if (stage.kind !== '打っている' || stage.fresh === lastFresh) return
    lastFresh = stage.fresh
    if (stage.board === undefined) return

    const transitions = transitionViews(stage.previousTurn, stage.board)
    const cutIns = cutInViews(stage.board, stage.fresh)
    if (transitions.length === 0 && cutIns.length === 0) return

    queue = [...queue, { transitions, cutIns }]
    if (overlayTimer === undefined) showNextOverlay()
  }

  const connection: Connection = connect({
    url: options.url,
    participant: options.participant,
    room: options.room,
    onMessage: (message) => {
      session = applyMessage(session, message)
      enqueueOverlays()
      redraw()

      // 放棄しか行えない場面は押させずに送る。**描いてから送る**ので、進む前の盤面が一度は
      // 画面に出る。送った結果は次の盤面として届き、そこでまた同じ判断をする。
      const automatic = automaticAction(session)
      if (automatic !== undefined) connection.send({ kind: '行動する', action: automatic })
    },
    onOpenChanged: (value) => {
      open = value
      redraw()
    },
  })

  redraw()

  return () => {
    if (overlayTimer !== undefined) clearTimeout(overlayTimer)
    connection.close()
  }
}
