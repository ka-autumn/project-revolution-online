import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { defineStrategy, defineUnit } from '@revolution/engine'
import type { Card, Deck, FromClient, ToClient } from '@revolution/engine'
import { CPU_PREFIX } from './cpu.js'
import type { RoomSetup } from './room.js'
import { serve } from './serve.js'
import type { RunningServer } from './serve.js'

/**
 * 実際にソケットを張って 2 人を繋ぐ（ADR-0009、#83）。
 *
 * 決まりごとは `room.test.ts` が見ているので、ここで見るのは**繋がること**と、**切れても
 * 入り直せること**である。
 */

const CARDS: Readonly<Record<string, Card>> = Object.fromEntries([
  ...Array.from({ length: 14 }, (_, index) => [
    `TEST-${index}`,
    defineUnit({ name: `テスト・接続${index}`, level: 0, bp: 100, sp: 100, moveIcon: ['上'] }),
  ]),
  ['TEST-S', defineStrategy({ name: 'テスト・接続のストラテジー', level: 0 })],
])

/** 構築戦の最小枚数（60 枚）を満たすデッキ（総合ルール 第3部 第1章 3-1）。 */
function buildDeck(): Deck {
  return Object.values(CARDS).flatMap((card) => Array.from({ length: 4 }, () => card))
}

let created = 0

/** 呼ぶたびに違う合言葉を返す。同じものを返すと、2 つめの部屋が作れない。 */
const setup = (): RoomSetup => {
  created += 1
  return { decks: [buildDeck(), buildDeck()], seed: 20260816, code: `あたらしいへや${created}` }
}

const CODE = 'あいことば'

/**
 * 届いたメッセージを溜めておく接続。
 *
 * WebSocket は非同期なので、送った直後には届いていない。`waitFor` で欲しいものが来るまで待つ。
 */
class Client {
  readonly received: ToClient[] = []
  private readonly socket: WebSocket

  constructor(port: number, participant: string) {
    this.socket = new WebSocket(`ws://localhost:${port}/?participant=${encodeURIComponent(participant)}`)
    this.socket.on('message', (data) => this.received.push(JSON.parse(String(data)) as ToClient))
  }

  opened(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket.readyState === WebSocket.OPEN) return resolve()
      this.socket.on('open', () => resolve())
      this.socket.on('error', reject)
    })
  }

  send(message: FromClient): void {
    this.socket.send(JSON.stringify(message))
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.socket.on('close', () => resolve())
      this.socket.close()
    })
  }

  /**
   * 何も返さなくなる。**閉じるのとは違う。** 回線が黙って死ぬと、切れたことが降りてこないまま
   * 繋がったままに見える接続が残る。それを作る。
   */
  stopsAnswering(): void {
    this.socket.pause()
  }

  /** 止めていた読み取りを戻す。落とされていれば、ここで閉じたことが分かる。 */
  answersAgain(): void {
    this.socket.resume()
  }

  /** サーバに落とされるまで待つ。 */
  closed(): Promise<void> {
    return new Promise((resolve) => {
      if (this.socket.readyState === WebSocket.CLOSED) return resolve()
      this.socket.on('close', () => resolve())
    })
  }

  /**
   * その種類で**最後に**届いたもの。まだ届いていなければ `undefined`。
   *
   * 同じ種類が何度も届くもの（`相手の繋がり`）は、最初の 1 つを見ても意味が無い。繋がりは
   * 変わるたびに送られる（`serve.ts` の `tellLinks`）ので、いまどうなっているかは最後に届いた
   * ものである。
   */
  latest(kind: ToClient['kind']): ToClient | undefined {
    return [...this.received].reverse().find((message) => message.kind === kind)
  }

  /** その状態になるまで待つ。ならなければ、何が届いたかを添えて投げる。 */
  async waitUntil(wanted: string, ready: () => boolean): Promise<void> {
    for (let waited = 0; waited < 200; waited += 1) {
      if (ready()) return

      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`${wanted} にならなかった: ${this.received.map((message) => message.kind).join(', ')}`)
  }

  /** その種類のメッセージが届くまで待って、届いたものを返す。 */
  async waitFor(kind: ToClient['kind']): Promise<ToClient> {
    for (let waited = 0; waited < 200; waited += 1) {
      const found = this.received.find((message) => message.kind === kind)
      if (found !== undefined) return found

      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`${kind} が届かなかった: ${this.received.map((message) => message.kind).join(', ')}`)
  }
}

