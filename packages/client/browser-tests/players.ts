import { randomBytes } from 'node:crypto'
import { expect } from '@playwright/test'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { sessionToken } from './servers.js'
import type { GameServer } from './servers.js'

declare global {
  interface Window {
    /** 画面が受け取って、処理し終えたメッセージ。`join` が仕込む。 */
    handled: string[]
  }
}

/** サーバがログイン済みの人を見分ける Cookie の名前（`sign-in.ts`）。 */
const SESSION_COOKIE = 'revolution_session'

const serverUrl = (server: GameServer): string => `ws://localhost:${server.port}`

/** テストをまたいで重ならない部屋の名前を作成する。名前の上限（20 文字）に収める。 */
export function uniqueName(base: string): string {
  return `${base}-${randomBytes(3).toString('hex')}`
}

/** いまのテストで使っている人と接続。`releasePlayers` が片付ける。 */
const seated: { readonly server: GameServer; readonly token: string }[] = []
const opened: (BrowserContext | WebSocket)[] = []

/** まだ使っていない人を 1 人選んで、そのセッションの合言葉を返す。 */
function takeSession(server: GameServer): string {
  const seat = seated.filter((each) => each.server === server).length
  if (seat >= server.people) {
    throw new Error(`${server.port} 番のサーバに用意した人数（${server.people} 人）では足りません`)
  }
  const token = sessionToken(seat)
  seated.push({ server, token })

  return token
}

/** 画面を使わずに、その人として対戦サーバへ接続する。 */
function connect(server: GameServer, token: string): WebSocket {
  const cookie = `${SESSION_COOKIE}=${token}`

  // Node の `WebSocket` は 2 つ目の引数でヘッダーを渡せるが、DOM の型には無い。
  return new WebSocket(serverUrl(server), { headers: { cookie } } as unknown as string[])
}

/** `wanted` の種類のメッセージが届くまで待つ。届いたメッセージの種類は `onKind` にも渡す。 */
function waitForKind(socket: WebSocket, wanted: string, onKind: (kind: string) => void = () => {}): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.addEventListener('error', () => reject(new Error('対戦サーバに接続できませんでした')))
    socket.addEventListener('message', (event) => {
      const { kind } = JSON.parse(String(event.data)) as { readonly kind: string }
      onKind(kind)
      if (kind === wanted) resolve()
    })
  })
}

/** 部屋は接続を切っても残るので、部屋にいる人は出てロビーに戻る。 */
async function returnToLobby(server: GameServer, token: string): Promise<void> {
  const socket = connect(server, token)
  // ロビーにいる人には接続した時にロビーが届く。部屋にいる人には、出た後に届く。
  socket.addEventListener('open', () => socket.send(JSON.stringify({ kind: 'ロビーに戻る' })))
  await waitForKind(socket, 'ロビー')
  socket.close()
}

/**
 * テストで使った接続を閉じて、全員をロビーに戻す。次のテストが同じ人を使うためである。
 * テストが失敗した時も呼ぶように、`test.afterEach` に渡す。
 */
export async function releasePlayers(): Promise<void> {
  for (const connection of opened.splice(0)) await connection.close()
  for (const { server, token } of seated.splice(0)) await returnToLobby(server, token)
}

export interface PlayerOptions {
  readonly viewport?: { readonly width: number; readonly height: number }
}

/** 別のコンテキストで、ログイン済みの人として画面を開き、ロビーに着く。 */
export async function join(browser: Browser, server: GameServer, options: PlayerOptions = {}): Promise<Page> {
  const context = await browser.newContext(options.viewport === undefined ? {} : { viewport: options.viewport })
  opened.push(context)
  // Cookie はポートを区別しないので、`localhost` に置けば対戦サーバとの握手に付く。
  await context.addCookies([{ name: SESSION_COOKIE, value: takeSession(server), domain: 'localhost', path: '/' }])
  const page = await context.newPage()
  await page.addInitScript(() => {
    window.handled = []
    const Original = window.WebSocket
    window.WebSocket = class extends Original {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols)
        // 画面より先に登録されるので、1 拍おいて、画面がこのメッセージを処理し終えてから書き留める。
        this.addEventListener('message', (event) => {
          setTimeout(() => window.handled.push(String(event.data)), 0)
        })
      }
    }
  })
  await page.goto(`/?server=${encodeURIComponent(serverUrl(server))}`)
  await expect(page.locator('.lobby__rooms')).toBeVisible()

  return page
}

/** デッキ一覧を開いて、最初に配られるデッキを組み始める。 */
export async function openDeckEditor(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'デッキ一覧' }).click()
  await page.getByRole('button', { name: '✏️ 編集' }).click()
  await expect(page.locator('.pool__item').first()).toBeVisible()
}

/** ロビーの入力欄から、対人戦の部屋を作成する。 */
export async function createRoom(page: Page, roomName: string): Promise<void> {
  await page.locator('.lobby__name').fill(roomName)
  await page.getByRole('button', { name: '対戦部屋を作成する' }).click()
}

/** その文字列を含むメッセージが画面に届いて、処理し終わるまで待つ。 */
export async function waitForMessage(page: Page, text: string): Promise<void> {
  await page.waitForFunction((needle) => window.handled.some((data) => data.includes(needle)), text)
}

/** 画面を使わずに、部屋を 1 つ作成して接続したままにする人。一覧に部屋を並べるためだけに使う。 */
export async function seatWaitingPlayer(server: GameServer, roomName: string): Promise<void> {
  const socket = connect(server, takeSession(server))
  opened.push(socket)
  await waitForKind(socket, '相手を待っている', (kind) => {
    if (kind === 'ロビー') socket.send(JSON.stringify({ kind: '部屋を作る', name: roomName, against: '人間' }))
  })
}
