import { describe, expect, it } from 'vitest'
import { ZONES, isSharedZone } from './index.js'

// ルールの挙動ではなく語彙そのものを固定するテストなので、条番号は付かない（ADR-0006）。
// 出典は CONTEXT.md「ゾーン」。挙動を検証するテストが入りしだい、そちらには条番号を付ける。
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
