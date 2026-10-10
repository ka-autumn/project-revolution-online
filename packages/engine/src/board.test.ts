import { describe, expect, it } from 'vitest'
import { isArea, rowOfArea } from './board.js'
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

describe('エリアの呼び名から行へ', () => {
  // 総合ルール 第2部 第22章 6-1。`areaOf` の逆になる。
  it('どのプレイヤーから見ても、行に直してから呼び名に戻すと元のエリアになる', () => {
    for (const player of ['先攻', '後攻'] as const) {
      for (const area of AREAS) {
        expect(areaOf(player, { row: rowOfArea(player, area), column: 0 })).toBe(area)
      }
    }
  })

  // 総合ルール 第2部 第22章 6
  it('同じ呼び名でも、見るプレイヤーによって指す行が入れ替わる', () => {
    expect(rowOfArea('先攻', '敵エリア')).toBe(rowOfArea('後攻', '味方エリア'))
    expect(rowOfArea('先攻', '敵エリア')).not.toBe(rowOfArea('後攻', '敵エリア'))
    expect(rowOfArea('先攻', '中央エリア')).toBe(rowOfArea('後攻', '中央エリア'))
  })

  it('エリアの呼び名だけがエリアとして見分けられる', () => {
    expect(isArea('敵エリア')).toBe(true)
    expect(isArea('左ライン')).toBe(false)
    expect(isArea({ row: 0, column: 0 })).toBe(false)
    expect(isArea(undefined)).toBe(false)
  })
})
