import { describe, expect, it } from 'vitest'
import { putInZone } from './duel.js'
import {
  PLAYERS,
  applyLegalAction,
  applyWithAnswers,
  cardsIn,
  defineStrategy,
  defineTrap,
  defineUnit,
  emptyDuelState,
  instantiate,
  lookAtOpponentHandAndDiscard,
  passPriority,
  perspectiveOf,
  playSelfPlay,
  randomChooser,
  randomFromSeed,
  runSelfPlayBatch,
} from './index.js'
import type { ActionProgress, CardInstance, Chooser, Deck, DuelEvent, DuelState, HandCondition, LegalAction, Player } from './index.js'

/** 選択を求められたら常に最初の候補を選ぶ。盤面を進めるためだけに使う。 */
const chooseFirst: Chooser = (candidates) => candidates[0]

const filler = defineUnit({ name: 'テスト・山札', level: 1, bp: 1000, sp: 1000 })

const MACHINE = 'テスト属性・機械'
const BEAST = 'テスト属性・獣'

/** 架空のユニット。名前と属性だけが違う。 */
function handUnit(id: string, name: string, attributes: readonly string[]): CardInstance {
  return instantiate({ id, card: defineUnit({ name, level: 1, bp: 1000, sp: 1000, attributes }), owner: '後攻' })
}

/** 架空のストラテジー。 */
function handStrategy(id: string, name: string): CardInstance {
  return instantiate({ id, card: defineStrategy({ name, level: 0 }), owner: '後攻' })
}

/** 相手の手札を見て、条件に合うカードを捨てるレベル 0 のストラテジー。 */
function discarder(conditions: readonly HandCondition[], upTo: boolean) {
  return defineStrategy({
    name: `テスト・見て捨てる${upTo ? '・まで' : ''}`,
    level: 0,
    effect: function* () {
      yield* lookAtOpponentHandAndDiscard(conditions, { upTo })
    },
  })
}

/**
 * 先攻がストラテジーをプレイできるメインフェイズの盤面。両者の山札は 10 枚、後攻の手札は引数で指定する。
 * `look-at-hand.test.ts` の `mainPhaseWith` と同じ作り。
 */
function mainPhaseWith(strategy: ReturnType<typeof discarder>, opponentHand: readonly CardInstance[]): DuelState {
  const stocked = PLAYERS.reduce(
    (state, player) =>
      putInZone(
        state,
        player,
        '山札',
        Array.from({ length: 10 }, (_, index) => instantiate({ id: `${player}の山札${index}`, card: filler, owner: player })),
      ),
    emptyDuelState(),
  )
  let current = stocked
  while (current.turn.phase !== 'メインフェイズ') current = passPriority(current, chooseFirst)
  current = passPriority(current, chooseFirst)

  const withStrategy = putInZone(current, '先攻', '手札', [instantiate({ id: 'ストラテジー', card: strategy, owner: '先攻' })])
  return putInZone(withStrategy, '後攻', '手札', opponentHand)
}

const PLAY: LegalAction = { kind: 'カードをプレイする', declaration: { card: 'ストラテジー' } }

const THREE: readonly CardInstance[] = [
  handUnit('相手手札C', 'テスト・ちゅう', [BEAST]),
  handUnit('相手手札A', 'テスト・あ', [MACHINE]),
  handStrategy('相手手札B', 'テスト・いい'),
]

function expectChoice(progress: ActionProgress): asserts progress is ActionProgress & { kind: '選んでほしい' } {
  if (progress.kind !== '選んでほしい') throw new Error(`選んでほしいはずだった: ${progress.kind}`)
}

function expectAdvanced(progress: ActionProgress): asserts progress is ActionProgress & { kind: '進んだ' } {
  if (progress.kind !== '進んだ') throw new Error(`進んだはずだった: ${progress.kind}`)
}

function lookEventsOf(state: DuelState): readonly DuelEvent[] {
  return state.log
    .map(({ event }) => event)
    .filter((event) => event.kind === '命令を実行した' && event.instruction.kind === '相手の手札を見る')
}

