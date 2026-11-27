import { expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { SERVER_PORT } from './ports.js'

declare global {
  interface Window {
    /** 画面が受け取って、処理し終えたメッセージ。`join` が仕込む。 */
    handled: string[]
  }
}

const SERVER_URL = `ws://localhost:${SERVER_PORT}`

let joined = 0

/** テストをまたいで重ならない名乗りを作成する。ログインの無い立て方では、名乗りがそのまま表示名になる。 */
export function uniqueName(base: string): string {
  joined += 1
  return `${base}-${Date.now().toString(36)}-${joined}`
}

export interface PlayerOptions {
  readonly viewport?: { readonly width: number; readonly height: number }
}

/** 別のコンテキストで画面を開き、名乗ってロビーに着く。 */
export async function join(browser: Browser, name: string, options: PlayerOptions = {}): Promise<Page> {
  const context = await browser.newContext(options.viewport === undefined ? {} : { viewport: options.viewport })
  const page = await context.newPage()
  await page.addInitScript(() => {
    window.handled = []
    const Original = window.WebSocket
    window.WebSocket = class extends Original {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols)
        // 画面より先に付くので、1 拍おいて、画面がこのメッセージを処理し終えてから書き留める。
        this.addEventListener('message', (event) => {
          setTimeout(() => window.handled.push(String(event.data)), 0)
        })
      }
    }
  })
  await page.goto(`/?participant=${encodeURIComponent(name)}&server=${encodeURIComponent(SERVER_URL)}`)
  await expect(page.locator('.lobby__rooms')).toBeVisible()

  return page
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
export async function seatWaitingPlayer(roomName: string): Promise<() => void> {
  const socket = new WebSocket(`${SERVER_URL}/?participant=${encodeURIComponent(uniqueName('まつ人'))}`)
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('error', () => reject(new Error('対戦サーバに繋げませんでした')))
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as { readonly kind: string }
      if (message.kind === 'ロビー') socket.send(JSON.stringify({ kind: '部屋を作る', name: roomName, against: '人間' }))
      if (message.kind === '相手を待っている') resolve()
    })
  })

  return () => socket.close()
}
