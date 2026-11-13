import { describe, expect, it } from 'vitest'
import {
  abilityGranting,
  defineUnit,
  dream,
  granting,
  indexOfSquare,
  movePreventing,
  squaresAdjacent,
  triggeredAbility,
} from '@revolution/engine'
import type { Card, Deck } from '@revolution/engine'
import { playCpuDuel } from './duel.js'
import type { CpuPlayer } from './player.js'
import { randomCpu } from './random-cpu.js'
import { scoredCpu } from './scored-cpu.js'

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

// 総合ルール 第3部 第8章 2-5（ADR-0068）。移動を妨げる能力を持つユニットが混ざったデッキでも、CPU は止まらず打ち切る。
describe('移動を妨げる常在型能力を持つユニットを含むデッキ', () => {
  // 能力が実際に移動を断った回数。CPU の先読み（pickAction の中）で断られた分は数えず、
  // エンジンが合法手を作る時と手を適用する時に断った分だけを数える。
  const engineRefusals = { guard: 0, tired: 0 }
  let inCpuPick = false

  /** 手を選んでいる間だけ `inCpuPick` を立てる CPU。 */
  const observedCpu: CpuPlayer = {
    ...scoredCpu,
    pickAction: (view, random) => {
      inCpuPick = true
      try {
        return scoredCpu.pickAction(view, random)
      } finally {
        inCpuPick = false
      }
    },
  }

  /** 「隣にいる敵と味方は移動できない」。 */
  const guard = defineUnit({
    name: 'テスト・デュエルの隣を止める',
    level: 0,
    bp: 3000,
    sp: 1000,
    moveIcon: ['上'],
    abilities: [
      movePreventing((duel, occasion) => {
        const self = duel.self()
        if (self === undefined || self.id === occasion.unit.id) return false
        const prevents = squaresAdjacent(self.square).some(
          (beside) => indexOfSquare(beside) === indexOfSquare(occasion.unit.square),
        )
        if (prevents && !inCpuPick) engineRefusals.guard += 1
        return prevents
      }),
    ],
  })

  /** 「このカードは１ターンに１回しか移動できない」。 */
  const tired = defineUnit({
    name: 'テスト・デュエルの1回だけ移動',
    level: 0,
    bp: 3000,
    sp: 1000,
    moveIcon: ['上', '右', '左'],
    abilities: [
      movePreventing((duel, occasion) => {
        const self = duel.self()
        const prevents = self !== undefined && self.id === occasion.unit.id && duel.movesThisTurn(occasion.unit) >= 1
        if (prevents && !inCpuPick) engineRefusals.tired += 1
        return prevents
      }),
    ],
  })

  const mixed = (label: string): Deck => [
    ...[guard, tired].flatMap((card) => Array.from({ length: 4 }, () => card)),
    ...deckOf(label, 2000).slice(8),
  ]

  it.each([1, 2, 3, 4])('点数で選ぶ CPU 同士が、最後まで打てる（シード %i）', (seed) => {
    const result = playCpuDuel({
      seats: [
        { cpu: observedCpu, deck: mixed('A') },
        { cpu: observedCpu, deck: mixed('B') },
      ],
      seed,
      maxActions: 5000,
    })

    expect(result.kind).toBe('決着')
  })

  it('4 つのシードの対戦のうちに、隣を止める能力も 1 回だけの能力も、実際に移動を断っている', () => {
    // 上の対戦が通っても、能力が一度も効かないまま決着しただけかもしれない。効いたことを確かめる。
    expect(engineRefusals.guard).toBeGreaterThan(0)
    expect(engineRefusals.tired).toBeGreaterThan(0)
  })
})

// 総合ルール 第4部 第12章 5-2 の(2)（ADR-0070）。プランゾーンのカードへ「夢」を与える常在型能力を持つユニットが
// 混ざったデッキでも、CPU は止まらず打ち切り、与えられた「夢」でプランゾーンからのプレイが実際に起きる。
describe('プランゾーンのカードへ「夢」を与える常在型能力を持つユニットを含むデッキ', () => {
  // 与えられた「夢」でプランゾーンからプレイされた回数。CPU の先読み（pickAction の中）は数えない。
  const playedFromPlan = { count: 0 }
  let inCpuPick = false

  const observedCpu: CpuPlayer = {
    ...scoredCpu,
    pickAction: (view, random) => {
      inCpuPick = true
      try {
        return scoredCpu.pickAction(view, random)
      } finally {
        inCpuPick = false
      }
    },
  }

  /** 「あなたのプランゾーンにある『テスト属性』のユニットに『夢』を与える」。 */
  const granter = defineUnit({
    name: 'テスト・デュエルのプランへ夢を与える',
    level: 0,
    bp: 3000,
    sp: 1000,
    moveIcon: ['上'],
    abilities: [
      abilityGranting((duel) =>
        duel
          .planZone()
          .filter((each) => each.card.type === 'ユニット' && each.card.attributes.includes('テスト属性'))
          .map((each) => granting(each, dream)),
      ),
    ],
  })

  /** 書かれた「夢」を持たない「テスト属性」のユニット。ＢＰを高くして、CPU がプレイしたくなるようにする。プランゾーンからプレイされたら回数に加える。 */
  const grantee = defineUnit({
    name: 'テスト・デュエルの夢を与えられる',
    level: 0,
    bp: 9000,
    sp: 1000,
    moveIcon: ['上'],
    attributes: ['テスト属性'],
    abilities: [
      triggeredAbility(
        '登場した時',
        function* () {},
        (occasion) => {
          if (occasion.from === 'プランゾーン' && !inCpuPick) playedFromPlan.count += 1
          return false
        },
      ),
    ],
  })

  const mixed = (label: string): Deck => [
    ...[granter, grantee].flatMap((card) => Array.from({ length: 4 }, () => card)),
    ...deckOf(label, 2000).slice(8),
  ]

  // CPU が与えられた「夢」を参照して動くことは、`scored-cpu.test.ts` の単体テストが確認する。ここで確認するのは、
  // 能力を与える常在型能力を含むデッキでも、CPU 同士が止まらずに決着し、与えられた「夢」でのプレイが起きることである。
  it('点数で選ぶ CPU 同士が、4 つのシードすべてで最後まで打て、与えられた「夢」でプランゾーンからプレイされる', () => {
    playedFromPlan.count = 0

    for (const seed of [1, 2, 3, 4]) {
      const result = playCpuDuel({
        seats: [
          { cpu: observedCpu, deck: mixed('A') },
          { cpu: observedCpu, deck: mixed('B') },
        ],
        seed,
        maxActions: 5000,
      })

      expect(result.kind).toBe('決着')
    }

    expect(playedFromPlan.count).toBeGreaterThan(0)
  })
})
