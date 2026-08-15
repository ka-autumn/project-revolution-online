import { describe, expect, it } from 'vitest'
// ゾーンを組み立てるためだけに `putInZone` を使う。engine の中からゾーンを差し替えるための
// 関数であり、公開する API ではない（`action.test.ts` と同じ）。
import { putInZone } from './duel.js'
import {
  PLAYERS,
  applyWithAnswers,
  cardsIn,
  defineUnit,
  emptyDuelState,
  instantiate,
  passPriority,
  planReplacing,
  putOnSquare,
} from './index.js'
import type { ActionProgress, CardInstance, Chooser, DuelState, LegalAction, Phase } from './index.js'

/** 選択を求められたら常に最初の候補を選ぶ。盤面を進めるためだけに使う。 */
const chooseFirst: Chooser = (candidates) => candidates[0]

const testCard = defineUnit({ name: 'テストカード', level: 1, colors: ['赤'], bp: 1000, sp: 1000 })

function card(id: string): CardInstance {
  return instantiate({ id, card: testCard, owner: '先攻' })
}

/** アクティブプレイヤー（先攻）が行動できる、そのフェイズの盤面（`action.test.ts` と同じ）。 */
function phaseReadyToAct(phase: Phase): DuelState {
  const stocked = PLAYERS.reduce(
    (state, player) =>
      putInZone(
        state,
        player,
        '山札',
        Array.from({ length: 10 }, (_, index) =>
          instantiate({ id: `${player}の山札${index}`, card: testCard, owner: player }),
        ),
      ),
    emptyDuelState(),
  )
  let current = stocked
  while (current.turn.phase !== phase) current = passPriority(current, chooseFirst)
  return passPriority(current, chooseFirst)
}

/**
 * プランのコストを、エネルギー 2 枚とスマッシュ 1 枚から支払える盤面。
 *
 * プランするコストはエネルギーかスマッシュを 1 枚フリーズすることである（総合ルール 第3部
 * 第8章 2-3、第2部 第21章 7-5）。**エネルギーは見えていて、スマッシュはどちらのプレイヤーにも
 * 見えない**（同 6-3・7-3）ので、1 つの選択に見える候補と見えない候補が並ぶ。
 */
function beforePlanning(): DuelState {
  const withEnergy = putInZone(phaseReadyToAct('メインフェイズ'), '先攻', 'エネルギーゾーン', [
    card('エネ1'),
    card('エネ2'),
  ])
  return putInZone(withEnergy, '先攻', 'スマッシュゾーン', [card('スマッシュ')])
}

const PLANNING: LegalAction = { kind: 'プランする' }

/** `選んでほしい` を期待するアサーション。 */
function expectChoice(progress: ActionProgress): asserts progress is ActionProgress & { kind: '選んでほしい' } {
  if (progress.kind !== '選んでほしい') throw new Error(`選んでほしいはずだった: ${progress.kind}`)
}

/** `進んだ` を期待するアサーション。 */
function expectAdvanced(progress: ActionProgress): asserts progress is ActionProgress & { kind: '進んだ' } {
  if (progress.kind !== '進んだ') throw new Error(`進んだはずだった: ${progress.kind}`)
}

