import { connect } from './connection.js'
import type { RoomCode } from '@revolution/engine'
import { boardElement } from './render.js'
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

function draw(root: HTMLElement, session: Session, open: boolean): void {
  root.replaceChildren()

  const status = statusOf(session, open)
  if (status !== undefined) {
    const line = document.createElement('p')
    line.className = 'status'
    line.textContent = status
    root.append(line)
  }

  const stage = session.stage
  if (stage.kind === '打っている' && stage.board !== undefined) {
    root.append(boardElement(boardView(stage.board)))
  }

  if (session.refusal !== undefined) {
    const refusal = document.createElement('p')
    refusal.className = 'refusal'
    refusal.textContent = `行えませんでした: ${session.refusal}`
    root.append(refusal)
  }
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

  const connection = connect({
    url: options.url,
    participant: options.participant,
    room: options.room,
    onMessage: (message) => {
      session = applyMessage(session, message)
      draw(root, session, open)
    },
    onOpenChanged: (value) => {
      open = value
      draw(root, session, open)
    },
  })

  draw(root, session, open)

  return () => connection.close()
}