/**
 * この命令が捨てたことを積んだできごと。見たことの行の直後にある、相手の捨札への `ゾーンへ置く` だけを対象にする。
 * 手札から捨札へ置く別の経路が積む行は数えない。
 */
function discardEventsOf(state: DuelState): readonly DuelEvent[] {
  const events = state.log.map(({ event }) => event)
  return events.filter(
    (event, at) =>
      event.kind === '命令を実行した' &&
      event.instruction.kind === 'ゾーンへ置く' &&
      event.instruction.to === '捨札' &&
      event.instruction.player === '後攻' &&
      events[at - 1]?.kind === '命令を実行した' &&
      (events[at - 1] as Extract<DuelEvent, { kind: '命令を実行した' }>).instruction.kind === '相手の手札を見る',
  )
}

const ids = (cards: readonly CardInstance[]): readonly string[] => cards.map((card) => card.id)

describe('相手の手札を見て選ぶ命令', () => {
  it('値で渡した絞り込みと処置を持つ命令を出し、効果には何も返さない', () => {
    const steps = lookAtOpponentHandAndDiscard([{ axis: '種別', value: 'ユニット' }], { upTo: true })

    expect(steps.next()).toEqual({
      done: false,
      value: { kind: '相手の手札を見て選ぶ', conditions: [{ axis: '種別', value: 'ユニット' }], disposal: '捨てる', mayDecline: true },
    })
    expect(steps.next(undefined)).toEqual({ done: true, value: undefined })
  })
})

// 総合ルール 第2部 第23章 3、第2部 第21章 4-3（ADR-0008、ADR-0069）
describe('相手の手札を見て選ぶ選択（必ず選ぶ形）', () => {
  const must = discarder([], false)

  it('支配者に、相手の手札の全部が一覧で届き、全部が選べる', () => {
    const progress = applyWithAnswers(mainPhaseWith(must, THREE), PLAY, [])

    expectChoice(progress)
    const { choice } = progress
    expect(choice.player).toBe('先攻')
    expect(choice.purpose).toBe('相手の手札から選ぶ')
    expect(choice.mayDecline).toBe(false)
    expect(choice.candidates).toHaveLength(3)
    expect(choice.candidates.every((candidate) => candidate.kind === '見えている')).toBe(true)
    // 一覧は、持ち順ではなく中身で並ぶ。
    expect(choice.shown?.map(({ instance }) => instance.id)).toEqual(['相手手札A', '相手手札B', '相手手札C'])
    expect(choice.shown?.every(({ candidate }) => candidate !== undefined)).toBe(true)
  })

  it('選んだ 1 枚が、相手の捨札に置かれる', () => {
    const start = mainPhaseWith(must, THREE)
    const asked = applyWithAnswers(start, PLAY, [])
    expectChoice(asked)
    const second = asked.choice.candidates.findIndex((candidate) => candidate.kind === '見えている' && candidate.card === '相手手札B')

    const progress = applyWithAnswers(start, PLAY, [second])

    expectAdvanced(progress)
    expect(ids(cardsIn(progress.state, '後攻', '捨札'))).toEqual(['相手手札B'])
    expect([...ids(cardsIn(progress.state, '後攻', '手札'))].sort()).toEqual(['相手手札A', '相手手札C'])
  })

  // 相手の手札が 1 枚でも聞く。聞かずに捨てると、一覧が届かない。
  it('相手の手札が 1 枚でも、選択が届いてから捨てられる', () => {
    const start = mainPhaseWith(must, [handUnit('相手手札1', 'テスト・唯一', [])])

    const asked = applyWithAnswers(start, PLAY, [])
    expectChoice(asked)
    expect(asked.choice.candidates).toHaveLength(1)
    expect(cardsIn(asked.board, '後攻', '捨札')).toHaveLength(0)

    const answered = applyWithAnswers(start, PLAY, [0])
    expectAdvanced(answered)
    expect(ids(cardsIn(answered.state, '後攻', '捨札'))).toEqual(['相手手札1'])
  })

  // 総合ルール 第2部 第23章 1-1: 手札の枚数は公開情報で、0 枚なら新しく見えるものが無い。
  it('相手の手札が 0 枚なら、選択は届かず、ログが 1 件積まれて効果が先へ進む', () => {
    const progress = applyWithAnswers(mainPhaseWith(must, []), PLAY, [])

    expectAdvanced(progress)
    expect(lookEventsOf(progress.state)).toHaveLength(1)
    expect(lookEventsOf(progress.state)[0]).toMatchObject({ instruction: { kind: '相手の手札を見る', count: 0, cards: [] } })
    expect(discardEventsOf(progress.state)).toHaveLength(0)
  })
})

