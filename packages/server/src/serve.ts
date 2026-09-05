import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import type { FromClient, ToClient } from '@revolution/engine'
import { isCpu } from './cpu.js'
import { emptyRooms, lobbyOf, partnerOf, receive, restore, roomOf } from './room.js'
import type { ParticipantId, Room, RoomOutcome, RoomSetup, Rooms } from './room.js'
import type { Store } from './store.js'

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
  /**
   * 書いたものが残る置き場（ADR-0018、`store.ts`）。
   *
   * **渡さなければ何も残らない。** 立て直せば対戦は消える——ADR-0018 より前と同じ振る舞いに
   * なる。置き場を持つかどうかを決めるのは、サーバを立てる側である（`tools/bundle-server.mjs`）。
   */
  readonly store?: Store
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
  部屋を作る: true,
  ロビーに戻る: true,
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
  /**
   * その人に最後に送ったロビー（#175）。同じものを送り直さないために覚えている。
   *
   * 部屋にいる間は消す。出てきた時に、変わっていなくてももう一度届くようにするためである。
   */
  const lobbySent = new Map<ParticipantId, string>()
  /**
   * その人に最後に伝えた「相手が繋がっているか」（#175）。同じことを言い続けないために覚えている。
   *
   * 切れたら消す。**繋ぎ直してきた人には、変わっていなくてももう一度伝える。**
   */
  const linkSent = new Map<ParticipantId, boolean>()
  /**
   * 置き場に残っていた対戦から始める（ADR-0018）。
   *
   * **立て直しても対戦が消えない。** 作り直すのは記録した入力を打ち直すことで、決着まで打った
   * 1 本でも 18ms しかかからない（`room.ts` の `restore`）。デッキは立てるときに渡されたものを
   * 使い、記録と違っていればその対戦は作り直さない。
   */
  let rooms: Rooms = options.store === undefined ? emptyRooms() : restore(options.store.openDuels(), options.setup().decks)

  /** いま繋がっている人。部屋はこれを見て、抜けられるかを決める（`room.ts` の `canLeave`）。 */
  const linked = (): ReadonlySet<ParticipantId> => new Set(sockets.keys())

  /**
   * 部屋が返したものを、それぞれの宛先へ送る。ロビーも送り直す。
   *
   * **送る前に書く**（ADR-0018）。書く前に送ると、書けないまま人の画面だけが先に進む。書いてから
   * 落ちたなら、繋ぎ直した先で同じ盤面が作り直される。
   */
  function deliver(outcome: RoomOutcome): void {
    keep(outcome)
    rooms = outcome.rooms
    for (const delivery of outcome.deliveries) send(sockets.get(delivery.to), delivery.message)
    pushLobby()
  }

  /**
   * 起きたことを置き場へ書き足す（ADR-0018）。
   *
   * **書けなくても対戦は止めない。** 記録が欠けるのは失うものだが、打てなくなるほうが重い。
   * 黙って落とさずに残すのは、置き場が壊れていることに気付けるようにするためである。
   */
  function keep(outcome: RoomOutcome): void {
    if (options.store === undefined || outcome.records.length === 0) return

    try {
      options.store.write(outcome.records)
    } catch (error) {
      console.error('置き場へ書けませんでした:', error)
    }
  }

  /**
   * その部屋にいる人それぞれに、相手が繋がっているかを伝える（#175）。
   *
   * **繋がりを知っているのはここだけである。** 部屋は決まりごとしか持たない（`room.ts`）ので、
   * 誰が繋がっているかは渡す側の仕事になる。相手が閉じたまま戻らない対戦から抜けられるかも、
   * 同じものから決まる（同 `canLeave`）。
   *
   * CPU が相手の部屋には送らない。CPU は繋がらないのが当たり前で、投げ出せるかどうかも相手が
   * CPU であることから決まっている。
   */
  function tellLinks(room: Room | undefined): void {
    if (room === undefined || room.cpu !== undefined) return

    for (const participant of room.participants) {
      const partner = partnerOf(room, participant)
      if (partner === undefined) continue

      // 繋がっていない人には送れない。**覚えてもおかない。** 繋ぎ直してきた時に、変わって
      // いないからと黙ってしまうことになる。
      const socket = sockets.get(participant)
      if (socket === undefined) {
        linkSent.delete(participant)
        continue
      }

      // **部屋を出た相手は繋がっていない。** 出た人はその席に戻れない（`enter` が断る）ので、
      // 繋ぎ直してくるかどうかに関わらず、待っていても相手は来ない。
      const present = room.participants.includes(partner) && sockets.has(partner)
      // **変わった時だけ送る。** 同じことを言い続けると、受け取るたびに畳み直す側
      // （`client` の `index.ts`）が動くことになる。
      if (linkSent.get(participant) === present) continue

      linkSent.set(participant, present)
      send(socket, { kind: '相手の繋がり', connected: present })
    }
  }

  /**
   * どの部屋にもいない人に、いまのロビーを送る（#175）。
   *
   * **部屋の様子が変わりうるたびに呼ぶ。** 尋ねに来るのを待たずに送ることで、誰かが部屋を
   * 作れば、ほかの人の一覧にすぐ出る。前に送ったものと同じなら送らない。
   */
  function pushLobby(): void {
    const lobby = lobbyOf(rooms)
    const shown = JSON.stringify(lobby)
    for (const [participant, socket] of sockets) {
      if (roomOf(rooms, participant) !== undefined) {
        lobbySent.delete(participant)
        continue
      }
      if (lobbySent.get(participant) === shown) continue

      lobbySent.set(participant, shown)
      send(socket, { kind: 'ロビー', rooms: lobby })
    }
  }

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
    // CPU の名乗りは人に使わせない（#175）。名乗りは認証ではなく、知っている人がその席に
    // 座れる合言葉である（ADR-0009）ため、名乗れてしまうと CPU の席に座れる。
    if (isCpu(participant)) {
      send(socket, { kind: '行えなかった', reason: '使えない名乗り' })
      socket.close()
      return
    }

    // 同じ合言葉で繋ぎ直された場合、古い接続は捨てる。部屋の側は入り直しとして扱う。
    sockets.set(participant, socket)
    // **新しい接続には、覚えていることを言い直す。** 送ったかどうかは名乗りで覚えている
    // （`lobbySent`・`linkSent`）ので、消しておかないと、同じ名乗りで繋ぎ直した先が
    // 「もう伝えてある」として黙って何も受け取れないままになる。
    lobbySent.delete(participant)
    linkSent.delete(participant)

    /**
     * 部屋にいるならその様子を、いないならロビーを送る（#175）。
     *
     * **どこにいるかを知っているのはサーバである。** 画面を読み込み直すと、繋ぐ側は自分が
     * どの部屋にいたかを忘れている（合言葉を決めたのはサーバなので、URL にも無い）。入り直しを
     * 待っていると、誰も何も送らないまま止まる。部屋にいる人には、入り直したものとして
     * いまの盤面を送る（ADR-0009、`room.ts` の `rejoin`）。
     */
    const current = roomOf(rooms, participant)
    if (current === undefined) pushLobby()
    else deliver(receive(rooms, participant, { kind: '部屋に入る', room: current.code }, options.setup(), linked()))
    // 入り直した本人にも、相手にも、繋がりが変わったことを伝える。
    tellLinks(roomOf(rooms, participant))

    socket.on('message', (data) => {
      const message = parse(data)
      if (message === undefined) {
        send(socket, { kind: '行えなかった', reason: '読めないメッセージ' })
        return
      }

      // 部屋を出入りすると、残った人から見た相手が変わる（#175）。出た先と入った先の両方に伝える。
      const before = roomOf(rooms, participant)?.code
      deliver(receive(rooms, participant, message, options.setup(), linked()))
      for (const code of new Set([before, roomOf(rooms, participant)?.code])) {
        if (code !== undefined) tellLinks(rooms.get(code))
      }
    })

    // 切れたことは覚えておかない。部屋は残り、同じ合言葉で入り直せば続きから打てる。
    socket.on('close', () => {
      if (sockets.get(participant) === socket) sockets.delete(participant)
      lobbySent.delete(participant)
      linkSent.delete(participant)
      // 待っている相手には伝える。**止まっている理由が読めないままにしない**（#175）。
      tellLinks(roomOf(rooms, participant))
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
