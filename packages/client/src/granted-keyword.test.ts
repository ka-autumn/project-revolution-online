import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { grantedParagraphs, keywordElement, keywordsElement } from './granted-keyword.js'

class FakeNode {
  readonly childNodes: FakeNode[] = []
  readonly attributes = new Map<string, string>()
  className = ''
  private ownText = ''

  constructor(
    readonly tagName = '',
    readonly nodeType = 1,
  ) {}

  get children(): FakeNode[] {
    return this.childNodes.filter((child) => child.nodeType === 1)
  }

  get textContent(): string {
    return this.ownText + this.childNodes.map((child) => child.textContent).join('')
  }

  set textContent(text: string) {
    this.ownText = text
  }

  append(...children: FakeNode[]): void {
    this.childNodes.push(...children)
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }
}

beforeEach(() => {
  vi.stubGlobal('document', {
    createElement: (tag: string) => new FakeNode(tag),
    createElementNS: (_namespace: string, tag: string) => new FakeNode(tag),
    createTextNode: (text: string) => Object.assign(new FakeNode('', 3), { textContent: text }),
  })
})
afterEach(() => vi.unstubAllGlobals())

/** 並びの中のアイコン（本物の DOM では `children` が `HTMLCollection` なので、配列にして扱う）。 */
const iconsOf = (row: HTMLElement | undefined): readonly Element[] => Array.from(row?.children ?? [])

// ADR-0073。与えられたキーワード能力は、書かれたものと見分けて表示する。読み上げの文は、見た目では気づけないので、ここで確認する。
describe('キーワード能力のアイコン', () => {
  it('書かれたものは、キーワードの名前だけを読み上げ、強調のクラスを付けない', () => {
    const node = keywordElement('夢')

    expect(node.getAttribute('aria-label')).toBe('夢')
    expect(node.className).toBe('keyword keyword--夢')
  })

  it('与えられたものは、「（与えられた能力）」を添えて読み上げ、強調のクラスを付ける', () => {
    const node = keywordElement('夢', true)

    expect(node.getAttribute('aria-label')).toBe('夢（与えられた能力）')
    expect(node.className).toBe('keyword keyword--夢 keyword--与えられた')
    expect(node.getAttribute('role')).toBe('img')
  })

  it('並びのうち、与えられたものだけを強調する', () => {
    const row = keywordsElement(['夢', '希望'], ['夢'])

    expect(iconsOf(row).map((icon) => icon.getAttribute('aria-label'))).toEqual(['夢（与えられた能力）', '希望'])
  })

  it('与えられたものが無ければ、どれも強調しない', () => {
    const row = keywordsElement(['夢', '希望'])

    expect(iconsOf(row).map((icon) => icon.className.includes('keyword--与えられた'))).toEqual([false, false])
  })

  it('持たなければ、並びを作らない', () => {
    expect(keywordsElement([], [])).toBeUndefined()
  })
})

describe('カードの詳細に追加する、与えられたキーワード能力の行', () => {
  it('与えられたものが無ければ、行を作らない', () => {
    expect(grantedParagraphs([])).toEqual([])
  })

  it('1 つにつき 1 行で、「夢」の文は書かれたテキストと同じ文になる', () => {
    const [paragraph, ...rest] = grantedParagraphs(['夢'])

    expect(rest).toEqual([])
    expect(paragraph?.className).toBe('card__granted')
    expect(paragraph?.textContent).toBe('与えられた能力: 夢（プランゾーンからプレイできる）')
  })

  it('行頭の十字は読み上げの対象から外し、「与えられた能力」の注記は、読み上げ専用の要素で伝える', () => {
    const [paragraph] = grantedParagraphs(['夢'])
    const [mark, reading] = paragraph?.children ?? []

    expect(mark?.getAttribute('aria-hidden')).toBe('true')
    expect(mark?.getAttribute('class')).toBe('card__granted-mark')
    expect(reading?.className).toBe('card__granted-reading')
    expect(reading?.textContent).toBe('与えられた能力: ')
  })

  it('「●」は付けない', () => {
    const [paragraph] = grantedParagraphs(['夢'])

    expect(paragraph?.textContent.includes('●')).toBe(false)
  })
})
