import { describe, expect, it } from 'vitest'
import { putInZone } from './duel.js'
import {
  PLAYERS,
  applyWithAnswers,
  cardsIn,
  defineStrategy,
  defineUnit,
  emptyDuelState,
  instantiate,
  mayDo,
  passPriority,
  placeInZone,
  perspectiveOf,
  putOnSquare,
} from './index.js'
import type { ActionProgress, CardInstance, Chooser, DuelState, LegalAction, Square } from './index.js'

const chooseFirst: Chooser = (candidates) => candidates[0]

const filler = defineUnit({ name: 'テスト・山札', level: 1, bp: 1000, sp: 1000 })

function discarded(id: string): CardInstance {
  return instantiate({ id, card: defineUnit({ name: `テスト・${id}`, level: 1, bp: 1000, sp: 1000 }), owner: '先攻' })
}

/** 捨札の「見張り」を手札に加えてもよい。そうしたら、手札を 1 枚捨てる（続きは効果が書く）。 */
const mayTakeThenDiscard = defineStrategy({
  name: 'テスト・拾ってもよい',
  level: 0,
  effect: function* (duel) {
    const target = duel.discardPile().find((each) => each.id === '見張り')
    const yes = yield* mayDo(target === undefined ? [] : [target], '手札に加える')
    if (!yes) return

    const [first] = duel.hand()
    if (first !== undefined) yield* placeInZone(first, '捨札', 'リリース')
  },
})

const homeSquare: Square = { row: 0, column: 1 }

function mainPhaseWith(strategy: ReturnType<typeof defineStrategy>, discardPile: readonly CardInstance[]): DuelState {
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
  const withPile = putInZone(withStrategy, '先攻', '捨札', discardPile)
  return putOnSquare(withPile, homeSquare, instantiate({ id: '味方', card: filler, owner: '先攻' }))
}

const PLAY: LegalAction = { kind: 'カードをプレイする', declaration: { card: 'ストラテジー' } }

function expectChoice(progress: ActionProgress): asserts progress is ActionProgress & { kind: '選んでほしい' } {
  if (progress.kind !== '選んでほしい') throw new Error(`選んでほしいはずだった: ${progress.kind}`)
}

function expectAdvanced(progress: ActionProgress): asserts progress is ActionProgress & { kind: '進んだ' } {
  if (progress.kind !== '進んだ') throw new Error(`進んだはずだった: ${progress.kind}`)
}

const handIds = (state: DuelState) => cardsIn(state, '先攻', '手札').map((card) => card.id)

const maySteps = (state: DuelState) =>
  state.log.flatMap(({ event }) =>
    event.kind === '命令を実行した' && event.instruction.kind === 'してもよいか聞く' ? [event.instruction] : [],
  )

