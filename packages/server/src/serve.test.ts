import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { NOT_SIGNED_IN, SIGN_IN_PATH, defineStrategy, defineUnit } from '@revolution/engine'
import type { Card, DeckId, FromClient, ToClient } from '@revolution/engine'
import { CPU_PREFIX } from './cpu.js'
import { deckChoicesOf, deckSourceFrom, restrictionChoicesOf } from './deck.js'
import type { CardSupply } from './deck.js'
import { OWNED_DECK_LIMIT, sortCards } from './owned-deck.js'
import { SHARE_LIMIT } from './recipe.js'
import type { RoomSetup } from './room.js'
import { serve } from './serve.js'
import type { RunningServer, ServeOptions } from './serve.js'
import { CALLBACK_PATH, createSignIn, digest } from './sign-in.js'
import { openStore } from './store.js'
import type { Store } from './store.js'

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

/** 立てる時に渡されるもの（ADR-0021）。既製デッキは構築戦の最小枚数を満たす（第3部 第1章 3-1）。 */
const SUPPLY: CardSupply = {
  pool: CARDS,
  presets: [
    {
      id: '既製1',
      name: 'ひとつめ',
      cards: Object.keys(CARDS).flatMap((key) => Array.from({ length: 4 }, () => key)),
    },
  ],
  // どの既製デッキにも入っていないカードを名指すので、どのデッキもこのリストで通る。
  restrictions: [{ id: 'リスト1', name: 'テストのリスト', limits: { 'テスト・どこにもないカード': 0 } }],
}

const decks = deckSourceFrom(SUPPLY)
const deckChoices = deckChoicesOf(SUPPLY)
const restrictions = restrictionChoicesOf(SUPPLY)

let created = 0

