import { describe, expect, it } from 'vitest'
import { putInZone } from './duel.js'
import {
  PLAYERS,
  applyWithAnswers,
  cardsIn,
  chooseAtMostOne,
  chooseSeveral,
  defineStrategy,
  defineUnit,
  emptyDuelState,
  instantiate,
  passPriority,
  placeInZone,
  putOnSquare,
} from './index.js'
import type { ActionProgress, CardInstance, Chooser, DuelState, LegalAction, Square } from './index.js'

const chooseFirst: Chooser = (candidates) => candidates[0]

const filler = defineUnit({ name: 'テスト・山札', level: 1, bp: 1000, sp: 1000 })

function discarded(id: string): CardInstance {
  return instantiate({ id, card: defineUnit({ name: `テスト・${id}`, level: 1, bp: 1000, sp: 1000 }), owner: '先攻' })
}

/** 自分の捨札から 2 枚を選び、手札に加えるレベル 0 のストラテジー。 */
const takingTwo = defineStrategy({
  name: 'テスト・2枚拾う',
  level: 0,
  effect: function* (duel) {
    const chosen = yield* chooseSeveral(duel.discardPile().filter((each) => each.card.type === 'ユニット'), 2)
    for (const each of chosen) yield* placeInZone(each, '手札', 'リリース')
  },
})

/** 味方を 1 つ選んでから、捨札の 2 枚を選ぶ。2 枚目を選ぶ時には、すでに 1 つ答えている。 */
const choosingAfterAnAnswer = defineStrategy({
  name: 'テスト・選んでから2枚拾う',
  level: 0,
  effect: function* (duel) {
    yield* chooseAtMostOne(duel.allies())
    const chosen = yield* chooseSeveral(duel.discardPile().filter((each) => each.card.type === 'ユニット'), 2)
    for (const each of chosen) yield* placeInZone(each, '手札', 'リリース')
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

const cardIdsOf = (progress: ActionProgress & { kind: '選んでほしい' }) =>
  progress.choice.candidates.map((candidate) => (candidate.kind === '見えている' ? candidate.card : undefined))

/** 捨札のうち、プレイしたストラテジー自身を除いたもの。 */
const pileIds = (state: DuelState) =>
  cardsIn(state, '先攻', '捨札')
    .map((card) => card.id)
    .filter((id) => id !== 'ストラテジー')

const handIds = (state: DuelState) => cardsIn(state, '先攻', '手札').map((card) => card.id)

// 総合ルール 第4部 第8章 2-3、第1部 第1章 3（ADR-0055）
describe('N 枚を選ぶ命令', () => {
  it('命令の形は候補と枚数で、効果には選んだ並びが返る', () => {
    const candidates = ['A', 'B', 'C']
    const steps = chooseSeveral(candidates, 2)

    expect(steps.next()).toEqual({ done: false, value: { kind: '複数を選ぶ', candidates, count: 2 } })
    expect(steps.next(['A', 'C'])).toEqual({ done: true, value: ['A', 'C'] })
  })

  it('支配者に、何枚目かと全部で何枚かを添えて 1 枚ずつ聞き、選んだカードは次の候補から外れる', () => {
    const start = mainPhaseWith(takingTwo, [discarded('A'), discarded('B'), discarded('C')])

    const first = applyWithAnswers(start, PLAY, [])
    expectChoice(first)
    expect(first.choice.player).toBe('先攻')
    expect(first.choice.purpose).toBe('効果の対象')
    expect(first.choice.mayDecline).toBe(false)
    expect(first.choice.series).toEqual({ nth: 1, of: 2 })
    expect(cardIdsOf(first).sort()).toEqual(['A', 'B', 'C'])

    const indexOfB = cardIdsOf(first).indexOf('B')
    const second = applyWithAnswers(start, PLAY, [indexOfB])
    expectChoice(second)
    expect(second.choice.series).toEqual({ nth: 2, of: 2 })
    expect(cardIdsOf(second).sort()).toEqual(['A', 'C'])
  })

  it('N 枚を選び終えてから、効果が選んだ並びを受け取って処置する', () => {
    const start = mainPhaseWith(takingTwo, [discarded('A'), discarded('B'), discarded('C')])
    const first = applyWithAnswers(start, PLAY, [])
    expectChoice(first)
    const indexOfB = cardIdsOf(first).indexOf('B')
    const second = applyWithAnswers(start, PLAY, [indexOfB])
    expectChoice(second)
    const indexOfC = cardIdsOf(second).indexOf('C')

    const done = applyWithAnswers(start, PLAY, [indexOfB, indexOfC])

    expectAdvanced(done)
    expect(handIds(done.state)).toEqual(expect.arrayContaining(['B', 'C']))
    expect(handIds(done.state)).not.toContain('A')
    expect(pileIds(done.state)).toEqual(['A'])
  })

  it('何枚目かは、この行動で先に答えた数に左右されない', () => {
    // #347。先に答えた選択（ここでは味方を選ぶ 1 つ）があっても、N 枚のうちの 1 枚目は 1 枚目である。
    const start = mainPhaseWith(choosingAfterAnAnswer, [discarded('A'), discarded('B'), discarded('C')])

    const first = applyWithAnswers(start, PLAY, [0])

    expectChoice(first)
    expect(first.choice.answered).toBe(1)
    expect(first.choice.series).toEqual({ nth: 1, of: 2 })
  })

  it('候補が N 枚以下なら聞かずに全部選ぶ', () => {
    const start = mainPhaseWith(takingTwo, [discarded('A'), discarded('B')])

    const progress = applyWithAnswers(start, PLAY, [])

    expectAdvanced(progress)
    expect(handIds(progress.state)).toEqual(expect.arrayContaining(['A', 'B']))
    expect(pileIds(progress.state)).toEqual([])
  })

  it('候補が 1 枚だけでも、聞かずにその 1 枚を選ぶ', () => {
    const start = mainPhaseWith(takingTwo, [discarded('A')])

    const progress = applyWithAnswers(start, PLAY, [])

    expectAdvanced(progress)
    expect(handIds(progress.state)).toContain('A')
  })

  it('候補が無ければ何も選ばず、効果は続く', () => {
    const start = mainPhaseWith(takingTwo, [])

    const progress = applyWithAnswers(start, PLAY, [])

    expectAdvanced(progress)
    expect(handIds(progress.state)).toEqual([])
  })

  it('選んだカードごとに、選んだ行がログに 1 行ずつ積まれる', () => {
    const start = mainPhaseWith(takingTwo, [discarded('A'), discarded('B'), discarded('C')])
    const first = applyWithAnswers(start, PLAY, [])
    expectChoice(first)
    const indexOfB = cardIdsOf(first).indexOf('B')
    const second = applyWithAnswers(start, PLAY, [indexOfB])
    expectChoice(second)
    const indexOfC = cardIdsOf(second).indexOf('C')

    const done = applyWithAnswers(start, PLAY, [indexOfB, indexOfC])

    expectAdvanced(done)
    const chosenRows = done.state.log
      .map(({ event }) => event)
      .flatMap((event) =>
        event.kind === '命令を実行した' && event.instruction.kind === '選ぶ' ? [{ player: event.controller, card: event.instruction.card }] : [],
      )
    expect(chosenRows).toEqual([
      { player: '先攻', card: 'B' },
      { player: '先攻', card: 'C' },
    ])
  })
})
