import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FromClient, RoomCode, ToClient } from '@revolution/engine'
import { MAX_ATTEMPTS, connect, connectingLink, delayBeforeAttempt } from './connection.js'
import type { Connection, Link } from './connection.js'

/**
 * 切れたら自分で繋ぎ直すところ（ADR-0016、#172）。
 *
 * 本物のソケットは張らない。**見たいのは繋ぎ直しの筋道**——いつ張り直すか、何を送り直すか、
 * いつ諦めるか——であって、WebSocket そのものの振る舞いではない。張るところを差し替えて、
 * 開いた・切れたをテストから起こす。
 */

type Listener = (event: unknown) => void

class FakeSocket {
  static readonly OPEN = 1
  /** 張られた順。繋ぎ直すたびに増える。 */
  static opened: FakeSocket[] = []

  readyState = 0
  readonly sent: string[] = []
  private readonly listeners = new Map<string, Listener[]>()

  constructor(readonly url: string) {
    FakeSocket.opened.push(this)
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.breaks()
  }

  /** サーバに繋がった。 */
  connects(): void {
    this.readyState = FakeSocket.OPEN
    this.emit('open', {})
  }

  /** 切れた。繋ぎ損ねた場合もこれになる（`close` は `error` の後に必ず来る）。 */
  breaks(): void {
    if (this.readyState === 3) return
    this.readyState = 3
    this.emit('close', {})
  }

  delivers(message: ToClient): void {
    this.deliversRaw(JSON.stringify(message))
  }

  /** サーバが送るはずのないバイト列。読めないものが来た時のため。 */
  deliversRaw(data: string): void {
    this.emit('message', { data })
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

const ROOM = 'あいことば' as RoomCode

/** 張られている最後のソケット。 */
function latest(): FakeSocket {
  const found = FakeSocket.opened.at(-1)
  if (found === undefined) throw new Error('まだ張られていない')

  return found
}

function sentBy(socket: FakeSocket): FromClient[] {
  return socket.sent.map((each) => JSON.parse(each) as FromClient)
}

interface Started {
  readonly connection: Connection
  readonly links: Link[]
  readonly messages: ToClient[]
}

function start(): Started {
  const links: Link[] = []
  const messages: ToClient[] = []
  const connection = connect({
    url: 'ws://localhost:8787',
    participant: 'わたし',
    room: ROOM,
    onMessage: (message) => messages.push(message),
    onLinkChanged: (link) => links.push(link),
  })

  return { connection, links, messages }
}

/** 諦めるまでの待ち時間をすべて足したもの。 */
function untilGivingUp(): number {
  return Array.from({ length: MAX_ATTEMPTS }, (_, index) => delayBeforeAttempt(index + 1)).reduce((a, b) => a + b, 0)
}

describe('サーバとの繋がり', () => {
  beforeEach(() => {
    FakeSocket.opened = []
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('名乗りを付けて繋ぎ、繋がったら部屋に入る', () => {
    start()

    expect(latest().url).toContain('participant=')
    latest().connects()
    expect(sentBy(latest())).toEqual([{ kind: '部屋に入る', room: ROOM }])
  })

  it('まだ一度も繋がっていない間は 0 回目', () => {
    expect(connectingLink()).toEqual({ kind: '繋ごうとしている', attempt: 0 })
  })

  it('切れたら間を空けて繋ぎ直し、同じ部屋に入り直す', () => {
    const { links } = start()
    latest().connects()
    latest().breaks()

    expect(links).toEqual([{ kind: '繋がっている' }, { kind: '繋ごうとしている', attempt: 1 }])
    expect(FakeSocket.opened).toHaveLength(1)

    vi.advanceTimersByTime(delayBeforeAttempt(1))
    expect(FakeSocket.opened).toHaveLength(2)

    latest().connects()
    // 入り直しは繋ぐのと同じでよい。いまの盤面を送り直すのはサーバの仕事（ADR-0009）。
    expect(sentBy(latest())).toEqual([{ kind: '部屋に入る', room: ROOM }])
  })

  it('繋ぎ直せたら数え直す', () => {
    const { links } = start()
    latest().connects()

    latest().breaks()
    vi.advanceTimersByTime(delayBeforeAttempt(1))
    latest().connects()
    latest().breaks()

    expect(links.at(-1)).toEqual({ kind: '繋ごうとしている', attempt: 1 })
  })

  it('待ち時間は倍々に伸びて頭打ちになる', () => {
    expect(delayBeforeAttempt(1)).toBe(250)
    expect(delayBeforeAttempt(2)).toBe(500)
    expect(delayBeforeAttempt(3)).toBe(1000)
    expect(delayBeforeAttempt(5)).toBe(4000)
    expect(delayBeforeAttempt(MAX_ATTEMPTS)).toBe(4000)
  })

  it('繋がらないまま回数を使い切ったら諦める', () => {
    const { links } = start()
    latest().breaks()

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      vi.advanceTimersByTime(delayBeforeAttempt(attempt))
      latest().breaks()
    }

    expect(links.at(-1)).toEqual({ kind: '諦めた' })
    expect(FakeSocket.opened).toHaveLength(1 + MAX_ATTEMPTS)

    // 諦めた後は、待っても張り直さない。
    vi.advanceTimersByTime(untilGivingUp())
    expect(FakeSocket.opened).toHaveLength(1 + MAX_ATTEMPTS)
  })

  it('呼ぶ側が閉じたら繋ぎ直さない', () => {
    const { connection } = start()
    latest().connects()
    connection.close()

    vi.advanceTimersByTime(untilGivingUp())
    expect(FakeSocket.opened).toHaveLength(1)
  })

  it('待っている間に閉じられたら、予約していた分も張らない', () => {
    const { connection } = start()
    latest().connects()
    latest().breaks()
    connection.close()

    vi.advanceTimersByTime(untilGivingUp())
    expect(FakeSocket.opened).toHaveLength(1)
  })

  it('繋がっていない間に送ったものは捨てる', () => {
    const { connection } = start()
    latest().connects()
    latest().breaks()
    connection.send({ kind: '行動する', action: { kind: '優先権を放棄する' } })

    // 貯めて後から流し直さない。繋ぎ直した先で同じ手が行えるとは限らない（ADR-0010）。
    vi.advanceTimersByTime(delayBeforeAttempt(1))
    latest().connects()
    expect(sentBy(latest())).toEqual([{ kind: '部屋に入る', room: ROOM }])
  })

  it('届いたものを渡す。読めないものは捨てる', () => {
    const { messages } = start()
    latest().connects()
    latest().delivers({ kind: '相手を待っている' })
    // 読めないもの。落ちずに捨てる。画面が 1 つ前のまま止まっているほうがましである。
    latest().deliversRaw('{')
    latest().deliversRaw('{"種類":"盤面"}')

    expect(messages).toEqual([{ kind: '相手を待っている' }])
  })
})