/** 呼ぶたびに違う合言葉を返す。同じものを返すと、2 つめの部屋が作れない。 */
const setup = (): RoomSetup => {
  created += 1
  return { seed: 20260816, code: `あたらしいへや${created}` }
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

  constructor(port: number, participant: string, cookie?: string) {
    this.socket = new WebSocket(`ws://localhost:${port}/?participant=${encodeURIComponent(participant)}`, {
      // 握手の HTTP リクエストに載る（ADR-0019）。ブラウザなら自動で載せるところである。
      ...(cookie === undefined ? {} : { headers: { cookie } }),
    })
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
    server = await serve({ port: 0, setup, decks, deckChoices, supply: SUPPLY })
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

  /**
   * ADR-0021。名乗りは認証ではない（ADR-0009）ので、そこにデッキを紐づけると、名乗りを知っている
   * 人が他人のデッキを書き換えられる。
   */
  it('ログインを持たない立て方では、デッキを持てない', async () => {
    const client = new Client(server.port, 'あ')
    await client.waitFor('ロビー')

    client.send({ kind: 'デッキをコピーする', origin: { kind: '既製デッキ', id: '既製1' } })

    expect(await client.waitFor('行えなかった')).toEqual({
      kind: '行えなかった',
      reason: 'ログインしていないとデッキを持てません',
    })
    expect(client.received.some((message) => message.kind === '自分のデッキ')).toBe(false)
    await client.close()
  })

  it('ログインを持たない立て方では、組んでいるデッキを確かめられない', async () => {
    const client = new Client(server.port, 'あ')
    await client.waitFor('ロビー')

    client.send({ kind: 'デッキを確かめる', cards: ['TEST-0'], format: undefined, restriction: undefined })

    expect(await client.waitFor('行えなかった')).toEqual({
      kind: '行えなかった',
      reason: 'ログインしていないとデッキを持てません',
    })
    await client.close()
  })

  /**
   * ADR-0022。共有もデッキと同じ理由（置き場に紐づける身元が無い）で断る。
   * 自分のデッキについては上の 2 件で確かめているので、レシピと共有でも同じ作法にする。
   */
  it('ログインを持たない立て方では、レシピを見られない', async () => {
    const client = new Client(server.port, 'あ')
    await client.waitFor('ロビー')

    client.send({ kind: 'レシピを見る', recipe: 'なにかのかぎ' })

    expect(await client.waitFor('行えなかった')).toEqual({
      kind: '行えなかった',
      reason: 'ログインしていないと見られません',
    })
    await client.close()
  })

  it('ログインを持たない立て方では、デッキを共有できない', async () => {
    const client = new Client(server.port, 'あ')
    await client.waitFor('ロビー')

    client.send({
      kind: 'デッキを共有する',
      deck: 'なにかのデッキ',
      name: 'きょうゆうできないはず',
      description: '',
      visibility: 'リンクを知っている人だけ',
      format: undefined,
      restriction: undefined,
    })

    expect(await client.waitFor('行えなかった')).toEqual({
      kind: '行えなかった',
      reason: 'ログインしていないと共有できません',
    })
    await client.close()
  })

  /** ADR-0021。カードプールは組むためのもので、デッキを持てない立て方では組む場所が無い。 */
  it('ログインを持たない立て方では、カードプールが届かない', async () => {
    const client = new Client(server.port, 'あ')
    // カードプールを送るのはロビーより前である（`serve.ts` の `admit`）。ロビーまで来て無ければ届かない。
    await client.waitFor('ロビー')

    expect(client.received.some((message) => message.kind === 'カードプール')).toBe(false)
    await client.close()
  })

  /** #175。尋ねに来るのを待たず、繋いだ時点で送る。最初に見るのがロビーだからである。 */
  it('繋ぐとロビーが届く', async () => {
    const client = new Client(server.port, 'あ')

    expect(await client.waitFor('ロビー')).toEqual({
      kind: 'ロビー',
      rooms: [],
      presets: deckChoices,
      chosen: '既製1',
      cpuChosen: '既製1',
      restrictions,
    })
    await client.close()
  })

  /**
   * ADR-0021 / ADR-0022、#194。既製デッキはコピー元として並ぶ。
   *
   * **席に着く時に選べるものではない。** 座るのは自分のデッキで、そちらは `自分のデッキ` で届く。
   */
  it('ロビーと一緒に、コピー元の既製デッキが届く', async () => {
    const client = new Client(server.port, 'あ')

    const lobby = await client.waitFor('ロビー')

    expect(lobby.kind === 'ロビー' && lobby.presets).toEqual([{ id: '既製1', name: 'ひとつめ' }])
    await client.close()
  })

  /**
   * ADR-0021、#194。**ログインの設定が無ければデッキを持てない**（名乗りは認証ではない、
   * ADR-0009）ので、既定になるのは既製デッキの先頭である。
   *
   * この立て方では、選ぶところにも既製デッキが並ぶ（`client` の `seatableDecks`）——**出るものと
   * 座れるものがずれない。**
   */
  it('自分のデッキを持てない立て方では、既製デッキの先頭が既定になる', async () => {
    const client = new Client(server.port, 'あ')

    const lobby = await client.waitFor('ロビー')

    expect(lobby.kind === 'ロビー' && lobby.chosen).toBe('既製1')
    await client.close()
  })

  /** ADR-0021。部屋のルールも、選ぶ場所はそれが分かる場所と同じでなければならない。 */
  it('ロビーと一緒に、部屋を作る時に選べる禁止／制限リストが届く', async () => {
    const client = new Client(server.port, 'あ')

    const lobby = await client.waitFor('ロビー')

    expect(lobby.kind === 'ロビー' && lobby.restrictions).toEqual([{ id: 'リスト1', name: 'テストのリスト' }])
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
    making.send({ kind: '部屋を作る', name: 'てすとのへや', against: '人間', deck: undefined, cpuDeck: undefined, format: undefined, restriction: undefined })

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
    client.send({ kind: '部屋を作る', name: 'ひとり', against: 'CPU', deck: undefined, cpuDeck: undefined, format: undefined, restriction: undefined })
    await client.waitFor('席についた')
    client.received.length = 0

    const other = new Client(server.port, 'い')
    await other.opened()
    other.send({ kind: '部屋を作る', name: 'もうひとつ', against: '人間', deck: undefined, cpuDeck: undefined, format: undefined, restriction: undefined })
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
    client.send({ kind: '部屋を作る', name: 'てすとのへや', against: '人間', deck: undefined, cpuDeck: undefined, format: undefined, restriction: undefined })
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

    client.send({ kind: '部屋を作る', name: 'ひとり', against: 'CPU', deck: undefined, cpuDeck: undefined, format: undefined, restriction: undefined })

    expect((await client.waitFor('席についた')).kind).toBe('席についた')
    expect((await client.waitFor('盤面')).kind).toBe('盤面')
    await client.close()
  })

  it('1 人目は相手を待ち、2 人目が来ると両方が席につく', async () => {
    const first = new Client(server.port, 'あ')
    await first.opened()
    first.send({ kind: '部屋に入る', room: CODE, deck: undefined })
    await first.waitFor('相手を待っている')

    const second = new Client(server.port, 'い')
    await second.opened()
    second.send({ kind: '部屋に入る', room: CODE, deck: undefined })

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
    again.send({ kind: '部屋に入る', room: CODE, deck: undefined })

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
    again.send({ kind: '部屋に入る', room: CODE, deck: undefined })
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
  first.send({ kind: '部屋に入る', room: CODE, deck: undefined })
  await first.waitFor('相手を待っている')
  second.send({ kind: '部屋に入る', room: CODE, deck: undefined })
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
    server = await serve({ port: 0, setup, decks, deckChoices, supply: SUPPLY, heartbeatMs: BEAT_MS })
  })

  afterEach(async () => {
    await server.close()
  })

  it('返事が返る間は落とさない', async () => {
    const client = new Client(server.port, 'あ')
    await client.opened()
    client.send({ kind: '部屋に入る', room: CODE, deck: undefined })
    await client.waitFor('相手を待っている')

    await new Promise((resolve) => setTimeout(resolve, BEAT_MS * 5))

    // 何度確かめられても、まだ打てる。返事は `ws` が勝手に返している。
    client.received.length = 0
    client.send({ kind: '部屋に入る', room: CODE, deck: undefined })
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

/**
 * ログインの設定があるときの繋ぎ方（ADR-0019）。
 *
 * **見るのは、誰として席に着くかがどこから来るかである。** ログインの道筋そのものは
 * `sign-in.test.ts` が見ている。ここで確かめるのは、**設定があると名乗りが効かなくなること**と、
 * **HTTP と WebSocket が同じポートに同居していること**の 2 つ。
 */
describe('ログインの設定があるとき', () => {
  let server: RunningServer
  let store: Store
  let signedIn: string
  /** 繋ぎに行く側の身元。名前が置き場に入ったかを見るのに使う（ADR-0020）。 */
  let me: string
  /** もう 1 人ぶんの身元。**同じ身元で 2 本繋ぐと入り直しになる**ので、別の人が要る場面で使う。 */
  let signedInOther: string
  /** 立てた時に渡したもの。**渡すものを変えて立て直す**場面で使う。 */
  let options: ServeOptions

  beforeEach(async () => {
    store = openStore(':memory:')
    me = store.identify('google', '10001')
    // Cookie は握手のヘッダーに載る。**ヘッダーに書けるのは ASCII だけ**なので、ここも実物と
    // 同じ形（`sign-in.ts` の `newToken` は base64url を作る）にする。
    const token = 'signed-in-token'
    store.openSession(digest(token), me)
    signedIn = `revolution_session=${token}`

    const other = store.identify('google', '10002')
    // こちらは名前が付いているものとして始める。確かめたいのは相手の側の振る舞いである。
    store.rename(other, 'あいて')
    const otherToken = 'signed-in-other'
    store.openSession(digest(otherToken), other)
    signedInOther = `revolution_session=${otherToken}`

    options = {
      port: 0,
      setup,
      decks,
      deckChoices,
      supply: SUPPLY,
      store,
      signIn: createSignIn({
        config: {
          clientId: 'テスト.apps.googleusercontent.com',
          clientSecret: 'ひみつ',
          callback: `http://localhost${CALLBACK_PATH}`,
          returnTo: 'http://localhost:5173/',
        },
        store,
      }),
    }
    server = await serve(options)
  })

  afterEach(async () => {
    await server.close()
    store.close()
  })

  /**
   * **名乗りは受け付けない。** 受け付けると、他人の識別子を名乗るだけでその席に座れてしまう。
   * 画面はこの返事を見てログインへ送る（ADR-0019）。
   */
  it('Cookie が無ければ、名乗っていても断られる', async () => {
    const client = new Client(server.port, '10001')

    expect(await client.waitFor('行えなかった')).toEqual({ kind: '行えなかった', reason: NOT_SIGNED_IN })
    await client.closed()
  })

  it('知らない合言葉でも断られる', async () => {
    const client = new Client(server.port, 'あ', 'revolution_session=unknown-token')

    expect(await client.waitFor('行えなかった')).toEqual({ kind: '行えなかった', reason: NOT_SIGNED_IN })
    await client.closed()
  })

  it('セッションを持っていれば、その身元として席に着ける', async () => {
    const client = new Client(server.port, 'なのっても無駄', signedIn)
    await client.opened()
    // 名前を決めるまで先へは進めない（ADR-0020）。
    await client.waitFor('名前を決めてほしい')
    client.send({ kind: '名前を決める', name: 'かずお' })
    await client.waitFor('ロビー')

    client.send({ kind: '部屋を作る', name: 'ろぐいんの部屋', against: 'CPU', deck: undefined, cpuDeck: undefined, format: undefined, restriction: undefined })

    const seated = await client.waitFor('席についた')
    expect(seated.kind === '席についた' && seated.opponent).toEqual({ kind: 'CPU' })
    await client.close()
  })

  /**
   * ADR-0020。**繋ぎはするが、決めるまでほかのことは受け付けない。**
   *
   * 断って閉じないのは、閉じると名前を送り返す口が無くなるからである。
   */
  it('名前を決めていなければ、まず尋ねられる', async () => {
    const client = new Client(server.port, 'なのっても無駄', signedIn)

    expect(await client.waitFor('名前を決めてほしい')).toEqual({
      kind: '名前を決めてほしい',
      current: undefined,
      reason: undefined,
    })
    await client.close()
  })

  it('名前を決めるまでは、部屋を作れない', async () => {
    const client = new Client(server.port, 'なのっても無駄', signedIn)
    await client.waitFor('名前を決めてほしい')
    client.received.length = 0

    client.send({ kind: '部屋を作る', name: 'つくれないはず', against: 'CPU', deck: undefined, cpuDeck: undefined, format: undefined, restriction: undefined })

    // 断るのではなく尋ね直す。画面がそこで止まっているとは限らない（繋ぎ直した先など）。
    await client.waitFor('名前を決めてほしい')
    expect(client.received.some((message) => message.kind === '席についた')).toBe(false)
    await client.close()
  })

  /** 決まりを見るのはサーバである（`name.ts`、ADR-0010）。 */
  it('決まりに通らない名前は、理由を添えて尋ね直される', async () => {
    const client = new Client(server.port, 'なのっても無駄', signedIn)
    await client.waitFor('名前を決めてほしい')
    client.received.length = 0

    client.send({ kind: '名前を決める', name: '   ' })

    const asked = await client.waitFor('名前を決めてほしい')
    expect(asked).toEqual({ kind: '名前を決めてほしい', current: undefined, reason: '名前を入れてください' })
    // **通らなかったものは置き場に入らない。**
    expect(store.nameOf(me)).toBeUndefined()
    await client.close()
  })

  /** ADR-0020。名前は変えられる。**記録には焼き付けない**ので、過去の対戦もいまの名前で出る。 */
  it('決めた名前は変えられる', async () => {
    const client = new Client(server.port, 'なのっても無駄', signedIn)
    await client.waitFor('名前を決めてほしい')
    client.send({ kind: '名前を決める', name: 'まえのなまえ' })
    await client.waitFor('ロビー')

    client.send({ kind: '名前を決める', name: 'あとのなまえ' })

    await client.waitUntil('名前が変わる', () => store.nameOf(me) === 'あとのなまえ')
    await client.close()
  })

  /** ADR-0020。**ロビーの中身は、部屋の様子だけでなく人の名前でも変わる。** */
  it('名前を変えると、ロビーにいる人にも届き直す', async () => {
    const client = new Client(server.port, 'なのっても無駄', signedIn)
    await client.waitFor('名前を決めてほしい')
    client.send({ kind: '名前を決める', name: 'まえのなまえ' })
    await client.waitFor('ロビー')
    client.send({ kind: '部屋を作る', name: 'なまえのかわる部屋', against: '人間', deck: undefined, cpuDeck: undefined, format: undefined, restriction: undefined })
    await client.waitFor('相手を待っている')

    const watcher = new Client(server.port, 'なのっても無駄', signedInOther)
    await watcher.waitUntil('部屋が出る', () => {
      const lobby = watcher.latest('ロビー')
      return lobby?.kind === 'ロビー' && lobby.rooms[0]?.occupants[0] === 'まえのなまえ'
    })

    client.send({ kind: '名前を決める', name: 'あとのなまえ' })

    await watcher.waitUntil('名前が変わって届く', () => {
      const lobby = watcher.latest('ロビー')
      return lobby?.kind === 'ロビー' && lobby.rooms[0]?.occupants[0] === 'あとのなまえ'
    })
    await watcher.close()
    await client.close()
  })

  /** ADR-0020。ロビーには誰がいるかが出る。名乗りが合言葉だった頃は出せなかった（ADR-0009）。 */
  it('ロビーに、そこにいる人の表示名が出る', async () => {
    const client = new Client(server.port, 'なのっても無駄', signedIn)
    await client.waitFor('名前を決めてほしい')
    client.send({ kind: '名前を決める', name: 'かずお' })
    await client.waitFor('ロビー')

    client.send({ kind: '部屋を作る', name: 'なまえのでる部屋', against: '人間', deck: undefined, cpuDeck: undefined, format: undefined, restriction: undefined })
    await client.waitFor('相手を待っている')

    // 部屋にいる人にはロビーが届かない（#175）ので、**別の身元**の目で見る。同じ身元で繋ぎ直すと
    // それは入り直しになり、ロビーではなく部屋の様子が届く（ADR-0016）。
    const watcher = new Client(server.port, 'なのっても無駄', signedInOther)
    const lobby = await watcher.waitFor('ロビー')
    expect(lobby.kind === 'ロビー' && lobby.rooms[0]?.occupants).toEqual(['かずお'])
    await watcher.close()
    await client.close()
  })

  /** ADR-0020。人が相手なら、誰と打っているかが名前で分かる。 */
  it('席についたら、相手の表示名が届く', async () => {
    const client = new Client(server.port, 'なのっても無駄', signedIn)
    await client.waitFor('名前を決めてほしい')
    client.send({ kind: '名前を決める', name: 'かずお' })
    await client.waitFor('ロビー')
    client.send({ kind: '部屋を作る', name: 'ふたりの部屋', against: '人間', deck: undefined, cpuDeck: undefined, format: undefined, restriction: undefined })
    const waiting = await client.waitFor('相手を待っている')
    if (waiting.kind !== '相手を待っている') throw new Error('待っているはずだった')

    const other = new Client(server.port, 'なのっても無駄', signedInOther)
    await other.waitFor('ロビー')
    other.send({ kind: '部屋に入る', room: waiting.room, deck: undefined })

    const seated = await other.waitFor('席についた')
    expect(seated.kind === '席についた' && seated.opponent).toEqual({ kind: '人間', name: 'かずお' })
    // **2 人ぶんで別のものになる。** それぞれの相手はもう一方である。
    const mine = await client.waitFor('席についた')
    expect(mine.kind === '席についた' && mine.opponent).toEqual({ kind: '人間', name: 'あいて' })
    await other.close()
    await client.close()
  })

  /** ADR-0021。**組む前に**カードの表記が要る。席に着いた後に流れるだけでは組めない。 */
  it('名前を決めると、席に着く前にカードプールが届く', async () => {
    const client = new Client(server.port, 'なのっても無駄', signedIn)
    await client.waitFor('名前を決めてほしい')
    client.send({ kind: '名前を決める', name: 'かずお' })

    const pool = await client.waitFor('カードプール')
    // 並びは確かめない。**画面は識別子で引く**もので、並べる順は画面の都合である（ADR-0021）。
    expect(pool.kind === 'カードプール' && pool.cards.map((card) => card.key).sort()).toEqual(Object.keys(CARDS).sort())
    expect(pool.kind === 'カードプール' && pool.cards.find((card) => card.key === 'TEST-S')?.face).toEqual({
      type: 'ストラテジー',
      name: 'テスト・接続のストラテジー',
      level: 0,
      colors: [],
      stars: 0,
      reverseStars: 0,
      attributes: [],
      text: [],
    })
    await client.close()
  })

  /** ADR-0021。カードプールは、席に着ける人にだけ配る。名前を決めるまでは席に着けない（ADR-0020）。 */
  it('名前を決めるまでは、カードプールが届かない', async () => {
    const client = new Client(server.port, 'なのっても無駄', signedIn)
    // 繋いだ時に送るものは、尋ねるのと同じ所で送られる（`serve.ts` の `admit`）。尋ねられるまで
    // 待てば、送られるはずのものは届いている。
    await client.waitFor('名前を決めてほしい')

    expect(client.received.some((message) => message.kind === 'カードプール')).toBe(false)
    await client.close()
  })

  it('名前を決め終えていた人には、繋いだ時に届く', async () => {
    const client = new Client(server.port, 'なのっても無駄', signedInOther)

    await client.waitFor('カードプール')
    await client.close()
  })

  /** 名前を決めてロビーまで進んだ接続。**自分のデッキが届くのを待ってから返す。** */
  async function enteredAsMe(): Promise<Client> {
    const client = new Client(server.port, 'なのっても無駄', signedIn)
    await client.waitFor('名前を決めてほしい')
    client.send({ kind: '名前を決める', name: 'かずお' })
    await client.waitFor('自分のデッキ')
    await client.waitFor('ロビー')
    client.received.length = 0
    return client
  }

  /** 送ったあと、自分のデッキが送り直されるまで待つ。 */
  async function decksAfter(client: Client, message: FromClient): Promise<ToClient> {
    client.received.length = 0
    client.send(message)
    return client.waitFor('自分のデッキ')
  }

  /** ADR-0021。60 枚を選び切るまで対戦できない、という入口にしない。 */
  it('名前を決めると、既製デッキが 1 つ自分のデッキとして届く', async () => {
    const client = await enteredAsMe()
    const [preset] = SUPPLY.presets
    if (preset === undefined) throw new Error('既製デッキがあるはずだった')

    expect(store.decksOf(me)).toEqual([
      { id: expect.any(String), name: preset.name, description: '', cards: sortCards(preset.cards) },
    ])
    await client.close()
  })

  /** 配るのを「初めて名前を決めた時」にすると、それより前に名前を決めた人に届かない。 */
  it('名前を決め終えていた人にも、繋いだ時に配られる', async () => {
    const client = new Client(server.port, 'なのっても無駄', signedInOther)

    const decks = await client.waitFor('自分のデッキ')
    expect(decks.kind === '自分のデッキ' && decks.decks.map((deck) => deck.name)).toEqual(['ひとつめ'])
    await client.close()
  })

  it('すでにデッキを持っている人には、配り直さない', async () => {
    store.rename(me, 'かずお')
    store.saveDeck(me, undefined, { name: 'くんだデッキ', description: '', cards: ['TEST-0'] })
    const client = new Client(server.port, 'なのっても無駄', signedIn)

    const decks = await client.waitFor('自分のデッキ')
    expect(decks.kind === '自分のデッキ' && decks.decks.map((deck) => deck.name)).toEqual(['くんだデッキ'])
    await client.close()
  })

  /** ADR-0021。不備があっても保存でき、並びは揃って残る。 */
  it('保存すると並びが揃って残り、構築戦の規定を満たしていない点が届く', async () => {
    const client = await enteredAsMe()

    const decks = await decksAfter(client, {
      kind: 'デッキを保存する',
      deck: undefined,
      name: 'くみかけ',
      description: '',
      cards: ['TEST-1', 'TEST-0'],
    })

    const saved = client.latest('デッキを保存した')
    // 総合ルール 第3部 第1章 3-1（ADR-0006）
    expect(saved?.kind === 'デッキを保存した' && saved.violations).toEqual([
      { kind: '枚数不足', count: 2, minimum: 60 },
    ])
    expect(decks.kind === '自分のデッキ' && decks.decks[1]).toEqual({
      id: saved?.kind === 'デッキを保存した' ? saved.deck : undefined,
      name: 'くみかけ',
      description: '',
      cards: ['TEST-0', 'TEST-1'],
    })
    await client.close()
  })

  it('保存できないものは、理由を添えて断られる', async () => {
    const client = await enteredAsMe()

    client.send({ kind: 'デッキを保存する', deck: undefined, name: 'くみかけ', description: '', cards: ['どこにもない'] })

    expect(await client.waitFor('行えなかった')).toEqual({ kind: '行えなかった', reason: '使えないカードが入っています' })
    expect(store.decksOf(me)).toHaveLength(1)
    await client.close()
  })

  describe('組んでいるデッキを確かめる', () => {
    /** 既製デッキと同じ、構築戦の規定を満たす 60 枚。 */
    const FULL = Object.keys(CARDS).flatMap((key) => Array.from({ length: 4 }, () => key))

    /** 送ったあと、確かめた結果が届くまで待つ。 */
    async function checked(client: Client, message: FromClient): Promise<ToClient> {
      client.received.length = 0
      client.send(message)
      return client.waitFor('デッキを確かめた')
    }

    /** ADR-0021。「あと何枚」をそのまま出せる。 */
    it('選んだルールで通らない点が届き、置き場には何も残らない', async () => {
      const client = await enteredAsMe()
      const before = store.decksOf(me)

      const result = await checked(client, {
        kind: 'デッキを確かめる',
        cards: ['TEST-0', 'TEST-1'],
        format: '構築戦',
        restriction: { kind: '制限なし' },
      })

      // 総合ルール 第3部 第1章 3-1（ADR-0006）
      expect(result).toEqual({ kind: 'デッキを確かめた', violations: [{ kind: '枚数不足', count: 2, minimum: 60 }] })
      expect(store.decksOf(me)).toEqual(before)
      expect(client.received.some((message) => message.kind === '自分のデッキ')).toBe(false)
      await client.close()
    })

    it('通るなら、空で届く', async () => {
      const client = await enteredAsMe()

      const result = await checked(client, {
        kind: 'デッキを確かめる',
        cards: FULL,
        format: undefined,
        restriction: undefined,
      })

      // 総合ルール 第3部 第1章 3-1（ADR-0006）
      expect(result).toEqual({ kind: 'デッキを確かめた', violations: [] })
      await client.close()
    })

    /** 部屋を作る時と既定が食い違うと、組んでいる時に通ったデッキが、何も選ばずに作った部屋で断られる。 */
    it('リストを選ばなければ、部屋を作る時と同じく、渡された先頭のリストを当てる', async () => {
      const banning: CardSupply = {
        ...SUPPLY,
        restrictions: [{ id: '禁じるリスト', name: 'テストの禁じるリスト', limits: { 'テスト・接続0': 0 } }],
      }
      await server.close()
      server = await serve({ ...options, decks: deckSourceFrom(banning), supply: banning })
      const client = await enteredAsMe()

      const unchosen = await checked(client, {
        kind: 'デッキを確かめる',
        cards: FULL,
        format: undefined,
        restriction: undefined,
      })
      const unrestricted = await checked(client, {
        kind: 'デッキを確かめる',
        cards: FULL,
        format: undefined,
        restriction: { kind: '制限なし' },
      })

      // フロアルール Version 1.12 第2部 第1章 1-1（ADR-0023）
      expect(unchosen).toEqual({
        kind: 'デッキを確かめた',
        violations: [{ kind: '禁止／制限の入れすぎ', name: 'テスト・接続0', count: 4, maximum: 0 }],
      })
      expect(unrestricted).toEqual({ kind: 'デッキを確かめた', violations: [] })
      await client.close()
    })

    it('知らないリストを選んだら断られる', async () => {
      const client = await enteredAsMe()

      client.send({
        kind: 'デッキを確かめる',
        cards: FULL,
        format: undefined,
        restriction: { kind: '禁止／制限リスト', id: '知らないリスト' },
      })

      expect(await client.waitFor('行えなかった')).toEqual({ kind: '行えなかった', reason: 'その禁止／制限リストはありません' })
      await client.close()
    })

    /** 確かめるだけでも、置き場に入れられない並びを通さない。 */
    it('使えないカードが入っていたら断られる', async () => {
      const client = await enteredAsMe()

      client.send({ kind: 'デッキを確かめる', cards: ['どこにもない'], format: undefined, restriction: undefined })

      expect(await client.waitFor('行えなかった')).toEqual({ kind: '行えなかった', reason: '使えないカードが入っています' })
      await client.close()
    })
  })

  /**
   * ADR-0021、#194。自分で組んだデッキで席に着く。
   *
   * **ロビーに並ぶのは自分のデッキだけである**（既製デッキはコピー元として別に届く）。規定を
   * 満たしているかは、残すときだけでなく席に着くときにも確かめる。
   */
  describe('自分のデッキで席に着く', () => {
    /** 構築戦の規定を満たす 60 枚（総合ルール 第3部 第1章 3-1）。 */
    const FULL = Object.keys(CARDS).flatMap((key) => Array.from({ length: 4 }, () => key))

    /**
     * 自分のデッキを置き場に残す。**繋ぐ前に呼ぶ。**
     *
     * 1 つも持っていない人には繋いだ時に既製デッキが配られる（ADR-0021）ので、先に残しておかないと
     * 並び順が配られたものから始まる。
     */
    function myDeck(name: string, cards: readonly string[] = FULL): DeckId {
      const id = store.saveDeck(me, undefined, { name, description: '', cards: sortCards(cards) })
      if (id === undefined) throw new Error('デッキを残せるはずだった')

      return id
    }

    /**
     * ロビーまで進み、届いたロビーごと返す。**繋ぎ直しでも同じように使える。**
     *
     * 名前は置き場に残る（ADR-0020）ので、決まっていなければここで入れておく。決まるまで先へ
     * 進めないのは別のところで確かめている。
     */
    async function lobbyAsMe(): Promise<{ readonly client: Client; readonly lobby: ToClient }> {
      if (store.nameOf(me) === undefined) store.rename(me, 'かずお')
      const client = new Client(server.port, 'なのっても無駄', signedIn)

      return { client, lobby: await client.waitFor('ロビー') }
    }

    /** CPU と打つ部屋を作って、席に着くまで待つ。 */
    async function seatWith(client: Client, deck: DeckId | undefined): Promise<void> {
      client.send({ kind: '部屋を作る', name: 'じぶんのへや', against: 'CPU', deck, cpuDeck: undefined, format: undefined, restriction: undefined })
      await client.waitFor('席についた')
    }

    it('選んだ自分のデッキで座る。記録にはその時の識別子の並びが残る', async () => {
      const chosen = myDeck('じぶんの', FULL)
      const { client } = await lobbyAsMe()

      await seatWith(client, chosen)

      const [duel] = store.openDuels()
      // 席の順に並ぶ（`room.ts` の `start`）。作った人が先で、CPU が後である。
      expect(duel?.decks[0]).toEqual(store.decksOf(me).find((deck) => deck.id === chosen)?.cards)
      await client.close()
    })

    /** 初めて入った人には既製デッキが 1 つ配られている（ADR-0021）ので、選ばせずに座れる。 */
    it('まだ一度も選んでいなければ、自分のデッキの先頭が既定になる', async () => {
      const first = myDeck('ひとつめ')
      myDeck('ふたつめ')

      const { client, lobby } = await lobbyAsMe()

      expect(lobby.kind === 'ロビー' && lobby.chosen).toBe(first)
      await client.close()
    })

    /** 前回選んだものを既定にすれば、続けて対戦するときの手数は増えない（ADR-0021）。 */
    it('座ると選んだデッキを覚えていて、次のロビーの既定になる', async () => {
      myDeck('ひとつめ')
      const second = myDeck('ふたつめ')
      const { client } = await lobbyAsMe()
      await seatWith(client, second)
      // **繋ぎ直して確かめる。** 覚えているのが置き場なら、接続をまたいでも既定は変わらない。
      client.received.length = 0
      client.send({ kind: 'ロビーに戻る' })
      await client.waitFor('ロビー')
      await client.close()

      const next = await lobbyAsMe()

      expect(next.lobby.kind === 'ロビー' && next.lobby.chosen).toBe(second)
      await next.client.close()
    })

    /**
     * ADR-0021。**残っているデッキから自動で選び直さない**——選んだ覚えのないデッキで相手の前に
     * 座ることになる。
     */
    it('覚えていたデッキを消すと、既定が無くなり、選ばずには座れない', async () => {
      const first = myDeck('ひとつめ')
      const second = myDeck('ふたつめ')
      const { client } = await lobbyAsMe()
      await seatWith(client, second)
      // 繋いだ時のロビーが残っていると、出てきたところで届くものと見分けが付かない。
      client.received.length = 0
      client.send({ kind: 'ロビーに戻る' })
      await client.waitFor('ロビー')
      await decksAfter(client, { kind: 'デッキを消す', deck: second })
      const lobby = await client.waitFor('ロビー')
      client.received.length = 0
      client.send({ kind: '部屋を作る', name: 'へや', against: 'CPU', deck: undefined, cpuDeck: undefined, format: undefined, restriction: undefined })

      expect(lobby.kind === 'ロビー' && lobby.chosen).toBeUndefined()
      expect(await client.waitFor('行えなかった')).toEqual({ kind: '行えなかった', reason: 'デッキが選ばれていません' })
      // 消していないほうを選び直せば座れる。**行き止まりにしない。**
      expect(store.decksOf(me).map((deck) => deck.id)).toEqual([first])
      await client.close()
    })

    /** ADR-0021。保存した後にプールやリストが変わっていても、そのまま座らせない。 */
    it('規定を満たしていないデッキを選ぶと、何が足りないかを添えて断られる', async () => {
      const short = myDeck('くみかけ', FULL.slice(0, 2))
      const { client } = await lobbyAsMe()
      client.received.length = 0

      client.send({ kind: '部屋を作る', name: 'へや', against: 'CPU', deck: short, cpuDeck: undefined, format: undefined, restriction: undefined })

      // 総合ルール 第3部 第1章 3-1（ADR-0006）
      expect(await client.waitFor('行えなかった')).toEqual({
        kind: '行えなかった',
        reason: 'デッキがこの部屋のルールを満たしていません: 60 枚に 58 枚足りません',
      })
      await client.close()
    })

    /**
     * ADR-0021。取り下げられたカードを含むデッキは、使えないものとして扱う——**消さないが、席には
     * 着けない。**
     */
    it('取り下げられたカードを含むデッキを選ぶと、理由が分かる形で断られる', async () => {
      const withdrawn = myDeck('とりさげ', FULL)
      // 置き場のデッキはそのままに、渡されるプールのほうを狭めて立て直す。
      const narrowed: CardSupply = { ...SUPPLY, pool: { 'TEST-0': CARDS['TEST-0'] as Card } }
      await server.close()
      server = await serve({ ...options, decks: deckSourceFrom(narrowed), supply: narrowed })
      const { client } = await lobbyAsMe()
      client.received.length = 0

      client.send({ kind: '部屋を作る', name: 'へや', against: 'CPU', deck: withdrawn, cpuDeck: undefined, format: undefined, restriction: undefined })

      expect(await client.waitFor('行えなかった')).toEqual({
        kind: '行えなかった',
        reason: 'デッキに、いまは使えないカードが入っています',
      })
      await client.close()
    })

    /** デッキは持ち主のものである（ADR-0021）。**識別子を送っただけでは持ち込めない。** */
    it('他人のデッキの識別子を送っても座れない', async () => {
      myDeck('じぶんの')
      const other = store.identify('google', '10002')
      const theirs = store.saveDeck(other, undefined, { name: 'ひとの', description: '', cards: sortCards(FULL) })
      if (theirs === undefined) throw new Error('デッキを残せるはずだった')
      const { client } = await lobbyAsMe()
      client.received.length = 0

      client.send({ kind: '部屋を作る', name: 'へや', against: 'CPU', deck: theirs, cpuDeck: undefined, format: undefined, restriction: undefined })

      expect(await client.waitFor('行えなかった')).toEqual({ kind: '行えなかった', reason: 'デッキが見つかりません' })
      await client.close()
    })

    /**
     * ADR-0021、#194。画面は既定を選んだ状態で出しているので、そのまま座ったのは、出ていたものを
     * 選んだのと同じことである。
     */
    it('選ばずに座っても、その時の既定を覚えている', async () => {
      const first = myDeck('ひとつめ')
      myDeck('ふたつめ')
      const { client } = await lobbyAsMe()

      await seatWith(client, undefined)

      expect(store.lastChosenDeckOf(me)).toBe(first)
      await client.close()
    })

    /**
     * ADR-0016。入り直しで飛ぶのも `部屋に入る` で、そこには選んだものが入っていない
     * （`FromClient`）。**席を選び直す場面ではないので、切れただけで既定が決まってしまわない。**
     */
    it('選んでいたデッキを消した後に入り直しても、残っているデッキが黙って既定にならない', async () => {
      const first = myDeck('ひとつめ')
      const second = myDeck('ふたつめ')
      const { client } = await lobbyAsMe()
      client.received.length = 0
      client.send({ kind: '部屋を作る', name: 'まちのへや', against: '人間', deck: second, cpuDeck: undefined, format: undefined, restriction: undefined })
      const waiting = await client.waitFor('相手を待っている')
      const code = waiting.kind === '相手を待っている' ? waiting.room : ''
      // 待っている間に、選んでいたデッキを消す。ここで既定は決まらなくなる（`fallbackFor`）。
      await decksAfter(client, { kind: 'デッキを消す', deck: second })

      client.send({ kind: '部屋に入る', room: code, deck: undefined })
      await client.waitFor('相手を待っている')

      // 覚えているのは消えた `second` のままで、`first` に置き換わらない。**選び直してもらう決まり
      // （#194）が、入り直しただけで解けない。**
      expect(store.lastChosenDeckOf(me)).toBe(second)
      expect(first).not.toBe(second)
      await client.close()
    })

    /** ADR-0021。相手を待っている間なら、持ち込むデッキは選び直せる（`room.ts` の `rejoin`）。 */
    it('選んで入り直したなら、その選択を覚える', async () => {
      const first = myDeck('ひとつめ')
      const second = myDeck('ふたつめ')
      const { client } = await lobbyAsMe()
      client.received.length = 0
      client.send({ kind: '部屋を作る', name: 'まちのへや', against: '人間', deck: first, cpuDeck: undefined, format: undefined, restriction: undefined })
      const waiting = await client.waitFor('相手を待っている')
      const code = waiting.kind === '相手を待っている' ? waiting.room : ''

      client.send({ kind: '部屋に入る', room: code, deck: second })
      await client.waitUntil('選び直したものを覚える', () => store.lastChosenDeckOf(me) === second)

      expect(store.lastChosenDeckOf(me)).toBe(second)
      await client.close()
    })

    /**
     * ADR-0021。**確かめた時のデッキのまま座るとは限らない。** 選ばずに待っている人のデッキは
     * 既定から決まり、既定は待っている間に変わりうるので、席に着く時にも部屋のルールを当てる。
     */
    it('待っている間に既定が変わっても、部屋のルールを満たさないデッキでは始まらない', async () => {
      myDeck('とおる')
      const { client } = await lobbyAsMe()
      client.received.length = 0
      client.send({ kind: '部屋を作る', name: 'まちのへや', against: '人間', deck: undefined, cpuDeck: undefined, format: undefined, restriction: undefined })
      const waiting = await client.waitFor('相手を待っている')
      const code = waiting.kind === '相手を待っている' ? waiting.room : ''
      // 待っている間に、この部屋では通らないデッキを既定にする。**部屋は選ばれたものを覚えていない**
      // ——選ばずに作ったので、座る時にもう一度その人の既定から決まる。
      const short = store.saveDeck(me, undefined, { name: 'くみかけ', description: '', cards: sortCards(FULL.slice(0, 2)) })
      if (short === undefined) throw new Error('デッキを残せるはずだった')
      store.rememberChosenDeck(me, short)

      const other = new Client(server.port, 'なのっても無駄', signedInOther)
      await other.waitFor('ロビー')
      other.send({ kind: '部屋に入る', room: code, deck: undefined })

      // 総合ルール 第3部 第1章 3-1（ADR-0006）
      expect(await client.waitFor('行えなかった')).toEqual({
        kind: '行えなかった',
        reason: 'デッキがこの部屋のルールを満たしていません: 60 枚に 58 枚足りません',
      })
      expect(store.openDuels()).toEqual([])
      await other.close()
      await client.close()
    })

    /**
     * ADR-0021、#194。合言葉を直に指して入った部屋にはデッキを選ぶ場所が無い（ロビーを通っていない）
     * ので、**覚えている既定がそのまま席に着く。**
     */
    it('合言葉を直に指して入っても、覚えている既定で座る', async () => {
      myDeck('ひとつめ')
      const second = myDeck('ふたつめ')
      const { client } = await lobbyAsMe()
      await seatWith(client, second)
      client.received.length = 0
      client.send({ kind: 'ロビーに戻る' })
      await client.waitFor('ロビー')

      // ロビーに並んでいない合言葉を直に指す。**部屋はここで作られる。**
      client.send({ kind: '部屋に入る', room: 'あいことば', deck: undefined })
      await client.waitFor('相手を待っている')
      const other = new Client(server.port, 'なのっても無駄', signedInOther)
      await other.waitFor('ロビー')
      other.send({ kind: '部屋に入る', room: 'あいことば', deck: undefined })
      await client.waitFor('席についた')

      const started = store.openDuels().find((duel) => duel.code === 'あいことば')
      expect(started?.decks[0]).toEqual(store.decksOf(me).find((deck) => deck.id === second)?.cards)
      await other.close()
      await client.close()
    })

    /** ロビーにデッキの名前も中身も出さない（ADR-0021）。山札は非公開情報である（第2部 第23章 2-1）。 */
    it('ロビーに並ぶ部屋に、相手のデッキは出ない', async () => {
      const mine = myDeck('じぶんの')
      const { client } = await lobbyAsMe()
      client.send({ kind: '部屋を作る', name: 'まちのへや', against: '人間', deck: mine, cpuDeck: undefined, format: undefined, restriction: undefined })
      await client.waitFor('相手を待っている')

      const watcher = new Client(server.port, 'なのっても無駄', signedInOther)
      const lobby = await watcher.waitFor('ロビー')

      // **識別子では見ない。** 置き場が振る番号は短く、部屋の名前や合言葉にたまたま含まれうる。
      expect(JSON.stringify(lobby.kind === 'ロビー' && lobby.rooms)).not.toContain('じぶんの')
      await watcher.close()
      await client.close()
    })

    /**
     * ADR-0021、#195。CPU の席のデッキは、部屋を作る人が自分のデッキから決める。
     *
     * **確かめるのは、人の席と同じ場所（部屋のルール）で、同じ理由付きの断り方をすること。** 黙って
     * 別のデッキに差し替えない。
     */
    describe('CPU の席のデッキ', () => {
      type Creating = { readonly deck?: DeckId; readonly cpuDeck?: DeckId }

      /** CPU と打つ部屋を作る。CPU の席のデッキを指定しなければ `cpuDeck` を省く。 */
      function createAgainstCpu(client: Client, chosen: Creating = {}): void {
        client.received.length = 0
        client.send({
          kind: '部屋を作る',
          name: '',
          against: 'CPU',
          deck: chosen.deck,
          cpuDeck: chosen.cpuDeck,
          format: undefined,
          restriction: undefined,
        })
      }

      const cardsOf = (id: DeckId): readonly string[] | undefined =>
        store.decksOf(me).find((deck) => deck.id === id)?.cards

      it('選んだ自分のデッキで CPU が座る。自分の席のデッキとは別でよい', async () => {
        const mine = myDeck('じぶんの', FULL)
        const theirs = myDeck('あいての', FULL.slice().reverse().slice(0, 61))
        const { client } = await lobbyAsMe()

        createAgainstCpu(client, { deck: mine, cpuDeck: theirs })
        await client.waitFor('席についた')

        const [duel] = store.openDuels()
        expect(duel?.decks[0]).toEqual(cardsOf(mine))
        expect(duel?.decks[1]).toEqual(cardsOf(theirs))
        await client.close()
      })

      it('自分のデッキ同士でも回せる', async () => {
        const mine = myDeck('じぶんの', FULL)
        const { client } = await lobbyAsMe()

        createAgainstCpu(client, { deck: mine, cpuDeck: mine })
        await client.waitFor('席についた')

        const [duel] = store.openDuels()
        expect(duel?.decks[1]).toEqual(cardsOf(mine))
        await client.close()
      })

      it('選ばなければ、自分のデッキの先頭で CPU が座る', async () => {
        const first = myDeck('ひとつめ', FULL)
        const second = myDeck('ふたつめ', FULL.slice().reverse().slice(0, 61))
        const { client, lobby } = await lobbyAsMe()

        expect(lobby.kind === 'ロビー' && lobby.cpuChosen).toBe(first)
        createAgainstCpu(client, { deck: second })
        await client.waitFor('席についた')

        const [duel] = store.openDuels()
        expect(duel?.decks[1]).toEqual(cardsOf(first))
        await client.close()
      })

      /** ADR-0021。デッキは持ち主のものである。CPU の席も、識別子を送っただけでは持ち込めない。 */
      it('他人のデッキの識別子を指定しても CPU の席に座らせられない', async () => {
        const mine = myDeck('じぶんの')
        const other = store.identify('google', '10002')
        const theirs = store.saveDeck(other, undefined, { name: 'ひとの', description: '', cards: sortCards(FULL) })
        if (theirs === undefined) throw new Error('デッキを残せるはずだった')
        const { client } = await lobbyAsMe()

        createAgainstCpu(client, { deck: mine, cpuDeck: theirs })

        expect(await client.waitFor('行えなかった')).toEqual({ kind: '行えなかった', reason: 'CPU のデッキが見つかりません' })
        expect(store.openDuels()).toEqual([])
        await client.close()
      })

      /** ADR-0021。デッキを持てる人は、既製デッキの識別子を直に送っても座れない。CPU の席も同じ。 */
      it('既製デッキの識別子を直に送っても CPU の席に座らせられない', async () => {
        const mine = myDeck('じぶんの')
        const { client } = await lobbyAsMe()

        createAgainstCpu(client, { deck: mine, cpuDeck: deckChoices[0]?.id })

        expect(await client.waitFor('行えなかった')).toEqual({ kind: '行えなかった', reason: 'CPU のデッキが見つかりません' })
        expect(store.openDuels()).toEqual([])
        await client.close()
      })

      it('選んだ CPU のデッキが部屋のルールを満たさなければ、理由付きで断られる。別のデッキに変わらない', async () => {
        const mine = myDeck('じぶんの', FULL)
        const short = myDeck('くみかけ', FULL.slice(0, 2))
        const { client } = await lobbyAsMe()

        createAgainstCpu(client, { deck: mine, cpuDeck: short })

        // 総合ルール 第3部 第1章 3-1（ADR-0006）
        expect(await client.waitFor('行えなかった')).toEqual({
          kind: '行えなかった',
          reason: 'CPU のデッキがこの部屋のルールを満たしていません: 60 枚に 58 枚足りません',
        })
        expect(store.openDuels()).toEqual([])
        await client.close()
      })

      it('選んだ CPU のデッキを、自分の席のデッキとは別に覚える', async () => {
        const mine = myDeck('じぶんの', FULL)
        const theirs = myDeck('あいての', FULL.slice().reverse().slice(0, 61))
        const { client } = await lobbyAsMe()

        createAgainstCpu(client, { deck: mine, cpuDeck: theirs })
        await client.waitFor('席についた')

        expect(store.lastChosenCpuDeckOf(me)).toBe(theirs)
        expect(store.lastChosenDeckOf(me)).toBe(mine)
        client.send({ kind: 'ロビーに戻る' })
        await client.close()

        // **繋ぎ直して確かめる。** 覚えているのが置き場なら、接続をまたいでも既定は変わらない。
        const next = await lobbyAsMe()
        expect(next.lobby.kind === 'ロビー' && next.lobby.cpuChosen).toBe(theirs)
        expect(next.lobby.kind === 'ロビー' && next.lobby.chosen).toBe(mine)
        await next.client.close()
      })

      /**
       * ADR-0021。**残っているデッキから自動で選び直さない**——選んだ覚えのないデッキを相手に
       * 持たせることになる。人の席と同じ扱いである。
       */
      it('覚えていた CPU のデッキが消えていれば、既定は決まらず、選ばずには作れない', async () => {
        const mine = myDeck('じぶんの', FULL)
        const theirs = myDeck('あいての', FULL.slice().reverse().slice(0, 61))
        store.rememberChosenCpuDeck(me, theirs)
        store.deleteDeck(me, theirs)
        const { client, lobby } = await lobbyAsMe()

        expect(lobby.kind === 'ロビー' && lobby.cpuChosen).toBeUndefined()
        createAgainstCpu(client, { deck: mine })

        expect(await client.waitFor('行えなかった')).toEqual({
          kind: '行えなかった',
          reason: 'CPU のデッキが選ばれていません',
        })
        expect(store.openDuels()).toEqual([])
        await client.close()
      })

      it('相手が人の部屋では、CPU のデッキは読まれず、覚えもしない', async () => {
        const mine = myDeck('じぶんの', FULL)
        const other = store.identify('google', '10002')
        const theirs = store.saveDeck(other, undefined, { name: 'ひとの', description: '', cards: sortCards(FULL) })
        if (theirs === undefined) throw new Error('デッキを残せるはずだった')
        const { client } = await lobbyAsMe()
        client.received.length = 0

        client.send({
          kind: '部屋を作る',
          name: 'へや',
          against: '人間',
          deck: mine,
          cpuDeck: theirs,
          format: undefined,
          restriction: undefined,
        })

        expect(await client.waitFor('相手を待っている')).toMatchObject({ kind: '相手を待っている' })
        expect(store.lastChosenCpuDeckOf(me)).toBeUndefined()
        await client.close()
      })
    })
  })

  it('既製デッキをコピーして、自分のデッキにできる', async () => {
    const client = await enteredAsMe()

    const decks = await decksAfter(client, { kind: 'デッキをコピーする', origin: { kind: '既製デッキ', id: '既製1' } })

    expect(decks.kind === '自分のデッキ' && decks.decks.map((deck) => deck.name)).toEqual(['ひとつめ', 'ひとつめ'])
    await client.close()
  })

  it('デッキを消せる', async () => {
    const client = await enteredAsMe()
    await decksAfter(client, { kind: 'デッキをコピーする', origin: { kind: '既製デッキ', id: '既製1' } })
    const [first] = store.decksOf(me)
    if (first === undefined) throw new Error('デッキがあるはずだった')

    const decks = await decksAfter(client, { kind: 'デッキを消す', deck: first.id })

    expect(decks.kind === '自分のデッキ' && decks.decks.map((deck) => deck.id)).not.toContain(first.id)
    expect(store.decksOf(me)).toHaveLength(1)
    await client.close()
  })

  /** 消せると、次に繋いだ時に既製デッキが配られ直して、消したはずのデッキが湧いて出る。 */
  it('最後のデッキは消せない', async () => {
    const client = await enteredAsMe()
    const [only] = store.decksOf(me)
    if (only === undefined) throw new Error('デッキがあるはずだった')

    client.send({ kind: 'デッキを消す', deck: only.id })

    expect(await client.waitFor('行えなかった')).toEqual({ kind: '行えなかった', reason: '最後のデッキは消せません' })
    expect(store.decksOf(me)).toHaveLength(1)
    await client.close()
  })

  it(`デッキは ${OWNED_DECK_LIMIT} 個まで`, async () => {
    const client = await enteredAsMe()
    for (let count = 1; count < OWNED_DECK_LIMIT; count += 1) {
      store.saveDeck(me, undefined, { name: 'ならべる', description: '', cards: [] })
    }

    client.send({ kind: 'デッキをコピーする', origin: { kind: '既製デッキ', id: '既製1' } })

    expect(await client.waitFor('行えなかった')).toEqual({
      kind: '行えなかった',
      reason: `デッキは ${OWNED_DECK_LIMIT} 個までです`,
    })
    expect(store.decksOf(me)).toHaveLength(OWNED_DECK_LIMIT)
    await client.close()
  })

  /**
   * デッキの共有（ADR-0022）。
   *
   * **決まりを見るのは `recipe.ts` である。** ここで確かめるのは、通信を通した時に完了条件が
   * 満たされることである。
   */
  describe('デッキの共有', () => {
    /** 構築戦の規定を満たす 60 枚（既製デッキと同じ中身）。 */
    const FULL = Object.keys(CARDS).flatMap((key) => Array.from({ length: 4 }, () => key))

    /** 送ったあと、共有した返事が届くまで待つ。 */
    async function shared(client: Client, message: FromClient): Promise<ToClient> {
      client.received.length = 0
      client.send(message)
      return client.waitFor('共有した')
    }

    // 完了条件 1: 共有すると中身の写しのレシピができ、元のデッキを直してもレシピの中身は変わらない。
    it('自分のデッキを共有できる。レシピはそのときの中身を写し取る', async () => {
      const client = await enteredAsMe()
      const deck = store.saveDeck(me, undefined, { name: 'もとのデッキ', description: '', cards: FULL })
      if (deck === undefined) throw new Error('デッキを残せるはずだった')

      const result = await shared(client, {
        kind: 'デッキを共有する',
        deck,
        name: 'わたしのレシピ',
        description: 'かいせつ',
        visibility: 'リンクを知っている人だけ',
        format: undefined,
        restriction: undefined,
      })
      expect(result.kind === '共有した' && result.share.name).toBe('わたしのレシピ')

      // 元のデッキを直す。
      store.saveDeck(me, deck, { name: 'もとのデッキ', description: '', cards: ['TEST-0'] })

      const shareId = result.kind === '共有した' ? result.share.id : ''
      const recipeKey = result.kind === '共有した' ? result.share.recipe : ''
      client.send({ kind: 'レシピを見る', recipe: recipeKey })
      const recipe = await client.waitFor('レシピ')
      expect(recipe.kind === 'レシピ' && recipe.recipe?.cards).toEqual([...FULL].sort())
      expect(recipe.kind === 'レシピ' && recipe.recipe?.shares.map((share) => share.id)).toContain(shareId)
      await client.close()
    })

    /**
     * `レシピを見る` が返す共有の並び（新着順）に、`shared_at` が並んだ時のタイブレークが無いと、
     * 同じミリ秒に 2 つ共有された時にどちらが先か決まらない（置き場の `publicShareRows` は
     * `id desc` を添えている）。**時計を固定して、わざと同じ時刻に共有する。**
     */
    it('同じ shared_at の共有でも、新しい id が先に並ぶ', async () => {
      const now = Date.now()
      const clockedStore = openStore(':memory:', { now: () => now })
      const owner = clockedStore.identify('google', '30001')
      clockedStore.rename(owner, 'ひとりめ')
      const other = clockedStore.identify('google', '30002')
      clockedStore.rename(other, 'ふたりめ')
      const token = 'same-instant-token'
      const otherToken = 'same-instant-other-token'
      clockedStore.openSession(digest(token), owner)
      clockedStore.openSession(digest(otherToken), other)
      const clockedServer = await serve({
        ...options,
        store: clockedStore,
        signIn: createSignIn({
          config: {
            clientId: 'テスト.apps.googleusercontent.com',
            clientSecret: 'ひみつ',
            callback: `http://localhost${CALLBACK_PATH}`,
            returnTo: 'http://localhost:5173/',
          },
          store: clockedStore,
        }),
      })
      try {
        const client = new Client(clockedServer.port, 'なのっても無駄', `revolution_session=${token}`)
        await client.waitFor('自分のデッキ')
        const otherClient = new Client(clockedServer.port, 'なのっても無駄', `revolution_session=${otherToken}`)
        await otherClient.waitFor('自分のデッキ')
        const deck = clockedStore.saveDeck(owner, undefined, { name: 'ひとつめ', description: '', cards: FULL })
        const otherDeck = clockedStore.saveDeck(other, undefined, { name: 'ふたつめ', description: '', cards: FULL })
        if (deck === undefined || otherDeck === undefined) throw new Error('デッキを残せるはずだった')

        // どちらも同じ `now` で共有される。行番号は「さき」のほうが若いので、それだけで並べると
        // 逆順になる。
        const first = await shared(client, {
          kind: 'デッキを共有する',
          deck,
          name: 'さきに共有',
          description: '',
          visibility: 'リンクを知っている人だけ',
          format: undefined,
          restriction: undefined,
        })
        const second = await shared(otherClient, {
          kind: 'デッキを共有する',
          deck: otherDeck,
          name: 'あとから共有',
          description: '',
          visibility: 'リンクを知っている人だけ',
          format: undefined,
          restriction: undefined,
        })
        const recipeKey = first.kind === '共有した' ? first.share.recipe : ''

        client.received.length = 0
        client.send({ kind: 'レシピを見る', recipe: recipeKey })
        const recipe = await client.waitFor('レシピ')
        expect(recipe.kind === 'レシピ' && recipe.recipe?.shares.map((share) => share.name)).toEqual([
          'あとから共有',
          'さきに共有',
        ])
        expect(second.kind === '共有した' && Number(second.share.id) > (first.kind === '共有した' ? Number(first.share.id) : 0)).toBe(
          true,
        )
        await client.close()
        await otherClient.close()
      } finally {
        await clockedServer.close()
        clockedStore.close()
      }
    })

    // 完了条件 2: 同じ中身のデッキを（同じ人でも別の人でも）共有すると、レシピは1つに決まる。
    it('別の人が同じ中身を共有しても、同じレシピになる', async () => {
      const client = await enteredAsMe()
      const myDeck = store.saveDeck(me, undefined, { name: 'ひとつめ', description: '', cards: FULL })
      const other = store.identify('google', '10002')
      store.rename(other, 'あいて')
      const otherDeck = store.saveDeck(other, undefined, { name: 'ふたつめ', description: '', cards: [...FULL].reverse() })
      if (myDeck === undefined || otherDeck === undefined) throw new Error('デッキを残せるはずだった')

      const otherClient = new Client(server.port, 'なのっても無駄', signedInOther)
      await otherClient.waitFor('ロビー')

      const mine = await shared(client, {
        kind: 'デッキを共有する',
        deck: myDeck,
        name: 'わたしの共有',
        description: '',
        visibility: '一覧に載せる',
        format: undefined,
        restriction: undefined,
      })
      otherClient.send({
        kind: 'デッキを共有する',
        deck: otherDeck,
        name: 'あいての共有',
        description: '',
        visibility: '一覧に載せる',
        format: undefined,
        restriction: undefined,
      })
      const theirs = await otherClient.waitFor('共有した')

      const myRecipe = mine.kind === '共有した' ? mine.share.recipe : 'みつからない'
      const theirRecipe = theirs.kind === '共有した' ? theirs.share.recipe : '別のもの'
      expect(myRecipe).toBe(theirRecipe)
      await client.close()
      await otherClient.close()
    })

    // 完了条件 3: レシピには「何が何枚か」だけが写され、カードの姿は焼き付けられていない。
    it('レシピは識別子の並びだけを持つ', async () => {
      const client = await enteredAsMe()
      const deck = store.saveDeck(me, undefined, { name: 'デッキ', description: '', cards: FULL })
      if (deck === undefined) throw new Error('デッキを残せるはずだった')

      const result = await shared(client, {
        kind: 'デッキを共有する',
        deck,
        name: 'レシピ',
        description: '',
        visibility: 'リンクを知っている人だけ',
        format: undefined,
        restriction: undefined,
      })
      const recipeKey = result.kind === '共有した' ? result.share.recipe : ''

      // **レシピの中身そのもの（`recipe.cards`）を見る。** 共有（`WireShare`）のキーだけを見ても、
      // レシピ側にカードの姿が混ざっていないかは分からない。
      client.received.length = 0
      client.send({ kind: 'レシピを見る', recipe: recipeKey })
      const recipe = await client.waitFor('レシピ')
      const cards = recipe.kind === 'レシピ' ? recipe.recipe?.cards : undefined
      expect(cards).toEqual([...FULL].sort())
      // 識別子の並びだけを持ち、カードの表記（名前・能力テキストなど）を持つオブジェクトは
      // 1 つも混ざらない。
      expect(cards?.every((card) => typeof card === 'string')).toBe(true)
      await client.close()
    })

    // 完了条件 9: 規定を満たさないデッキは、共有しようとしたときに理由付きで断られる。
    it('規定を満たしていないデッキは、理由を添えて共有を断られる', async () => {
      const client = await enteredAsMe()
      // enteredAsMe が最初に配る自分のデッキは既製デッキの写しで、60 枚に届いている
      // （ADR-0021）。組みかけの、規定を満たさないデッキを別に残す。
      const incomplete = store.saveDeck(me, undefined, { name: 'くみかけ', description: '', cards: ['TEST-0'] })
      if (incomplete === undefined) throw new Error('デッキを残せるはずだった')

      client.send({
        kind: 'デッキを共有する',
        deck: incomplete,
        name: 'くみかけ',
        description: '',
        visibility: 'リンクを知っている人だけ',
        format: undefined,
        restriction: undefined,
      })

      const refusal = await client.waitFor('行えなかった')
      // 総合ルール 第3部 第1章 3-1（ADR-0006）
      expect(refusal).toEqual({
        kind: '行えなかった',
        reason: expect.stringContaining('枚に'),
      })
      await client.close()
    })

    it('他人のデッキは共有できない', async () => {
      const client = await enteredAsMe()
      const other = store.identify('google', '10002')
      const theirs = store.saveDeck(other, undefined, { name: 'あいてのデッキ', description: '', cards: FULL })
      if (theirs === undefined) throw new Error('デッキを残せるはずだった')

      client.send({
        kind: 'デッキを共有する',
        deck: theirs,
        name: 'のっとり',
        description: '',
        visibility: 'リンクを知っている人だけ',
        format: undefined,
        restriction: undefined,
      })

      expect(await client.waitFor('行えなかった')).toEqual({ kind: '行えなかった', reason: 'そのデッキはありません' })
      await client.close()
    })

    /**
     * `SHARE_LIMIT` の防御が働くことを確かめる。
     *
     * **同じレシピを繰り返し共有しても件数は増えない**（`store.ts` の `addShare` は、同じ人・
     * 同じレシピなら書き換えになる）。上限に達した状態を作るには、`SHARE_LIMIT` 個の異なる
     * レシピをそれぞれ 1 件ずつ共有させる必要がある（`serve.ts` の判定は「すでに上限に達して
     * いるか」を見ており、達する 1 件手前までは通す）。ソケット越しに 1 件ずつ送ると時間が
     * かかるので、置き場（`store.ensureRecipe` / `store.addShare`）を直に使って積み、上限に
     * 達したところでソケット経由の共有を試みて断られることを確かめる。
     */
    it(`共有は ${SHARE_LIMIT} 個まで`, async () => {
      const client = await enteredAsMe()
      const deck = store.saveDeck(me, undefined, { name: 'あふれさせるデッキ', description: '', cards: FULL })
      if (deck === undefined) throw new Error('デッキを残せるはずだった')

      for (let count = 0; count < SHARE_LIMIT; count += 1) {
        const key = `つみあげたかぎ${count}`
        store.ensureRecipe(key, ['TEST-0'])
        store.addShare(key, me, {
          name: `つみあげた共有${count}`,
          description: '',
          format: '構築戦',
          restriction: undefined,
          visibility: 'リンクを知っている人だけ',
        })
      }

      client.send({
        kind: 'デッキを共有する',
        deck,
        name: 'あふれる共有',
        description: '',
        visibility: 'リンクを知っている人だけ',
        format: undefined,
        restriction: undefined,
      })

      expect(await client.waitFor('行えなかった')).toEqual({
        kind: '行えなかった',
        reason: `共有は ${SHARE_LIMIT} 個までです`,
      })
      expect(store.sharesOf(me)).toHaveLength(SHARE_LIMIT)
      await client.close()
    })

    /** 完了条件 4: 公開の段階を「リンクを知っている人だけ」と「一覧に載せる」の間で変えられる。 */
    it('公開の段階をあとから変えられる', async () => {
      const client = await enteredAsMe()
      const deck = store.saveDeck(me, undefined, { name: 'デッキ', description: '', cards: FULL })
      if (deck === undefined) throw new Error('デッキを残せるはずだった')
      const result = await shared(client, {
        kind: 'デッキを共有する',
        deck,
        name: 'レシピ',
        description: '',
        visibility: 'リンクを知っている人だけ',
        format: undefined,
        restriction: undefined,
      })
      const shareId = result.kind === '共有した' ? result.share.id : ''

      client.received.length = 0
      client.send({ kind: '共有の公開範囲を変える', share: shareId, visibility: '一覧に載せる' })

      const mine = await client.waitFor('自分の共有')
      expect(mine.kind === '自分の共有' && mine.shares.find((share) => share.id === shareId)?.visibility).toBe(
        '一覧に載せる',
      )
      await client.close()
    })

    /**
     * 完了条件 5: 自分の共有を取り消すと、その共有は消える。共有が0になったレシピは開けない。
     * ほかの人の共有が残っていれば開ける。
     */
    it('取り消すと、その共有だけが消える。ほかの共有が残っていればレシピは開ける', async () => {
      const client = await enteredAsMe()
      const deck = store.saveDeck(me, undefined, { name: 'デッキ', description: '', cards: FULL })
      const other = store.identify('google', '10002')
      store.rename(other, 'あいて')
      const otherDeck = store.saveDeck(other, undefined, { name: 'あいてのデッキ', description: '', cards: FULL })
      if (deck === undefined || otherDeck === undefined) throw new Error('デッキを残せるはずだった')

      const otherClient = new Client(server.port, 'なのっても無駄', signedInOther)
      await otherClient.waitFor('ロビー')

      const mine = await shared(client, {
        kind: 'デッキを共有する',
        deck,
        name: 'わたしの共有',
        description: '',
        visibility: 'リンクを知っている人だけ',
        format: undefined,
        restriction: undefined,
      })
      otherClient.send({
        kind: 'デッキを共有する',
        deck: otherDeck,
        name: 'あいての共有',
        description: '',
        visibility: 'リンクを知っている人だけ',
        format: undefined,
        restriction: undefined,
      })
      await otherClient.waitFor('共有した')
      const shareId = mine.kind === '共有した' ? mine.share.id : ''
      const recipeKey = mine.kind === '共有した' ? mine.share.recipe : ''

      client.send({ kind: '共有を取り消す', share: shareId })
      await client.waitFor('自分の共有')

      client.received.length = 0
      client.send({ kind: 'レシピを見る', recipe: recipeKey })
      const stillOpen = await client.waitFor('レシピ')
      // **ほかの人の共有が残っている間は開ける。** 取り消した自分の共有はもう並ばない。
      expect(stillOpen.kind === 'レシピ' && stillOpen.recipe?.shares.map((share) => share.name)).toEqual(['あいての共有'])
      await client.close()
      await otherClient.close()
    })

    it('共有が1つも残っていないレシピは開けない', async () => {
      const client = await enteredAsMe()
      const deck = store.saveDeck(me, undefined, { name: 'デッキ', description: '', cards: FULL })
      if (deck === undefined) throw new Error('デッキを残せるはずだった')
      const result = await shared(client, {
        kind: 'デッキを共有する',
        deck,
        name: 'レシピ',
        description: '',
        visibility: 'リンクを知っている人だけ',
        format: undefined,
        restriction: undefined,
      })
      const shareId = result.kind === '共有した' ? result.share.id : ''
      const recipeKey = result.kind === '共有した' ? result.share.recipe : ''

      client.send({ kind: '共有を取り消す', share: shareId })
      await client.waitFor('自分の共有')

      client.received.length = 0
      client.send({ kind: 'レシピを見る', recipe: recipeKey })
      const gone = await client.waitFor('レシピ')
      expect(gone).toEqual({ kind: 'レシピ', recipe: undefined })
      await client.close()
    })

    /** 完了条件 6: 取り消したあと、同じ中身を誰かが共有すると、また開けるようになる。 */
    it('取り消したあと、同じ中身を誰かが共有すると、また開けるようになる', async () => {
      const client = await enteredAsMe()
      const deck = store.saveDeck(me, undefined, { name: 'デッキ', description: '', cards: FULL })
      if (deck === undefined) throw new Error('デッキを残せるはずだった')
      const result = await shared(client, {
        kind: 'デッキを共有する',
        deck,
        name: 'さいしょの共有',
        description: '',
        visibility: 'リンクを知っている人だけ',
        format: undefined,
        restriction: undefined,
      })
      const recipeKey = result.kind === '共有した' ? result.share.recipe : ''
      const firstShareId = result.kind === '共有した' ? result.share.id : ''
      client.send({ kind: '共有を取り消す', share: firstShareId })
      await client.waitFor('自分の共有')

      const again = await shared(client, {
        kind: 'デッキを共有する',
        deck,
        name: 'ふたたびの共有',
        description: '',
        visibility: 'リンクを知っている人だけ',
        format: undefined,
        restriction: undefined,
      })
      expect(again.kind === '共有した' && again.share.recipe).toBe(recipeKey)

      client.received.length = 0
      client.send({ kind: 'レシピを見る', recipe: recipeKey })
      const reopened = await client.waitFor('レシピ')
      // **取り消した共有は取り消されたまま残り、その人の名前で復活しない。**
      expect(reopened.kind === 'レシピ' && reopened.recipe?.shares.map((share) => share.name)).toEqual([
        'ふたたびの共有',
      ])
      await client.close()
    })

    it('/recipe/<鍵> にあたる、共有ごとのコピーができる。コピー後は独立している', async () => {
      const client = await enteredAsMe()
      const deck = store.saveDeck(me, undefined, { name: 'デッキ', description: '', cards: FULL })
      if (deck === undefined) throw new Error('デッキを残せるはずだった')
      const result = await shared(client, {
        kind: 'デッキを共有する',
        deck,
        name: 'コピーされる名前',
        description: 'コピーされる解説',
        visibility: 'リンクを知っている人だけ',
        format: undefined,
        restriction: undefined,
      })
      const shareId = result.kind === '共有した' ? result.share.id : ''

      const decks = await decksAfter(client, { kind: 'デッキをコピーする', origin: { kind: '共有レシピ', share: shareId } })
      const copied = decks.kind === '自分のデッキ' ? decks.decks.find((each) => each.name === 'コピーされる名前') : undefined
      expect(copied?.description).toBe('コピーされる解説')

      // コピー後は独立している——元のレシピを取り消しても、コピーは残る。
      client.send({ kind: '共有を取り消す', share: shareId })
      await client.waitFor('自分の共有')
      expect(store.decksOf(me).some((each) => each.id === copied?.id)).toBe(true)
      await client.close()
    })

    it('取り消された共有からはコピーできない', async () => {
      const client = await enteredAsMe()
      const deck = store.saveDeck(me, undefined, { name: 'デッキ', description: '', cards: FULL })
      if (deck === undefined) throw new Error('デッキを残せるはずだった')
      const result = await shared(client, {
        kind: 'デッキを共有する',
        deck,
        name: 'レシピ',
        description: '',
        visibility: 'リンクを知っている人だけ',
        format: undefined,
        restriction: undefined,
      })
      const shareId = result.kind === '共有した' ? result.share.id : ''
      client.send({ kind: '共有を取り消す', share: shareId })
      await client.waitFor('自分の共有')

      client.send({ kind: 'デッキをコピーする', origin: { kind: '共有レシピ', share: shareId } })

      expect(await client.waitFor('行えなかった')).toEqual({ kind: '行えなかった', reason: 'そのデッキはありません' })
      await client.close()
    })

    /**
     * 完了条件 8: 「一覧に載せる」にしたレシピが一覧で見られ、新着順とコピー数順を切り替えられる。
     *
     * **異なる中身の、どちらも規定を満たすデッキが要る。** `CARDS` は 15 種 × 4 枚がちょうど
     * 60 枚（構築戦の最小枚数）になる大きさで、この中では「規定を満たす別の中身」が作れない
     * （同名 4 枚までの上限に必ず当たる）。この 1 件だけ、種類の多いプールで部屋を立て直す。
     */
    it('一覧に載せたレシピが一覧に出て、新着順とコピー数順を切り替えられる', async () => {
      const richCards: Readonly<Record<string, Card>> = Object.fromEntries(
        Array.from({ length: 16 }, (_, index) => [
          `RICH-${index}`,
          defineUnit({ name: `テスト・一覧${index}`, level: 0, bp: 100, sp: 100, moveIcon: ['上'] }),
        ]),
      )
      const richKeys = Object.keys(richCards)
      const richSupply: CardSupply = {
        pool: richCards,
        presets: [{ id: '既製1', name: 'ひとつめ', cards: richKeys.slice(0, 15).flatMap((key) => Array.from({ length: 4 }, () => key)) }],
        restrictions: [],
      }
      await server.close()
      server = await serve({ ...options, decks: deckSourceFrom(richSupply), deckChoices: deckChoicesOf(richSupply), supply: richSupply })
      // 15 種ずつだが、1 種だけずらしてあるので中身は違う。どちらも 15 種 × 4 枚で規定を満たす。
      const oldCards = richKeys.slice(0, 15).flatMap((key) => Array.from({ length: 4 }, () => key))
      const newCards = richKeys.slice(1, 16).flatMap((key) => Array.from({ length: 4 }, () => key))

      const client = await enteredAsMe()
      const oldDeck = store.saveDeck(me, undefined, { name: 'ふるいデッキ', description: '', cards: oldCards })
      if (oldDeck === undefined) throw new Error('デッキを残せるはずだった')
      const old = await shared(client, {
        kind: 'デッキを共有する',
        deck: oldDeck,
        name: 'ふるいレシピ',
        description: '',
        visibility: '一覧に載せる',
        format: undefined,
        restriction: undefined,
      })
      const oldKey = old.kind === '共有した' ? old.share.recipe : ''

      const newDeck = store.saveDeck(me, undefined, { name: 'あたらしいデッキ', description: '', cards: newCards })
      if (newDeck === undefined) throw new Error('デッキを残せるはずだった')
      await shared(client, {
        kind: 'デッキを共有する',
        deck: newDeck,
        name: 'あたらしいレシピ',
        description: '',
        visibility: '一覧に載せる',
        format: undefined,
        restriction: undefined,
      })

      // 古いレシピだけコピーして、コピー数を稼ぐ。
      client.send({ kind: 'デッキをコピーする', origin: { kind: '共有レシピ', share: old.kind === '共有した' ? old.share.id : '' } })
      await client.waitFor('デッキを保存した')

      client.received.length = 0
      client.send({ kind: 'レシピの一覧を見る', order: '新着' })
      const byNew = await client.waitFor('レシピの一覧')
      expect(byNew.kind === 'レシピの一覧' && byNew.recipes.map((recipe) => recipe.name)).toEqual([
        'あたらしいレシピ',
        'ふるいレシピ',
      ])

      client.received.length = 0
      client.send({ kind: 'レシピの一覧を見る', order: 'コピー数' })
      const byCopies = await client.waitFor('レシピの一覧')
      expect(byCopies.kind === 'レシピの一覧' && byCopies.recipes[0]).toEqual({
        key: oldKey,
        name: 'ふるいレシピ',
        description: '',
        copies: 1,
      })
      await client.close()
    })

    it('「リンクを知っている人だけ」の共有だけのレシピは、一覧に出ない', async () => {
      const client = await enteredAsMe()
      const deck = store.saveDeck(me, undefined, { name: 'デッキ', description: '', cards: FULL })
      if (deck === undefined) throw new Error('デッキを残せるはずだった')
      await shared(client, {
        kind: 'デッキを共有する',
        deck,
        name: '身内向け',
        description: '',
        visibility: 'リンクを知っている人だけ',
        format: undefined,
        restriction: undefined,
      })

      client.send({ kind: 'レシピの一覧を見る', order: '新着' })
      const list = await client.waitFor('レシピの一覧')
      expect(list.kind === 'レシピの一覧' && list.recipes).toEqual([])
      await client.close()
    })

    /**
     * ADR-0022「一覧」節。共有し直すことは自分の共有を編集することなので、公開の段階も
     * 一緒に変わる——「一覧に載せる」で出していた共有を「リンクを知っている人だけ」で
     * 共有し直すと、その共有は一覧から消える。**ほかに公開している人がいなければ、
     * レシピごと一覧から落ちる。**
     */
    it('「一覧に載せる」で共有したあと、同じレシピを「リンクを知っている人だけ」で共有し直すと、一覧から消える', async () => {
      const client = await enteredAsMe()
      const deck = store.saveDeck(me, undefined, { name: 'デッキ', description: '', cards: FULL })
      if (deck === undefined) throw new Error('デッキを残せるはずだった')
      await shared(client, {
        kind: 'デッキを共有する',
        deck,
        name: 'いちらんまえ',
        description: '',
        visibility: '一覧に載せる',
        format: undefined,
        restriction: undefined,
      })

      client.send({ kind: 'レシピの一覧を見る', order: '新着' })
      const before = await client.waitFor('レシピの一覧')
      expect(before.kind === 'レシピの一覧' && before.recipes.map((recipe) => recipe.name)).toEqual(['いちらんまえ'])

      // 同じデッキを、同じ人が「リンクを知っている人だけ」で共有し直す。中身が同じなので
      // レシピの鍵も同じであり、`addShare` はその人の既存の共有を書き換える。
      await shared(client, {
        kind: 'デッキを共有する',
        deck,
        name: 'いいなおし',
        description: '',
        visibility: 'リンクを知っている人だけ',
        format: undefined,
        restriction: undefined,
      })

      client.received.length = 0
      client.send({ kind: 'レシピの一覧を見る', order: '新着' })
      const after = await client.waitFor('レシピの一覧')
      // ほかに「一覧に載せる」共有が無いので、レシピごと消える。
      expect(after.kind === 'レシピの一覧' && after.recipes).toEqual([])
      await client.close()
    })

    /** 同じ場面でも、ほかの人の「一覧に載せる」共有が残っていれば、レシピは一覧に残る。 */
    it('他人の「一覧に載せる」共有が残っていれば、共有し直してもレシピは一覧に残る', async () => {
      const client = await enteredAsMe()
      const myDeck = store.saveDeck(me, undefined, { name: 'デッキ', description: '', cards: FULL })
      const other = store.identify('google', '10002')
      store.rename(other, 'あいて')
      const otherDeck = store.saveDeck(other, undefined, { name: 'あいてのデッキ', description: '', cards: FULL })
      if (myDeck === undefined || otherDeck === undefined) throw new Error('デッキを残せるはずだった')

      const otherClient = new Client(server.port, 'なのっても無駄', signedInOther)
      await otherClient.waitFor('ロビー')

      await shared(client, {
        kind: 'デッキを共有する',
        deck: myDeck,
        name: 'わたしの共有',
        description: '',
        visibility: '一覧に載せる',
        format: undefined,
        restriction: undefined,
      })
      otherClient.send({
        kind: 'デッキを共有する',
        deck: otherDeck,
        name: 'あいての共有',
        description: '',
        visibility: '一覧に載せる',
        format: undefined,
        restriction: undefined,
      })
      await otherClient.waitFor('共有した')

      // 自分の共有だけを「リンクを知っている人だけ」に共有し直す。
      await shared(client, {
        kind: 'デッキを共有する',
        deck: myDeck,
        name: 'ひきさげた',
        description: '',
        visibility: 'リンクを知っている人だけ',
        format: undefined,
        restriction: undefined,
      })

      client.received.length = 0
      client.send({ kind: 'レシピの一覧を見る', order: '新着' })
      const list = await client.waitFor('レシピの一覧')
      // あいての共有だけが残り、レシピは一覧から落ちない。
      expect(list.kind === 'レシピの一覧' && list.recipes.map((recipe) => recipe.name)).toEqual(['あいての共有'])
      await client.close()
      await otherClient.close()
    })

    /**
     * `addShare` は内部で時刻を打つため、自然な流れでは書き込み順と時刻の順が必ず
     * 一致し、`shared_at` を無視して行番号だけで並べる実装でもこのテストは通ってしまう。
     * **時計を差し込んで、書き込み順と時刻の順をわざとずらす。**
     */
    it('新着順は、時計を差し込んで確かめても shared_at の時刻で決まる', async () => {
      // **セッションの有効期限は本物の `Date.now()` で切られる**（`sign-in.ts` の `holderOf`）
      // ので、差し込む時計は本物の現在時刻の近くに置く。ここでずらすのは、2 つの共有の間の
      // 前後関係だけである。
      const base = Date.now()
      let now = base
      const clockedStore = openStore(':memory:', { now: () => now })
      const owner = clockedStore.identify('google', '20001')
      clockedStore.rename(owner, 'とけいのひと')
      const token = 'clocked-token'
      clockedStore.openSession(digest(token), owner)
      const clockedServer = await serve({
        ...options,
        store: clockedStore,
        signIn: createSignIn({
          config: {
            clientId: 'テスト.apps.googleusercontent.com',
            clientSecret: 'ひみつ',
            callback: `http://localhost${CALLBACK_PATH}`,
            returnTo: 'http://localhost:5173/',
          },
          store: clockedStore,
        }),
      })
      try {
        const client = new Client(clockedServer.port, 'なのっても無駄', `revolution_session=${token}`)
        await client.waitFor('自分のデッキ')

        // **通信の層を経由せず、置き場に直接書く。** ここで確かめたいのは並べる側
        // （`serve.ts` の `レシピの一覧を見る`）の振る舞いで、有効なデッキを 2 つ組む手間は
        // 要らない。行番号は「ふるい」のほうが先（若い）だが、時刻はこちらのほうが新しい——
        // 行番号の並びに頼った実装では、この食い違いを見分けられない。
        clockedStore.ensureRecipe('ふるいかぎ', ['TEST-0'])
        clockedStore.ensureRecipe('あたらしいかぎ', ['TEST-1'])
        now = base + 10_000
        clockedStore.addShare('ふるいかぎ', owner, {
          name: 'ふるいレシピ',
          description: '',
          format: '構築戦',
          restriction: undefined,
          visibility: '一覧に載せる',
        })
        now = base
        clockedStore.addShare('あたらしいかぎ', owner, {
          name: 'あたらしいレシピ',
          description: '',
          format: '構築戦',
          restriction: undefined,
          visibility: '一覧に載せる',
        })

        client.send({ kind: 'レシピの一覧を見る', order: '新着' })
        const list = await client.waitFor('レシピの一覧')
        expect(list.kind === 'レシピの一覧' && list.recipes.map((recipe) => recipe.name)).toEqual([
          'ふるいレシピ',
          'あたらしいレシピ',
        ])
        await client.close()
      } finally {
        await clockedServer.close()
        clockedStore.close()
      }
    })

    /**
     * `parse` は `kind` しか見ないので、ここに来る値は型どおりとは限らない
     * （ADR-0010）。**サーバが落ちず、断りが返って、接続が保たれたままであることを確かめる。**
     * 続けて別のメッセージを送って、接続がまだ生きていることを見る。
     */
    describe('壊れたメッセージを送っても落ちない', () => {
      /**
       * 接続がまだ生きていることを確かめる。**`ロビーに戻る` は使えない**——すでにロビーにいる
       * 間に送っても部屋の様子は変わらず、`pushLobby` が「前と同じなら送らない」で黙ってしまう
       * （`serve.ts`）。`デッキを確かめる` は毎回必ず返事が届くので、これで見る。
       */
      async function stillConnected(client: Client): Promise<void> {
        client.received.length = 0
        client.send({ kind: 'デッキを確かめる', cards: [], format: undefined, restriction: undefined })
        expect((await client.waitFor('デッキを確かめた')).kind).toBe('デッキを確かめた')
      }

      it('デッキを共有する: restriction が null でも断られるだけで済む', async () => {
        const client = await enteredAsMe()
        const deck = store.saveDeck(me, undefined, { name: 'デッキ', description: '', cards: ['TEST-0'] })
        if (deck === undefined) throw new Error('デッキを残せるはずだった')

        client.send({
          kind: 'デッキを共有する',
          deck,
          name: 'こわれたきょうゆう',
          description: '',
          visibility: 'リンクを知っている人だけ',
          format: undefined,
          restriction: null as unknown as undefined,
        })

        expect((await client.waitFor('行えなかった')).kind).toBe('行えなかった')
        await stillConnected(client)
        await client.close()
      })

      it('共有を取り消す: share が型どおりでなくても断られるだけで済む', async () => {
        const client = await enteredAsMe()

        client.send({ kind: '共有を取り消す', share: {} as unknown as string })

        expect(await client.waitFor('行えなかった')).toEqual({ kind: '行えなかった', reason: 'その共有はありません' })
        await stillConnected(client)
        await client.close()
      })

      it('共有の公開範囲を変える: visibility が型どおりでなくても断られるだけで済む', async () => {
        const client = await enteredAsMe()
        const deck = store.saveDeck(me, undefined, { name: 'デッキ', description: '', cards: FULL })
        if (deck === undefined) throw new Error('デッキを残せるはずだった')
        const result = await shared(client, {
          kind: 'デッキを共有する',
          deck,
          name: 'レシピ',
          description: '',
          visibility: 'リンクを知っている人だけ',
          format: undefined,
          restriction: undefined,
        })
        const shareId = result.kind === '共有した' ? result.share.id : ''

        client.send({
          kind: '共有の公開範囲を変える',
          share: shareId,
          visibility: {} as unknown as 'リンクを知っている人だけ',
        })

        expect((await client.waitFor('行えなかった')).kind).toBe('行えなかった')
        await stillConnected(client)
        await client.close()
      })

      it('レシピを見る: recipe が型どおりでなくても断られるだけで済む', async () => {
        const client = await enteredAsMe()

        client.send({ kind: 'レシピを見る', recipe: ['はいれつ'] as unknown as string })

        expect((await client.waitFor('行えなかった')).kind).toBe('行えなかった')
        await stillConnected(client)
        await client.close()
      })

      it('レシピの一覧を見る: order が型どおりでなくても断られるだけで済む', async () => {
        const client = await enteredAsMe()

        client.send({ kind: 'レシピの一覧を見る', order: true as unknown as '新着' })

        expect((await client.waitFor('行えなかった')).kind).toBe('行えなかった')
        await stillConnected(client)
        await client.close()
      })
    })
  })

  /** ADR-0019。中継の設定も、WebSocket だけでなく通常の HTTP の道が要るようになる。 */
  it('同じポートで HTTP のログインの口が開いている', async () => {
    const response = await fetch(`http://localhost:${server.port}${SIGN_IN_PATH}`, { redirect: 'manual' })

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('accounts.google.com')
    expect(response.headers.get('set-cookie')).toContain('revolution_state=')
  })

  it('ログインの口でないところは断る', async () => {
    expect((await fetch(`http://localhost:${server.port}/よそ`)).status).toBe(404)
  })
})
