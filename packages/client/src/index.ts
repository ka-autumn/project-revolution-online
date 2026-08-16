import { connect } from './connection.js'
import type { Connection } from './connection.js'
import type { RoomCode } from '@revolution/engine'
import { actionViews, automaticAction, choiceView } from './input-model.js'
import { actionsElement, boardElement, choiceElement } from './render.js'
import { applyMessage, connecting } from './session.js'
import type { Session } from './session.js'
import { boardView } from './view-model.js'

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
 */
function draw(root: HTMLElement, session: Session, open: boolean, connection: Connection): void {
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
        choiceElement(choiceView(board, stage.choice), (answer) => connection.send({ kind: '選ぶ', answer })),
      )
    } else {
      root.append(
        actionsElement(actionViews(board, stage.actions), (action) =>
          connection.send({ kind: '行動する', action }),
        ),
      )
    }
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

  const connection: Connection = connect({
    url: options.url,
    participant: options.participant,
    room: options.room,
    onMessage: (message) => {
      session = applyMessage(session, message)
      draw(root, session, open, connection)

      // 放棄しか行えない場面は押させずに送る。**描いてから送る**ので、進む前の盤面が一度は
      // 画面に出る。送った結果は次の盤面として届き、そこでまた同じ判断をする。
      const automatic = automaticAction(session)
      if (automatic !== undefined) connection.send({ kind: '行動する', action: automatic })
    },
    onOpenChanged: (value) => {
      open = value
      draw(root, session, open, connection)
    },
  })

  draw(root, session, open, connection)

  return () => connection.close()
}