describe('WebSocket で繋ぐ', () => {
  let server: RunningServer

  beforeEach(async () => {
    server = await serve({ port: 0, setup })
  })

  afterEach(async () => {
    await server.close()
  })

  it('名乗らずに繋ぐと断られる', async () => {
    const socket = new WebSocket(`ws://localhost:${server.port}/`)
    const message = await new Promise<ToClient>((resolve) => {
      socket.on('message', (data) => resolve(JSON.parse(String(data)) as ToClient))
    })

    expect(message).toEqual({ kind: '行えなかった', reason: '名乗っていない' })
  })

  it('読めないメッセージは断られる', async () => {
    const client = new Client(server.port, 'あ')
    await client.opened()

    client.send('こわれている' as unknown as FromClient)

    expect(await client.waitFor('行えなかった')).toEqual({ kind: '行えなかった', reason: '読めないメッセージ' })
    await client.close()
  })

  /**
   * 名乗りは席に座れる合言葉である（ADR-0009）ので、CPU の名乗りを人に使わせない（#175）。
   * 使えると、CPU が座っている席に人が座れてしまう。
   */
  it('CPU の名乗りでは繋げない', async () => {
    const client = new Client(server.port, `${CPU_PREFIX}あいことば`)

    expect(await client.waitFor('行えなかった')).toEqual({ kind: '行えなかった', reason: '使えない名乗り' })
    await client.closed()
  })

  /** #175。尋ねに来るのを待たず、繋いだ時点で送る。最初に見るのがロビーだからである。 */
  it('繋ぐとロビーが届く', async () => {
    const client = new Client(server.port, 'あ')

    expect(await client.waitFor('ロビー')).toEqual({ kind: 'ロビー', rooms: [] })
    await client.close()
  })

  /**
   * #175。送ったかどうかは名乗りで覚えている（同じことを送り直さないため）。**繋ぎ直した先には
   * 言い直す。** 覚えたままにすると、切れる前に送ってあるからと黙って、何も届かないままになる。
   */
  it('同じ名乗りで繋ぎ直すと、ロビーがもう一度届く', async () => {
    const client = new Client(server.port, 'あ')
    await client.waitFor('ロビー')

    const again = new Client(server.port, 'あ')

    expect((await again.waitFor('ロビー')).kind).toBe('ロビー')
    await client.close()
    await again.close()
  })

  /** #175。ほかの人が部屋を作ったことが、尋ね直さずに一覧へ出る。 */
  it('誰かが部屋を作ると、ロビーにいる人に届く', async () => {
    const watching = new Client(server.port, 'あ')
    await watching.waitFor('ロビー')
    watching.received.length = 0

    const making = new Client(server.port, 'い')
    await making.opened()
    making.send({ kind: '部屋を作る', name: 'てすとのへや', against: '人間' })

    const lobby = await watching.waitFor('ロビー')
    if (lobby.kind !== 'ロビー') throw new Error('ロビーのはずだった')
    expect(lobby.rooms.map((room) => ({ name: room.name, status: room.status }))).toEqual([
      { name: 'てすとのへや', status: '相手を待っている' },
    ])
    await watching.close()
    await making.close()
  })

  /** #175。部屋にいる人にロビーは要らない。届くのは盤面と、そこで起きたことだけである。 */
  it('部屋にいる人にはロビーが届かない', async () => {
    const client = new Client(server.port, 'あ')
    await client.opened()
    client.send({ kind: '部屋を作る', name: 'ひとり', against: 'CPU' })
    await client.waitFor('席についた')
    client.received.length = 0

    const other = new Client(server.port, 'い')
    await other.opened()
    other.send({ kind: '部屋を作る', name: 'もうひとつ', against: '人間' })
    await other.waitFor('相手を待っている')

    expect(client.received.some((message) => message.kind === 'ロビー')).toBe(false)
    await client.close()
    await other.close()
  })

  /**
   * #175。画面を読み込み直すと、繋ぐ側は自分がどの部屋にいたかを忘れている（合言葉を決めたのは
   * サーバなので、URL にも無い）。**入り直しを待っていると、誰も何も送らないまま止まる。**
   */
  it('部屋にいる人が繋ぎ直すと、何も送らなくてもその部屋の様子が届く', async () => {
    const client = new Client(server.port, 'あ')
    await client.opened()
    client.send({ kind: '部屋を作る', name: 'てすとのへや', against: '人間' })
    const waiting = await client.waitFor('相手を待っている')
    if (waiting.kind !== '相手を待っている') throw new Error('相手を待っているのはずだった')
    await client.close()

    const again = new Client(server.port, 'あ')

    expect(await again.waitFor('相手を待っている')).toEqual({ kind: '相手を待っている', room: waiting.room })
    await again.close()
  })

  /**
   * #175。相手が画面を閉じると、待っている側の画面は相手の優先権のまま動かなくなる。
   * **止まっている理由が読めないままにしない。**
   */
  it('相手が閉じると、残った人に伝わって、その対戦から出られる', async () => {
    const { first, second } = await bothJoined(server.port)
    first.received.length = 0

    await second.close()

    await first.waitUntil('相手が切れたと届く', () => {
      const link = first.latest('相手の繋がり')
      return link?.kind === '相手の繋がり' && !link.connected
    })
    expect(first.latest('相手の繋がり')).toEqual({ kind: '相手の繋がり', connected: false })

    // 永久に待たされない。投げ出してロビーに戻れる（`room.ts` の `canLeave`）。
    first.received.length = 0
    first.send({ kind: 'ロビーに戻る' })
    expect((await first.waitFor('ロビー')).kind).toBe('ロビー')
    await first.close()
  })

  /**
   * #175。閉じていた側が、相手がロビーへ戻った後に繋ぎ直してくることはある。**席は残っている
   * ので盤面は見えるが、相手はもう来ない。** 待たされ続けないよう、そこも伝える。
   */
  it('相手が出ていった後に繋ぎ直すと、その対戦はもう無い', async () => {
    const { first, second } = await bothJoined(server.port)
    await second.close()
    await first.waitUntil('相手が切れたと届く', () => {
      const link = first.latest('相手の繋がり')
      return link?.kind === '相手の繋がり' && !link.connected
    })
    first.received.length = 0
    first.send({ kind: 'ロビーに戻る' })
    await first.waitFor('ロビー')

    const again = new Client(server.port, 'い')

    // 投げ出された対戦は部屋ごと消える（`room.ts` の `withoutParticipant`）ので、戻る先が無い。
    const lobby = await again.waitFor('ロビー')
    if (lobby.kind !== 'ロビー') throw new Error('ロビーのはずだった')
    expect(lobby.rooms).toEqual([])
    expect(again.received.some((message) => message.kind === '席についた')).toBe(false)
    await first.close()
    await again.close()
  })

  /**
   * #175。**同じことを言い続けない。** 受け取るたびにクライアントは畳み直して描き直すので、
   * 変わっていないのに送ると、そのぶんの手間と紛れが増える。
   */
  it('繋がりが変わらない間は、送り直さない', async () => {
    const { first, second } = await bothJoined(server.port)
    await first.waitUntil('繋がりが届く', () => first.latest('相手の繋がり') !== undefined)
    const sent = first.received.filter((message) => message.kind === '相手の繋がり').length

    // 断られるだけのメッセージでも、部屋の様子は見に行く（`serve.ts`）。
    second.send({ kind: 'ロビーに戻る' })
    await second.waitFor('行えなかった')

    expect(first.received.filter((message) => message.kind === '相手の繋がり')).toHaveLength(sent)
    await first.close()
    await second.close()
  })

  /** 回線が切れただけなら相手は戻ってくる（ADR-0016）。戻ったことも伝える。 */
  it('相手が戻ると、繋がったことが伝わる', async () => {
    const { first, second } = await bothJoined(server.port)
    await second.close()
    await first.waitUntil('相手が切れたと届く', () => {
      const link = first.latest('相手の繋がり')
      return link?.kind === '相手の繋がり' && !link.connected
    })

    const again = new Client(server.port, 'い')
    await again.waitFor('席についた')

    await first.waitUntil('相手が戻ったと届く', () => {
      const link = first.latest('相手の繋がり')
      return link?.kind === '相手の繋がり' && link.connected
    })
    expect(first.latest('相手の繋がり')).toEqual({ kind: '相手の繋がり', connected: true })
    await first.close()
    await again.close()
  })

  /** #175。CPU は繋がっていないので、席につくのは人だけである。 */
  it('CPU と対戦する部屋は、作った時点で始まっている', async () => {
    const client = new Client(server.port, 'あ')
    await client.opened()

    client.send({ kind: '部屋を作る', name: 'ひとり', against: 'CPU' })

    expect((await client.waitFor('席についた')).kind).toBe('席についた')
    expect((await client.waitFor('盤面')).kind).toBe('盤面')
    await client.close()
  })

  it('1 人目は相手を待ち、2 人目が来ると両方が席につく', async () => {
    const first = new Client(server.port, 'あ')
    await first.opened()
    first.send({ kind: '部屋に入る', room: CODE })
    await first.waitFor('相手を待っている')

    const second = new Client(server.port, 'い')
    await second.opened()
    second.send({ kind: '部屋に入る', room: CODE })

    const seatOfFirst = await first.waitFor('席についた')
    const seatOfSecond = await second.waitFor('席についた')
    expect(seatOfFirst.kind === '席についた' && seatOfSecond.kind === '席についた').toBe(true)
    await first.close()
    await second.close()
  })

  it('行動すると、両方に新しい盤面が届く', async () => {
    const { first, second } = await bothJoined(server.port)
    const board = await first.waitFor('盤面')
    if (board.kind !== '盤面') throw new Error('盤面のはずだった')
    const acting = board.perspective.turn.priority === board.perspective.viewer ? first : second
    first.received.length = 0
    second.received.length = 0

    acting.send({ kind: '行動する', action: { kind: '優先権を放棄する' } })

    expect((await first.waitFor('盤面')).kind).toBe('盤面')
    expect((await second.waitFor('盤面')).kind).toBe('盤面')
    await first.close()
    await second.close()
  })

  /**
   * ADR-0009。切れても部屋は残り、同じ合言葉で入り直せば続きから打てる。
   *
   * 切れる前に 1 手進めておく。**始めの盤面が送り直されたのでは意味がない**ので、届くのが
   * 進んだ後の盤面であることを見る。
   */
  it('切れても、同じ合言葉で入り直せば進んだ後の盤面が届く', async () => {
    const { first, second } = await bothJoined(server.port)
    const opening = await first.waitFor('盤面')
    if (opening.kind !== '盤面') throw new Error('盤面のはずだった')
    const acting = opening.perspective.turn.priority === opening.perspective.viewer ? first : second
    first.received.length = 0
    acting.send({ kind: '行動する', action: { kind: '優先権を放棄する' } })
    const advanced = await first.waitFor('盤面')
    expect(advanced).not.toEqual(opening) // 前提: 1 手進んで盤面が変わっている
    await first.close()

    const again = new Client(server.port, 'あ')
    await again.opened()
    again.send({ kind: '部屋に入る', room: CODE })

    expect(await again.waitFor('盤面')).toEqual(advanced)
    await again.close()
    await second.close()
  })

  it('入り直した後も、続きから打てる', async () => {
    const { first, second } = await bothJoined(server.port)
    const board = await first.waitFor('盤面')
    if (board.kind !== '盤面') throw new Error('盤面のはずだった')
    const priority = board.perspective.turn.priority
    const seatOfFirst = board.perspective.viewer
    await first.close()

    const again = new Client(server.port, 'あ')
    await again.opened()
    again.send({ kind: '部屋に入る', room: CODE })
    await again.waitFor('盤面')
    second.received.length = 0
    const acting = priority === seatOfFirst ? again : second
    acting.send({ kind: '行動する', action: { kind: '優先権を放棄する' } })

    // 入り直したほうにも相手にも、新しい盤面が届く。
    expect((await second.waitFor('盤面')).kind).toBe('盤面')
    await again.close()
    await second.close()
  })
})

