import { describe, expect, it } from 'vitest'
// ダメージを与えるためだけに `dealDamage` を使う。engine の中から盤面を組み替えるための
// 関数であり、公開する API ではない。
import { dealDamage } from './duel.js'
import {
  cardsIn,
  cardsOn,
  defineStrategy,
  defineUnit,
  emptyDuelState,
  instantiate,
  passPriority,
  putOnSquare,
  triggeredAbility,
} from './index.js'
import type { CardInstance, Chooser, DuelState, Square } from './index.js'

// 検証したいルールだけを持つ架空のテストカード（ADR-0002）。
const vanilla = defineUnit({ name: 'テスト・バニラ', level: 1, colors: ['赤'], bp: 1000, sp: 1000 })

const strategy = defineStrategy({ name: 'テスト・ストラテジー', level: 1, colors: ['赤'] })

/** 「エネルギーフェイズの始め」に誘発する能力を持つテストカード。効果は何もしない。 */
const beginner = defineUnit({
  name: 'テスト・エネルギーフェイズの始め',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [triggeredAbility('エネルギーフェイズの始め', function* () {})],
})

const someSquare: Square = { row: 2, column: 1 }
const anotherSquare: Square = { row: 0, column: 1 }

const chooseFirst: Chooser = (candidates) => candidates[0]

function pass(state: DuelState): DuelState {
  return passPriority(state, chooseFirst)
}

type Placement = readonly [Square, CardInstance]

function boardOf(...placements: readonly Placement[]): DuelState {
  return placements.reduce((state, [square, card]) => putOnSquare(state, square, card), emptyDuelState())
}

const idsOf = (cards: readonly CardInstance[]) => cards.map((card) => card.id)

// 総合ルール 第4部 第14章 2（ADR-0006）
describe('ルールエフェクトを解決する時', () => {
  const placed = boardOf([someSquare, instantiate({ id: 'ストラテジー', card: strategy, owner: '先攻' })])

  it('カードが置かれた時点では、まだ解決されない', () => {
    expect(idsOf(cardsOn(placed, someSquare))).toEqual(['ストラテジー'])
  })

  it('プレイヤーが優先権を獲得する時に解決される', () => {
    // 放棄すると、もう一方のプレイヤーが優先権を獲得する。
    expect(cardsOn(pass(placed), someSquare)).toEqual([])
  })
})

// 総合ルール 第4部 第14章 4-3（ADR-0006）
describe('ユニット以外のカードがスクエアにある', () => {
  it('持ち主の捨札に置かれる', () => {
    // 持ち主は後攻だが、支配しているのは先攻であるカード。
    const stolen = instantiate({ id: '奪われたストラテジー', card: strategy, owner: '後攻', controller: '先攻' })
    const checked = pass(boardOf([someSquare, stolen]))

    expect(idsOf(cardsIn(checked, '後攻', '捨札'))).toEqual(['奪われたストラテジー'])
    expect(cardsIn(checked, '先攻', '捨札')).toEqual([])
  })

  it('同じスクエアにいるユニットはそのまま残る', () => {
    const checked = pass(
      boardOf(
        [someSquare, instantiate({ id: 'ユニット', card: vanilla, owner: '先攻' })],
        [someSquare, instantiate({ id: 'ストラテジー', card: strategy, owner: '先攻' })],
      ),
    )

    expect(idsOf(cardsOn(checked, someSquare))).toEqual(['ユニット'])
  })
})

