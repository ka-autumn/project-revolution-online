import { describe, expect, it } from 'vitest'
import {
  BATTLE_SPACE,
  PLAYERS,
  PLAYER_ZONES,
  cardsIn,
  cardsOn,
  defineUnit,
  prepareDuel,
  randomFromSeed,
  shuffle,
} from './index.js'
import type { Deck, DuelState, Player } from './index.js'

/** 60 枚すべてが別々の名前のデッキ。並びが分かるように名前に番号を入れる。 */
function testDeck(prefix: string): Deck {
  return Array.from({ length: 60 }, (_, index) =>
    defineUnit({ name: `${prefix}${index}`, level: 1, bp: 1000, sp: 1000 }),
  )
}

const decks: readonly [Deck, Deck] = [testDeck('先手候補'), testDeck('後手候補')]

function prepared(seed: number) {
  const preparation = prepareDuel({ decks, seed })
  if (preparation.kind !== '準備完了') throw new Error('準備できるデッキのはずだった')
  return preparation
}

function names(state: DuelState, player: Player, zone: '山札' | '手札'): readonly string[] {
  return cardsIn(state, player, zone).map((instance) => instance.card.name)
}

// 総合ルール 第3部 第1章 4（ADR-0006）
describe('デュエルの準備', () => {
  it('デッキは持ち主の山札になる', () => {
    const { state } = prepared(20260809)

    // 初手の 5 枚を引いた残りが山札にある。
    expect(cardsIn(state, '先攻', '山札')).toHaveLength(55)
    expect(cardsIn(state, '後攻', '山札')).toHaveLength(55)
  })

  // 総合ルール 第3部 第1章 6
  it('それぞれのプレイヤーは 5 枚の手札を引く', () => {
    const { state } = prepared(20260809)

    expect(cardsIn(state, '先攻', '手札')).toHaveLength(5)
    expect(cardsIn(state, '後攻', '手札')).toHaveLength(5)
  })

  // 総合ルール 第2部 第21章 1-5: 「引く」とは山札の 1 番上のカードを手札に加えること
  it('手札はシャッフルした山札の上から 5 枚である', () => {
    // 準備と同じ順に乱数を使えば、シャッフルの結果は外からも再現できる。デュエルを
    // シードから再生できる（ADR-0005）とはこういうことである。
    const { state, first } = prepared(20260809)
    const shuffledOfSeat0 = shuffle(decks[0], randomFromSeed(20260809))
    const shuffledOfSeat1 = shuffle(decks[1], shuffledOfSeat0.random)
    const 先攻の山札 = (first === 0 ? shuffledOfSeat0 : shuffledOfSeat1).value.map((card) => card.name)

    expect(names(state, '先攻', '手札')).toEqual(先攻の山札.slice(0, 5))
    expect(names(state, '先攻', '山札')).toEqual(先攻の山札.slice(5))
  })

  it('デッキのカードは 1 枚も欠けず、増えもしない', () => {
    const { state, first } = prepared(20260809)
    const 先攻のデッキ = decks[first]

    expect(
      [...names(state, '先攻', '手札'), ...names(state, '先攻', '山札')].sort(),
    ).toEqual(先攻のデッキ.map((card) => card.name).sort())
  })

  // ADR-0005: 失敗した対戦をシードから再生できなければならない
  it('同じシードからは同じ初期盤面が再現できる', () => {
    expect(prepared(20260809).state).toEqual(prepared(20260809).state)
  })

  it('シードが違えば山札の並びが変わる', () => {
    expect(names(prepared(1).state, '先攻', '山札')).not.toEqual(names(prepared(2).state, '先攻', '山札'))
  })

  // 総合ルール 第2部 第21章 3-1・5-1・6-1・7-1
  it('山札と手札のほかに、カードはどこにもない', () => {
    const { state } = prepared(20260809)

    for (const player of PLAYERS) {
      for (const zone of PLAYER_ZONES) {
        if (zone === '山札' || zone === '手札') continue
        expect(cardsIn(state, player, zone)).toEqual([])
      }
    }
    for (const square of BATTLE_SPACE) {
      expect(cardsOn(state, square)).toEqual([])
    }
  })

  // 総合ルール 第2部 第1章 1-1
  it('カードの持ち主は、そのカードをデッキに入れたプレイヤーである', () => {
    const { state, first } = prepared(20260809)
    const 先攻のデッキ = first === 0 ? '先手候補' : '後手候補'

    for (const zone of ['山札', '手札'] as const) {
      for (const instance of cardsIn(state, '先攻', zone)) {
        expect(instance.card.name.startsWith(先攻のデッキ)).toBe(true)
        expect(instance.owner).toBe('先攻')
        expect(instance.controller).toBe('先攻')
      }
    }
  })

  // 総合ルール 第3部 第1章 3-1: 同じカード名のカードが 4 枚まで入るため、
  // カードはカード名では指せない。
  it('カードは 1 枚ずつ別の識別子を持つ', () => {
    const { state } = prepared(20260809)
    const ids = PLAYERS.flatMap((player) =>
      [...cardsIn(state, player, '山札'), ...cardsIn(state, player, '手札')].map((instance) => instance.id),
    )

    expect(new Set(ids).size).toBe(ids.length)
  })
})

// 総合ルール 第3部 第1章 5（ADR-0006）
describe('先攻・後攻の決定', () => {
  it('シードによってどちらの席も先攻になる', () => {
    const firsts = new Set(Array.from({ length: 50 }, (_, seed) => prepared(seed).first))

    expect(firsts).toEqual(new Set([0, 1]))
  })

  it('同じシードからは同じ側が先攻になる', () => {
    expect(prepared(20260809).first).toBe(prepared(20260809).first)
  })
})

// 総合ルール 第3部 第1章 3-1（ADR-0006）
describe('デッキが構築戦の規定を満たさないとき', () => {
  it('盤面を作らずに違反を返す', () => {
    const preparation = prepareDuel({ decks: [testDeck('先手候補').slice(1), testDeck('後手候補')], seed: 1 })

    expect(preparation).toEqual({
      kind: 'デッキ不備',
      violations: [{ seat: 0, violation: { kind: '枚数不足', count: 59, minimum: 60 } }],
    })
  })

  it('どちらの席のデッキの違反かが分かる', () => {
    const preparation = prepareDuel({
      decks: [testDeck('先手候補').slice(1), testDeck('後手候補').slice(2)],
      seed: 1,
    })

    expect(preparation).toEqual({
      kind: 'デッキ不備',
      violations: [
        { seat: 0, violation: { kind: '枚数不足', count: 59, minimum: 60 } },
        { seat: 1, violation: { kind: '枚数不足', count: 58, minimum: 60 } },
      ],
    })
  })
})
