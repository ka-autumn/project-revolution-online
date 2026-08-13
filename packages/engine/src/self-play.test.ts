import { describe, expect, it } from 'vitest'
import { defineStrategy, defineTrap, defineUnit, dream, pep, playSelfPlay, runSelfPlayBatch } from './index.js'
import type { ActionPicker, Deck, DuelSetup, SelfPlayBatchResult, SelfPlayResult } from './index.js'

/** 上下左右すべてのムーブアイコンを持つレベル 0 のユニット。 */
const moverUnit = defineUnit({ name: 'テスト・自己対戦ユニットA', level: 0, bp: 100, sp: 100, moveIcon: ['上', '下', '左', '右'] })

/** 「元気」を持つレベル 0 のユニット（総合ルール 第5部 第8章 2）。 */
const pepUnit = defineUnit({ name: 'テスト・自己対戦ユニットB', level: 0, bp: 100, sp: 500, abilities: [pep] })

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
const templates = [moverUnit, pepUnit, dreamUnit, coloredUnit, strategyCard, trapCard, ...plainUnits]

/** 構築戦の最小枚数（60 枚）を満たす、15 種類 × 4 枚のデッキ。 */
function buildDeck(): Deck {
  return templates.flatMap((card) => Array.from({ length: 4 }, () => card))
}

/** `決着` を期待するアサーション。決着していなければ何が起きたかを示す。 */
function expectDecided(result: SelfPlayResult): asserts result is SelfPlayResult & { readonly kind: '決着' } {
  if (result.kind !== '決着') throw new Error(`決着したはずだった: ${result.kind}`)
}

/** `全て決着` を期待するアサーション。 */
function expectAllDecided(
  result: SelfPlayBatchResult,
): asserts result is SelfPlayBatchResult & { readonly kind: '全て決着' } {
  if (result.kind !== '全て決着') throw new Error(`全て決着したはずだった: ${result.kind}`)
}

/** `失敗` を期待するアサーション。 */
function expectFailed(result: SelfPlayBatchResult): asserts result is SelfPlayBatchResult & { readonly kind: '失敗' } {
  if (result.kind !== '失敗') throw new Error(`失敗のはずだった: ${result.kind}`)
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

  // ADR-0005: `pickAction` を差し替えれば、ランダムに選ぶだけのファザ役の代わりに、決まった手を
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

    expectAllDecided(result)
    expect([...result.actionsTakenBySeed.keys()]).toEqual([1, 2, 3])
  })

  it('デッキ不備のシードがあれば、途中で打ち切らずすべてのシードを失敗として報告する', () => {
    const result = runSelfPlayBatch({
      decks: [buildDeck().slice(1), buildDeck()],
      seeds: [1, 2, 3],
      maxActions: 3000,
    })

    expectFailed(result)
    expect(result.failures.map((failure) => failure.seed)).toEqual([1, 2, 3])
    expect(result.failures.every((failure) => failure.result.kind === 'デッキ不備')).toBe(true)
  })

  // ADR-0005: 失敗したシードがあっても、同じ実行で決着したシードの手数まで捨ててはならない
  // （1 回の実行から学べることを最大化する、`runSelfPlayBatch` の doc）。期待値は実装の分岐を
  // 書き写すのではなく、決着分と失敗分が排他かつ全シードを覆うという性質で表現する。
  it('一部のシードだけ手数上限に達しても、決着した残りのシードの手数は失敗と一緒に返る', () => {
    const decks: [Deck, Deck] = [buildDeck(), buildDeck()]
    const seeds = [1, 2, 3, 4, 5]
    // 手数上限を超えるシードを作るため、まず十分な上限で各シードの決着までの手数を測る。
    const actionsBySeed = new Map(
      seeds.map((seed) => {
        const result = playSelfPlay({ setup: { decks, seed }, maxActions: 3000 })
        expectDecided(result)
        return [seed, result.actionsTaken] as const
      }),
    )
    // 一番手数が短かったシードだけが決着し、残りは手数上限に達するように上限を置く。
    const threshold = Math.min(...actionsBySeed.values())
    expect(Math.max(...actionsBySeed.values())).toBeGreaterThan(threshold) // 前提: 手数にばらつきがある

    const result = runSelfPlayBatch({ decks, seeds, maxActions: threshold })

    expectFailed(result)
    const decidedSeeds = [...result.actionsTakenBySeed.keys()]
    const failedSeeds = result.failures.map((failure) => failure.seed)
    // 決着した分と失敗した分は排他で、合わせると全シードを覆う（手数が捨てられていないこと）。
    expect(decidedSeeds.some((seed) => failedSeeds.includes(seed))).toBe(false)
    expect(new Set([...decidedSeeds, ...failedSeeds])).toEqual(new Set(seeds))
    expect(decidedSeeds.length).toBeGreaterThan(0) // 本題: 決着した分の手数が捨てられていないこと
    expect(result.failures.every((failure) => failure.result.kind === '手数上限')).toBe(true)
  })
})
