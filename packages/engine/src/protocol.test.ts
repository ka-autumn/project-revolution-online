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
  triggeredAbility,
} from './index.js'
import type { ActionProgress, CardInstance, Chooser, DuelState, LegalAction, Phase, Square } from './index.js'

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

  /**
   * コストのエネルギーが 2 枚あり、置換効果を持つユニットがスクエアにいる盤面。
   *
   * エネルギーを 2 枚置いているのは、**1 枚では選択にならない**ためである。候補が 1 つで
   * 選ばないことも選べないなら聞かれない（`applyWithAnswers`）。
   */
  function withReplacement(): DuelState {
    const placed = putOnSquare(
      phaseReadyToAct('メインフェイズ'),
      { row: 0, column: 1 },
      instantiate({ id: '置換するユニット', card: replacing, owner: '先攻' }),
    )
    return putInZone(placed, '先攻', 'エネルギーゾーン', [card('エネ1'), card('エネ2')])
  }

  it('1 回目に答えると、2 回目を尋ねてくる', () => {
    const progress = applyWithAnswers(withReplacement(), PLANNING, [0])

    expectChoice(progress)
    // 置換効果は「かわりに〜してよい」なので、選ばないことを選べる。
    expect(progress.choice.mayDecline).toBe(true)
  })

  /**
   * 候補は能力であってカードではない。
   *
   * 置換効果は常在型能力なので、発生源のカードを覚えていない（`action.ts` の
   * `chosenPlanReplacement` は能力だけを集める）。裏向きのカードと同じ扱いにはせず、
   * 能力として並べる。
   */
  it('置換効果の候補は、発生源のない能力として並ぶ', () => {
    const progress = applyWithAnswers(withReplacement(), PLANNING, [0])

    expectChoice(progress)
    expect(progress.choice.candidates).toEqual([{ kind: '能力', source: undefined }])
  })

  it('2 回目に選ばないと答えると、行動が終わる', () => {
    const progress = applyWithAnswers(withReplacement(), PLANNING, [0, '選ばない'])

    expectAdvanced(progress)
    expect(cardsIn(progress.state, '先攻', 'プランゾーン')).toHaveLength(1)
  })

  /**
   * 同じ行動の中でも、聞かれていることは変わる。
   *
   * 候補だけを見せても、それがコストの支払いなのか置き換えるかどうかなのかは分からない。
   * **何を聞かれているかが分からないまま選ばせない**ために、種類を載せている。
   */
  it('1 回目と 2 回目で、何のための選択かが変わる', () => {
    const first = applyWithAnswers(withReplacement(), PLANNING, [])
    const second = applyWithAnswers(withReplacement(), PLANNING, [0])

    expectChoice(first)
    expectChoice(second)
    expect(first.choice.purpose).toBe('プランのコスト')
    expect(second.choice.purpose).toBe('プランの置き換え')
  })
})

/**
 * #14。**選ぶ余地が無いなら聞かない。**
 *
 * 候補が 1 つで、選ばないことも選べないなら、答えは 1 通りしかない。押させても盤面は同じ
 * ところへ進むので、押させない。
 */
describe('選ぶ余地が無い選択', () => {
  /** フリーズできるカードが 1 枚しかない盤面。プランのコストに選ぶ余地が無い。 */
  function oneEnergyOnly(): DuelState {
    return putInZone(phaseReadyToAct('メインフェイズ'), '先攻', 'エネルギーゾーン', [card('ただ 1 枚のエネ')])
  }

  it('候補が 1 つなら聞かずに進む', () => {
    const progress = applyWithAnswers(oneEnergyOnly(), PLANNING, [])

    expectAdvanced(progress)
    expect(cardsIn(progress.state, '先攻', 'プランゾーン')).toHaveLength(1)
  })

  /** 聞かなかったぶんは答えとして数えない。答えの並びは実際に選んだものだけになる。 */
  it('聞かなかった選択は、答えを消費しない', () => {
    const progress = applyWithAnswers(oneEnergyOnly(), PLANNING, [])

    expectAdvanced(progress)
    // 候補が 1 つのエネルギーがフリーズされている（総合ルール 第2部 第24章 1）。
    expect(cardsIn(progress.state, '先攻', 'エネルギーゾーン')[0]?.orientation).toBe('フリーズ')
  })

  /** 候補が 2 つ以上あれば聞く。選ぶ余地があるかどうかだけで決まる。 */
  it('候補が 2 つあれば聞く', () => {
    const progress = applyWithAnswers(beforePlanning(), PLANNING, [])

    expectChoice(progress)
    expect(progress.choice.candidates.length).toBeGreaterThan(1)
  })

  /**
   * 候補が 1 つでも、選ばないことを選べるなら聞く。
   *
   * 「かわりに〜してよい」は、適用するかしないかの 2 通りである（総合ルール 第4部 第13章）。
   */
  it('選ばないことを選べるなら、候補が 1 つでも聞く', () => {
    const replacing = defineUnit({
      name: 'テスト・プランの置換',
      level: 1,
      colors: ['赤'],
      bp: 1000,
      sp: 1000,
      abilities: [planReplacing((each) => each.attributes.includes('目印'))],
    })
    const placed = putOnSquare(
      phaseReadyToAct('メインフェイズ'),
      { row: 0, column: 1 },
      instantiate({ id: '置換するユニット', card: replacing, owner: '先攻' }),
    )
    const state = putInZone(placed, '先攻', 'エネルギーゾーン', [card('ただ 1 枚のエネ')])

    // コストは聞かれずに払われ、置換するかどうかだけを聞かれる。
    const progress = applyWithAnswers(state, PLANNING, [])

    expectChoice(progress)
    expect(progress.choice.purpose).toBe('プランの置き換え')
  })
})

