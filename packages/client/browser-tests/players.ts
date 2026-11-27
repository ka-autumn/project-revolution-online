import { randomBytes } from 'node:crypto'
import { expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
// サーバの置き場を直に使う。画面のパッケージはサーバに依存しない（ADR-0010）ので、依存には
// 追加せず、テストからだけ相対パスで読み込む。
import { digest } from '../../server/src/sign-in.js'
import { openStore } from '../../server/src/store.js'
import { storePathOf } from './servers.js'
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

/** テストをまたいで重ならない名前を作成する。表示名と部屋の名前の上限（20 文字）に収める。 */
export function uniqueName(base: string): string {
  return `${base}-${randomBytes(3).toString('hex')}`
}

/**
 * ログイン済みの人を 1 人作成して、そのセッションの合言葉を返す。Google でのログインを済ませた
 * あとに置き場に残るもの（身元・表示名・セッション）を、テストが直に書く。
 */
function openSession(server: GameServer, name: string): string {
  const token = randomBytes(32).toString('base64url')
  const store = openStore(storePathOf(server))
  try {
    const participant = store.identify('browser-test', token)
    store.rename(participant, name)
    store.openSession(digest(token), participant)
  } finally {
    store.close()
  }

  return token
}

export interface PlayerOptions {
  readonly viewport?: { readonly width: number; readonly height: number }
}

/** 別のコンテキストで、ログイン済みの人として画面を開き、ロビーに着く。 */
export async function join(
  browser: Browser,
  server: GameServer,
  name: string,
  options: PlayerOptions = {},
): Promise<Page> {
  const context = await browser.newContext(options.viewport === undefined ? {} : { viewport: options.viewport })
  // Cookie はポートを区別しないので、`localhost` に置けば対戦サーバとの握手に付く。
  await context.addCookies([{ name: SESSION_COOKIE, value: openSession(server, name), domain: 'localhost', path: '/' }])
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

/**
 * 画面を使わずに、部屋を 1 つ作成して接続したままにする人。一覧に部屋を並べるためだけに使う。
 * 戻り値の関数で切断する。
 */
export async function seatWaitingPlayer(server: GameServer, roomName: string): Promise<() => void> {
  const cookie = `${SESSION_COOKIE}=${openSession(server, uniqueName('まつ人'))}`
  // Node の `WebSocket` は 2 つ目の引数でヘッダーを渡せるが、DOM の型には無い。
  const socket = new WebSocket(serverUrl(server), { headers: { cookie } } as unknown as string[])
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('error', () => reject(new Error('対戦サーバに接続できませんでした')))
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as { readonly kind: string }
      if (message.kind === 'ロビー') socket.send(JSON.stringify({ kind: '部屋を作る', name: roomName, against: '人間' }))
      if (message.kind === '相手を待っている') resolve()
    })
  })

  return () => socket.close()
}
