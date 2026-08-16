import { connect } from './connection.js'
import type { Connection } from './connection.js'
import type { DuelEvent, RoomCode } from '@revolution/engine'
import { actionViews, automaticAction, choiceView } from './input-model.js'
import { actionsElement, boardElement, choiceElement, cutInElement } from './render.js'
import { applyMessage, connecting } from './session.js'
import type { Session } from './session.js'
import { boardView, cutInViews } from './view-model.js'
import type { CutInView } from './view-model.js'

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

/** カットインを出しておく長さ（#104）。演出が押し付けがましくならない程度の初期値。 */
const CUT_IN_DURATION_MS = 2600

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
 * `cutIns` は盤面の一部ではなく、いま出す分だけを呼ぶ側（`mount` のタイマー）が渡す。
 * ここで毎回作り直しても、CSS の `animation` を使っていないのでちらつかない
 * （`style.css` の `.cut-in-layer`）。
 */
function draw(
  root: HTMLElement,
  session: Session,
  open: boolean,
  connection: Connection,
  cutIns: readonly CutInView[],
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
    if (cutIns.length > 0) root.append(cutInElement(cutIns))
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

  // いま出しているカットインと、消すタイマー（#104）。`fresh` は盤面が届くたびに新しい配列で
  // 届く（`session.ts`）ので、参照を覚えておけば「前回と同じ盤面」を区別できる——`選んでほしい`
  // の到着で `draw` をやり直しても、出ているカットインを作り直さずに済む。
  let cutIns: readonly CutInView[] = []
  let cutInTimer: ReturnType<typeof setTimeout> | undefined
  let lastFresh: readonly DuelEvent[] | undefined

  const redraw = (): void => draw(root, session, open, connection, cutIns)

  /** 新しく届いた分からカットインを作り直す。**積まない。**続けて起きたら置き換える。 */
  function refreshCutIns(): void {
    const stage = session.stage
    if (stage.kind !== '打っている' || stage.fresh === lastFresh) return
    lastFresh = stage.fresh

    if (cutInTimer !== undefined) clearTimeout(cutInTimer)
    cutIns = stage.board === undefined ? [] : cutInViews(stage.board, stage.fresh)

    if (cutIns.length > 0) {
      cutInTimer = setTimeout(() => {
        cutIns = []
        cutInTimer = undefined
        redraw()
      }, CUT_IN_DURATION_MS)
    }
  }

  const connection: Connection = connect({
    url: options.url,
    participant: options.participant,
    room: options.room,
    onMessage: (message) => {
      session = applyMessage(session, message)
      refreshCutIns()
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
    if (cutInTimer !== undefined) clearTimeout(cutInTimer)
    connection.close()
  }
}
