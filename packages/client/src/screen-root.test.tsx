// @vitest-environment happy-dom
import { cleanup, render, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILD_FAILED, ScreenRoot, showScreen } from './screen-root.js'
import type { Screen } from './screen-root.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

const paragraph = (text: string): HTMLElement => {
  const node = document.createElement('p')
  node.textContent = text
  return node
}

const chunkOf = (build: (chunk: HTMLElement) => void): Screen => ({ kind: 'かたまり', build })

/** `#board` の代わりの要素。 */
const board = (): HTMLElement => {
  const node = document.createElement('main')
  document.body.append(node)
  return node
}

describe('かたまり（ADR-0078）', () => {
  it('組み立ては、画面を表示する呼び出しが返るまでに終わる', () => {
    const root = board()

    showScreen(root, chunkOf((chunk) => chunk.replaceChildren(paragraph('はじめ'))))

    expect(root.textContent).toBe('はじめ')
  })

  it('描き直しても、中身には差分を当てず、組み立てた側が置いたものがそのまま残る', () => {
    const { container, rerender } = render(<ScreenRoot screen={chunkOf((chunk) => chunk.append(paragraph('1 回目')))} />)
    const chunk = container.firstElementChild
    const first = chunk!.firstElementChild

    rerender(<ScreenRoot screen={chunkOf((node) => node.append(paragraph('2 回目')))} />)

    expect(container.firstElementChild).toBe(chunk)
    expect(chunk!.firstElementChild).toBe(first)
    expect([...chunk!.children].map((node) => node.textContent)).toEqual(['1 回目', '2 回目'])
  })

  it('描き直すと、中身が組み立ての結果に置き換わる', () => {
    const { container, rerender } = render(
      <ScreenRoot screen={chunkOf((chunk) => chunk.replaceChildren(paragraph('前の画面')))} />,
    )

    rerender(<ScreenRoot screen={chunkOf((chunk) => chunk.replaceChildren(paragraph('次の画面')))} />)

    expect(container.textContent).toBe('次の画面')
  })
})

describe('組み立てられなかった時（ADR-0078）', () => {
  const failure = new Error('組み立てに失敗した')
  const broken = chunkOf((chunk) => {
    chunk.replaceChildren(paragraph('途中まで'))
    throw failure
  })

  it('白い画面にせず、断りの 1 行を表示して、投げたものを console.error に出力する', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const root = board()

    showScreen(root, broken)

    await waitFor(() => expect(root.textContent).toBe(BUILD_FAILED))
    expect(root.querySelector('p.status')).not.toBeNull()
    expect(error).toHaveBeenCalledWith('画面を組み立てられませんでした:', failure)
  })

  it('次に画面を渡されたら、組み立て直す', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const root = board()
    showScreen(root, broken)
    await waitFor(() => expect(root.textContent).toBe(BUILD_FAILED))

    showScreen(root, chunkOf((chunk) => chunk.replaceChildren(paragraph('直った画面'))))

    expect(root.textContent).toBe('直った画面')
  })
})

describe('1 行だけの画面', () => {
  it('かたまりを、同じ根の 1 行に替える', () => {
    const root = board()
    showScreen(root, chunkOf((chunk) => chunk.replaceChildren(paragraph('前の画面'))))

    showScreen(root, { kind: '一行', text: 'ログインへ移動しています' })

    expect(root.children).toHaveLength(1)
    expect(root.querySelector('p.status')!.textContent).toBe('ログインへ移動しています')
  })
})
