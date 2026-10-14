import { describe, expect, it } from 'vitest'
import {
  CARD_TYPES,
  COLORS,
  defineStrategy,
  defineTrap,
  defineUnit,
  dream,
  hope,
  isIntrusionTrap,
  isStrategy,
  planKeywordsOf,
} from './index.js'
import type { Square, TriggerFilter } from './index.js'

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
    expect(isStrategy(defineTrap({ name: 'テストトラップ', level: 3, triggerIcon: { kind: 'スマッシュ' } }))).toBe(false)
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

// 総合ルール 第2部 第12章、第20章 3-6（ADR-0006）
describe('トリガーアイコン', () => {
  it('侵入のアイコンは、赤く塗られたスクエアを指定して持たせられる', () => {
    const square: Square = { row: 0, column: 1 }
    const trap = defineTrap({ name: 'テストトラップ', level: 1, triggerIcon: { kind: '侵入', squares: [square] } })

    expect(trap.triggerIcon).toEqual({ kind: '侵入', squares: [square] })
  })

  // ADR-0039。印刷されたトリガーアイコンが、攻撃のアイコンと絞り込みを合わせて表している。
  it.each([
    ['メーカーシンボル', 'テスト記号'],
    ['色', '赤'],
    ['属性', 'テスト属性'],
  ] as const)('攻撃のアイコンは、%sの絞り込みを 1 つ持たせられる', (axis, value) => {
    const trap = defineTrap({
      name: 'テストトラップ',
      level: 1,
      triggerIcon: { kind: '攻撃', filter: { axis, value } as TriggerFilter },
    })

    expect(trap.triggerIcon).toEqual({ kind: '攻撃', filter: { axis, value } })
  })

  it('攻撃のアイコンは、絞り込みを持たなくてもよい', () => {
    const trap = defineTrap({ name: 'テストトラップ', level: 1, triggerIcon: { kind: '攻撃' } })

    expect(trap.triggerIcon).toEqual({ kind: '攻撃' })
  })

  it('スマッシュのアイコンは、追加の値を持たない', () => {
    const trap = defineTrap({ name: 'テストトラップ', level: 1, triggerIcon: { kind: 'スマッシュ' } })

    expect(trap.triggerIcon).toEqual({ kind: 'スマッシュ' })
  })

  it('侵入のトラップだけが、侵入のトラップとして絞れる', () => {
    const intrusion = defineTrap({ name: 'テスト侵入', level: 1, triggerIcon: { kind: '侵入', squares: [] } })
    const attack = defineTrap({ name: 'テスト攻撃', level: 1, triggerIcon: { kind: '攻撃' } })
    const smash = defineTrap({ name: 'テストスマッシュ', level: 1, triggerIcon: { kind: 'スマッシュ' } })

    expect([intrusion, attack, smash].map(isIntrusionTrap)).toEqual([true, false, false])
  })
})

// 総合ルール 第5部 第1章 2・第5部 第3章 2（ADR-0006）。対戦画面のカードの面のアイコン（ADR-0027）。
describe('プランゾーンに関わるキーワード能力', () => {
  it('「夢」「希望」を持つカードは、その名前が並ぶ', () => {
    const card = defineUnit({
      name: 'テストユニット',
      level: 1,
      bp: 1000,
      sp: 1000,
      abilities: [dream, hope(function* () {})],
    })

    expect(planKeywordsOf(card)).toEqual(['夢', '希望'])
  })

  it('持たなければ空', () => {
    const card = defineUnit({ name: 'テストユニット', level: 1, bp: 1000, sp: 1000 })

    expect(planKeywordsOf(card)).toEqual([])
  })
})
