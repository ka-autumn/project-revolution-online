import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import type { FromClient, ToClient } from '@revolution/engine'
import { emptyRooms, receive } from './room.js'
import type { ParticipantId, RoomSetup, Rooms } from './room.js'

/**
 * WebSocket で 2 人を繋ぐ（ADR-0009、#83）。
 *
 * 決まりごとを持っているのは `room.ts` で、ここは**受け取ったバイト列を組み立て直して渡し、
 * 返ってきたものを送り分けるだけ**である。盤面を進めるところと同じように（ADR-0001）、
 * 決まりごとと I/O を分けている。
 *
 * **接続 1 本が参加者 1 人に対応する。** 誰であるかは繋ぐ時の URL で名乗る（`?participant=`）。
 * これはクライアントが持ち続ける合言葉であって認証ではない（ADR-0009）。最初の完走では
 * アカウント認証を作らない（#17）ため、これを知っている人がその席に座れる。
 *
 * 同じ合言葉で繋ぎ直すと、部屋はそのままに続きから打てる。切れた接続は覚えておかず、その
 * 合言葉に紐づく接続を新しいものに差し替えるだけでよい。**入り直した人にいまの盤面を送り直す
 * のは `room.ts` の仕事**である。
 */

export interface ServeOptions {
  readonly port: number
  /**
   * デュエルを始めるのに要るもの。部屋が始まるたびに呼ぶ。
   *
   * 呼ぶたびに違うシードを返せるようにするため、値ではなく関数で受け取る。同じシードを返すと
   * どの部屋も同じ山札の並びになる（ADR-0005）。
   */
  readonly setup: () => RoomSetup
}

export interface RunningServer {
  /** 実際に使っている番号。`port` に 0 を渡した場合はここで分かる。 */
  readonly port: number
  close(): Promise<void>
}

/** 繋ぐ時に名乗った合言葉。名乗っていなければ `undefined`。 */
function participantOf(url: string | undefined): ParticipantId | undefined {
  const named = new URL(url ?? '/', 'ws://localhost').searchParams.get('participant')
  return named === null || named === '' ? undefined : named
}

/** 受け取ったバイト列をメッセージとして読む。読めなければ `undefined`。 */
function parse(data: unknown): FromClient | undefined {
  try {
    const parsed: unknown = JSON.parse(String(data))
    if (typeof parsed !== 'object' || parsed === null) return undefined

    const { kind } = parsed as { readonly kind?: unknown }
    return kind === '部屋に入る' || kind === '行動する' || kind === '選ぶ' ? (parsed as FromClient) : undefined
  } catch {
    return undefined
  }
}

function send(socket: WebSocket | undefined, message: ToClient): void {
  if (socket !== undefined && socket.readyState === socket.OPEN) socket.send(JSON.stringify(message))
}

/**
 * サーバを立てる。返る約束は、繋げるようになったところで果たされる。
 *
 * 部屋も、合言葉から接続を引く表も、この中にしか無い。落とすと対戦は消える（ADR-0009）。
 */
export function serve(options: ServeOptions): Promise<RunningServer> {
  const server = new WebSocketServer({ port: options.port })
  const sockets = new Map<ParticipantId, WebSocket>()
  let rooms: Rooms = emptyRooms()

  server.on('connection', (socket, request) => {
    const participant = participantOf(request.url)
    if (participant === undefined) {
      send(socket, { kind: '行えなかった', reason: '名乗っていない' })
      socket.close()
      return
    }

    // 同じ合言葉で繋ぎ直された場合、古い接続は捨てる。部屋の側は入り直しとして扱う。
    sockets.set(participant, socket)

    socket.on('message', (data) => {
      const message = parse(data)
      if (message === undefined) {
        send(socket, { kind: '行えなかった', reason: '読めないメッセージ' })
        return
      }

      const outcome = receive(rooms, participant, message, options.setup())
      rooms = outcome.rooms
      for (const delivery of outcome.deliveries) send(sockets.get(delivery.to), delivery.message)
    })

    // 切れたことは覚えておかない。部屋は残り、同じ合言葉で入り直せば続きから打てる。
    socket.on('close', () => {
      if (sockets.get(participant) === socket) sockets.delete(participant)
    })
  })

  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.on('listening', () => {
      const address = server.address()
      resolve({
        port: typeof address === 'object' && address !== null ? address.port : options.port,
        close: () =>
          new Promise((done, failed) => {
            server.close((error) => (error === undefined ? done() : failed(error)))
            for (const socket of sockets.values()) socket.terminate()
          }),
      })
    })
  })
}