/**
 * #14。バンクから解決する能力を選ぶ（総合ルール 第2部 第21章 11-3）。
 *
 * 候補はカードではなく能力である。**どのカードから出た能力かまでは見せられる**ので、裏向きの
 * カードと同じ扱いにはしない。
 */
describe('バンクの能力を選ぶ', () => {
  const source = defineUnit({
    name: 'テスト・誘発するユニット',
    level: 1,
    colors: ['赤'],
    bp: 1000,
    sp: 1000,
    abilities: [triggeredAbility('登場した時', function* () {})],
  })

  /** スクエアにいるユニット 2 体の能力が、バンクで解決を待っている盤面。 */
  function waitingInBank(): DuelState {
    const squares: readonly (readonly [string, Square])[] = [
      ['誘発したユニットA', { row: 0, column: 0 }],
      ['誘発したユニットB', { row: 0, column: 2 }],
    ]
    const placed = squares.reduce(
      (state, [id, square]) => putOnSquare(state, square, instantiate({ id, card: source, owner: '先攻' })),
      phaseReadyToAct('メインフェイズ'),
    )
    const [triggered] = source.abilities
    if (triggered?.kind !== '誘発型能力') throw new Error('誘発型能力のはずだった')

    return {
      ...placed,
      bank: squares.map(([id, square]) => ({
        ability: triggered,
        source: id,
        controller: '先攻' as const,
        self: { id, square, card: source, controller: '先攻' as const },
      })),
    }
  }

  const PASS: LegalAction = { kind: '優先権を放棄する' }

  it('どのカードから出た能力かが分かる', () => {
    const progress = applyWithAnswers(waitingInBank(), PASS, [])

    expectChoice(progress)
    expect(progress.choice.purpose).toBe('解決する能力')
    expect(progress.choice.candidates).toEqual([
      { kind: '能力', source: '誘発したユニットA' },
      { kind: '能力', source: '誘発したユニットB' },
    ])
  })

  /** 発生源はスクエアにいるので公開情報である（総合ルール 第2部 第23章 1-1）。 */
  it('裏向きのカードとしては並ばない', () => {
    const progress = applyWithAnswers(waitingInBank(), PASS, [])

    expectChoice(progress)
    expect(progress.choice.candidates.some((candidate) => candidate.kind === '見えていない')).toBe(false)
  })

  /** 1 つしか無ければ選ぶ余地が無いので、聞かずに解決する。 */
  it('バンクに 1 つしか無ければ聞かない', () => {
    const only = waitingInBank()
    const progress = applyWithAnswers({ ...only, bank: only.bank.slice(0, 1) }, PASS, [])

    expectAdvanced(progress)
    expect(progress.state.bank).toHaveLength(0)
  })
})

// #14。候補だけでは何を聞かれているか分からないので、何のための選択かを載せる。
describe('何のための選択か', () => {
  it('プランのコストを支払うところでは、プランのコストになる', () => {
    const progress = applyWithAnswers(beforePlanning(), PLANNING, [])

    expectChoice(progress)
    expect(progress.choice.purpose).toBe('プランのコスト')
  })

  /** ユニットをプレイする時、レベルの支払いにどのエネルギーを使うかを選ぶ（総合ルール 第1部 第2章 3-1）。 */
  it('プレイのコストを支払うところでは、プレイのコストになる', () => {
    const withHand = putInZone(beforePlanning(), '先攻', '手札', [card('手札の1枚')])
    const play: LegalAction = {
      kind: 'カードをプレイする',
      declaration: { card: '手札の1枚', square: { row: 0, column: 1 } },
    }

    const progress = applyWithAnswers(withHand, play, [])

    expectChoice(progress)
    expect(progress.choice.purpose).toBe('プレイのコスト')
  })
})
