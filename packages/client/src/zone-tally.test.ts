import { describe, expect, it } from 'vitest'
import type { Color, Orientation } from '@revolution/engine'
import { ENERGY_COLORS, zoneTally } from './zone-tally.js'
import { emptyBoard, instance, unitFace, withZone } from './test-support.js'
import { visibleCardViewsIn } from './view-model.js'
import type { CardView } from './view-model.js'

/**
 * スマートフォンの、エネルギー・スマッシュのボタンに出す種類ごとの枚数（ADR-0034）。
 */

let issued = 0

/** 色と向きを指定した、表向きの 1 枚。 */
function energy(color: Color, orientation: Orientation = 'リリース'): CardView {
  const id = `エネルギー${++issued}`
  const placed = instance(id, '先攻', { card: unitFace('テスト・エネルギー', { colors: [color] }), orientation })
  const view = visibleCardViewsIn(withZone(emptyBoard('先攻'), '先攻', 'エネルギーゾーン', [{ kind: '見えている', instance: placed }])).get(id)
  if (view === undefined) throw new Error('見えているはず')

  return view
}

function smash(orientation: Orientation = 'リリース'): CardView {
  return { kind: '裏', orientation, at: { player: '先攻', zone: 'スマッシュゾーン', index: 0 } }
}

function times<T>(count: number, make: () => T): T[] {
  return Array.from({ length: count }, make)
}

/** 出す種類を、読みやすい形にする（記号・状態・枚数・格子の位置）。 */
const shown = (cards: readonly CardView[], zone: 'エネルギーゾーン' | 'スマッシュゾーン' = 'エネルギーゾーン') =>
  zoneTally(zone, cards).kinds.map((kind) => [kind.symbol, kind.frozen ? 'F' : 'R', kind.count, kind.column, kind.row])

describe('エネルギーを種類ごとに数える', () => {
  it('列は色の順（赤・青・白・緑・黒）で、上の段がリリース、下の段がフリーズ', () => {
    const cards = [energy('黒'), energy('赤', 'フリーズ'), energy('白'), energy('赤')]

    expect(ENERGY_COLORS).toEqual(['赤', '青', '白', '緑', '黒'])
    expect(shown(cards)).toEqual([
      ['赤', 'R', 1, 1, 1],
      ['赤', 'F', 1, 1, 2],
      ['白', 'R', 1, 2, 1],
      ['白', 'F', 0, 2, 2],
      ['黒', 'R', 1, 3, 1],
      ['黒', 'F', 0, 3, 2],
    ])
  })

  it('1 枚でもある色は、片方が 0 枚でも両方を出す。1 枚も無い色は出さない', () => {
    const tally = zoneTally('エネルギーゾーン', [energy('青', 'フリーズ')])

    expect(tally.kinds.map((kind) => [kind.symbol, kind.frozen, kind.count])).toEqual([
      ['青', false, 0],
      ['青', true, 1],
    ])
  })

  it('0 枚のゾーンには何も出さない', () => {
    const tally = zoneTally('エネルギーゾーン', [])

    expect(tally).toMatchObject({ total: 0, frozen: 0, kinds: [] })
  })

  it('5 色 × 2 状態の 10 種類が、2 桁の枚数が混じっても全部出る', () => {
    const cards = [
      ...times(3, () => energy('赤')),
      energy('赤', 'フリーズ'),
      ...times(2, () => energy('青')),
      energy('青', 'フリーズ'),
      energy('白'),
      energy('白', 'フリーズ'),
      ...times(2, () => energy('緑')),
      energy('緑', 'フリーズ'),
      ...times(10, () => energy('黒')),
      ...times(12, () => energy('黒', 'フリーズ')),
    ]
    const tally = zoneTally('エネルギーゾーン', cards)

    expect(tally.kinds).toHaveLength(10)
    expect(tally.kinds.map((kind) => kind.count)).toEqual([3, 1, 2, 1, 1, 1, 2, 1, 10, 12])
    expect(tally.total).toBe(34)
    expect(tally.frozen).toBe(16)
  })

  /** 盤面に届くエネルギーは表向きに決まっている。型の上で起こりうる裏向きは、落とさず、列の最後に数える。 */
  it('裏向きが混じっても落とさず、色の列のあとの「裏向き」の列に数える', () => {
    const tally = zoneTally('エネルギーゾーン', [energy('赤'), smash('フリーズ')])

    expect(tally.kinds.map((kind) => [kind.symbol, kind.frozen, kind.count, kind.column])).toEqual([
      ['赤', false, 1, 1],
      ['赤', true, 0, 1],
      ['裏', false, 0, 2],
      ['裏', true, 1, 2],
    ])
    expect(tally.label).toBe('エネルギーゾーン（2、うちフリーズ 1。赤 1、フリーズの裏向き 1）の一覧を開く')
  })
})

describe('スマッシュを種類ごとに数える', () => {
  it('色が無いので、リリース・フリーズの 2 つ。上がリリース、下がフリーズ', () => {
    expect(shown([smash(), smash(), smash('フリーズ')], 'スマッシュゾーン')).toEqual([
      ['裏', 'R', 2, 1, 1],
      ['裏', 'F', 1, 1, 2],
    ])
  })

  it('1 枚でもあれば、片方が 0 枚でも両方を出す', () => {
    expect(shown([smash()], 'スマッシュゾーン')).toEqual([
      ['裏', 'R', 1, 1, 1],
      ['裏', 'F', 0, 1, 2],
    ])
  })

  it('0 枚のゾーンには何も出さない', () => {
    expect(zoneTally('スマッシュゾーン', []).kinds).toEqual([])
  })

  it('表向きに置かれた 1 枚（希望ステップ）も、スマッシュの 1 枚として数える', () => {
    expect(zoneTally('スマッシュゾーン', [energy('赤'), smash()]).kinds.map((kind) => kind.count)).toEqual([2, 0])
  })
})

describe('読み上げの名前', () => {
  it('枚数とフリーズの枚数のあとに、種類ごとの枚数を言う。0 枚の種類は言わない', () => {
    const cards = [energy('白'), energy('黒'), energy('白', 'フリーズ'), energy('黒', 'フリーズ')]

    expect(zoneTally('エネルギーゾーン', cards).label).toBe(
      'エネルギーゾーン（4、うちフリーズ 2。白 1、黒 1、フリーズの白 1、フリーズの黒 1）の一覧を開く',
    )
  })

  it('片方の状態が 0 枚の色は、ある状態だけを言う', () => {
    expect(zoneTally('エネルギーゾーン', [energy('赤'), energy('赤')]).label).toBe('エネルギーゾーン（2、うちフリーズ 0。赤 2）の一覧を開く')
  })

  it('0 枚のゾーンは、種類を言わない', () => {
    expect(zoneTally('エネルギーゾーン', []).label).toBe('エネルギーゾーン（0、うちフリーズ 0）の一覧を開く')
    expect(zoneTally('スマッシュゾーン', []).label).toBe('スマッシュゾーン（0、うちフリーズ 0）の一覧を開く')
  })

  it('スマッシュは、枚数とフリーズの枚数で足りるので、種類は添えない', () => {
    expect(zoneTally('スマッシュゾーン', [smash(), smash(), smash('フリーズ')]).label).toBe('スマッシュゾーン（3、うちフリーズ 1）の一覧を開く')
  })
})
