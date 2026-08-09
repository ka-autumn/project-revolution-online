import { describe, expect, it } from 'vitest'
import { PLAYERS } from './index.js'

// 総合ルール 第3部 第1章 5（ADR-0006）
describe('プレイヤー', () => {
  it('デュエルには先攻と後攻の 2 人が参加する', () => {
    expect(PLAYERS).toEqual(['先攻', '後攻'])
  })
})
