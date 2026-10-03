import { describe, expect, it } from 'vitest'
import { countName, DISPLAY_NAME_LIMIT } from './name-count'

describe('名前の文字数の目安', () => {
  it('絵文字は 1 字と数える', () => {
    expect(countName('😀').length).toBe(1)
    expect(countName('a😀b').length).toBe(3)
  })

  it('20 字で上限になり、19 字では上限でない', () => {
    expect(DISPLAY_NAME_LIMIT).toBe(20)
    expect(countName('あ'.repeat(19)).full).toBe(false)
    expect(countName('あ'.repeat(20))).toEqual({ length: 20, full: true })
  })

  it('前後の空白は数えない', () => {
    expect(countName('abc ').length).toBe(3)
    expect(countName('　abc　').length).toBe(3)
    expect(countName('a b').length).toBe(3)
  })

  it('濁点を分けて書いた文字を 1 字と数える', () => {
    const decomposed = 'が'
    expect(decomposed.length).toBe(2)
    expect(countName(decomposed).length).toBe(1)
  })
})
