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
  /** 生きているかを確かめる間隔（ミリ秒）。既定は `HEARTBEAT_MS`。テストで縮めるために開けてある。 */
  readonly heartbeatMs?: number
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

/**
 * 受け取ってよいメッセージの種類（`protocol.ts` の `FromClient`）。
 *
 * `FromClient` に足したら、ここにも足す。**足し忘れると読めないメッセージとして黙って断られる**
 * ので、種類をキーにした表にして、抜けが型検査で落ちるようにしている。
 */
const ACCEPTED: Readonly<Record<FromClient['kind'], true>> = {
  部屋に入る: true,
  行動する: true,
  選ぶ: true,
  ひとつ戻る: true,
  取り消す: true,
}

/** 受け取ったバイト列をメッセージとして読む。読めなければ `undefined`。 */
function parse(data: unknown): FromClient | undefined {
  try {
    const parsed: unknown = JSON.parse(String(data))
    if (typeof parsed !== 'object' || parsed === null) return undefined

    const { kind } = parsed as { readonly kind?: unknown }
    // `hasOwn` で引く。`in` だと `toString` のような受け継いだ名前まで通ってしまう。
    return typeof kind === 'string' && Object.hasOwn(ACCEPTED, kind) ? (parsed as FromClient) : undefined
  } catch {
    return undefined
  }
}

/**
 * 生きているかを確かめる間隔（ミリ秒）。
 *
 * 不安定な回線では、切れたことが TCP から降りてこないまま黙って死ぬ接続ができる。放っておくと
 * その席は埋まったままになり、繋ぎ直してきた本人が入れなくなる——のではなく、**繋ぎ直した側は
 * 入れるが、死んだ接続がずっと残る**（ADR-0016）。合わせて、間に置いた中継が黙っている接続を
 * 切る場合の予防にもなる（ADR-0015）。
 *
 * 30 秒にしているのは、よくある中継のアイドル打ち切り（60 秒）の半分だからである。
 */
const HEARTBEAT_MS = 30_000

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
  /** 前回の確認から返事があった接続。ここに無いものは死んだものとして落とす。 */
  const answered = new Set<WebSocket>()
  let rooms: Rooms = emptyRooms()

  /**
   * 生きているかを確かめて、返事の無かった接続を落とす。
   *
   * 落とすと `close` が起きるので、表から外すのは今までどおりそちらの仕事である。相手の
   * 返事（pong）は `ws` が勝手に返すので、**繋いでいる側は何もしなくてよい**。
   */
  const heartbeat = setInterval(() => {
    for (const socket of server.clients) {
      if (!answered.has(socket)) {
        socket.terminate()
        continue
      }
      answered.delete(socket)
      socket.ping()
    }
  }, options.heartbeatMs ?? HEARTBEAT_MS)
  // これ自体はサーバを生かしておく理由にならない。待っているポートのほうが生かす。
  heartbeat.unref()

  server.on('connection', (socket, request) => {
    answered.add(socket)
    socket.on('pong', () => answered.add(socket))
    socket.on('close', () => answered.delete(socket))


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
            clearInterval(heartbeat)
            server.close((error) => (error === undefined ? done() : failed(error)))
            for (const socket of sockets.values()) socket.terminate()
          }),
      })
    })
  })
}
