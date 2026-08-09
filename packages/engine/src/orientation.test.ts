import { describe, expect, it } from 'vitest'
import { ORIENTATIONS } from './index.js'

// 総合ルール 第2部 第24章 1（ADR-0006）
describe('カードの向き', () => {
  it('リリース状態かフリーズ状態かのいずれかである', () => {
    expect(ORIENTATIONS).toEqual(['リリース', 'フリーズ'])
  })
})
