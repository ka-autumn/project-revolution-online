import { describe, expect, it } from 'vitest'
// ゾーンを組み立てるためだけに `putInZone` を使う。engine の中からゾーンを差し替えるための
// 関数であり、公開する API ではない（`action.test.ts` と同じ）。
import { putInZone } from './duel.js'
import {
  PLAYERS,
  applyWithAnswers,
  cardsIn,
  choose,
  defineUnit,
  emptyDuelState,
  instantiate,
  passPriority,
  planReplacing,
  placeTopOfLibrary,
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
   *
   * 見えないまま盤面から押せるように、置き場所は添える（#127）。**中身は載らない。**
   */
  it('見えないカードは、見えないまま候補になる', () => {
    const progress = applyWithAnswers(beforePlanning(), PLANNING, [])

    expectChoice(progress)
    expect(progress.choice.candidates).toEqual([
      { kind: '見えている', card: 'エネ1' },
      { kind: '見えている', card: 'エネ2' },
      { kind: '見えていない', at: { player: '先攻', zone: 'スマッシュゾーン', index: 0 } },
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
   * 候補は能力であってカードではない。#110。
   *
   * 置換効果は常在型能力なので、能力の側は自分がどのカードから出たかを覚えていない。それでも
   * **どのユニットが生み出しているかは盤面から分かる**（総合ルール 第4部 第4章 1）ので、
   * `chosenPlanReplacement`（`action.ts`）がそのユニットと組にして選ばせる。発生源を持たない
   * 能力として並べると、選ぶ側に「どのユニットの能力か」が伝わらない。
   */
  it('置換効果の候補には、生み出しているユニットが出る', () => {
    const progress = applyWithAnswers(withReplacement(), PLANNING, [0])

    expectChoice(progress)
    expect(progress.choice.candidates).toEqual([{ kind: '能力', source: '置換するユニット' }])
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
 * #127。見えていない候補は、**盤面のどこにあるか**を持つ。
 *
 * 識別子を出さずに、盤面の裏向きの札と候補の番号を結び付けるためである。**見えないままである
 * ことは崩れない**——ゾーンごとの枚数・並び・向きは今も届いている（`wire.ts` の
 * `WireVisibleCard`）ので、位置はその言い直しにしかならない。
 */
describe('見えていない候補の置き場所', () => {
  const secret = defineUnit({
    name: 'テスト・見えていないスマッシュ',
    level: 2,
    colors: ['黒'],
    bp: 3000,
    sp: 1500,
  })

  /** プランのコストを、エネルギー 1 枚と裏向きのスマッシュ 2 枚から支払える盤面。 */
  function withSmashes(): DuelState {
    const withEnergy = putInZone(phaseReadyToAct('メインフェイズ'), '先攻', 'エネルギーゾーン', [card('エネ1')])
    return putInZone(withEnergy, '先攻', 'スマッシュゾーン', [
      instantiate({ id: '裏のスマッシュ1', card: secret, owner: '先攻' }),
      instantiate({ id: '裏のスマッシュ2', card: secret, owner: '先攻' }),
    ])
  }

  it('ゾーンと、そのゾーンの何番目かが載る', () => {
    const progress = applyWithAnswers(withSmashes(), PLANNING, [])

    expectChoice(progress)
    expect(progress.choice.candidates).toEqual([
      { kind: '見えている', card: 'エネ1' },
      { kind: '見えていない', at: { player: '先攻', zone: 'スマッシュゾーン', index: 0 } },
      { kind: '見えていない', at: { player: '先攻', zone: 'スマッシュゾーン', index: 1 } },
    ])
  })

  /**
   * `wire.test.ts` の「通信内容に現れないもの」と同じ確かめ方。位置を足しても、**カードの
   * 中身も識別子も現れない。**
   */
  it('カードの中身も識別子も現れない', () => {
    const progress = applyWithAnswers(withSmashes(), PLANNING, [])

    expectChoice(progress)
    const sent = JSON.stringify(progress.choice)
    expect(sent).toContain('スマッシュゾーン')
    expect(sent).not.toContain('テスト・見えていないスマッシュ')
    expect(sent).not.toContain('裏のスマッシュ')
  })

  /**
   * 山札の中は持ち主であっても見てはならない（総合ルール 第2部 第21章 2-2）。1 枚ずつ並べる
   * 場所も画面に無いので、**位置も出さない。** 深さだけが分かると、そこだけ新しく読み取れる
   * ものが増える。
   */
  it('山札にあるカードは置き場所を持たない', () => {
    const inLibrary = [
      instantiate({ id: '山札の1枚', card: secret, owner: '先攻' }),
      instantiate({ id: '山札の2枚目', card: secret, owner: '先攻' }),
    ]
    const picker = defineUnit({
      name: 'テスト・山札から選ぶ',
      level: 1,
      colors: ['赤'],
      bp: 1000,
      sp: 1000,
      abilities: [
        triggeredAbility('登場した時', function* () {
          yield* choose(inLibrary)
        }),
      ],
    })
    const square: Square = { row: 0, column: 1 }
    const placed = putOnSquare(
      putInZone(phaseReadyToAct('メインフェイズ'), '先攻', '山札', inLibrary),
      square,
      instantiate({ id: '選ばせるユニット', card: picker, owner: '先攻' }),
    )
    const [triggered] = picker.abilities
    if (triggered?.kind !== '誘発型能力') throw new Error('誘発型能力のはずだった')
    const waiting: DuelState = {
      ...placed,
      bank: [
        {
          ability: triggered,
          source: '選ばせるユニット',
          controller: '先攻',
          self: { id: '選ばせるユニット', square, card: picker, controller: '先攻' },
        },
      ],
    }

    const progress = applyWithAnswers(waiting, { kind: '優先権を放棄する' }, [])

    expectChoice(progress)
    expect(progress.choice.candidates).toEqual([
      { kind: '見えていない', at: undefined },
      { kind: '見えていない', at: undefined },
    ])
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

/**
 * #113。効果が置き先を選ばせる場面では、候補として並ぶのはカードではなくスクエアである。
 *
 * カードの識別子を持たないので、裏向きのカードとして並べると「何番目か」しか出せなくなる。
 * スクエアは盤面の位置であって隠すものが無い（総合ルール 第2部 第23章 1-1）ので、位置その
 * ものを載せる。
 */
describe('スクエアを選ぶ', () => {
  const chooser = defineUnit({
    name: 'テスト・置き先を選ぶユニット',
    level: 1,
    colors: ['赤'],
    bp: 1000,
    sp: 1000,
    abilities: [
      triggeredAbility('登場した時', function* () {
        yield* choose<Square>([
          { row: 0, column: 0 },
          { row: 2, column: 2 },
        ])
      }),
    ],
  })

  /** スクエアを選ばせる能力が、バンクで解決を待っている盤面。 */
  function waitingToChooseSquare(): DuelState {
    const square: Square = { row: 0, column: 1 }
    const placed = putOnSquare(
      phaseReadyToAct('メインフェイズ'),
      square,
      instantiate({ id: '選ばせるユニット', card: chooser, owner: '先攻' }),
    )
    const [triggered] = chooser.abilities
    if (triggered?.kind !== '誘発型能力') throw new Error('誘発型能力のはずだった')

    return {
      ...placed,
      bank: [
        {
          ability: triggered,
          source: '選ばせるユニット',
          controller: '先攻',
          self: { id: '選ばせるユニット', square, card: chooser, controller: '先攻' },
        },
      ],
    }
  }

  const PASS: LegalAction = { kind: '優先権を放棄する' }

  it('候補のスクエアが、行と列で並ぶ', () => {
    const progress = applyWithAnswers(waitingToChooseSquare(), PASS, [])

    expectChoice(progress)
    expect(progress.choice.candidates).toEqual([
      { kind: 'スクエア', square: { row: 0, column: 0 } },
      { kind: 'スクエア', square: { row: 2, column: 2 } },
    ])
  })

  /** 裏向きのカードと同じ扱いにすると、どこを選んでいるのか分からなくなる。 */
  it('見えていないものとしては並ばない', () => {
    const progress = applyWithAnswers(waitingToChooseSquare(), PASS, [])

    expectChoice(progress)
    expect(progress.choice.candidates.some((candidate) => candidate.kind === '見えていない')).toBe(false)
  })

  /** スクエアにいるユニットは自分の位置を `square` として持つので、スクエアとは混ざらない。 */
  it('スクエアにいるユニットは、カードとして並ぶ', () => {
    const withHand = putInZone(beforePlanning(), '先攻', '手札', [card('手札の1枚')])
    const play: LegalAction = {
      kind: 'カードをプレイする',
      declaration: { card: '手札の1枚', square: { row: 0, column: 1 } },
    }

    const progress = applyWithAnswers(withHand, play, [])

    expectChoice(progress)
    expect(progress.choice.candidates.every((candidate) => candidate.kind !== 'スクエア')).toBe(true)
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

/**
 * #122。効果が選ばせている場面は、種類（`ChoicePurpose`）だけではどれも `効果の対象` になる。
 * どのカードの効果かが分かれば場面は絞れるので、発生源のカードを載せる。
 *
 * **載せるのは識別子だけである。** 名前も文言も engine は持たない（ADR-0001）。
 */
describe('選ばせているカード', () => {
  const SOURCE = '選ばせるユニット'
  const square: Square = { row: 0, column: 1 }
  const PASS: LegalAction = { kind: '優先権を放棄する' }

  const picker = defineUnit({
    name: 'テスト・敵を選ぶユニット',
    level: 1,
    colors: ['赤'],
    bp: 1000,
    sp: 1000,
    abilities: [
      triggeredAbility('登場した時', function* (duel) {
        yield* choose(duel.enemies())
      }),
    ],
  })

  /**
   * その能力がバンクで解決を待ち、選ぶ余地があるように敵が 2 枚いる盤面。
   *
   * 発生源のカードをどこに置くかは呼ぶ側が決める。バンクにある能力はカードとは別に存在し、
   * 支配者も誘発した時の発生源から決まっている（総合ルール 第2部 第1章 5-1）ので、置き場所を
   * 変えても解決はそのまま起きる。
   */
  function waitingToPick(place: (state: DuelState, unit: CardInstance) => DuelState): DuelState {
    const enemies: readonly (readonly [string, Square])[] = [
      ['敵A', { row: 2, column: 0 }],
      ['敵B', { row: 2, column: 2 }],
    ]
    const withEnemies = enemies.reduce(
      (state, [id, at]) => putOnSquare(state, at, instantiate({ id, card: testCard, owner: '後攻' })),
      phaseReadyToAct('メインフェイズ'),
    )
    const placed = place(withEnemies, instantiate({ id: SOURCE, card: picker, owner: '先攻' }))
    const [triggered] = picker.abilities
    if (triggered?.kind !== '誘発型能力') throw new Error('誘発型能力のはずだった')

    return {
      ...placed,
      bank: [
        {
          ability: triggered,
          source: SOURCE,
          controller: '先攻',
          self: { id: SOURCE, square, card: picker, controller: '先攻' },
        },
      ],
    }
  }

  const onSquare = (state: DuelState, unit: CardInstance): DuelState => putOnSquare(state, square, unit)

  /** 山札の中は非公開情報である（総合ルール 第2部 第23章 2-1）ので、支配者からも見えない。 */
  const inLibrary = (state: DuelState, unit: CardInstance): DuelState =>
    putInZone(state, '先攻', '山札', [...cardsIn(state, '先攻', '山札'), unit])

  it('効果が選ばせているなら、どのカードの効果かが載る', () => {
    const progress = applyWithAnswers(waitingToPick(onSquare), PASS, [])

    expectChoice(progress)
    expect(progress.choice.source).toBe(SOURCE)
  })

  /**
   * **見えていない発生源は落とす。** 見えていないものの名前を作らない（#95）のと同じ理由で、
   * 識別子も渡さない。バンクにある能力はカードとは別に存在する（総合ルール 第2部 第1章 5-1）
   * ので、選ばせている当のカードが場を離れて見えなくなる場面は起こりうる。
   */
  it('選ぶ人から見えていない発生源は載らない', () => {
    const progress = applyWithAnswers(waitingToPick(inLibrary), PASS, [])

    expectChoice(progress)
    expect(progress.choice.source).toBeUndefined()
  })

  /** コストの支払いは効果が選ばせているのではない。発生源という言い方が当たらないので載せない。 */
  it('コストの支払いには載らない', () => {
    const progress = applyWithAnswers(beforePlanning(), PLANNING, [])

    expectChoice(progress)
    expect(progress.choice.source).toBeUndefined()
  })
})

/**
 * #142。選ぶ人が見るのは**その選択が起きている盤面**であり、そこで新しく見えたものがあれば
 * その行動は戻せない。見てから取り消して別の手を打てると、山札の 1 番上を覗く手立てになる。
 */
describe('戻れるかどうか', () => {
  const PASS: LegalAction = { kind: '優先権を放棄する' }

  /**
   * 自分の山札の 1 番上を捨札へ置いてから、敵を 1 枚選ぶ能力。
   *
   * 捨札はいつでも見られる（総合ルール 第2部 第21章 5-2）ので、選ばせる前に、それまで誰にも
   * 見えていなかったカードが 1 枚見えるようになる。
   */
  const revealer = defineUnit({
    name: 'テスト・めくってから選ぶ',
    level: 1,
    colors: ['赤'],
    bp: 1000,
    sp: 1000,
    abilities: [
      triggeredAbility('登場した時', function* (duel) {
        yield* placeTopOfLibrary('捨札', 'リリース')
        yield* choose(duel.enemies())
      }),
    ],
  })

  /** その能力がバンクで解決を待ち、選ぶ余地があるように敵が 2 枚いる盤面。 */
  function waitingToReveal(): DuelState {
    const enemies: readonly (readonly [string, Square])[] = [
      ['敵A', { row: 2, column: 0 }],
      ['敵B', { row: 2, column: 2 }],
    ]
    const withEnemies = enemies.reduce(
      (state, [id, square]) => putOnSquare(state, square, instantiate({ id, card: testCard, owner: '後攻' })),
      phaseReadyToAct('メインフェイズ'),
    )
    const square: Square = { row: 0, column: 1 }
    const self = { id: 'めくる役', square, card: revealer, controller: '先攻' as const }
    const placed = putOnSquare(withEnemies, square, instantiate({ id: self.id, card: revealer, owner: '先攻' }))
    const [triggered] = revealer.abilities
    if (triggered?.kind !== '誘発型能力') throw new Error('誘発型能力のはずだった')

    return { ...placed, bank: [{ ability: triggered, source: self.id, controller: '先攻', self }] }
  }

  it('新しく見えたものが無ければ戻れる', () => {
    const progress = applyWithAnswers(beforePlanning(), PLANNING, [])

    expectChoice(progress)
    expect(progress.choice.mayGoBack).toBe(true)
  })

  it('山札の 1 番上が見えるようになったら戻れない', () => {
    const progress = applyWithAnswers(waitingToReveal(), PASS, [])

    expectChoice(progress)
    expect(progress.choice.mayGoBack).toBe(false)
  })

  /** 選ぶ人に見せるのは、行動を始める前の盤面ではなく、いま止まっているところの盤面である。 */
  it('その選択が起きている盤面が返る', () => {
    const started = waitingToReveal()
    const progress = applyWithAnswers(started, PASS, [])

    expectChoice(progress)
    expect(cardsIn(started, '先攻', '捨札')).toEqual([])
    expect(cardsIn(progress.board, '先攻', '捨札').map((each) => each.id)).toEqual(['先攻の山札0'])
  })
})
