import { describe, expect, it } from 'vitest'
import { defineUnit } from '@revolution/engine'
import type { Card, Deck } from '@revolution/engine'
import { playCpuDuel } from './duel.js'
import { randomCpu } from './random-cpu.js'

/**
 * CPU 同士で 1 回のデュエルを打つ（ADR-0060 の段階 1、#365）。
 */

/** 名前だけを変更した 15 種類 × 4 枚のデッキ。構築戦では同じカード名を 4 枚までしか入れられない（総合ルール 第3部 第1章 3-1）。 */
function deckOf(label: string, bp: number): Deck {
  const cards: readonly Card[] = Array.from({ length: 15 }, (_, index) =>
    defineUnit({ name: `テスト・デュエルの${label}${index}`, level: 0, bp, sp: 1000, moveIcon: ['上'] }),
  )
  return cards.flatMap((card) => Array.from({ length: 4 }, () => card))
}

const DECK_A = deckOf('ユニットA', 1000)
const DECK_B = deckOf('ユニットB', 2000)

describe('CPU 同士の 1 回のデュエル', () => {
  it('最後まで打てる', () => {
    const result = playCpuDuel({
      seats: [
        { cpu: randomCpu, deck: DECK_A },
        { cpu: randomCpu, deck: DECK_B },
      ],
      seed: 1,
      maxActions: 5000,
    })

    expect(result.kind).toBe('決着')
    expect(result.actionsTaken).toBeGreaterThan(0)
  })

  it('同じ設定なら、同じ結果になる', () => {
    const options = {
      seats: [
        { cpu: randomCpu, deck: DECK_A },
        { cpu: randomCpu, deck: DECK_B },
      ],
      seed: 2,
      maxActions: 5000,
    } as const

    expect(playCpuDuel(options)).toEqual(playCpuDuel(options))
  })

  it('手数の上限に届いたら、決着していないものとして止まる', () => {
    const result = playCpuDuel({
      seats: [
        { cpu: randomCpu, deck: DECK_A },
        { cpu: randomCpu, deck: DECK_B },
      ],
      seed: 1,
      maxActions: 3,
    })

    expect(result).toEqual({ kind: '手数上限', first: result.first, actionsTaken: 3 })
  })
})