describe('相手の手札を見て選ぶ選択（1 枚までの形）', () => {
  const machineUnit = discarder([{ axis: '属性', value: MACHINE }], true)

  it('一覧には全部が届き、条件に合うカードだけが選べて、選ばないことも選べる', () => {
    const progress = applyWithAnswers(mainPhaseWith(machineUnit, THREE), PLAY, [])

    expectChoice(progress)
    const { choice } = progress
    expect(choice.mayDecline).toBe(true)
    expect(choice.candidates).toEqual([{ kind: '見えている', card: '相手手札A' }])
    expect(choice.shown).toHaveLength(3)
    expect(choice.shown?.filter(({ candidate }) => candidate !== undefined).map(({ instance }) => instance.id)).toEqual(['相手手札A'])
  })

  it('選ばない時は、何も捨てられず、見たことだけがログに残る', () => {
    const progress = applyWithAnswers(mainPhaseWith(machineUnit, THREE), PLAY, ['選ばない'])

    expectAdvanced(progress)
    expect(cardsIn(progress.state, '後攻', '捨札')).toHaveLength(0)
    expect(cardsIn(progress.state, '後攻', '手札')).toHaveLength(3)
    expect(lookEventsOf(progress.state)).toHaveLength(1)
    expect(discardEventsOf(progress.state)).toHaveLength(0)
  })

  it('選んだ時は、合うカードが捨てられる', () => {
    const progress = applyWithAnswers(mainPhaseWith(machineUnit, THREE), PLAY, [0])

    expectAdvanced(progress)
    expect(ids(cardsIn(progress.state, '後攻', '捨札'))).toEqual(['相手手札A'])
  })

  it('絞り込みに合うカードが 1 枚も無い時は、一覧が届き、確認だけして先へ進む', () => {
    const hand = [handUnit('相手手札X', 'テスト・獣だけ', [BEAST]), handStrategy('相手手札Y', 'テスト・策')]
    const start = mainPhaseWith(machineUnit, hand)

    const asked = applyWithAnswers(start, PLAY, [])
    expectChoice(asked)
    expect(asked.choice.candidates).toEqual([{ kind: '確認' }])
    expect(asked.choice.mayDecline).toBe(false)
    expect(asked.choice.shown).toHaveLength(2)
    expect(asked.choice.shown?.every(({ candidate }) => candidate === undefined)).toBe(true)

    const confirmed = applyWithAnswers(start, PLAY, [0])
    expectAdvanced(confirmed)
    expect(cardsIn(confirmed.state, '後攻', '捨札')).toHaveLength(0)
    expect(lookEventsOf(confirmed.state)).toHaveLength(1)
  })
})

describe('絞り込みの条件', () => {
  it('条件を 2 つ並べると、両方を満たすカードだけが候補になる', () => {
    const hand = [
      handUnit('機械ユニット', 'テスト・機械ユニット', [MACHINE]),
      handUnit('獣ユニット', 'テスト・獣ユニット', [BEAST]),
      instantiate({
        id: '機械トラップ',
        card: defineTrap({ name: 'テスト・機械トラップ', level: 0, attributes: [MACHINE], triggerIcon: { kind: '侵入', squares: [] }, effect: function* () {} }),
        owner: '後攻',
      }),
    ]
    const both = discarder(
      [
        { axis: '種別', value: 'ユニット' },
        { axis: '属性', value: MACHINE },
      ],
      true,
    )

    const progress = applyWithAnswers(mainPhaseWith(both, hand), PLAY, [])

    expectChoice(progress)
    expect(progress.choice.candidates).toEqual([{ kind: '見えている', card: '機械ユニット' }])
    expect(progress.choice.shown).toHaveLength(3)
  })

  it('種別だけの条件でも絞り込める', () => {
    const progress = applyWithAnswers(mainPhaseWith(discarder([{ axis: '種別', value: 'ストラテジー' }], true), THREE), PLAY, [])

    expectChoice(progress)
    expect(progress.choice.candidates).toEqual([{ kind: '見えている', card: '相手手札B' }])
  })

  it('空の並びは、絞り込まない', () => {
    const progress = applyWithAnswers(mainPhaseWith(discarder([], true), THREE), PLAY, [])

    expectChoice(progress)
    expect(progress.choice.candidates).toHaveLength(3)
  })
})

