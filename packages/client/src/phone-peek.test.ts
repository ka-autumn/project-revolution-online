import { describe, expect, it } from 'vitest'
import { indexOfSquare } from '@revolution/engine'
import type { LegalAction, Player, WirePerspective } from '@revolution/engine'
import { pickView } from './input-model.js'
import type { AskView } from './input-model.js'
import { PEEK_CARD_MIN_WIDTH, peekAimOf, peekCardWidth, peekGuide, peekMaxHeight, peekStats } from './phone-peek.js'
import { emptyBoard, instance, unitFace, withZone } from './test-support.js'
import { visibleCardViewsIn } from './view-model.js'

/**
 * スマートフォンで、行き先を選んでいる間に出す低い詳細の帯（ADR-0034）。
 *
 * 帯を出すかどうかは、届いた手から作ったシート（`PickView.sheet`）だけで決める（ADR-0010）。
 */

function board(viewer: Player = '先攻'): WirePerspective {
  const inHand = instance('てふだの1枚', viewer, { card: unitFace('テスト・手札の戦士') })
  const onSquare = instance('スクエアの1枚', viewer, { card: unitFace('テスト・盤上の戦士') })
  const withHand = withZone(emptyBoard(viewer), viewer, '手札', [{ kind: '見えている', instance: inHand }])

  return {
    ...withHand,
    squares: withHand.squares.map((each, index) => (index === indexOfSquare({ row: 1, column: 1 }) ? [onSquare] : each)),
  }
}

const PLACE: LegalAction = { kind: 'エネルギーを置く', card: 'てふだの1枚' }
const PLAY_LEFT: LegalAction = { kind: 'カードをプレイする', declaration: { card: 'てふだの1枚', square: { row: 0, column: 0 } } }
const PLAY_RIGHT: LegalAction = { kind: 'カードをプレイする', declaration: { card: 'てふだの1枚', square: { row: 0, column: 2 } } }
const MOVE: LegalAction = {
  kind: 'ユニットを移動する',
  unit: 'スクエアの1枚',
  destination: { row: 0, column: 1 },
}
const SMASH: LegalAction = { kind: 'スマッシュする', unit: 'スクエアの1枚' }

function sheetOf(actions: readonly LegalAction[], card: string): AskView | undefined {
  return pickView(board(), actions, { card }, undefined).sheet
}

describe('低い詳細の帯を出すか', () => {
  it('置く場所を選ぶ手だけのカードは、帯を出す', () => {
    expect(peekAimOf(sheetOf([PLAY_LEFT, PLAY_RIGHT], 'てふだの1枚'))).toBe('カードをプレイする')
  })

  it('移動する手だけのスクエアのユニットは、帯を出す', () => {
    expect(peekAimOf(sheetOf([MOVE], 'スクエアの1枚'))).toBe('ユニットを移動する')
  })

  it('手が 2 種類以上あるカードは、シートで聞く', () => {
    expect(peekAimOf(sheetOf([PLACE, PLAY_LEFT, PLAY_RIGHT], 'てふだの1枚'))).toBeUndefined()
    expect(peekAimOf(sheetOf([MOVE, SMASH], 'スクエアの1枚'))).toBeUndefined()
  })

  it('押すと送る手が 1 つだけのカード（確認）は、シートで聞く', () => {
    expect(peekAimOf(sheetOf([PLACE], 'てふだの1枚'))).toBeUndefined()
    expect(peekAimOf(sheetOf([SMASH], 'スクエアの1枚'))).toBeUndefined()
  })

  it('何も選んでいなければ、帯は無い', () => {
    expect(peekAimOf(undefined)).toBeUndefined()
  })

  it('手が 1 件も並ばないシートは、帯にしない', () => {
    expect(peekAimOf({ heading: 'x', lead: 'y', options: [] })).toBeUndefined()
  })
})

describe('案内の文', () => {
  it('移動なら移動先、置くなら置く場所を選ばせる', () => {
    expect(peekGuide('ユニットを移動する').join('')).toBe('移動先を選択してください')
    expect(peekGuide('カードをプレイする').join('')).toBe('置く場所を選択してください')
    expect(peekGuide('トラップとしてプレイする').join('')).toBe('置く場所を選択してください')
  })

  it('2 つに分けるのは「を」の後ろで、言葉の途中では割らない', () => {
    expect(peekGuide('ユニットを移動する')).toEqual(['移動先を', '選択してください'])
    expect(peekGuide('カードをプレイする')).toEqual(['置く場所を', '選択してください'])
  })
})

