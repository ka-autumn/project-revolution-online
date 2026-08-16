import type { FromClient, RoomCode, ToClient } from '@revolution/engine'

/**
 * サーバとの WebSocket 1 本（ADR-0009）。
 *
 * **決まりごとを持たない。** 送るものを JSON にし、届いたものを読んで渡すだけである。届いたもの
 * をどう覚えるかは `session.ts`、何を送るかは呼ぶ側が決める。
 *
 * 誰であるかは繋ぐ時の URL で名乗る（`?participant=`）。同じ合言葉で繋ぎ直せば、部屋はそのままに
 * 続きから打てる（`server` の `serve.ts`）。
 */

export interface ConnectionOptions {
  /** サーバの WebSocket の URL。`ws://localhost:8787` のような、パスまでのもの。 */
  readonly url: string
  /** 誰であるかを名乗る合言葉。これを知っている人がその席に座れる（ADR-0009）。 */
  readonly participant: string
  /** 繋がったら入る部屋。 */
  readonly room: RoomCode
  /** メッセージが届くたびに呼ばれる。 */
  readonly onMessage: (message: ToClient) => void
  /** 繋がっているかが変わるたびに呼ばれる。 */
  readonly onOpenChanged: (open: boolean) => void
}

export interface Connection {
  send(message: FromClient): void
  close(): void
}

/** 名乗りを付けた接続先。 */
function addressOf(url: string, participant: string): string {
  const address = new URL(url)
  address.searchParams.set('participant', participant)
  return address.toString()
}

/**
 * 届いたバイト列をメッセージとして読む。読めなければ `undefined`。
 *
 * サーバが送ってくるものしか来ないはずだが、**読めないものが来たら捨てる**。落ちるより、
 * 画面が 1 つ前のまま止まっているほうがましである。
 */
function parse(data: unknown): ToClient | undefined {
  try {
    const parsed: unknown = JSON.parse(String(data))
    if (typeof parsed !== 'object' || parsed === null) return undefined

    const { kind } = parsed as { readonly kind?: unknown }
    return typeof kind === 'string' ? (parsed as ToClient) : undefined
  } catch {
    return undefined
  }
}

/**
 * 繋いで、繋がったら部屋に入る。
 *
 * 入り直しもこれで足りる。同じ合言葉で入り直せば、サーバがいまの盤面を送り直す（ADR-0009）。
 */
export function connect(options: ConnectionOptions): Connection {
  const socket = new WebSocket(addressOf(options.url, options.participant))

  socket.addEventListener('open', () => {
    options.onOpenChanged(true)
    socket.send(JSON.stringify({ kind: '部屋に入る', room: options.room } satisfies FromClient))
  })
  socket.addEventListener('close', () => options.onOpenChanged(false))
  socket.addEventListener('message', (event: MessageEvent<unknown>) => {
    const message = parse(event.data)
    if (message !== undefined) options.onMessage(message)
  })

  return {
    send: (message) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
    },
    close: () => socket.close(),
  }
}
