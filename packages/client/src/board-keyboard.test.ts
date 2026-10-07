import { describe, expect, it } from 'vitest'
import { gridTarget, linearTarget } from './board-keyboard.js'

describe('linearTarget', () => {
  it('左右・上下で隣へ移る', () => {
    expect(linearTarget(4, 1, 'ArrowRight')).toBe(2)
    expect(linearTarget(4, 1, 'ArrowDown')).toBe(2)
    expect(linearTarget(4, 1, 'ArrowLeft')).toBe(0)
    expect(linearTarget(4, 1, 'ArrowUp')).toBe(0)
  })

  it('端では止まり、反対の端へは回らない', () => {
    expect(linearTarget(4, 3, 'ArrowRight')).toBeUndefined()
    expect(linearTarget(4, 0, 'ArrowLeft')).toBeUndefined()
  })

  it('Home・End で両端へ飛ぶ', () => {
    expect(linearTarget(4, 2, 'Home')).toBe(0)
    expect(linearTarget(4, 1, 'End')).toBe(3)
    expect(linearTarget(4, 0, 'Home')).toBeUndefined()
  })

  it('空の区画・矢印以外のキーでは動かない', () => {
    expect(linearTarget(0, 0, 'ArrowRight')).toBeUndefined()
    expect(linearTarget(4, 1, 'a')).toBeUndefined()
  })
})

describe('gridTarget', () => {
  // 3×3 を行の順に並べたもの。
  const cells = Array.from({ length: 9 }, (_, i) => ({ row: Math.floor(i / 3), col: i % 3 }))

  it('画面で見える向きのまま、上下左右の隣へ移る', () => {
    expect(gridTarget(cells, 4, 'ArrowUp')).toBe(1)
    expect(gridTarget(cells, 4, 'ArrowDown')).toBe(7)
    expect(gridTarget(cells, 4, 'ArrowLeft')).toBe(3)
    expect(gridTarget(cells, 4, 'ArrowRight')).toBe(5)
  })

  it('端では止まり、行をまたいで回らない', () => {
    expect(gridTarget(cells, 2, 'ArrowRight')).toBeUndefined()
    expect(gridTarget(cells, 0, 'ArrowUp')).toBeUndefined()
    expect(gridTarget(cells, 8, 'ArrowDown')).toBeUndefined()
    expect(gridTarget(cells, 3, 'ArrowLeft')).toBeUndefined()
  })

  it('Home・End で最初と最後のスクエアへ飛ぶ', () => {
    expect(gridTarget(cells, 4, 'Home')).toBe(0)
    expect(gridTarget(cells, 4, 'End')).toBe(8)
  })
})
