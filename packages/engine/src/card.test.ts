import { describe, expect, it } from 'vitest'
import { CARD_TYPES, COLORS, defineStrategy, defineTrap, defineUnit, isStrategy } from './index.js'

// 総合ルール 第2部 第4章 2（ADR-0006）
describe('種別', () => {
  it('ユニット・ストラテジー・トラップ・超必殺ストラテジー！の 4 つ', () => {
    expect(CARD_TYPES).toEqual(['ユニット', 'ストラテジー', 'トラップ', '超必殺ストラテジー！'])
  })

  // 総合ルール 第2部 第4章 2-1
  it('超必殺ストラテジー！はストラテジーとして扱う', () => {
    const superFinisher = defineStrategy({ name: 'テスト超必殺', type: '超必殺ストラテジー！', level: 3 })

    expect(isStrategy(superFinisher)).toBe(true)
    expect(isStrategy(defineStrategy({ name: 'テストストラテジー', level: 3 }))).toBe(true)
    expect(isStrategy(defineTrap({ name: 'テストトラップ', level: 3 }))).toBe(false)
  })
})

// 総合ルール 第2部 第3章 4（ADR-0006）
describe('色', () => {
  it('赤・黒・青・白・緑の 5 色', () => {
    expect(COLORS).toEqual(['赤', '黒', '青', '白', '緑'])
  })

  // 総合ルール 第2部 第3章 3
  it('レベルに色付きのエネルギー・シンボルを含まないカードは無色', () => {
    const colorless = defineUnit({ name: 'テスト無色', level: 1, bp: 1000, sp: 1000 })

    expect(colorless.colors).toEqual([])
  })
})

// カード記述 API そのものの振る舞いであってルールの挙動ではないため、条番号は付けない
// （ADR-0006）。
describe('カードを定義する', () => {
  it('検証したいルールに関係のない項目は省いて書ける', () => {
    const unit = defineUnit({ name: 'テストユニット', level: 1, colors: ['赤'], bp: 1000, sp: 1000 })

    expect(unit.type).toBe('ユニット')
    expect(unit.abilities).toEqual([])
  })
})