describe('数値の札', () => {
  function faceUp(values: Parameters<typeof unitFace>[1], extra: Parameters<typeof instance>[2] = {}) {
    const placed = instance('1枚', '先攻', { card: unitFace('テスト・戦士', values), ...extra })
    const view = visibleCardViewsIn(withZone(emptyBoard('先攻'), '先攻', '手札', [{ kind: '見えている', instance: placed }])).get('1枚')
    if (view?.kind !== '表') throw new Error('表のはず')

    return view
  }

  it('手札のカードは Lv・BP・SP', () => {
    const stats = peekStats(faceUp({ level: 2, bp: 3000, sp: 1500 }), '手札など')

    expect(stats.map((each) => [each.label, each.value, each.change])).toEqual([
      ['Lv', 2, undefined],
      ['BP', 3000, undefined],
      ['SP', 1500, undefined],
    ])
  })

  it('スクエアのユニットは BP・SP・ダメージ（レベルは出さない）', () => {
    const stats = peekStats(faceUp({ bp: 3000, sp: 1500 }, { damage: 2 }), 'スクエア')

    expect(stats.map((each) => each.label)).toEqual(['BP', 'SP', 'ダメージ'])
  })

  it('ダメージは、受けていれば赤くする印（受けている）を付け、受けていなければ付けない', () => {
    expect(peekStats(faceUp({}, { damage: 2 }), 'スクエア').at(-1)).toMatchObject({ label: 'ダメージ', value: 2, change: '受けている' })
    expect(peekStats(faceUp({}), 'スクエア').at(-1)).toMatchObject({ label: 'ダメージ', value: 0, change: undefined })
  })

  it('BP・SP を持たないカードは、持つ値だけを出す', () => {
    const placed = instance('策', '先攻', { card: { type: 'ストラテジー', name: 'テスト・策', level: 3, colors: ['青'], stars: 0, reverseStars: 0, attributes: [], keywords: [], text: [] } })
    const view = visibleCardViewsIn(withZone(emptyBoard('先攻'), '先攻', '手札', [{ kind: '見えている', instance: placed }])).get('策')
    if (view?.kind !== '表') throw new Error('表のはず')

    expect(peekStats(view, '手札など').map((each) => each.label)).toEqual(['Lv'])
  })

  /** 継続効果で BP が変わっているときの向きは、カードの絵と同じ判定（`bpDirection`）をそのまま使う。 */
  it('BP が元の値より上がっていれば「上」、下がっていれば「下」で、読み上げに元の値を添える', () => {
    const up = unitFace('テスト・戦士', { bp: 2000 })
    const placed = instance('1枚', '先攻', { card: up })
    const squareBoard: WirePerspective = {
      ...emptyBoard('先攻'),
      squares: emptyBoard('先攻').squares.map((each, index) => (index === 0 ? [placed] : each)),
      effective: [{ card: '1枚', bp: 3000, attributes: [] }],
    }
    const raised = visibleCardViewsIn(squareBoard).get('1枚')
    const lowered = visibleCardViewsIn({ ...squareBoard, effective: [{ card: '1枚', bp: 1000, attributes: [] }] }).get('1枚')
    if (raised?.kind !== '表' || lowered?.kind !== '表') throw new Error('表のはず')

    expect(peekStats(raised, 'スクエア')[0]).toMatchObject({ label: 'BP', value: 3000, change: '上', valueReading: '3000（元は 2000）' })
    expect(peekStats(lowered, 'スクエア')[0]).toMatchObject({ label: 'BP', value: 1000, change: '下', valueReading: '1000（元は 2000）' })
    expect(peekStats(raised, 'スクエア')[1]).toMatchObject({ label: 'SP', change: undefined, valueReading: '1000' })
  })
})

describe('帯の大きさ', () => {
  it('帯の上は、自分の手札の段の上端までしか伸ばさない', () => {
    expect(peekMaxHeight(844, 560)).toBe(284)
  })

  it('手札の段が帯の下より下にあれば、伸ばさない', () => {
    expect(peekMaxHeight(500, 560)).toBe(0)
  })

  it('カードの幅は、中身の高さの 3 分の 2。小さくなりすぎない', () => {
    expect(peekCardWidth(150)).toBe(100)
    expect(peekCardWidth(30)).toBe(PEEK_CARD_MIN_WIDTH)
  })
})
