import { connect } from './connection.js'
import type { RoomCode } from '@revolution/engine'
import { applyMessage, connecting } from './session.js'
import type { Session } from './session.js'

/**
 * クライアントの起動点。
 *
 * 受け取った盤面を描き、選んだものを送るだけで、**ルールの判断は持たない**（ADR-0010）。
 * 行える手はサーバが盤面と一緒に送る。
 *
 * 3 つに分けている。届いたものを畳む純粋な関数（`session.ts`）、ソケットを張るところ
 * （`connection.ts`）、そしてこの 2 つを繋いで画面に書くところ（ここ）である。DOM を触るのは
 * ここだけで、テストは畳むところに寄せている。
 */

export interface MountOptions {
  /** サーバの WebSocket の URL。 */
  readonly url: string
  /** 誰であるかを名乗る合言葉（ADR-0009）。 */
  readonly participant: string
  /** 入る部屋の合言葉。 */
  readonly room: RoomCode
}

/** いまの様子を 1 行で。盤面を描くのは #14 の続きで入る。 */
function describe(session: Session, open: boolean): string {
  if (!open) return '繋がっていません'

  const stage = session.stage
  const refusal = session.refusal === undefined ? '' : `（${session.refusal}）`
  switch (stage.kind) {
    case '繋いでいる':
      return `部屋に入ろうとしています${refusal}`
    case '相手を待っている':
      return `相手を待っています${refusal}`
    case '打っている':
      return `${stage.seat}の席・行える手 ${stage.actions.length} 個${refusal}`
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

  const draw = (): void => {
    root.textContent = describe(session, open)
  }

  const connection = connect({
    url: options.url,
    participant: options.participant,
    room: options.room,
    onMessage: (message) => {
      session = applyMessage(session, message)
      draw()
    },
    onOpenChanged: (value) => {
      open = value
      draw()
    },
  })

  draw()

  return () => connection.close()
}
