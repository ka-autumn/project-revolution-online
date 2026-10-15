import { describe, expect, it } from 'vitest'
// ゾーンを組み立てるためだけに `putInZone` を使う。engine の中からゾーンを差し替えるための
// 関数であり、公開する API ではない（`action.test.ts` と同じ）。
import { putInZone } from './duel.js'
import {
  PLAYERS,
  applyWithAnswers,
  cardsIn,
  choose,
  chooseAtMostOne,
  courage,
  defineTrap,
  defineUnit,
  emptyDuelState,
  instantiate,
  passPriority,
  perspectiveOf,
  planReplacing,
  placeInZone,
  placeTopOfLibrary,
  putOnSquare,
  triggeredAbility,
} from './index.js'
import type {
  ActionProgress,
  Area,
  Battle,
  CardInstance,
  Chooser,
  DuelState,
  LegalAction,
  Phase,
  Player,
  Square,
  TrapCard,
  TrapOccasion,
} from './index.js'

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
 * 効果が自分のスマッシュを選ぶ時の候補は、プランのコストの支払いと同じ「見えていない」候補
 * として届く。通信の形は変えていない。
 */
describe('効果が選ぶスマッシュの候補', () => {
  const secret = defineUnit({
    name: 'テスト・効果が選ぶスマッシュ',
    level: 2,
    colors: ['黒'],
    bp: 3000,
    sp: 1500,
  })

  const discarder = defineUnit({
    name: 'テスト・スマッシュを捨てる',
    level: 1,
    colors: ['赤'],
    bp: 1000,
    sp: 1000,
    abilities: [
      triggeredAbility('登場した時', function* (duel) {
        const smash = yield* chooseAtMostOne(duel.smashZone())
        if (smash !== undefined) yield* placeInZone(smash, '捨札', 'リリース')
      }),
    ],
  })

  /** 選んだスマッシュを手札へ置く以外は `discarder` と同じユニット。 */
  const handler = defineUnit({
    name: 'テスト・スマッシュを手札へ置く',
    level: 1,
    colors: ['赤'],
    bp: 1000,
    sp: 1000,
    abilities: [
      triggeredAbility('登場した時', function* (duel) {
        const smash = yield* chooseAtMostOne(duel.smashZone())
        if (smash !== undefined) yield* placeInZone(smash, '手札', 'リリース')
      }),
    ],
  })

  /** スマッシュを 2 枚持つ先攻の「登場した時」が、バンクで解決を待っている盤面。 */
  function waiting(unit: typeof discarder = discarder): DuelState {
    const square: Square = { row: 0, column: 1 }
    const placed = putOnSquare(
      putInZone(phaseReadyToAct('メインフェイズ'), '先攻', 'スマッシュゾーン', [
        instantiate({ id: '裏のスマッシュ1', card: secret, owner: '先攻' }),
        instantiate({ id: '裏のスマッシュ2', card: secret, owner: '先攻' }),
      ]),
      square,
      instantiate({ id: '捨てさせるユニット', card: unit, owner: '先攻' }),
    )
    const [triggered] = unit.abilities
    if (triggered?.kind !== '誘発型能力') throw new Error('誘発型能力のはずだった')
    return {
      ...placed,
      bank: [
        {
          ability: triggered,
          source: '捨てさせるユニット',
          controller: '先攻',
          self: { id: '捨てさせるユニット', square, card: unit, controller: '先攻' },
        },
      ],
    }
  }

  it('見えていない候補として、置き場所つきで届く', () => {
    const progress = applyWithAnswers(waiting(), { kind: '優先権を放棄する' }, [])

    expectChoice(progress)
    expect(progress.choice.mayDecline).toBe(true)
    expect(progress.choice.candidates).toEqual([
      { kind: '見えていない', at: { player: '先攻', zone: 'スマッシュゾーン', index: 0 } },
      { kind: '見えていない', at: { player: '先攻', zone: 'スマッシュゾーン', index: 1 } },
    ])
  })

  it('カードの中身も識別子も現れない', () => {
    const progress = applyWithAnswers(waiting(), { kind: '優先権を放棄する' }, [])

    expectChoice(progress)
    const sent = JSON.stringify(progress.choice)
    expect(sent).not.toContain('テスト・効果が選ぶスマッシュ')
    expect(sent).not.toContain('裏のスマッシュ')
  })

  it('答えた番号のスマッシュが捨札に置かれる', () => {
    const progress = applyWithAnswers(waiting(), { kind: '優先権を放棄する' }, [1])

    expectAdvanced(progress)
    expect(cardsIn(progress.state, '先攻', 'スマッシュゾーン').map((each) => each.id)).toEqual(['裏のスマッシュ1'])
    expect(cardsIn(progress.state, '先攻', '捨札').map((each) => each.id)).toEqual(['裏のスマッシュ2'])
  })

  /** 選んだログの「選ぶ」の行（命令の部分）。 */
  const chosenRows = (state: DuelState, viewer: (typeof PLAYERS)[number]) =>
    perspectiveOf(state, viewer).log.flatMap(({ event }) =>
      event.kind === '命令を実行した' && event.instruction.kind === '選ぶ' ? [event.instruction] : [],
    )

  it('スマッシュを選んだログは、どちらのプレイヤーにも、選んだカードを名指ししない', () => {
    const progress = applyWithAnswers(waiting(), { kind: '優先権を放棄する' }, [1])

    expectAdvanced(progress)
    for (const viewer of PLAYERS) {
      const rows = chosenRows(progress.state, viewer)
      expect(rows).toHaveLength(1)
      expect(rows.map((row) => row.card)).toEqual([undefined])
    }
  })

  describe('スマッシュを手札へ置いた時', () => {
    const afterTaking = () => {
      const progress = applyWithAnswers(waiting(handler), { kind: '優先権を放棄する' }, [1])
      expectAdvanced(progress)
      return progress.state
    }

    it('相手の視点のログの「ゾーンへ置く」の行に、識別子が残らない', () => {
      const rows = perspectiveOf(afterTaking(), '後攻').log.flatMap(({ event }) =>
        event.kind === '命令を実行した' && event.instruction.kind === 'ゾーンへ置く' ? [event.instruction] : [],
      )

      expect(rows).toHaveLength(1)
      expect(rows.map((row) => row.card)).toEqual([undefined])
    })

    it('相手の視点の、ログが名指しするカードの一覧にも出ない', () => {
      const perspective = perspectiveOf(afterTaking(), '後攻')

      expect(perspective.namedInLog.map((each) => each.id)).not.toContain('裏のスマッシュ1')
      expect(JSON.stringify(perspective.log)).not.toContain('裏のスマッシュ')
    })
  })

  // 捨札に置かれたスマッシュは表向きになる（総合ルール 第2部 第23章 1-1）ので、新しく見えた
  // ものがあり、選び直しの前へは戻れない。
  it('スマッシュを捨札に置いた後、同じ行動の中で次の選択をさせると、戻れない', () => {
    const twice = defineUnit({
      name: 'テスト・スマッシュを2回捨てる',
      level: 1,
      colors: ['赤'],
      bp: 1000,
      sp: 1000,
      abilities: [
        triggeredAbility('登場した時', function* (duel) {
          const first = yield* chooseAtMostOne(duel.smashZone())
          if (first === undefined) return
          yield* placeInZone(first, '捨札', 'リリース')
          const second = yield* chooseAtMostOne(duel.smashZone())
          if (second !== undefined) yield* placeInZone(second, '捨札', 'リリース')
        }),
      ],
    })

    const progress = applyWithAnswers(waiting(twice), { kind: '優先権を放棄する' }, [1])

    expectChoice(progress)
    expect(progress.choice.mayGoBack).toBe(false)
  })
})