// 総合ルール 第2部 第23章 2-1（ADR-0008、ADR-0069）
describe('見た後に戻れない', () => {
  it('必ず選ぶ形の選択は、戻せず取り消せない', () => {
    const progress = applyWithAnswers(mainPhaseWith(discarder([], false), THREE), PLAY, [])

    expectChoice(progress)
    expect(progress.choice.mayGoBack).toBe(false)
  })

  it('1 枚までの形の選択も、戻せず取り消せない', () => {
    const progress = applyWithAnswers(mainPhaseWith(discarder([{ axis: '属性', value: MACHINE }], true), THREE), PLAY, [])

    expectChoice(progress)
    expect(progress.choice.mayGoBack).toBe(false)
  })

  it('合うカードが無い確認だけの選択も、戻せず取り消せない', () => {
    const progress = applyWithAnswers(mainPhaseWith(discarder([{ axis: '属性', value: 'テスト属性・無い' }], true), THREE), PLAY, [])

    expectChoice(progress)
    expect(progress.choice.mayGoBack).toBe(false)
  })

  it('手札が 1 枚の時も、戻せない', () => {
    const progress = applyWithAnswers(mainPhaseWith(discarder([], false), [handUnit('相手手札1', 'テスト・唯一', [])]), PLAY, [])

    expectChoice(progress)
    expect(progress.choice.mayGoBack).toBe(false)
  })
})

// 総合ルール 第2部 第23章 1-1・2-1（ADR-0004、ADR-0069）
describe('相手の手札の中身が漏れない', () => {
  function finished(answer = 0): DuelState {
    const progress = applyWithAnswers(mainPhaseWith(discarder([], false), THREE), PLAY, [answer])
    expectAdvanced(progress)
    return progress.state
  }

  it('選択の要求は支配者に向き、支配者でない側には向かない', () => {
    const progress = applyWithAnswers(mainPhaseWith(discarder([], false), THREE), PLAY, [])

    expectChoice(progress)
    expect(progress.choice.player).toBe('先攻')
  })

  it('支配者の側に届く盤面でも、相手の手札は枚数のままである', () => {
    const asked = applyWithAnswers(mainPhaseWith(discarder([], false), THREE), PLAY, [])
    expectChoice(asked)

    for (const board of [perspectiveOf(asked.board, '先攻'), perspectiveOf(finished(), '先攻')]) {
      const hand = board.zones['後攻']['手札']
      expect(hand.every((card) => card.kind === '見えていない')).toBe(true)
    }
    expect(perspectiveOf(asked.board, '先攻').zones['後攻']['手札']).toHaveLength(3)
  })

  it('見た内容は、2 人のログに同じ内容で出る', () => {
    const state = finished()
    const sees = (viewer: Player) =>
      perspectiveOf(state, viewer)
        .log.map(({ event }) => event)
        .filter((event) => event.kind === '命令を実行した' && event.instruction.kind === '相手の手札を見る')

    expect(sees('先攻')).toHaveLength(1)
    expect(sees('先攻')).toEqual(sees('後攻'))
    expect(sees('先攻')[0]).toMatchObject({ instruction: { count: 3, cards: ['相手手札A', '相手手札B', '相手手札C'] } })
    // 捨てた 1 枚（あ）は捨札で見えているので、盤面から引ける。残りの 2 枚は、ログの写しで名前が引ける。
    expect(perspectiveOf(state, '先攻').namedInLog.map((card) => card.card.name).sort()).toEqual(['テスト・いい', 'テスト・ちゅう'])
    expect(perspectiveOf(state, '先攻').zones['後攻']['捨札']).toMatchObject([{ kind: '見えている', instance: { id: '相手手札A' } }])
  })

  it('捨てたカードの名前が、2 人のログに出る', () => {
    const state = finished(0)
    const named = (viewer: Player) =>
      perspectiveOf(state, viewer)
        .log.map(({ event }) => event)
        .filter((event) => event.kind === '命令を実行した' && event.instruction.kind === 'ゾーンへ置く' && event.instruction.to === '捨札')

    expect(named('先攻')).toHaveLength(1)
    expect(named('先攻')).toEqual(named('後攻'))
    expect(named('先攻')[0]).toMatchObject({ instruction: { card: '相手手札A', player: '後攻' } })
  })

  it('選ばなかった時は、捨てたカードの行が無い', () => {
    const progress = applyWithAnswers(mainPhaseWith(discarder([{ axis: '属性', value: MACHINE }], true), THREE), PLAY, ['選ばない'])

    expectAdvanced(progress)
    expect(discardEventsOf(progress.state)).toHaveLength(0)
  })
})

