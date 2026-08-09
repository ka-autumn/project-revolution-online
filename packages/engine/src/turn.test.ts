import { describe, expect, it } from 'vitest'
import { PHASES } from './index.js'

// 総合ルール 第3部 第4章 2（ADR-0006）
describe('ターン', () => {
  it('6 つの連続するフェイズで構成される', () => {
    expect(PHASES).toEqual([
      'リリースフェイズ',
      'ドローフェイズ',
      'エネルギーフェイズ',
      'メインフェイズ',
      'スマッシュフェイズ',
      'リカバリーフェイズ',
    ])
  })
})