/**
 * 効果がトラップゾーンのカードを選ぶ時の候補（ADR-0040）。自分のトラップゾーンのカードは表側を
 * 見られ、相手のものは見られない（総合ルール 第2部 第21章 9-3）。候補はその見え方のとおりに、
 * 「見えている」候補と、置き場所つきの「見えていない」候補として届く。通信の形は変えていない。
 */
describe('効果が選ぶトラップゾーンのカードの候補', () => {
  const mine = defineUnit({ name: 'テスト・先攻の伏せ札', level: 1, colors: ['青'], bp: 1000, sp: 1000 })
  const theirs = defineUnit({ name: 'テスト・後攻の伏せ札', level: 2, colors: ['黒'], bp: 2000, sp: 1000 })

  const discarder = defineUnit({
    name: 'テスト・トラップを捨てる',
    level: 1,
    colors: ['赤'],
    bp: 1000,
    sp: 1000,
    abilities: [
      triggeredAbility('登場した時', function* (duel) {
        const trap = yield* chooseAtMostOne(duel.trapZone())
        if (trap !== undefined) yield* placeInZone(trap, '捨札', 'リリース')
      }),
    ],
  })

  /** 選んだカードを持ち主の手札へ置く以外は `discarder` と同じユニット。 */
  const returner = defineUnit({
    name: 'テスト・トラップを手札へ戻す',
    level: 1,
    colors: ['赤'],
    bp: 1000,
    sp: 1000,
    abilities: [
      triggeredAbility('登場した時', function* (duel) {
        const trap = yield* chooseAtMostOne(duel.trapZone())
        if (trap !== undefined) yield* placeInZone(trap, '手札', 'リリース')
      }),
    ],
  })

  /**
   * 先攻の「登場した時」が、バンクで解決を待っている盤面。書いたプレイヤーのトラップゾーンに
   * カードを 1 枚ずつ置く。
   */
  function waiting(...players: readonly Player[]): DuelState {
    return waitingWith(discarder, ...players)
  }

  /** `waiting` の、登場したユニットを差し替えられる形。 */
  function waitingWith(unit: typeof discarder, ...players: readonly Player[]): DuelState {
    const square: Square = { row: 0, column: 1 }
    const withTraps = players.reduce(
      (state, player) =>
        putInZone(state, player, 'トラップゾーン', [
          instantiate({ id: `${player}の伏せ札`, card: player === '先攻' ? mine : theirs, owner: player }),
        ]),
      phaseReadyToAct('メインフェイズ'),
    )
    const placed = putOnSquare(
      withTraps,
      square,
      instantiate({ id: '捨てさせるユニット', card: unit, owner: '先攻' }),
    )
    const [triggered] = unit.abilities
    if (triggered?.kind !== '誘発型能力') throw new Error('誘発型能力のはずだった')
    return {
      ...placed,
      bank: [
        {
          ability: triggered,
          source: '捨てさせるユニット',
          controller: '先攻',
          self: { id: '捨てさせるユニット', square, card: unit, controller: '先攻' },
        },
      ],
    }
  }

  it('自分のカードは見えている候補、相手のカードは置き場所つきの見えていない候補として届く', () => {
    const progress = applyWithAnswers(waiting('先攻', '後攻'), { kind: '優先権を放棄する' }, [])

    expectChoice(progress)
    expect(progress.choice.mayDecline).toBe(true)
    expect(progress.choice.candidates).toEqual([
      { kind: '見えている', card: '先攻の伏せ札' },
      { kind: '見えていない', at: { player: '後攻', zone: 'トラップゾーン', index: 0 } },
    ])
  })

  it('選ぶ要求に、相手のカードの中身も識別子も現れない', () => {
    const progress = applyWithAnswers(waiting('先攻', '後攻'), { kind: '優先権を放棄する' }, [])

    expectChoice(progress)
    const sent = JSON.stringify(progress.choice)
    expect(sent).not.toContain('テスト・後攻の伏せ札')
    expect(sent).not.toContain('後攻の伏せ札')
  })

  // どちらのトラップゾーンかを書いていないテキストは、両方から選べる（ADR-0040）。
  it('相手のトラップゾーンが空なら、自分のカードだけが候補になる', () => {
    const progress = applyWithAnswers(waiting('先攻'), { kind: '優先権を放棄する' }, [])

    expectChoice(progress)
    expect(progress.choice.candidates).toEqual([{ kind: '見えている', card: '先攻の伏せ札' }])
  })

  /** 答えた番号のカードを捨札に置いた後の盤面。 */
  const afterDiscarding = (answer: number): DuelState => {
    const progress = applyWithAnswers(waiting('先攻', '後攻'), { kind: '優先権を放棄する' }, [answer])
    expectAdvanced(progress)
    return progress.state
  }

  // 総合ルール 第2部 第21章 1-2・第2部 第23章 1-1。持ち主の捨札に置かれ、捨札は公開情報である。
  it('相手のカードを選ぶと、持ち主である相手の捨札に置かれ、中身が両方のプレイヤーに見える', () => {
    const state = afterDiscarding(1)

    expect(cardsIn(state, '後攻', '捨札').map((each) => each.id)).toEqual(['後攻の伏せ札'])
    expect(cardsIn(state, '後攻', 'トラップゾーン')).toEqual([])
    for (const viewer of PLAYERS) {
      const [top] = perspectiveOf(state, viewer).zones['後攻']['捨札']
      expect(top).toMatchObject({
        kind: '見えている',
        instance: { id: '後攻の伏せ札', card: { name: 'テスト・後攻の伏せ札' } },
      })
    }
  })

  it('自分のカードを選ぶと、自分の捨札に置かれ、中身が両方のプレイヤーに見える', () => {
    const state = afterDiscarding(0)

    expect(cardsIn(state, '先攻', '捨札').map((each) => each.id)).toEqual(['先攻の伏せ札'])
    for (const viewer of PLAYERS) {
      const [top] = perspectiveOf(state, viewer).zones['先攻']['捨札']
      expect(top).toMatchObject({
        kind: '見えている',
        instance: { id: '先攻の伏せ札', card: { name: 'テスト・先攻の伏せ札' } },
      })
    }
  })

  // 総合ルール 第2部 第20章 3-8。発動条件は、そのカードがトラップゾーンにあってこそ意味を持つ。
  it('満たされた発動条件が残っていたカードを捨札に置くと、その発動条件が取り除かれる', () => {
    const invader = {
      id: '捨てさせるユニット',
      square: { row: 0, column: 1 },
      card: discarder,
      controller: '先攻',
    } as const
    const state: DuelState = {
      ...waiting('先攻', '後攻'),
      trapConditionsMet: [{ trap: '後攻の伏せ札', occasion: { kind: '侵入', invader }, metAt: 0 }],
    }

    const progress = applyWithAnswers(state, { kind: '優先権を放棄する' }, [1])

    expectAdvanced(progress)
    expect(progress.state.trapConditionsMet).toEqual([])
  })

  /** その視点のログの、命令の行のうちその種類のもの。 */
  const instructionRows = (state: DuelState, viewer: Player, kind: '選ぶ' | 'ゾーンへ置く') =>
    perspectiveOf(state, viewer).log.flatMap(({ event }) =>
      event.kind === '命令を実行した' && event.instruction.kind === kind ? [event.instruction] : [],
    )

  // 選んだ時点では裏向きで、選んだプレイヤーには表側が見えない（総合ルール 第2部 第21章 9-3）。
  it('相手のカードを選んだログは、選んだプレイヤーに、選んだカードを名指ししない', () => {
    const rows = instructionRows(afterDiscarding(1), '先攻', '選ぶ')

    expect(rows.map((row) => row.card)).toEqual([undefined])
  })

  it('自分のカードを選んだログは、相手に、選んだカードを名指ししない', () => {
    const rows = instructionRows(afterDiscarding(0), '後攻', '選ぶ')

    expect(rows.map((row) => row.card)).toEqual([undefined])
  })

  // 手札は非公開情報で（総合ルール 第2部 第23章 2-1）、トラップゾーンにあった時も選んだプレイヤーには
  // 表側が見えなかった（同 第21章 9-3）。置く前も置いた後も見えないので、名指しは持ち主にだけ残る。
  describe('相手のカードを持ち主の手札へ置いた時', () => {
    const afterReturning = () => {
      const progress = applyWithAnswers(waitingWith(returner, '先攻', '後攻'), { kind: '優先権を放棄する' }, [1])
      expectAdvanced(progress)
      return progress.state
    }

    it('持ち主である相手の手札に置かれる', () => {
      expect(cardsIn(afterReturning(), '後攻', '手札').map((each) => each.id)).toContain('後攻の伏せ札')
    })

    it('選んだプレイヤーの視点のログの「ゾーンへ置く」の行に、識別子が残らない', () => {
      const rows = instructionRows(afterReturning(), '先攻', 'ゾーンへ置く')

      expect(rows.map((row) => row.card)).toEqual([undefined])
      expect(JSON.stringify(perspectiveOf(afterReturning(), '先攻').log)).not.toContain('後攻の伏せ札')
    })

    it('持ち主の視点のログには、置いたカードが名指しされる', () => {
      const rows = instructionRows(afterReturning(), '後攻', 'ゾーンへ置く')

      expect(rows.map((row) => row.card)).toEqual(['後攻の伏せ札'])
    })
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

/**
 * #278。効果がエリアを選ばせる場面では、候補として並ぶのはエリアである。
 *
 * エリアの呼び名は見るプレイヤーによって入れ替わる（総合ルール 第2部 第22章 6）ので、呼び名では
 * 送らない。選ぶプレイヤー（能力の支配者、同 6-1）から見た呼び名を、盤面に固定した行に直して載せる。
 */
describe('エリアを選ぶ', () => {
  const areaChooser = defineUnit({
    name: 'テスト・エリアを選ぶユニット',
    level: 1,
    colors: ['赤'],
    bp: 1000,
    sp: 1000,
    abilities: [
      triggeredAbility('登場した時', function* () {
        yield* choose<Area>(['味方エリア', '中央エリア', '敵エリア'])
      }),
    ],
  })

  /** エリアを選ばせる能力が、バンクで解決を待っている盤面。 */
  function waitingToChooseArea(controller: Player): DuelState {
    const square: Square = { row: 1, column: 1 }
    const placed = putOnSquare(
      phaseReadyToAct('メインフェイズ'),
      square,
      instantiate({ id: '選ばせるユニット', card: areaChooser, owner: controller }),
    )
    const [triggered] = areaChooser.abilities
    if (triggered?.kind !== '誘発型能力') throw new Error('誘発型能力のはずだった')

    return {
      ...placed,
      bank: [
        {
          ability: triggered,
          source: '選ばせるユニット',
          controller,
          self: { id: '選ばせるユニット', square, card: areaChooser, controller },
        },
      ],
    }
  }

  const PASS: LegalAction = { kind: '優先権を放棄する' }

  // 総合ルール 第2部 第22章 6。先攻の味方エリアは row 0、敵エリアは row 2。
  it('先攻が選ぶなら、先攻から見た呼び名の行で並ぶ', () => {
    const progress = applyWithAnswers(waitingToChooseArea('先攻'), PASS, [])

    expectChoice(progress)
    expect(progress.choice.player).toBe('先攻')
    expect(progress.choice.candidates).toEqual([
      { kind: 'エリア', row: 0 },
      { kind: 'エリア', row: 1 },
      { kind: 'エリア', row: 2 },
    ])
  })

  // 総合ルール 第2部 第22章 6-1。あるプレイヤーの味方エリアは、相手の敵エリアになる。
  it('後攻が選ぶなら、同じ呼び名でも行が入れ替わる', () => {
    const progress = applyWithAnswers(waitingToChooseArea('後攻'), PASS, [])

    expectChoice(progress)
    expect(progress.choice.player).toBe('後攻')
    expect(progress.choice.candidates).toEqual([
      { kind: 'エリア', row: 2 },
      { kind: 'エリア', row: 1 },
      { kind: 'エリア', row: 0 },
    ])
  })

  /** エリアは盤面の位置であって、隠すものが無い。見えていないカードとしては並べない。 */
  it('見えていないものとしては並ばない', () => {
    const progress = applyWithAnswers(waitingToChooseArea('先攻'), PASS, [])

    expectChoice(progress)
    expect(progress.choice.candidates.some((candidate) => candidate.kind === '見えていない')).toBe(false)
  })

  /** 答えは番号のままである（ADR-0008）。 */
  it('番号で答えると、そのエリアが選ばれて進む', () => {
    const progress = applyWithAnswers(waitingToChooseArea('先攻'), PASS, [2])

    expectAdvanced(progress)
  })

  /** 候補の番号と、記録に残るエリアの行が、先攻でも後攻でも対応している（番号とエリアがずれると落ちる）。 */
  it('番号で答えた分のエリアの行が、選んだ記録に残る', () => {
    const chosenRows = (controller: Player, answer: number): unknown[] => {
      const progress = applyWithAnswers(waitingToChooseArea(controller), PASS, [answer])
      expectAdvanced(progress)

      return progress.state.log.flatMap(({ event }) =>
        event.kind === '命令を実行した' && event.instruction.kind === '選ぶ' ? [event.instruction.areaRow] : [],
      )
    }

    // 先攻の候補は味方エリア（row 0）・中央エリア（row 1）・敵エリア（row 2）の順。後攻は row 2・1・0 の順。
    expect([0, 1, 2].map((answer) => chosenRows('先攻', answer))).toEqual([[0], [1], [2]])
    expect([0, 1, 2].map((answer) => chosenRows('後攻', answer))).toEqual([[2], [1], [0]])
  })
})

// #14。候補だけでは何を聞かれているか分からないので、何のための選択かを載せる。
// ADR-0039。権利が発生しているきっかけが複数ある時、発動の中で支配者が選ぶ。
describe('発動するきっかけを選ぶ', () => {
  /** 効果が受け取ったきっかけの侵入したユニットの識別子。 */
  const seen: string[] = []
  const trapCard = defineTrap({
    name: 'テスト・侵入トラップ',
    level: 1,
    colors: ['赤'],
    triggerIcon: { kind: '侵入', squares: [{ row: 0, column: 1 }] },
    effect: function* (_duel, occasion) {
      seen.push(occasion.invader.id)
    },
  })

  const invaderAt = (id: string, square: Square) => ({ id, square, card: testCard, controller: '先攻' as const })

  /** 後攻が優先権を持ち、満たされた発動条件を `invaders` の数だけ持っている盤面。 */
  function withRights(invaders: readonly { id: string; square: Square }[]): DuelState {
    const base = phaseReadyToAct('メインフェイズ')
    const withTrap = putInZone(base, '後攻', 'トラップゾーン', [instantiate({ id: 'トラップ', card: trapCard, owner: '後攻' })])
    const withEnergy = putInZone(withTrap, '後攻', 'エネルギーゾーン', [
      instantiate({ id: '後攻のエネ1', card: testCard, owner: '後攻' }),
      instantiate({ id: '後攻のエネ2', card: testCard, owner: '後攻' }),
    ])
    return {
      ...withEnergy,
      turn: { ...withEnergy.turn, priority: '後攻' },
      trapConditionsMet: invaders.map((each, index) => ({
        trap: 'トラップ',
        occasion: { kind: '侵入', invader: invaderAt(each.id, each.square) },
        metAt: index,
      })),
    }
  }

  const ACTIVATE: LegalAction = { kind: 'トラップを発動する', card: 'トラップ' }

  it('権利が発生しているきっかけが複数あれば、きっかけを選ばせる', () => {
    const state = withRights([
      { id: '1 体目', square: { row: 2, column: 1 } },
      { id: '2 体目', square: { row: 2, column: 0 } },
    ])

    const progress = applyWithAnswers(state, ACTIVATE, [])

    expectChoice(progress)
    expect(progress.choice.purpose).toBe('トラップのきっかけ')
    expect(progress.choice.source).toBe('トラップ')
    expect(progress.choice.candidates).toEqual([
      { kind: 'きっかけ', occasion: { kind: '侵入', invader: { card: '1 体目', square: { row: 2, column: 1 } } } },
      { kind: 'きっかけ', occasion: { kind: '侵入', invader: { card: '2 体目', square: { row: 2, column: 0 } } } },
    ])
  })

  it('きっかけが 1 つなら、選ばせずに発動する', () => {
    const state = withRights([{ id: '1 体目', square: { row: 2, column: 1 } }])

    // エネルギーが 2 枚あるので、コストは選ばせる。ここで見るのは、きっかけを選ばせないこと。
    const progress = applyWithAnswers(state, ACTIVATE, [])

    expectChoice(progress)
    expect(progress.choice.purpose).not.toBe('トラップのきっかけ')
  })

  // 答えの並びは、きっかけの番号、コストの番号の順（きっかけを選んでからコストを払う）。
  it('選んだきっかけの効果が解決され、コストも答えどおりに払われる', () => {
    seen.length = 0
    const state = withRights([
      { id: '1 体目', square: { row: 2, column: 1 } },
      { id: '2 体目', square: { row: 2, column: 0 } },
    ])

    const progress = applyWithAnswers(state, ACTIVATE, [1, 0])

    expectAdvanced(progress)
    expect(seen).toEqual(['2 体目'])
    const frozen = cardsIn(progress.state, '後攻', 'エネルギーゾーン').filter((each) => each.orientation === 'フリーズ')
    expect(frozen.map((each) => each.id)).toEqual(['後攻のエネ1'])
  })

  it('コストの番号を変えても、きっかけの選択は同じ番号で答える', () => {
    seen.length = 0
    const state = withRights([
      { id: '1 体目', square: { row: 2, column: 1 } },
      { id: '2 体目', square: { row: 2, column: 0 } },
    ])

    const progress = applyWithAnswers(state, ACTIVATE, [0, 1])

    expectAdvanced(progress)
    expect(seen).toEqual(['1 体目'])
    const frozen = cardsIn(progress.state, '後攻', 'エネルギーゾーン').filter((each) => each.orientation === 'フリーズ')
    expect(frozen.map((each) => each.id)).toEqual(['後攻のエネ2'])
  })

  // 止まっている件は候補に並ばない。発生している件が 1 つなら、選択は出ず、その件で発動する。
  it('1 件が止まり、1 件が発生していれば、選択は出ず、発生している件のきっかけで発動する', () => {
    seen.length = 0
    const stopped = withRights([
      { id: '止まっている件', square: { row: 2, column: 1 } },
      { id: '発生している件', square: { row: 2, column: 0 } },
    ])
    const battle: Battle = {
      square: { row: 1, column: 1 },
      attacker: '攻撃したユニット',
      attacked: '攻撃されたユニット',
      step: '第１バトルステップ',
      dealtDamage: [],
      endOfBattleTriggered: false,
      heldBank: [],
      heldTriggered: [],
      // 1 件目（metAt 0）より後、2 件目（metAt 1）以前に始まったバトル。1 件目だけを止める。
      startedAt: 0,
    }
    const state: DuelState = {
      ...stopped,
      battles: [battle],
      trapConditionsMet: stopped.trapConditionsMet.map((met, index) => ({ ...met, metAt: index === 0 ? 0 : 1 })),
    }

    const progress = applyWithAnswers(state, ACTIVATE, [0])

    expectAdvanced(progress)
    expect(seen).toEqual(['発生している件'])
  })

  // 攻撃・スマッシュのきっかけも、同じ入れ物と同じ選択で扱う。ユニットは識別子とスクエアで指す。
  describe('攻撃・スマッシュのきっかけ', () => {
    const attackedBy: string[] = []
    const smashedBy: string[] = []
    const attackTrapCard = defineTrap({
      name: 'テスト・攻撃トラップ',
      level: 1,
      colors: ['赤'],
      triggerIcon: { kind: '攻撃' },
      effect: function* (_duel, occasion) {
        attackedBy.push(`${occasion.attacker.id}→${occasion.attacked.id}`)
      },
    })
    const smashTrapCard = defineTrap({
      name: 'テスト・スマッシュトラップ',
      level: 1,
      colors: ['赤'],
      triggerIcon: { kind: 'スマッシュ' },
      effect: function* (_duel, occasion) {
        smashedBy.push(occasion.smasher.id)
      },
    })

    const unitAt = (id: string, square: Square, controller: Player) => ({ id, square, card: testCard, controller })
    const here: Square = { row: 0, column: 1 }
    const there: Square = { row: 0, column: 2 }

    /** 後攻が優先権を持ち、そのトラップと満たされた発動条件を持っている盤面。 */
    function armedWith(trap: TrapCard, occasions: readonly TrapOccasion[]): DuelState {
      const base = phaseReadyToAct('メインフェイズ')
      const withTrap = putInZone(base, '後攻', 'トラップゾーン', [instantiate({ id: 'トラップ', card: trap, owner: '後攻' })])
      const withEnergy = putInZone(withTrap, '後攻', 'エネルギーゾーン', [
        instantiate({ id: '後攻のエネ1', card: testCard, owner: '後攻' }),
      ])
      return {
        ...withEnergy,
        turn: { ...withEnergy.turn, priority: '後攻' },
        trapConditionsMet: occasions.map((occasion, index) => ({ trap: 'トラップ', occasion, metAt: index })),
      }
    }

    const attackOccasion = (attacker: string, attacked: string, square: Square): TrapOccasion => ({
      kind: '攻撃',
      attacker: unitAt(attacker, square, '先攻'),
      attacked: unitAt(attacked, square, '後攻'),
    })

    it('攻撃のきっかけは、攻撃したユニットと攻撃されたユニットを、識別子とスクエアで指す', () => {
      const state = armedWith(attackTrapCard, [attackOccasion('攻撃者1', '被攻撃者1', here), attackOccasion('攻撃者2', '被攻撃者2', there)])

      const progress = applyWithAnswers(state, ACTIVATE, [])

      expectChoice(progress)
      expect(progress.choice.purpose).toBe('トラップのきっかけ')
      expect(progress.choice.candidates).toEqual([
        {
          kind: 'きっかけ',
          occasion: { kind: '攻撃', attacker: { card: '攻撃者1', square: here }, attacked: { card: '被攻撃者1', square: here } },
        },
        {
          kind: 'きっかけ',
          occasion: { kind: '攻撃', attacker: { card: '攻撃者2', square: there }, attacked: { card: '被攻撃者2', square: there } },
        },
      ])
    })

    it('選んだ攻撃のきっかけの効果が解決される', () => {
      attackedBy.length = 0
      const state = armedWith(attackTrapCard, [attackOccasion('攻撃者1', '被攻撃者1', here), attackOccasion('攻撃者2', '被攻撃者2', there)])

      expectAdvanced(applyWithAnswers(state, ACTIVATE, [1]))

      expect(attackedBy).toEqual(['攻撃者2→被攻撃者2'])
    })

    it('スマッシュのきっかけは、スマッシュしたユニットを、識別子とスクエアで指す', () => {
      const state = armedWith(smashTrapCard, [
        { kind: 'スマッシュ', smasher: unitAt('1 体目', here, '先攻') },
        { kind: 'スマッシュ', smasher: unitAt('2 体目', there, '先攻') },
      ])

      const progress = applyWithAnswers(state, ACTIVATE, [])

      expectChoice(progress)
      expect(progress.choice.candidates).toEqual([
        { kind: 'きっかけ', occasion: { kind: 'スマッシュ', smasher: { card: '1 体目', square: here } } },
        { kind: 'きっかけ', occasion: { kind: 'スマッシュ', smasher: { card: '2 体目', square: there } } },
      ])
    })

    it('選んだスマッシュのきっかけの効果が解決される', () => {
      smashedBy.length = 0
      const state = armedWith(smashTrapCard, [
        { kind: 'スマッシュ', smasher: unitAt('1 体目', here, '先攻') },
        { kind: 'スマッシュ', smasher: unitAt('2 体目', there, '先攻') },
      ])

      expectAdvanced(applyWithAnswers(state, ACTIVATE, [0]))

      expect(smashedBy).toEqual(['1 体目'])
    })
  })
})

// ADR-0039。「勇気」を起動する時も、権利が発生しているきっかけが複数あれば選ばせる。
describe('「勇気」を起動するきっかけを選ぶ', () => {
  const courageCard = defineUnit({
    name: 'テスト・勇気',
    level: 1,
    colors: ['赤'],
    bp: 1000,
    sp: 1000,
    abilities: [courage(4000)],
  })

  it('候補はきっかけの形で届き、目的と発生源が載る', () => {
    const base = phaseReadyToAct('メインフェイズ')
    const withHand = putInZone(base, '後攻', '手札', [instantiate({ id: '勇気', card: courageCard, owner: '後攻' })])
    const ready = putInZone(withHand, '後攻', 'エネルギーゾーン', [
      instantiate({ id: '後攻のエネ', card: testCard, owner: '後攻' }),
    ])
    const placedAt = (id: string, square: Square) => ({ id, square, card: testCard, controller: '先攻' as const })
    const state: DuelState = {
      ...ready,
      turn: { ...ready.turn, priority: '後攻' },
      courageConditionsMet: [
        { player: '後攻', satisfied: ['勇気'], placed: placedAt('1 体目', { row: 2, column: 1 }), metAt: 0 },
        { player: '後攻', satisfied: ['勇気'], placed: placedAt('2 体目', { row: 2, column: 0 }), metAt: 1 },
      ],
    }

    const progress = applyWithAnswers(state, { kind: '「勇気」を起動する', card: '勇気' }, [])

    expectChoice(progress)
    expect(progress.choice.purpose).toBe('勇気のきっかけ')
    expect(progress.choice.source).toBe('勇気')
    // トリガーアイコンとは関係が無いので、「侵入」とは呼ばない。
    expect(progress.choice.candidates).toEqual([
      { kind: 'きっかけ', occasion: { kind: '置かれた', unit: { card: '1 体目', square: { row: 2, column: 1 } } } },
      { kind: 'きっかけ', occasion: { kind: '置かれた', unit: { card: '2 体目', square: { row: 2, column: 0 } } } },
    ])
  })
})

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
