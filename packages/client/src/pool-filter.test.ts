import { describe, expect, it } from 'vitest'
import type { WireCardFace, WirePoolCard } from '@revolution/engine'
import { COLORLESS, emptyFilter, filterChoicesOf, filterPool, isFiltering, toggled } from './pool-filter.js'
import type { PoolFilter } from './pool-filter.js'
import { unitFace } from './test-support.js'

/**
 * プールを絞り込む（#193）。
 *
 * 軸はカードに印刷されている項目と、エキスパンションである（ADR-0021）。識別子は意味の無い文字列に
 * して、**識別子では絞り込んでいないこと**が分かるようにする。
 */

function card(key: string, face: WireCardFace, expansions: readonly string[] = []): WirePoolCard {
  return { key, face, expansions }
}

const RED_UNIT = card('い', unitFace('テスト・赤の戦士', { colors: ['赤'], level: 1, bp: 2000, sp: 1000, moveIcon: ['上'] }), [
  'テストの第1弾',
])
const BLUE_UNIT = card('ろ', unitFace('テスト・青の戦士', { colors: ['青'], level: 3, bp: 5000, sp: 3000, moveIcon: ['右', '左'] }), [
  'テストの第1弾',
  'テストの第2弾',
])
const TWO_COLORS = card('は', unitFace('テスト・赤青の戦士', { colors: ['赤', '青'], level: 2, stars: 1, attributes: ['テスト属性'] }))
const STRATEGY = card(
  'に',
  {
    type: 'ストラテジー',
    name: 'テスト・一手',
    level: 0,
    colors: [],
    stars: 0,
    reverseStars: 1,
    attributes: [],
    text: ['カードを１枚引く。'],
  },
  ['テストの第2弾'],
)
const TRAP = card('ほ', {
  type: 'トラップ',
  name: 'テスト・落とし穴',
  level: 1,
  colors: ['黒'],
  stars: 0,
  reverseStars: 0,
  attributes: [],
  text: [],
  triggerIcon: [{ row: 1, column: 1 }],
})

const POOL = [RED_UNIT, BLUE_UNIT, TWO_COLORS, STRATEGY, TRAP]

function keysWith(filter: Partial<PoolFilter>): readonly string[] {
  return filterPool(POOL, { ...emptyFilter(), ...filter }).map((each) => each.key)
}

describe('絞り込む', () => {
  it('何も選んでいなければ、全部残る', () => {
    expect(keysWith({})).toEqual(['い', 'ろ', 'は', 'に', 'ほ'])
  })

  /** 同じ軸の中は「どれか」。 */
  it('色を 2 つ選べば、どちらかの色を持つカードが残る。2 色のカードも残る', () => {
    expect(keysWith({ colors: ['赤', '青'] })).toEqual(['い', 'ろ', 'は'])
  })

  it('無色を選べば、色を持たないカードが残る', () => {
    expect(keysWith({ colors: [COLORLESS] })).toEqual(['に'])
  })

  /** 軸どうしは「どれも」。 */
  it('違う軸で選べば、どれにも合うカードだけが残る', () => {
    expect(keysWith({ colors: ['赤', '青'], levels: [3] })).toEqual(['ろ'])
  })

  it('種別で絞り込める', () => {
    expect(keysWith({ types: ['ストラテジー', 'トラップ'] })).toEqual(['に', 'ほ'])
  })

  /** ＢＰはユニットだけが持つ。区切ったのに持たないカードが残ると、範囲に入っているように見える。 */
  it('ＢＰの範囲で区切ると、範囲に入るユニットだけが残る', () => {
    expect(keysWith({ bp: { min: 1500, max: undefined } })).toEqual(['い', 'ろ'])
    expect(keysWith({ bp: { min: undefined, max: 2000 } })).toEqual(['い', 'は'])
  })

  it('ＳＰの範囲でも区切れる', () => {
    expect(keysWith({ sp: { min: 2000, max: 3000 } })).toEqual(['ろ'])
  })

  it('属性・スターアイコン・ムーブアイコン・トリガーアイコンで絞り込める', () => {
    expect(keysWith({ attributes: ['テスト属性'] })).toEqual(['は'])
    expect(keysWith({ stars: ['スターアイコンあり', 'リバーススターアイコンあり'] })).toEqual(['は', 'に'])
    expect(keysWith({ stars: ['どちらも無し'] })).toEqual(['い', 'ろ', 'ほ'])
    expect(keysWith({ moveIcons: ['左'] })).toEqual(['ろ'])
    expect(keysWith({ triggerIcons: filterChoicesOf([TRAP]).triggerIcons })).toEqual(['ほ'])
  })

  /** #193。1 枚が複数のエキスパンションに入りうる。 */
  it('エキスパンションで絞り込める。複数に入っているカードは、どれを選んでも残る', () => {
    expect(keysWith({ expansions: ['テストの第1弾'] })).toEqual(['い', 'ろ'])
    expect(keysWith({ expansions: ['テストの第2弾'] })).toEqual(['ろ', 'に'])
  })

  it('テキストは名前と印刷されているテキストの両方から探し、全角と半角を区別しない', () => {
    expect(keysWith({ text: '戦士' })).toEqual(['い', 'ろ', 'は'])
    expect(keysWith({ text: '1枚' })).toEqual(['に'])
  })

  it('空白で区切ると、どれも含むカードが残る', () => {
    expect(keysWith({ text: '赤　戦士' })).toEqual(['い', 'は'])
  })

  /** 画面とサーバは別々に配られる。古いサーバはエキスパンションを添えてこない。 */
  it('エキスパンションが届いていないカードは、エキスパンションで絞り込むと残らない', () => {
    const old = { key: 'へ', face: RED_UNIT.face } as unknown as WirePoolCard

    expect(filterPool([old], { ...emptyFilter(), expansions: ['テストの第1弾'] })).toEqual([])
    expect(filterChoicesOf([old]).expansions).toEqual([])
  })
})

describe('選べるもの', () => {
  it('プールに実際にあるものだけが、決まった順に並ぶ', () => {
    const choices = filterChoicesOf(POOL)

    expect(choices.types).toEqual(['ユニット', 'ストラテジー', 'トラップ'])
    expect(choices.colors).toEqual(['赤', '黒', '青', COLORLESS])
    expect(choices.levels).toEqual([0, 1, 2, 3])
    expect(choices.attributes).toEqual(['テスト属性'])
    expect(choices.moveIcons).toEqual(['上', '左', '右'])
    expect(choices.expansions).toEqual(['テストの第1弾', 'テストの第2弾'])
    expect(choices.triggerIcons).toHaveLength(1)
  })
})

describe('絞り込みの状態', () => {
  it('何も選んでいなければ絞り込んでいない。空白だけの文字も同じ', () => {
    expect(isFiltering(emptyFilter())).toBe(false)
    expect(isFiltering({ ...emptyFilter(), text: '  ' })).toBe(false)
    expect(isFiltering({ ...emptyFilter(), levels: [1] })).toBe(true)
  })

  it('選んでいれば外し、選んでいなければ足す', () => {
    expect(toggled(['赤'], '青')).toEqual(['赤', '青'])
    expect(toggled(['赤', '青'], '赤')).toEqual(['青'])
  })
})
