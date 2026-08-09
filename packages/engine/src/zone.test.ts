import { describe, expect, it } from 'vitest'
import { PLAYER_ZONES, SHARED_ZONES, ZONES } from './index.js'
import type { PlayerZone, SharedZone, Zone } from './index.js'

// 総合ルール 第2部 第21章 1（ADR-0006）
describe('ゾーン', () => {
  it('12 種類ある', () => {
    expect(ZONES).toEqual([
      '山札',
      'プランゾーン',
      '手札',
      '捨札',
      'エネルギーゾーン',
      'スマッシュゾーン',
      'スクエア',
      'トラップゾーン',
      'リムーブゾーン',
      'バンク',
      'リゾルブゾーン',
      'パートナーゾーン',
    ])
  })

  it('スクエア・バンク・リゾルブゾーンは両プレイヤーで共有する', () => {
    expect(SHARED_ZONES).toEqual(['スクエア', 'バンク', 'リゾルブゾーン'])
  })

  it('それ以外はプレイヤーごとに存在する', () => {
    expect(PLAYER_ZONES).toEqual([
      '山札',
      'プランゾーン',
      '手札',
      '捨札',
      'エネルギーゾーン',
      'スマッシュゾーン',
      'トラップゾーン',
      'リムーブゾーン',
      'パートナーゾーン',
    ])
  })

  it('12 種類は、プレイヤーごとのゾーンと共有するゾーンのどちらかである', () => {
    expect([...ZONES].sort()).toEqual([...PLAYER_ZONES, ...SHARED_ZONES].sort())
  })

  it('共有するゾーンとプレイヤーごとのゾーンは型で区別される', () => {
    // @ts-expect-error バンクは両プレイヤーで共有するゾーンである
    const shared: PlayerZone = 'バンク'
    // @ts-expect-error 手札はプレイヤーごとに存在するゾーンである
    const perPlayer: SharedZone = '手札'
    expect([shared, perPlayer]).toEqual(['バンク', '手札'])
  })

  // 総合ルール 第2部 第21章 1-1
  it('スクエアをまとめてとらえた場所の呼び方はゾーンとして扱えない', () => {
    // @ts-expect-error バトルスペースはスクエアのグループの呼び方であってゾーンではない
    const battleSpace: Zone = 'バトルスペース'
    // @ts-expect-error 味方エリアはスクエアのグループの呼び方であってゾーンではない
    const area: Zone = '味方エリア'
    // @ts-expect-error 左ラインはスクエアのグループの呼び方であってゾーンではない
    const line: Zone = '左ライン'
    expect(ZONES).not.toContain(battleSpace)
    expect(ZONES).not.toContain(area)
    expect(ZONES).not.toContain(line)
  })
})