// ADR-0018、ADR-0053
describe('記録からの打ち直し', () => {
  it('同じ答えの並びからは、同じ盤面になる', () => {
    const start = mainPhaseWith(discarder([], false), THREE)

    const first = applyWithAnswers(start, PLAY, [1])
    const again = applyWithAnswers(start, PLAY, [1])

    expectAdvanced(first)
    expectAdvanced(again)
    expect(again.state).toEqual(first.state)
  })

  it('候補の範囲外の答えは断られる', () => {
    expect(() => applyWithAnswers(mainPhaseWith(discarder([], false), THREE), PLAY, [3])).toThrow()
  })
})

// ADR-0005、ADR-0059: 自動で手を選ぶ側が、この命令を通り抜ける。
describe('自動で手を選ぶ側が、相手の手札を見て選ぶ効果を通り抜ける', () => {
  it('最初の候補を選ぶ chooser で、効果は最後まで進む', () => {
    const start = mainPhaseWith(discarder([], false), THREE)

    const after = applyLegalAction(start, PLAY, chooseFirst)

    expect(lookEventsOf(after)).toHaveLength(1)
    expect(cardsIn(after, '後攻', '捨札')).toHaveLength(1)
  })

  it('ランダムに選ぶ chooser でも、1 枚までの形と確認だけの形が最後まで進む', () => {
    for (const conditions of [[], [{ axis: '属性', value: 'テスト属性・無い' }]] as const) {
      const start = mainPhaseWith(discarder(conditions, true), THREE)

      const after = applyLegalAction(start, PLAY, randomChooser(randomFromSeed(7)).chooser)

      expect(lookEventsOf(after)).toHaveLength(1)
    }
  })

  it('ランダムに手を選ぶ自己対戦が、この命令のあるデッキで最後まで進み、実際に使われる', () => {
    const cards = [
      ...Array.from({ length: 3 }, (_, index) => defineStrategy({
        name: `テスト・自己対戦で捨てさせる${index}`,
        level: 0,
        effect: function* () {
          yield* lookAtOpponentHandAndDiscard(index === 0 ? [] : [{ axis: '種別', value: 'ユニット' }], { upTo: index === 2 })
        },
      })),
      ...Array.from({ length: 12 }, (_, index) =>
        defineUnit({ name: `テスト・自己対戦ユニット${index}`, level: 0, bp: 100, sp: 100, moveIcon: ['上', '下', '左', '右'] }),
      ),
    ]
    const deck: Deck = cards.flatMap((card) => Array.from({ length: 4 }, () => card))

    const result = runSelfPlayBatch({ decks: [deck, deck], seeds: Array.from({ length: 10 }, (_, seed) => seed), maxActions: 3000 })
    expect(result.kind).toBe('全て決着')

    const used = Array.from({ length: 10 }, (_, seed) => playSelfPlay({ setup: { decks: [deck, deck], seed }, maxActions: 3000 })).filter(
      (one) => one.kind === '決着' && discardEventsOf(one.state).length > 0,
    )
    expect(used.length).toBeGreaterThan(0)
  })
})