/** 2 人が同じ部屋に入り、デュエルが始まったところ。 */
async function bothJoined(port: number): Promise<{ readonly first: Client; readonly second: Client }> {
  const first = new Client(port, 'あ')
  const second = new Client(port, 'い')
  await first.opened()
  await second.opened()
  first.send({ kind: '部屋に入る', room: CODE })
  await first.waitFor('相手を待っている')
  second.send({ kind: '部屋に入る', room: CODE })
  await first.waitFor('席についた')
  await second.waitFor('席についた')
  return { first, second }
}

/**
 * 黙って死んだ接続を落とす（ADR-0016、#172）。
 *
 * 確かめの間隔を縮めて見ている。本番は 30 秒（`serve.ts` の `HEARTBEAT_MS`）で、待っていると
 * テストが終わらない。
 */
describe('生きているかを確かめる', () => {
  const BEAT_MS = 20
  let server: RunningServer

  beforeEach(async () => {
    server = await serve({ port: 0, setup, heartbeatMs: BEAT_MS })
  })

  afterEach(async () => {
    await server.close()
  })

  it('返事が返る間は落とさない', async () => {
    const client = new Client(server.port, 'あ')
    await client.opened()
    client.send({ kind: '部屋に入る', room: CODE })
    await client.waitFor('相手を待っている')

    await new Promise((resolve) => setTimeout(resolve, BEAT_MS * 5))

    // 何度確かめられても、まだ打てる。返事は `ws` が勝手に返している。
    client.received.length = 0
    client.send({ kind: '部屋に入る', room: CODE })
    expect((await client.waitFor('相手を待っている')).kind).toBe('相手を待っている')
    await client.close()
  })

  it('返事の無くなった接続は落とす', async () => {
    const client = new Client(server.port, 'い')
    await client.opened()
    client.stopsAnswering()
    await new Promise((resolve) => setTimeout(resolve, BEAT_MS * 5))

    // 黙っている間は、落とされたことも降りてこない。読み取りを戻したところで閉じたと分かる。
    client.answersAgain()
    await client.closed()
  })
})
