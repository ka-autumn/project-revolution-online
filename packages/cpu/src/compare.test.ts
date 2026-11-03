import { describe, expect, it } from 'vitest'
import { defineUnit } from '@revolution/engine'
import type { Card, Deck, LegalAction } from '@revolution/engine'
import { compareCpus, verdictOf, wilsonInterval } from './compare.js'
import type { CpuPlayer } from './player.js'
import { randomCpu } from './random-cpu.js'

/**
 * 2 つの CPU を比べて、勝率を測る仕組み（ADR-0060 の段階 1、#365）。勝ち越したと言える基準は
 * ADR-0061 にある。
 */

/** 名前だけを変更した 15 種類 × 4 枚のデッキ。構築戦では同じカード名を 4 枚までしか入れられない（総合ルール 第3部 第1章 3-1）。 */
function deckOf(label: string, bp: number): Deck {
  const cards: readonly Card[] = Array.from({ length: 15 }, (_, index) =>
    defineUnit({ name: `テスト・勝率の${label}${index}`, level: 0, bp, sp: 1000, moveIcon: ['上'] }),
  )
  return cards.flatMap((card) => Array.from({ length: 4 }, () => card))
}

const DECK_A = deckOf('ユニットA', 1000)
const DECK_B = deckOf('ユニットB', 2000)

/**
 * 行える手のうち、放棄だけを選ぶ CPU。何もしないので、何かをする CPU に負けるはずの相手。
 *
 * 選択に答える場面は、放棄しか選ばない限り自分には来ない。来ればランダムな CPU と同じに答える。
 */
const passingCpu: CpuPlayer = {
  pickAction: (view, random) => {
    const action = view.actions.find((each): each is LegalAction => each.kind === '優先権を放棄する')
    return action === undefined ? undefined : { action, random }
  },
  answer: randomCpu.answer,
}

describe('2 つの CPU を比べる', () => {
  it('デュエルの数と内訳が合う', () => {
    const result = compareCpus({
      challenger: randomCpu,
      baseline: randomCpu,
      pairings: [
        { name: 'A 対 B', decks: [DECK_A, DECK_B] },
        { name: 'B 対 A', decks: [DECK_B, DECK_A] },
      ],
      duels: 8,
      seed: 1,
      maxActions: 5000,
    })

    const sum = (tally: typeof result.total): number => tally.wins + tally.losses + tally.draws + tally.unfinished
    expect(sum(result.total)).toBe(8)
    expect(sum(result.byPosition['先攻']) + sum(result.byPosition['後攻'])).toBe(8)
    // 組（2 回のデュエル）ごとにデッキの組み合わせを順に回すので、4 組が 2 組ずつに分かれる。
    expect(result.byPairing.map(({ name, tally }) => [name, sum(tally)])).toEqual([
      ['A 対 B', 4],
      ['B 対 A', 4],
    ])
  })

  /**
   * 1 組の 2 回は、同じシード・同じデッキで CPU の席だけを入れ替える。同じ CPU 同士なら 2 回は
   * まったく同じに進むので、勝つのは同じ席であり、挑む側から見ると 1 勝 1 敗になる。
   */
  it('1 組の 2 回のデュエルでは、CPU の席だけを入れ替える', () => {
    const result = compareCpus({
      challenger: randomCpu,
      baseline: randomCpu,
      pairings: [{ name: 'A 対 B', decks: [DECK_A, DECK_B] }],
      duels: 6,
      seed: 10,
      maxActions: 5000,
    })

    expect(result.total.wins).toBe(result.total.losses)
  })

  it('何もしない CPU には、ランダムな CPU が勝ち越す', () => {
    const result = compareCpus({
      challenger: randomCpu,
      baseline: passingCpu,
      pairings: [{ name: 'A 対 A', decks: [DECK_A, DECK_A] }],
      duels: 20,
      seed: 1,
      maxActions: 5000,
    })

    expect(result.verdict.kind).toBe('勝ち越し')
  })

  it('同じ設定なら、同じ結果になる', () => {
    const options = {
      challenger: randomCpu,
      baseline: randomCpu,
      pairings: [{ name: 'A 対 B', decks: [DECK_A, DECK_B] }],
      duels: 4,
      seed: 3,
      maxActions: 5000,
    } as const

    expect(compareCpus(options)).toEqual(compareCpus(options))
  })

  it('デュエルの数が偶数でなければ断る', () => {
    expect(() =>
      compareCpus({
        challenger: randomCpu,
        baseline: randomCpu,
        pairings: [{ name: 'A 対 B', decks: [DECK_A, DECK_B] }],
        duels: 3,
        seed: 1,
        maxActions: 5000,
      }),
    ).toThrow()
  })
})

describe('勝ち越したかの判定', () => {
  it('勝率の信頼区間の下限が 50% を上回れば、勝ち越し', () => {
    // 60 勝 40 敗：勝率 60%、区間の下限は約 50.2%。
    expect(verdictOf({ wins: 60, losses: 40, draws: 0, unfinished: 0 }).kind).toBe('勝ち越し')
  })

  it('勝率が 50% を上回っていても、デュエルの数が少なければ勝ち越しにしない', () => {
    // 6 勝 4 敗：勝率は同じ 60% だが、区間の下限は 50% を下回る。
    expect(verdictOf({ wins: 6, losses: 4, draws: 0, unfinished: 0 }).kind).toBe('勝ち越していない')
  })

  it('引き分けと手数上限は、勝率に入れない', () => {
    const verdict = verdictOf({ wins: 3, losses: 1, draws: 5, unfinished: 7 })

    expect(verdict.winRate).toBe(0.75)
  })

  it('決着したデュエルが無ければ、勝ち越しにしない', () => {
    expect(verdictOf({ wins: 0, losses: 0, draws: 2, unfinished: 1 })).toEqual({
      kind: '勝ち越していない',
      winRate: undefined,
      interval: undefined,
    })
  })

  it('信頼区間は Wilson のスコア区間である', () => {
    // 50 勝 50 敗の 95% 区間はおよそ [0.4038, 0.5962]。
    const { lower, upper } = wilsonInterval(50, 100)

    expect(lower).toBeCloseTo(0.4038, 4)
    expect(upper).toBeCloseTo(0.5962, 4)
  })
})
