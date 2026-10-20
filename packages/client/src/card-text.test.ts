import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cardTextParagraphs } from './card-text.js'

class TextElement {
  readonly childNodes: TextElement[] = []
  readonly attributes = new Map<string, string>()
  className = ''
  private ownText = ''

  constructor(readonly nodeType = 1) {}

  get children(): TextElement[] {
    return this.childNodes.filter((child) => child.nodeType === 1)
  }

  get textContent(): string {
    return this.ownText + this.childNodes.map((child) => child.textContent).join('')
  }

  set textContent(text: string) {
    this.ownText = text
  }

  append(...children: TextElement[]): void {
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
    createElement: () => new TextElement(),
    createTextNode: (text: string) => Object.assign(new TextElement(3), { textContent: text }),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('能力テキストの行頭', () => {
  it('複数の能力・キーワード能力・発動条件を、届いた順にそれぞれ●付きで表示する', () => {
    const source = ['見本の効果の行。', '夢（キーワード能力）', '《見本の条件》見本の処理。']
    expect(cardTextParagraphs(source).map((paragraph) => paragraph.textContent)).toEqual(source.map((line) => `●${line}`))
    expect(source).toEqual(['見本の効果の行。', '夢（キーワード能力）', '《見本の条件》見本の処理。'])
  })

  it('1行だけのテキストにも●を付ける', () => {
    expect(cardTextParagraphs(['見本の行。'])[0]?.textContent).toBe('●見本の行。')
  })

  it('テキストが無ければ行を作らず、空白だけの行にも●を付けない', () => {
    expect(cardTextParagraphs([])).toEqual([])
    expect(cardTextParagraphs(['', ' \t', '　']).map((paragraph) => paragraph.textContent)).toEqual(['', '', ''])
  })

  it('●は読み上げ対象から外し、本文は別のテキストとして残す', () => {
    const [paragraph] = cardTextParagraphs(['見本の行。'])
    expect(paragraph?.children[0]?.getAttribute('aria-hidden')).toBe('true')
    expect(paragraph?.children[0]?.textContent).toBe('●')
    expect(paragraph?.childNodes[1]?.textContent).toBe('見本の行。')
    expect(paragraph?.getAttribute('aria-hidden')).toBeNull()
  })

  it('長い本文でも折り返し用の●を増やさず、1行につき1つだけ付ける', () => {
    const text = '見本の長い本文。'.repeat(30)
    const [paragraph] = cardTextParagraphs([text], 'card__panel-line')
    expect(paragraph?.textContent).toBe(`●${text}`)
    expect(paragraph?.className).toBe('card__panel-line')
  })
})
