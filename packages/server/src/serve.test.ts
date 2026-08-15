import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { defineStrategy, defineUnit } from '@revolution/engine'
import type { Card, CardNaming, Deck, FromClient, ToClient } from '@revolution/engine'
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

const numberOf: CardNaming = (card) => {
  const found = Object.entries(CARDS).find(([, each]) => each === card)
  if (found === undefined) throw new Error(`番号を知らないカード: ${card.name}`)

  return found[0]
}

/** 構築戦の最小枚数（60 枚）を満たすデッキ（総合ルール 第3部 第1章 3-1）。 */
function buildDeck(): Deck {
  return Object.values(CARDS).flatMap((card) => Array.from({ length: 4 }, () => card))
}

const setup = (): RoomSetup => ({ decks: [buildDeck(), buildDeck()], seed: 20260816, numberOf })

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