// 総合ルール 第4部 第8章 2-3、第1部 第1章 3（ADR-0064）
describe('してもよいか聞く命令', () => {
  it('命令の構造は対象と動きで、効果には「はい」なら true が返る', () => {
    const target = { id: 'X', zone: '捨札' as const, player: '先攻' as const, card: filler }
    const steps = mayDo([target], '手札に加える')

    expect(steps.next()).toEqual({ done: false, value: { kind: 'してもよいか聞く', targets: [target], action: '手札に加える' } })
    expect(steps.next(true)).toEqual({ done: true, value: true })
    expect(mayDo([target], '手札に加える').next().done).toBe(false)
  })

  it('支配者に、目的「してもよい」と、動き・対象つきで聞く。候補は「確認」の 1 つで、選ばないことも選べる', () => {
    const start = mainPhaseWith(mayTakeThenDiscard, [discarded('見張り')])

    const asked = applyWithAnswers(start, PLAY, [])

    expectChoice(asked)
    expect(asked.choice.player).toBe('先攻')
    expect(asked.choice.purpose).toBe('してもよい')
    expect(asked.choice.mayDecline).toBe(true)
    expect(asked.choice.candidates).toEqual([{ kind: '確認' }])
    expect(asked.choice.may).toEqual({ action: '手札に加える', targets: ['見張り'] })
  })

  it('「はい」（候補の 0 番）なら、対象を手札へ置いて、効果が続きを実行する', () => {
    const start = mainPhaseWith(mayTakeThenDiscard, [discarded('見張り')])

    const done = applyWithAnswers(start, PLAY, [0])

    expectAdvanced(done)
    expect(maySteps(done.state)).toEqual([
      { kind: 'してもよいか聞く', action: '手札に加える', count: 1, cards: ['見張り'], answer: 'はい' },
    ])
    // 手札に加えた後に、続きの「手札を 1 枚捨てる」を実行している。
    const placed = done.state.log.flatMap(({ event }) =>
      event.kind === '命令を実行した' && event.instruction.kind === 'ゾーンへ置く'
        ? [{ card: event.instruction.card, to: event.instruction.to }]
        : [],
    )
    expect(placed[0]).toEqual({ card: '見張り', to: '手札' })
    expect(placed[1]?.to).toBe('捨札')
  })

  it('「はい」の時の行は、聞いた行、手札へ置いた行の順に並ぶ', () => {
    const start = mainPhaseWith(mayTakeThenDiscard, [discarded('見張り')])

    const done = applyWithAnswers(start, PLAY, [0])

    expectAdvanced(done)
    const kinds = done.state.log.flatMap(({ event }) => (event.kind === '命令を実行した' ? [event.instruction.kind] : []))
    expect(kinds.slice(0, 2)).toEqual(['してもよいか聞く', 'ゾーンへ置く'])
  })

  it('「いいえ」（選ばない）なら、何も動かず、効果の続きも実行されない。聞いた行だけが積まれる', () => {
    const start = mainPhaseWith(mayTakeThenDiscard, [discarded('見張り')])

    const done = applyWithAnswers(start, PLAY, ['選ばない'])

    expectAdvanced(done)
    expect(maySteps(done.state)).toEqual([
      { kind: 'してもよいか聞く', action: '手札に加える', count: 1, cards: ['見張り'], answer: 'いいえ' },
    ])
    expect(handIds(done.state)).not.toContain('見張り')
    expect(cardsIn(done.state, '先攻', '捨札').map((card) => card.id)).toContain('見張り')
    const moved = done.state.log.flatMap(({ event }) =>
      event.kind === '命令を実行した' && event.instruction.kind === 'ゾーンへ置く' ? [event.instruction.card] : [],
    )
    expect(moved).not.toContain('見張り')
  })

  it('効果が空の対象を渡せば、聞かずに「いいえ」として進み、ログも積まない', () => {
    // 捨札に「見張り」が無い。効果は空の対象を渡す。
    const start = mainPhaseWith(mayTakeThenDiscard, [])

    const done = applyWithAnswers(start, PLAY, [])

    expectAdvanced(done)
    expect(maySteps(done.state)).toEqual([])
  })

  // 総合ルール 第1部 第1章 3。効果が読んだあと、聞く前に対象が場所を離れていれば、その対象には実行できない。
  describe('効果が読んだあと、聞く前に対象が場所を離れた時', () => {
    /** 捨札の 2 枚を読み、1 枚目を先に手札へ置いてから、2 枚（または 1 枚目だけ）について聞く。 */
    const movingFirst = (askAbout: 'どちらも' | '1枚目だけ') =>
      defineStrategy({
        name: `テスト・先に動かす（${askAbout}）`,
        level: 0,
        effect: function* (duel) {
          const [first, second] = duel.discardPile()
          if (first === undefined || second === undefined) return

          yield* placeInZone(first, '手札', 'リリース')
          yield* mayDo(askAbout === 'どちらも' ? [first, second] : [first], '手札に加える')
        },
      })

    it('対象のすべてが離れていれば、選択は出ず、聞いた行も積まれない', () => {
      const start = mainPhaseWith(movingFirst('1枚目だけ'), [discarded('A'), discarded('B')])

      const done = applyWithAnswers(start, PLAY, [])

      expectAdvanced(done)
      expect(maySteps(done.state)).toEqual([])
    })

    it('一部だけが離れていれば、聞く文・ログ・手札へ置く動きは、残った 1 枚だけになる', () => {
      const start = mainPhaseWith(movingFirst('どちらも'), [discarded('A'), discarded('B')])

      const asked = applyWithAnswers(start, PLAY, [])
      expectChoice(asked)
      expect(asked.choice.may?.targets).toHaveLength(1)

      const done = applyWithAnswers(start, PLAY, [0])
      expectAdvanced(done)
      const [row] = maySteps(done.state)
      expect(row).toMatchObject({ count: 1, answer: 'はい' })
      expect(row?.cards).toEqual(asked.choice.may?.targets)
      expect(handIds(done.state)).toEqual(expect.arrayContaining(['A', 'B']))
    })
  })

  it('2 人に見えているカードなので、相手の視点のログにも同じ名指しが届く（ADR-0004）', () => {
    const start = mainPhaseWith(mayTakeThenDiscard, [discarded('見張り')])
    const done = applyWithAnswers(start, PLAY, [0])
    expectAdvanced(done)

    for (const viewer of PLAYERS) {
      const asked = perspectiveOf(done.state, viewer).log.flatMap(({ event }) =>
        event.kind === '命令を実行した' && event.instruction.kind === 'してもよいか聞く' ? [event.instruction] : [],
      )
      expect(asked).toEqual([
        { kind: 'してもよいか聞く', action: '手札に加える', count: 1, cards: ['見張り'], answer: 'はい' },
      ])
    }
  })

  it('答えが候補の範囲外なら、断る', () => {
    const start = mainPhaseWith(mayTakeThenDiscard, [discarded('見張り')])

    expect(() => applyWithAnswers(start, PLAY, [1])).toThrow('候補にない番号が答えられた')
  })
})
