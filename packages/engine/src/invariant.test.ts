import { describe, expect, it } from 'vitest'
// エネルギーゾーンを組み立てるためだけに `putInZone` を使う。engine の中からゾーンを
// 差し替えるための関数であり、公開する API ではない。
import { putInZone } from './duel.js'
import { cardIdsOf, checkBoardInvariants, defineUnit, emptyDuelState, instantiate, putOnSquare } from './index.js'
import type { DuelState, Square } from './index.js'

const testCard = defineUnit({ name: 'テストカード', level: 0, bp: 100, sp: 100 })
const homeSquare: Square = { row: 0, column: 0 }

/** カード 2 枚が別々の場所にある盤面。 */
function stateWithTwoCards(): DuelState {
  const onSquare = putOnSquare(emptyDuelState(), homeSquare, instantiate({ id: 'スクエアのカード', card: testCard, owner: '先攻' }))
  return putInZone(onSquare, '先攻', '手札', [instantiate({ id: '手札のカード', card: testCard, owner: '先攻' })])
}

// ADR-0005: 盤面の不変条件チェック（カードの総数が変わらない、など）。
describe('カードの id の集まり', () => {
  it('スクエア・ゾーン・リゾルブゾーンにあるすべてのカードの id を集める', () => {
    expect(cardIdsOf(stateWithTwoCards())).toEqual(new Set(['スクエアのカード', '手札のカード']))
  })
})

describe('盤面の不変条件', () => {
  it('基準にしたのと同じ盤面なら崩れていない', () => {
    const state = stateWithTwoCards()

    expect(checkBoardInvariants(state, cardIdsOf(state))).toEqual([])
  })

  it('カードが動いても、id の集まりが変わらなければ崩れていない', () => {
    const state = stateWithTwoCards()
    const initial = cardIdsOf(state)
    const moved = putInZone(putInZone(state, '先攻', '手札', []), '先攻', '捨札', [
      instantiate({ id: '手札のカード', card: testCard, owner: '先攻' }),
    ])

    expect(checkBoardInvariants(moved, initial)).toEqual([])
  })

  it('見えていたカードがどこにも見つからなければ崩れている', () => {
    const state = stateWithTwoCards()
    const initial = cardIdsOf(state)
    const vanished: DuelState = { ...state, zones: { ...state.zones, 先攻: { ...state.zones.先攻, 手札: [] } } }

    expect(checkBoardInvariants(vanished, initial)).toEqual(['カード 手札のカード がどこにも見つからない'])
  })

  it('1 枚のカードが同時に 2 か所にあれば崩れている', () => {
    const state = stateWithTwoCards()
    const initial = cardIdsOf(state)
    const duplicated: DuelState = {
      ...state,
      zones: {
        ...state.zones,
        先攻: { ...state.zones.先攻, 捨札: [instantiate({ id: '手札のカード', card: testCard, owner: '先攻' })] },
      },
    }

    expect(checkBoardInvariants(duplicated, initial)).toEqual(['カード 手札のカード が 2 か所に重複して存在する'])
  })

  it('見覚えのないカードが現れていれば崩れている', () => {
    const state = stateWithTwoCards()
    const initial = cardIdsOf(state)
    const appeared = putInZone(state, '先攻', '捨札', [
      instantiate({ id: '見知らぬカード', card: testCard, owner: '先攻' }),
    ])

    expect(checkBoardInvariants(appeared, initial)).toEqual(['見覚えのないカード 見知らぬカード が存在する'])
  })

  it('カードが負のダメージを持っていれば崩れている', () => {
    const state = stateWithTwoCards()
    const initial = cardIdsOf(state)
    const damaged: DuelState = {
      ...state,
      squares: state.squares.map((cards) => cards.map((card) => (card.id === 'スクエアのカード' ? { ...card, damage: -1 } : card))),
    }

    expect(checkBoardInvariants(damaged, initial)).toEqual(['カード スクエアのカード が負のダメージ -1 を持っている'])
  })

  it('プレイヤーが負のダメージを受けていれば崩れている', () => {
    const state = stateWithTwoCards()
    const initial = cardIdsOf(state)
    const damaged: DuelState = { ...state, damage: { ...state.damage, 先攻: -1 } }

    expect(checkBoardInvariants(damaged, initial)).toEqual(['先攻 が負のダメージ -1 を受けている'])
  })
})
