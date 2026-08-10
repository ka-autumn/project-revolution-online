import { describe, expect, it } from 'vitest'
import { defineUnit, dream, genki, playRandomSelfPlay } from './index.js'
import type { Deck, DuelSetup } from './index.js'

/** 上下左右すべてのムーブアイコンを持つレベル 0 のユニット。 */
const moverUnit = defineUnit({ name: 'テスト・自己対戦ユニットA', level: 0, bp: 100, sp: 100, moveIcon: ['上', '下', '左', '右'] })

/** 「元気」を持つレベル 0 のユニット（総合ルール 第5部 第8章 2）。 */
const genkiUnit = defineUnit({ name: 'テスト・自己対戦ユニットB', level: 0, bp: 100, sp: 500, abilities: [genki] })

/** 「夢」を持つレベル 0 のユニット（総合ルール 第5部 第1章 2）。プランゾーンからもプレイできる。 */
const dreamUnit = defineUnit({ name: 'テスト・自己対戦ユニットC', level: 0, bp: 100, sp: 100, abilities: [dream] })

/** 能力を持たないレベル 0 のユニット。テンプレートの残りを埋める。 */
const plainUnits = Array.from({ length: 12 }, (_, index) =>
  defineUnit({ name: `テスト・自己対戦ユニットD${index}`, level: 0, bp: 100, sp: 100 }),
)

/** デッキに入れる 15 種類のカード。同じ名前は 4 枚まで（総合ルール 第3部 第1章 3-1）。 */
const templates = [moverUnit, genkiUnit, dreamUnit, ...plainUnits]

/** 構築戦の最小枚数（60 枚）を満たす、15 種類 × 4 枚のデッキ。 */
function buildDeck(): Deck {
  return templates.flatMap((card) => Array.from({ length: 4 }, () => card))
}

// ADR-0005: AI の最初の役割はファザである。ランダムに手を選ぶだけのプレイヤーで、大量の
// 自己対戦を回すことで、合法手生成の漏れ・無限ループ・不正な盤面状態を自動で炙り出す。
describe('ランダムな自己対戦', () => {
  it('例外も無限ループもなく、一定回数の自己対戦が完走する', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const result = playRandomSelfPlay({ setup: { decks: [buildDeck(), buildDeck()], seed }, maxMoves: 3000 })

      expect(result.kind).toBe('決着')
    }
  })

  // ADR-0005: 失敗した対戦をシードから再生できなければならない。
  it('同じシードからは同じ対戦が再生できる', () => {
    const setup: DuelSetup = { decks: [buildDeck(), buildDeck()], seed: 20260810 }

    const first = playRandomSelfPlay({ setup, maxMoves: 3000 })
    const second = playRandomSelfPlay({ setup, maxMoves: 3000 })

    expect(second).toEqual(first)
  })

  it('シードが違えば違う対戦になる', () => {
    const first = playRandomSelfPlay({ setup: { decks: [buildDeck(), buildDeck()], seed: 1 }, maxMoves: 3000 })
    const second = playRandomSelfPlay({ setup: { decks: [buildDeck(), buildDeck()], seed: 2 }, maxMoves: 3000 })

    expect(second).not.toEqual(first)
  })

  it('デッキが構築戦の規定を満たさなければ、対戦せずにデッキ不備を返す', () => {
    const result = playRandomSelfPlay({
      setup: { decks: [buildDeck().slice(1), buildDeck()], seed: 1 },
      maxMoves: 3000,
    })

    expect(result.kind).toBe('デッキ不備')
  })
})
