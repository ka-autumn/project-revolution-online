// @vitest-environment happy-dom
import { NOT_SIGNED_IN } from '@revolution/engine'
import type { ToClient } from '@revolution/engine'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from './index.js'
import { settlePhoneScroll } from './phone-scroll.js'
import { nameElement } from './render.js'
import { BUILD_FAILED } from './screen-root.js'

/*
 * `mount` が画面を根の部品を通して表示すること（ADR-0078）。対戦サーバの代わりに、サーバから
 * 届いたことにするメッセージを流せる偽の WebSocket を置く。
 */

// 組み立ての途中で投げる場面を作成するために差し替える。ふだんは本物を呼ぶ。
vi.mock('./render.js', async (load) => {
  const original = await load<typeof import('./render.js')>()
  return { ...original, nameElement: vi.fn(original.nameElement) }
})

// 描いた後の処理（Preact の外）で投げる場面を作成するために差し替える。ふだんは本物を呼ぶ。
vi.mock('./phone-scroll.js', async (load) => {
  const original = await load<typeof import('./phone-scroll.js')>()
  return { ...original, settlePhoneScroll: vi.fn(original.settlePhoneScroll) }
})

class FakeSocket extends EventTarget {
  static latest: FakeSocket | undefined
  static readonly OPEN = 1
  readyState = 1

  constructor() {
    super()
    FakeSocket.latest = this
  }

  send(): void {}
  close(): void {}

  opened(): void {
    this.dispatchEvent(new Event('open'))
  }

  receive(message: ToClient): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }))
  }
}

let close: (() => void) | undefined
let root: HTMLElement

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket)
  sessionStorage.clear()
  root = document.createElement('main')
  document.body.append(root)
})

afterEach(() => {
  close?.()
  close = undefined
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.mocked(settlePhoneScroll).mockClear()
  document.body.replaceChildren()
})

const start = (): FakeSocket => {
  close = mount(root, { url: 'ws://localhost:1', signInUrl: 'http://localhost:1/sign-in', participant: 'じぶん' })
  return FakeSocket.latest!
}

describe('根の部品を通して表示する（ADR-0078）', () => {
  it('ログインが要る時は、#board を直に書き換えずに「ログインへ移動しています」を表示する', () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined)
    const socket = start()
    const replaced = vi.spyOn(root, 'replaceChildren')

    socket.receive({ kind: '行えなかった', reason: NOT_SIGNED_IN })

    expect(assign).toHaveBeenCalledWith('http://localhost:1/sign-in')
    expect(root.children).toHaveLength(1)
    expect(root.querySelector('p.status')!.textContent).toBe('ログインへ移動しています')
    expect(replaced).not.toHaveBeenCalled()
  })

  it('描いた後の処理で投げても、白い画面にせず、#board を直に書き換えずに断りの 1 行を表示する', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failure = new Error('寸法を測れなかった')
    vi.mocked(settlePhoneScroll).mockImplementationOnce(() => {
      throw failure
    })
    const replaced = vi.spyOn(root, 'replaceChildren')

    start()

    expect(root.children).toHaveLength(1)
    expect(root.querySelector('p.status')!.textContent).toBe(BUILD_FAILED)
    expect(error).toHaveBeenCalledWith('画面を組み立てられませんでした:', failure)
    expect(replaced).not.toHaveBeenCalled()
  })

  it('後片付けをすると、#board から Preact の木を外す', () => {
    start()
    expect(root.querySelector('.screen-chunk')).not.toBeNull()

    close!()
    close = undefined

    expect(root.childNodes).toHaveLength(0)
  })

  it('組み立てで投げた時は、描いた後の処理へ進まない', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const socket = start()
    socket.opened()
    vi.mocked(settlePhoneScroll).mockClear()
    vi.mocked(nameElement).mockImplementationOnce(() => {
      throw new Error('組み立てに失敗した')
    })

    socket.receive({ kind: '名前を決めてほしい' } as ToClient)

    await vi.waitFor(() => expect(root.textContent).toBe(BUILD_FAILED))
    expect(settlePhoneScroll).not.toHaveBeenCalled()
  })
})
