import type { FromClient, RoomCode, ToClient } from '@revolution/engine'

/**
 * サーバとの WebSocket 1 本（ADR-0009）。切れたら自分で繋ぎ直す（ADR-0016、#172）。
 *
 * **決まりごとを持たない。** 送るものを JSON にし、届いたものを読んで渡すだけである。届いたもの
 * をどう覚えるかは `session.ts`、何を送るかは呼ぶ側が決める。
 *
 * 誰であるかは繋ぐ時の URL で名乗る（`?participant=`）。同じ合言葉で繋ぎ直せば、部屋はそのままに
 * 続きから打てる（`server` の `serve.ts`）。**繋ぎ直したら `部屋に入る` を送り直す**ところまでが
 * ここの仕事で、いまの盤面を送り直すのはサーバの仕事である（`server` の `room.ts` の `rejoin`）。
 */

/**
 * いま繋がっているか。
 *
 * 3 つしか無い。「繋がっているか」の真偽と「何回目か」を別々に持つと、諦めたのか待っている
 * だけなのかが組み合わせでしか読めなくなる。なりうる形そのものを数え上げる。
 */
export type Link =
  | {
      /** 繋がっている。打てる。 */
      readonly kind: '繋がっている'
    }
  | {
      /** 繋がっておらず、繋ぎ直そうとしている。 */
      readonly kind: '繋ごうとしている'
      /** これから行う試みが切れてから何回目か。まだ一度も繋がっていなければ 0。 */
      readonly attempt: number
    }
  | {
      /** 繋ぎ直すのをやめた。ここから先は自分では戻らない。 */
      readonly kind: '諦めた'
    }

/**
 * 繋ぎ直しを諦めるまでの回数。
 *
 * 待ち時間と合わせて、切れてからおよそ 30 秒で諦める。**無限に試し続けない。** 繋がらない
 * 理由が回線でない場合（サーバが落ちている、URL が違う）、試み続けても画面は「繋ぎ直して
 * います」のまま変わらず、人は待つしかなくなる。諦めたことを出せば、再読み込みという次の
 * 手を選べる。
 */
export const MAX_ATTEMPTS = 10

const FIRST_DELAY_MS = 250
const LONGEST_DELAY_MS = 4000

/**
 * 何回目の試みの前に何ミリ秒待つか。倍々に伸ばし、頭打ちにする。
 *
 * 1 回目を短くするのは、繋がらない大半が一瞬の途切れだからである。頭打ちにするのは、伸ばし
 * 続けると諦めるまでの回数のほとんどが最後の 1 回の待ちに使われてしまうためである。
 *
 * ばらつきは足していない。同じ部屋に 2 人しかおらず（`server` の `room.ts`）、揃って繋ぎ直しても
 * サーバが押し負ける数にならない。
 */
export function delayBeforeAttempt(attempt: number): number {
  return Math.min(FIRST_DELAY_MS * 2 ** (attempt - 1), LONGEST_DELAY_MS)
}

/** まだ一度も繋がっていない状態。呼ぶ側の初期値に使う。 */
export function connectingLink(): Link {
  return { kind: '繋ごうとしている', attempt: 0 }
}

export interface ConnectionOptions {
  /** サーバの WebSocket の URL。`ws://localhost:8787` のような、パスまでのもの。 */
  readonly url: string
  /** 誰であるかを名乗る合言葉。これを知っている人がその席に座れる（ADR-0009）。 */
  readonly participant: string
  /**
   * 繋がった時に入り直す部屋。どこにもいなければ `undefined`（#175）。
   *
   * **値ではなく関数で受け取る。** 入っている部屋は打っている間に変わる（ロビーで作る・入る・
   * 戻る）ので、繋いだ時に決まっていない。繋ぎ直すたびに、その時いる部屋を尋ねる。どこにも
   * いなければ何も送らず、サーバがロビーを送ってくる。
   */
  readonly rejoining: () => RoomCode | undefined
  /** メッセージが届くたびに呼ばれる。 */
  readonly onMessage: (message: ToClient) => void
  /** 繋がりの様子が変わるたびに呼ばれる。 */
  readonly onLinkChanged: (link: Link) => void
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
 * 繋いで、部屋にいるなら入り直す。切れたら間を空けて繋ぎ直す。
 *
 * 入り直しは繋ぐのと同じでよい。同じ合言葉で入り直せば、サーバがいまの盤面を送り直す
 * （ADR-0009）ので、**送れなかった手を貯めて後から流し直すことはしない。** 何を行えるかを
 * 決めるのはサーバで（ADR-0010）、繋ぎ直した先の盤面では、切れる前に押そうとした手がもう
 * 行えないかもしれない。
 */
export function connect(options: ConnectionOptions): Connection {
  let link: Link = connectingLink()
  let socket: WebSocket | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  /** 呼ぶ側が閉じた。ここから先は繋ぎ直さない。 */
  let done = false

  function moveTo(next: Link): void {
    link = next
    options.onLinkChanged(next)
  }

  function open(): void {
    const opening = new WebSocket(addressOf(options.url, options.participant))
    socket = opening

    opening.addEventListener('open', () => {
      moveTo({ kind: '繋がっている' })

      // どこにもいないなら、入り直す先が無い。サーバがロビーを送ってくる（#175）。
      const room = options.rejoining()
      if (room !== undefined) opening.send(JSON.stringify({ kind: '部屋に入る', room } satisfies FromClient))
    })
    // 繋ぎ損ねた時も閉じたことになる（`error` の後に必ず来る）ので、繋ぎ直しはここだけで足りる。
    // 差し替わった後の古い接続からも遅れて届くため、いま張っているものかを確かめる。
    opening.addEventListener('close', () => {
      if (done || socket !== opening) return
      retryLater()
    })
    opening.addEventListener('message', (event: MessageEvent<unknown>) => {
      const message = parse(event.data)
      if (message !== undefined) options.onMessage(message)
    })
  }

  /** 次の試みを予約する。回数を使い切っていたら諦める。 */
  function retryLater(): void {
    const attempt = (link.kind === '繋ごうとしている' ? link.attempt : 0) + 1
    if (attempt > MAX_ATTEMPTS) {
      moveTo({ kind: '諦めた' })
      return
    }

    moveTo({ kind: '繋ごうとしている', attempt })
    timer = setTimeout(() => {
      timer = undefined
      open()
    }, delayBeforeAttempt(attempt))
  }

  open()

  return {
    // 繋がっていない間に押された手は捨てる。貯めない理由は `connect` の説明にある。
    send: (message) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
    },
    close: () => {
      done = true
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      socket?.close()
    },
  }
}
