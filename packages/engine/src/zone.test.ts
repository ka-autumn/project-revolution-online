import { describe, expect, it } from 'vitest'
import { ZONES, isSharedZone } from './index.js'

// 総合ルール 第2部 第21章 1（ADR-0006）
describe('ゾーン', () => {
  it('12 種類ある', () => {
    expect(ZONES).toHaveLength(12)
  })

  it('スクエア・バンク・リゾルブゾーンは両プレイヤーで共有する', () => {
    expect(ZONES.filter(isSharedZone)).toEqual(['スクエア', 'バンク', 'リゾルブゾーン'])
  })

  it('それ以外はプレイヤーごとに存在する', () => {
    expect(ZONES.filter((zone) => !isSharedZone(zone))).toEqual([
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
})
