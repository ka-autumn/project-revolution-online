import { describe, expect, it } from 'vitest'
import { AREAS, BATTLE_SPACE, LINES, areaOf, lineOf } from './index.js'

// 総合ルール 第2部 第22章 2（ADR-0006）
describe('バトルスペース', () => {
  it('9 つのスクエアからなる', () => {
    expect(BATTLE_SPACE).toHaveLength(9)
  })

  // 総合ルール 第2部 第21章 1-1
  it('スクエアはそれぞれが単独のゾーンなので、9 つは互いに別のものとして区別できる', () => {
    const identities = new Set(BATTLE_SPACE.map((square) => `${square.row},${square.column}`))
    expect(identities.size).toBe(BATTLE_SPACE.length)
  })
})

// 総合ルール 第2部 第22章 1（ADR-0006）
describe('エリアとライン', () => {
  // 総合ルール 第2部 第22章 6
  it('エリアは味方エリア・中央エリア・敵エリアの 3 つ', () => {
    expect(AREAS).toEqual(['味方エリア', '中央エリア', '敵エリア'])
  })

  // 総合ルール 第2部 第22章 4
  it('ラインは左ライン・中央ライン・右ラインの 3 つ', () => {
    expect(LINES).toEqual(['左ライン', '中央ライン', '右ライン'])
  })

  // 総合ルール 第2部 第22章 5
  it('エリアは横 1 列の 3 つのスクエアからなり、バトルスペースに 3 つある', () => {
    const rows = new Set(BATTLE_SPACE.map((square) => square.row))
    expect(rows.size).toBe(AREAS.length)
    for (const row of rows) {
      expect(BATTLE_SPACE.filter((square) => square.row === row)).toHaveLength(3)
    }
  })

  // 総合ルール 第2部 第22章 3
  it('ラインは縦 1 列の 3 つのスクエアからなり、バトルスペースに 3 つある', () => {
    const columns = new Set(BATTLE_SPACE.map((square) => square.column))
    expect(columns.size).toBe(LINES.length)
    for (const column of columns) {
      expect(BATTLE_SPACE.filter((square) => square.column === column)).toHaveLength(3)
    }
  })

  // 総合ルール 第2部 第22章 6
  it('あるプレイヤーの味方エリアは、相手の敵エリアになる', () => {
    const square = { row: 0, column: 1 } as const

    expect(areaOf('先攻', square)).toBe('味方エリア')
    expect(areaOf('後攻', square)).toBe('敵エリア')
  })

  // 総合ルール 第2部 第22章 4
  it('あるプレイヤーの右ラインは、相手の左ラインになる', () => {
    const square = { row: 1, column: 2 } as const

    expect(lineOf('先攻', square)).toBe('右ライン')
    expect(lineOf('後攻', square)).toBe('左ライン')
  })

  // 総合ルール 第2部 第22章 4。中央ラインだけは、どちらから見ても同じ呼び名になる。
  it('中央ラインは、どちらから見ても中央ラインである', () => {
    const square = { row: 1, column: 1 } as const

    expect(lineOf('先攻', square)).toBe('中央ライン')
    expect(lineOf('後攻', square)).toBe('中央ライン')
  })
})
