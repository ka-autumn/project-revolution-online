import { describe, expect, it } from 'vitest'
import { defineStrategy, defineTrap, defineUnit, dream, genki, playSelfPlay, runSelfPlayBatch } from './index.js'
import type { ActionPicker, Deck, DuelSetup } from './index.js'

/** 上下左右すべてのムーブアイコンを持つレベル 0 のユニット。 */
const moverUnit = defineUnit({ name: 'テスト・自己対戦ユニットA', level: 0, bp: 100, sp: 100, moveIcon: ['上', '下', '左', '右'] })

/** 「元気」を持つレベル 0 のユニット（総合ルール 第5部 第8章 2）。 */
const genkiUnit = defineUnit({ name: 'テスト・自己対戦ユニットB', level: 0, bp: 100, sp: 500, abilities: [genki] })

/** 「夢」を持つレベル 0 のユニット（総合ルール 第5部 第1章 2）。プランゾーンからもプレイできる。 */
const dreamUnit = defineUnit({ name: 'テスト・自己対戦ユニットC', level: 0, bp: 100, sp: 100, abilities: [dream] })

/**
 * 赤いレベル 1 のユニット（総合ルール 第2部 第3章 4）。プレイには同じ色のエネルギーが要る
 * （同 第1部 第2章 3-1）ので、有色コストの支払いを合法手の探索に通す。デッキに複数枚あるので
 * 自分自身をエネルギーにして支払える。
 */
const coloredUnit = defineUnit({ name: 'テスト・自己対戦ユニットE', level: 1, colors: ['赤'], bp: 100, sp: 100 })

/** 効果を持たないストラテジー（総合ルール 第2部 第20章 2）。プレイして解決する経路を通す。 */
const strategyCard = defineStrategy({ name: 'テスト・自己対戦ストラテジー', level: 0 })

/**
 * トリガーアイコンを持つトラップ（総合ルール 第2部 第20章 3）。相手のユニットが敵エリアの
 * 中央寄りのスクエアに侵入すると発動する権利を得るので、トラップの発動・廃棄の経路を通す。
 */
const trapCard = defineTrap({ name: 'テスト・自己対戦トラップ', level: 0, triggerIcon: [{ row: 2, column: 1 }] })

/** 能力を持たないレベル 0 のユニット。テンプレートの残りを埋める。 */
const plainUnits = Array.from({ length: 9 }, (_, index) =>
  defineUnit({ name: `テスト・自己対戦ユニットD${index}`, level: 0, bp: 100, sp: 100 }),
)

/**
 * デッキに入れる 15 種類のカード。同じ名前は 4 枚まで（総合ルール 第3部 第1章 3-1）。
 * バニラユニットだけでは行動空間が狭く、ストラテジー・トラップ・有色コストの経路が
 * 一度も踏まれない（ADR-0005 の「合法手生成の漏れ…を自動で炙り出す」目的が薄れる）ので、
 * これらも混ぜる。
 *
 * ただしこのデッキでも、`トラップを発動する`（トリガーアイコンの侵入条件自体の希少性）と、
 * スマッシュ判定（総合ルール 第3部 第9章 1、プレイヤーへのダメージが 1000 に届く必要がある）
 * は、ランダムな自己対戦では実際には踏まれない。ファザが炙り出す漏れの探索範囲としては、
 * この 2 経路は今のところ対象外である。
 */
const templates = [moverUnit, genkiUnit, dreamUnit, coloredUnit, strategyCard, trapCard, ...plainUnits]

/** 構築戦の最小枚数（60 枚）を満たす、15 種類 × 4 枚のデッキ。 */
function buildDeck(): Deck {
  return templates.flatMap((card) => Array.from({ length: 4 }, () => card))
}

// ADR-0005: AI の最初の役割はファザである。ランダムに手を選ぶだけのプレイヤーで、大量の
// 自己対戦を回すことで、合法手生成の漏れ・無限ループ・不正な盤面状態を自動で炙り出す。
describe('ランダムな自己対戦', () => {
  it('例外も無限ループもなく、一定回数の自己対戦が完走する', () => {
    const result = runSelfPlayBatch({
      decks: [buildDeck(), buildDeck()],
      seeds: Array.from({ length: 20 }, (_, seed) => seed),
      maxActions: 3000,
    })

    expect(result.kind).toBe('全て決着')
  })

  // ADR-0005: 失敗した対戦をシードから再生できなければならない。
  it('同じシードからは同じ対戦が再生できる', () => {
    const setup: DuelSetup = { decks: [buildDeck(), buildDeck()], seed: 20260810 }

    const first = playSelfPlay({ setup, maxActions: 3000 })
    const second = playSelfPlay({ setup, maxActions: 3000 })

    expect(second).toEqual(first)
  })

  it('シードが違えば違う対戦になる', () => {
    const first = playSelfPlay({ setup: { decks: [buildDeck(), buildDeck()], seed: 1 }, maxActions: 3000 })
    const second = playSelfPlay({ setup: { decks: [buildDeck(), buildDeck()], seed: 2 }, maxActions: 3000 })

    expect(second).not.toEqual(first)
  })

  it('デッキが構築戦の規定を満たさなければ、対戦せずにデッキ不備を返す', () => {
    const result = playSelfPlay({
      setup: { decks: [buildDeck().slice(1), buildDeck()], seed: 1 },
      maxActions: 3000,
    })

    expect(result.kind).toBe('デッキ不備')
  })

  // Spec: `pickAction` を差し替えれば、ランダムに選ぶだけのファザ役の代わりに、決まった手を
  // 返すプレイヤーで対戦を決定的に進められる（`self-play.ts` の `ActionPicker`）。
  it('pickAction を差し替えれば、決まった手だけを返すプレイヤーで対戦を進められる', () => {
    const pickPassPriority: ActionPicker = (actions, random) => {
      const action = actions.find((candidate) => candidate.kind === '優先権を放棄する')
      return action === undefined ? undefined : { action, random }
    }

    const result = playSelfPlay({
      setup: { decks: [buildDeck(), buildDeck()], seed: 1 },
      maxActions: 100,
      pickAction: pickPassPriority,
    })

    // 双方が優先権を放棄するだけでは何も進まず、決着せずに手数上限に達する。
    expect(result.kind).toBe('手数上限')
  })
})

// ADR-0005: 複数シードを回して失敗を集約するハーネスそのものの振る舞い。
describe('複数シードの自己対戦', () => {
  it('すべてのシードが決着すれば、シードごとの決着までの手数を返す', () => {
    const result = runSelfPlayBatch({ decks: [buildDeck(), buildDeck()], seeds: [1, 2, 3], maxActions: 3000 })

    expect(result.kind).toBe('全て決着')
    if (result.kind !== '全て決着') throw new Error('到達しないはず')
    expect([...result.actionsTaken.keys()]).toEqual([1, 2, 3])
  })

  it('デッキ不備のシードがあれば、途中で打ち切らずすべてのシードを失敗として報告する', () => {
    const result = runSelfPlayBatch({
      decks: [buildDeck().slice(1), buildDeck()],
      seeds: [1, 2, 3],
      maxActions: 3000,
    })

    expect(result.kind).toBe('失敗')
    if (result.kind !== '失敗') throw new Error('到達しないはず')
    expect(result.failures.map((failure) => failure.seed)).toEqual([1, 2, 3])
    expect(result.failures.every((failure) => failure.result.kind === 'デッキ不備')).toBe(true)
  })
})