// ADR-0008。答えが足りなくなったところで適用をやめ、答えを足してやり直す。
describe('答えの並びで行動を適用する', () => {
  it('答えが無ければ、選んでほしいことを返す', () => {
    const progress = applyWithAnswers(beforePlanning(), PLANNING, [])

    expectChoice(progress)
    expect(progress.choice.player).toBe('先攻')
    expect(progress.choice.candidates).toHaveLength(3)
  })

  /**
   * 見えないカードも候補になる（ADR-0008）。
   *
   * プランのコストは自分の裏向きのスマッシュでも支払える（総合ルール 第2部 第21章 7-5）が、
   * スマッシュはどちらのプレイヤーにも見えない（同 7-3）。**番号で答えるからこそ、見えないまま
   * 選べる。**
   */
  it('見えないカードは、見えないまま候補になる', () => {
    const progress = applyWithAnswers(beforePlanning(), PLANNING, [])

    expectChoice(progress)
    expect(progress.choice.candidates).toEqual([
      { kind: '見えている', card: 'エネ1' },
      { kind: '見えている', card: 'エネ2' },
      { kind: '見えていない' },
    ])
  })

  it('答えを足してやり直すと、その候補が選ばれて進む', () => {
    const progress = applyWithAnswers(beforePlanning(), PLANNING, [1])

    expectAdvanced(progress)
    const frozen = cardsIn(progress.state, '先攻', 'エネルギーゾーン').filter(
      (each) => each.orientation === 'フリーズ',
    )
    expect(frozen.map((each) => each.id)).toEqual(['エネ2'])
  })

  it('見えない候補も選べる', () => {
    const progress = applyWithAnswers(beforePlanning(), PLANNING, [2])

    expectAdvanced(progress)
    expect(cardsIn(progress.state, '先攻', 'スマッシュゾーン')[0]?.orientation).toBe('フリーズ')
  })

  /**
   * やり直しが成り立つ根拠。エンジンが純粋である以上、同じ盤面と同じ答えの並びからは必ず
   * 同じところまで進む（ADR-0008）。
   */
  it('同じ盤面と同じ答えからは、同じ盤面になる', () => {
    const state = beforePlanning()

    expect(applyWithAnswers(state, PLANNING, [0])).toEqual(applyWithAnswers(state, PLANNING, [0]))
  })

  it('やり直しても、渡した盤面は変わらない', () => {
    const state = beforePlanning()

    applyWithAnswers(state, PLANNING, [])
    applyWithAnswers(state, PLANNING, [0])

    expect(state).toEqual(beforePlanning())
  })

  it('候補にない番号が答えられたら止まる', () => {
    expect(() => applyWithAnswers(beforePlanning(), PLANNING, [3])).toThrow('候補にない番号')
  })

  // 選ばないことが認められていない場面（コストの支払い）で `選ばない` が来た場合。
  // 候補にないものを選んだことになるので、エンジンがそこで止める。
  it('選べない場面で選ばないと答えたら止まる', () => {
    expect(() => applyWithAnswers(beforePlanning(), PLANNING, ['選ばない'])).toThrow()
  })

  it('選んでほしいことは JSON にして戻しても変わらない', () => {
    const progress = applyWithAnswers(beforePlanning(), PLANNING, [])

    expectChoice(progress)
    expect(JSON.parse(JSON.stringify(progress.choice))).toEqual(progress.choice)
  })
})

/**
 * 1 つの行動の中で選択が 2 回起こる場合（ADR-0008）。
 *
 * プランは、コストの支払い（総合ルール 第3部 第8章 2-3）と、めくりを置き換えるかどうか
 * （同 第4部 第13章 2）の 2 回選ばせる。**2 回目の候補は 1 回目の答えでは変わらないが、
 * 答えの並びが順に消費されることはここで見える。**
 */
describe('1 つの行動で 2 回選ぶ', () => {
  const replacing = defineUnit({
    name: 'テスト・プランの置換',
    level: 1,
    colors: ['赤'],
    bp: 1000,
    sp: 1000,
    abilities: [planReplacing((each) => each.attributes.includes('目印'))],
  })

  /** コストのエネルギーが 1 枚あり、置換効果を持つユニットがスクエアにいる盤面。 */
  function withReplacement(): DuelState {
    const placed = putOnSquare(
      phaseReadyToAct('メインフェイズ'),
      { row: 0, column: 1 },
      instantiate({ id: '置換するユニット', card: replacing, owner: '先攻' }),
    )
    return putInZone(placed, '先攻', 'エネルギーゾーン', [card('エネ')])
  }

  it('1 回目に答えると、2 回目を尋ねてくる', () => {
    const progress = applyWithAnswers(withReplacement(), PLANNING, [0])

    expectChoice(progress)
    // 置換効果は「かわりに〜してよい」なので、選ばないことを選べる。
    expect(progress.choice.mayDecline).toBe(true)
  })

  // 候補が能力なので、カードを指していない。番号だけで選ぶことになる（`WireCandidate`）。
  it('カードを指していない候補は、見えていないものとして並ぶ', () => {
    const progress = applyWithAnswers(withReplacement(), PLANNING, [0])

    expectChoice(progress)
    expect(progress.choice.candidates).toEqual([{ kind: '見えていない' }])
  })

  it('2 回目に選ばないと答えると、行動が終わる', () => {
    const progress = applyWithAnswers(withReplacement(), PLANNING, [0, '選ばない'])

    expectAdvanced(progress)
    expect(cardsIn(progress.state, '先攻', 'プランゾーン')).toHaveLength(1)
  })
})
