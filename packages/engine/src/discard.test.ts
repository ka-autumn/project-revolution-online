import { describe, expect, it } from 'vitest'
// スクエアから捨札へのゾーン移動を 1 つにまとめる関数であり、公開する API ではない。
// 誘発が移動前の盤面から起こることを直接確かめるために、ここでだけ使う。
import { discardFromSquares } from './discard.js'
import { defineStrategy, defineUnit, emptyDuelState, instantiate, putOnSquare, triggeredAbility } from './index.js'
import type { CardInstance, DuelState, Square } from './index.js'

const discardWatcher = defineUnit({
  name: 'テスト・あなたのユニットの捨札',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [
    triggeredAbility('あなたのユニットがスクエアから捨札に置かれた時', function* () {}),
  ],
})

const vanilla = defineUnit({ name: 'テスト・バニラ', level: 1, colors: ['赤'], bp: 1000, sp: 1000 })
const strategy = defineStrategy({ name: 'テスト・ストラテジー', level: 1, colors: ['赤'] })

const firstSquare: Square = { row: 0, column: 1 }
const secondSquare: Square = { row: 0, column: 2 }

function boardOf(...placements: readonly (readonly [Square, CardInstance])[]): DuelState {
  return placements.reduce((state, [square, card]) => putOnSquare(state, square, card), emptyDuelState())
}

describe('スクエアから捨札への移動による誘発', () => {
  // 総合ルール 第4部 第7章 6・10（ADR-0006）
  it('能力を持つユニット自身も同時に捨札へ置かれる場合、移動直前の能力が誘発する', () => {
    const state = boardOf(
      [firstSquare, instantiate({ id: '能力持ち', card: discardWatcher, owner: '先攻' })],
      [secondSquare, instantiate({ id: '別のユニット', card: vanilla, owner: '先攻' })],
    )

    const discarded = discardFromSquares(state, ['能力持ち', '別のユニット'])

    expect(discarded.triggered.map((each) => each.source)).toEqual(['能力持ち', '能力持ち'])
  })

  // 総合ルール 第4部 第7章 1、第2部 第21章 1-2（ADR-0006）
  it('「あなたの」は持ち主ではなく支配者を基準に判定する', () => {
    const stolenWatcher = instantiate({
      id: '奪われた能力持ち',
      card: discardWatcher,
      owner: '後攻',
      controller: '先攻',
    })
    const controlledUnit = instantiate({ id: '先攻のユニット', card: vanilla, owner: '先攻' })
    const state = boardOf([firstSquare, stolenWatcher], [secondSquare, controlledUnit])

    const discarded = discardFromSquares(state, ['先攻のユニット'])

    expect(discarded.triggered.map((each) => each.source)).toEqual(['奪われた能力持ち'])
  })

  // 総合ルール 第4部 第7章 6、第14章 4-3（ADR-0006）
  it('ユニット以外のカードが捨札へ置かれても誘発しない', () => {
    const state = boardOf(
      [firstSquare, instantiate({ id: '能力持ち', card: discardWatcher, owner: '先攻' })],
      [secondSquare, instantiate({ id: 'ストラテジー', card: strategy, owner: '先攻' })],
    )

    const discarded = discardFromSquares(state, ['ストラテジー'])

    expect(discarded.triggered).toEqual([])
  })
})