// 総合ルール 第4部 第14章 4-7（ADR-0006）
describe('同じプレイヤーが支配するユニットが同じスクエアに重なる', () => {
  const stacked = boardOf(
    [someSquare, instantiate({ id: '先にいたユニット', card: vanilla, owner: '先攻' })],
    [someSquare, instantiate({ id: '後から置かれたユニット', card: vanilla, owner: '先攻' })],
  )

  it('後から置かれたユニットが持ち主の捨札に置かれる', () => {
    expect(idsOf(cardsIn(pass(stacked), '先攻', '捨札'))).toEqual(['後から置かれたユニット'])
  })

  it('先に置かれていたユニットはスクエアに残る', () => {
    expect(idsOf(cardsOn(pass(stacked), someSquare))).toEqual(['先にいたユニット'])
  })

  // 支配者が違うユニットが重なった場合に起きるのはバトルの発生（同 4-4）であって、
  // このルールエフェクトではない。バトルの側は `battle.test.ts` で見るので、ここでは
  // 捨札に置かれないことだけを見る。
  it('支配者が違うユニットが重なっても、捨札には置かれない', () => {
    const opposed = boardOf(
      [anotherSquare, instantiate({ id: '先攻のユニット', card: vanilla, owner: '先攻' })],
      [anotherSquare, instantiate({ id: '後攻のユニット', card: vanilla, owner: '後攻' })],
    )

    expect(idsOf(cardsOn(pass(opposed), anotherSquare))).toEqual(['先攻のユニット', '後攻のユニット'])
  })
})

// 総合ルール 第4部 第14章 4-5（ADR-0006）
describe('ＢＰが 0 以下のユニットがスクエアにある', () => {
  // ＢＰを修整する効果はまだ書けないので、印刷されたＢＰが 0 のカードで見る
  // （`card.ts` の `bpOf`）。
  const zeroBp = defineUnit({ name: 'テスト・ＢＰ0', level: 1, colors: ['赤'], bp: 0, sp: 1000 })

  it('持ち主の捨札に置かれる', () => {
    const placed = boardOf([someSquare, instantiate({ id: 'ＢＰ0のユニット', card: zeroBp, owner: '先攻' })])

    expect(idsOf(cardsIn(pass(placed), '先攻', '捨札'))).toEqual(['ＢＰ0のユニット'])
  })
})

// 総合ルール 第4部 第14章 4-6（ADR-0006）
describe('ＢＰと同じかそれ以上のダメージを受けたユニットがスクエアにある', () => {
  /** ＢＰ1000 のユニットがそのダメージを受けている盤面。 */
  function damaged(amount: number): DuelState {
    const unit = defineUnit({ name: 'テスト・ＢＰ1000', level: 1, colors: ['赤'], bp: 1000, sp: 1000 })
    const placed = boardOf([someSquare, instantiate({ id: '傷ついたユニット', card: unit, owner: '先攻' })])
    return dealDamage(placed, '傷ついたユニット', amount)
  }

  it('持ち主の捨札に置かれる', () => {
    expect(idsOf(cardsIn(pass(damaged(1000)), '先攻', '捨札'))).toEqual(['傷ついたユニット'])
  })

  it('ＢＰより小さいダメージでは捨札に置かれない', () => {
    expect(idsOf(cardsOn(pass(damaged(999)), someSquare))).toEqual(['傷ついたユニット'])
  })
})

// 総合ルール 第4部 第14章 2、第7章 2（ADR-0006）
describe('ルールエフェクトと誘発型能力の順序', () => {
  it('優先権を獲得する時、ルールエフェクトが解決された後に誘発型能力がバンクに入る', () => {
    const board = boardOf(
      [someSquare, instantiate({ id: '能力持ち', card: beginner, owner: '先攻' })],
      [anotherSquare, instantiate({ id: 'ストラテジー', card: strategy, owner: '後攻' })],
    )
    // リリースフェイズを終わらせるとエネルギーフェイズに入り、その始めに能力が誘発する。
    const energyPhase = pass(pass(board))

    expect(energyPhase.turn.phase).toBe('エネルギーフェイズ')
    // 優先権が発生した時点で、ルールエフェクトは解決済みで、能力はバンクに入っている。
    expect(cardsOn(energyPhase, anotherSquare)).toEqual([])
    expect(energyPhase.bank.map((banked) => banked.source)).toEqual(['能力持ち'])
    expect(energyPhase.triggered).toEqual([])
  })
})
