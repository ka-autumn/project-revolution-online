// @vitest-environment happy-dom
import type { PublicShare, ShareId, ShareKey } from '@revolution/engine'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountPublicShare } from './public-share.js'
import { publicShareElement } from './render.js'
import { BUILD_FAILED } from './screen-root.js'

/*
 * 公開ページ（`/share/<鍵>`）が根の部品を通して表示すること（ADR-0078）。対戦サーバの代わりに、
 * 偽の `fetch` と WebSocket を置く。
 */

// 組み立ての途中で投げる場面を作成するために差し替える。ふだんは本物を呼ぶ。
vi.mock('./render.js', async (load) => {
  const original = await load<typeof import('./render.js')>()
  return { ...original, publicShareElement: vi.fn(original.publicShareElement) }
})

class FakeSocket extends EventTarget {
  static readonly OPEN = 1
  readyState = 1
  send(): void {}
  close(): void {}
}

const share: PublicShare = {
  sharer: 'わけた人',
  name: '架空のデッキ',
  description: '',
  format: '構築戦',
  restriction: undefined,
  cards: [],
  authenticated: true,
  share: 'share-1' as ShareId,
}

let root: HTMLElement

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket)
  root = document.createElement('main')
  document.body.append(root)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

/** 対戦サーバの返事を、テストが決定した時点で届ける。 */
function pendingReply(): (response: Response) => void {
  let reply: (response: Response) => void = () => undefined
  vi.stubGlobal('fetch', () => new Promise<Response>((resolve) => (reply = resolve)))
  return (response) => reply(response)
}

const open = (): Promise<void> =>
  mountPublicShare(root, {
    serverOrigin: 'http://localhost:1',
    wsUrl: 'ws://localhost:1',
    participant: 'じぶん',
    key: 'key-1' as ShareKey,
    signInUrl: 'http://localhost:1/sign-in',
  })

describe('公開ページを根の部品を通して表示する（ADR-0078）', () => {
  it('返事が届くまでは「読み込んでいます…」を表示し、届いたら本体に替える。#board は直に書き換えない', async () => {
    const reply = pendingReply()
    const replaced = vi.spyOn(root, 'replaceChildren')

    const mounted = open()
    expect(root.textContent).toBe('読み込んでいます…')

    reply(Response.json(share))
    await mounted

    expect(root.querySelector('.public-share .decks__title')!.textContent).toBe('架空のデッキ')
    expect(root.querySelectorAll('.public-share')).toHaveLength(1)
    expect(replaced).not.toHaveBeenCalled()
  })

  it('開けなかった時は、見つからないことを表示する。#board は直に書き換えない', async () => {
    const reply = pendingReply()
    const replaced = vi.spyOn(root, 'replaceChildren')

    const mounted = open()
    reply(new Response('', { status: 404 }))
    await mounted

    expect(root.querySelector('.public-share')!.textContent).toContain('この共有は見つかりませんでした')
    expect(root.querySelectorAll('.public-share')).toHaveLength(1)
    expect(replaced).not.toHaveBeenCalled()
  })

  it('「コピーする」を押すと、本体を組み立て直して進み具合を表示する', async () => {
    const reply = pendingReply()
    const mounted = open()
    reply(Response.json(share))
    await mounted

    root.querySelector<HTMLButtonElement>('.public-share__copy button')!.click()

    expect(root.querySelector('.public-share__copy button')!.textContent).toBe('繋いでいます…')
    expect(root.querySelectorAll('.public-share')).toHaveLength(1)
  })

  it('組み立てで投げても白い画面にせず、断りの 1 行を表示する', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failure = new Error('組み立てに失敗した')
    vi.mocked(publicShareElement).mockImplementationOnce(() => {
      throw failure
    })
    const reply = pendingReply()

    const mounted = open()
    reply(Response.json(share))
    await mounted

    await vi.waitFor(() => expect(root.textContent).toBe(BUILD_FAILED))
    expect(error).toHaveBeenCalledWith('画面を組み立てられませんでした:', failure)
  })
})
