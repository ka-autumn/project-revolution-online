import { describe, expect, it } from 'vitest'
import { putInZone } from './duel.js'
import {
  PLAYERS,
  applyWithAnswers,
  cardsIn,
  chooseAtMostOne,
  defineStrategy,
  defineUnit,
  discardOpponentHand,
  emptyDuelState,
  instantiate,
  letOpponentChooseFromMyHand,
  passPriority,
  perspectiveOf,
  placeInZone,
  putOnSquare,
  wit,
} from './index.js'
import type { ActionProgress, CardInstance, Chooser, DuelEvent, DuelState, LegalAction, Player, Square } from './index.js'

const chooseFirst: Chooser = (candidates) => candidates[0]

const filler = defineUnit({ name: 'テスト・山札', level: 1, bp: 1000, sp: 1000 })

function handCard(id: string, owner: Player): CardInstance {
  return instantiate({ id, card: defineUnit({ name: `テスト・${id}`, level: 1, bp: 1000, sp: 1000 }), owner })
}

/** 相手に手札を N 枚捨てさせるだけのレベル 0 のストラテジー。 */
function discarding(count: number) {
  return defineStrategy({
    name: `テスト・捨てさせる${count}`,
    level: 0,
    effect: function* () {
      yield* discardOpponentHand(count)
    },
  })
}

/** 味方を選び、相手に 2 枚捨てさせ、また味方を選ぶ。選ぶ人が入れ替わる行動を作る。 */
const alternating = defineStrategy({
  name: 'テスト・交互',
  level: 0,
  effect: function* (duel) {
    yield* chooseAtMostOne(duel.allies())
    yield* discardOpponentHand(2)
    yield* chooseAtMostOne(duel.allies())
  },
})

/** 支配者の手札を相手に見せ、相手が選んだ 1 枚を支配者の捨札に置く。 */
const revealing = defineStrategy({
  name: 'テスト・見せる',
  level: 0,
  effect: function* (duel) {
    const chosen = yield* letOpponentChooseFromMyHand(duel)
    if (chosen !== undefined) yield* placeInZone(chosen, '捨札', 'リリース')
  },
})

const homeSquare: Square = { row: 0, column: 1 }

/** 先攻がストラテジーをプレイできるメインフェイズの盤面。 */
function mainPhaseWith(
  strategy: ReturnType<typeof defineStrategy>,
  opponentHand: readonly CardInstance[],
  ownHand: readonly CardInstance[] = [],
): DuelState {
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

  const withStrategy = putInZone(current, '先攻', '手札', [instantiate({ id: 'ストラテジー', card: strategy, owner: '先攻' }), ...ownHand])
  const withOpponentHand = putInZone(withStrategy, '後攻', '手札', opponentHand)
  return putOnSquare(withOpponentHand, homeSquare, instantiate({ id: '味方', card: filler, owner: '先攻' }))
}

const PLAY: LegalAction = { kind: 'カードをプレイする', declaration: { card: 'ストラテジー' } }

const hand = (ids: readonly string[]): readonly CardInstance[] => ids.map((id) => handCard(id, '後攻'))

function expectChoice(progress: ActionProgress): asserts progress is ActionProgress & { kind: '選んでほしい' } {
  if (progress.kind !== '選んでほしい') throw new Error(`選んでほしいはずだった: ${progress.kind}`)
}

function expectAdvanced(progress: ActionProgress): asserts progress is ActionProgress & { kind: '進んだ' } {
  if (progress.kind !== '進んだ') throw new Error(`進んだはずだった: ${progress.kind}`)
}

const idsOf = (cards: readonly CardInstance[]) => cards.map((card) => card.id)

function instructionEvents(state: DuelState, kind: string): readonly DuelEvent[] {
  return state.log.map(({ event }) => event).filter((event) => event.kind === '命令を実行した' && event.instruction.kind === kind)
}

// 総合ルール 第4部 第8章 2-3、第4部 第10章 2（ADR-0052）
describe('相手に手札を捨てさせる命令', () => {
  it('命令の形は件数だけで、効果には何も返さない', () => {
    const steps = discardOpponentHand(2)

    expect(steps.next()).toEqual({ done: false, value: { kind: '相手に手札を捨てさせる', count: 2 } })
    expect(steps.next(undefined)).toEqual({ done: true, value: undefined })
  })

  it('相手の手札が 3 枚なら、相手にだけ目的が捨てる手札の選択が届く', () => {
    const progress = applyWithAnswers(mainPhaseWith(discarding(1), hand(['A', 'B', 'C'])), PLAY, [])

    expectChoice(progress)
    expect(progress.choice.player).toBe('後攻')
    expect(progress.choice.purpose).toBe('捨てる手札')
    expect(progress.choice.mayDecline).toBe(false)
    expect(progress.choice.candidates).toHaveLength(3)
    // 1 枚だけ選ぶ選択には、何枚目かは載らない。
    expect(progress.choice.series).toBeUndefined()
  })

  it('相手が選んだ 1 枚が相手の捨札に置かれ、支配者には選択が届かない', () => {
    const start = mainPhaseWith(discarding(1), hand(['A', 'B', 'C']))
    const asked = applyWithAnswers(start, PLAY, [])
    expectChoice(asked)
    const index = asked.choice.candidates.findIndex((candidate) => candidate.kind === '見えている' && candidate.card === 'B')

    const progress = applyWithAnswers(start, PLAY, [index])

    expectAdvanced(progress)
    expect(idsOf(cardsIn(progress.state, '後攻', '捨札'))).toEqual(['B'])
    expect(idsOf(cardsIn(progress.state, '後攻', '手札')).sort()).toEqual(['A', 'C'])
  })

  // 総合ルール 第4部 第10章 2
  it('相手の手札が 1 枚なら、聞かずにその 1 枚を捨てる', () => {
    const progress = applyWithAnswers(mainPhaseWith(discarding(1), hand(['A'])), PLAY, [])

    expectAdvanced(progress)
    expect(idsOf(cardsIn(progress.state, '後攻', '捨札'))).toEqual(['A'])
  })

  it('相手の手札が 0 枚なら、何も起きず、ログも積まない', () => {
    const progress = applyWithAnswers(mainPhaseWith(discarding(1), []), PLAY, [])

    expectAdvanced(progress)
    expect(cardsIn(progress.state, '後攻', '捨札')).toEqual([])
    expect(instructionEvents(progress.state, '相手に手札を捨てさせる')).toEqual([])
  })

  it('捨てた枚数より手札が少ない時は、あるだけ捨てる', () => {
    const progress = applyWithAnswers(mainPhaseWith(discarding(3), hand(['A', 'B'])), PLAY, [])

    expectAdvanced(progress)
    expect(idsOf(cardsIn(progress.state, '後攻', '捨札')).sort()).toEqual(['A', 'B'])
    expect(cardsIn(progress.state, '後攻', '手札')).toEqual([])
  })
})

// 総合ルール 第4部 第10章 2（ADR-0052）
describe('N 枚を続けて選ばせる', () => {
  const start = () => mainPhaseWith(discarding(2), hand(['A', 'B', 'C', 'D']))

  it('1 枚目の選択には何枚目かが載り、答えが 2 つで 2 枚が同時に捨札へ置かれる', () => {
    const first = applyWithAnswers(start(), PLAY, [])
    expectChoice(first)
    expect(first.choice.series).toEqual({ nth: 1, of: 2 })
    expect(first.choice.candidates).toHaveLength(4)

    const second = applyWithAnswers(start(), PLAY, [0])
    expectChoice(second)
    expect(second.choice.series).toEqual({ nth: 2, of: 2 })
    // 選んだカードは次の候補から外れる。盤面は途中で変わらない。
    expect(second.choice.candidates).toHaveLength(3)
    expect(cardsIn(second.board, '後攻', '手札')).toHaveLength(4)

    const done = applyWithAnswers(start(), PLAY, [0, 0])
    expectAdvanced(done)
    expect(cardsIn(done.state, '後攻', '手札')).toHaveLength(2)
    expect(cardsIn(done.state, '後攻', '捨札')).toHaveLength(2)
  })

  // 1 枚目を送った後に回線が切れて繋ぎ直した場合、届くのは続きの選択だけである。
  it('1 枚目の答えが記録に残った後は、続きの選択だけが届き、選び直した 1 枚と合わせて 2 枚が捨てられる', () => {
    const first = applyWithAnswers(start(), PLAY, [])
    expectChoice(first)
    const firstCard = first.choice.candidates[2]
    const firstId = firstCard?.kind === '見えている' ? firstCard.card : undefined

    const rejoined = applyWithAnswers(start(), PLAY, [2])
    expectChoice(rejoined)
    expect(rejoined.choice.series).toEqual({ nth: 2, of: 2 })

    const done = applyWithAnswers(start(), PLAY, [2, 0])
    expectAdvanced(done)
    const discarded = idsOf(cardsIn(done.state, '後攻', '捨札'))
    expect(discarded).toHaveLength(2)
    expect(discarded).toContain(firstId)
  })

  it('手札が捨てる枚数と同じなら、聞かずに全部を捨てる', () => {
    const progress = applyWithAnswers(mainPhaseWith(discarding(2), hand(['A', 'B'])), PLAY, [])

    expectAdvanced(progress)
    expect(cardsIn(progress.state, '後攻', '捨札')).toHaveLength(2)
  })

  it('捨てたカードの名前が、2 人のログに同じように出る', () => {
    const done = applyWithAnswers(start(), PLAY, [0, 0])
    expectAdvanced(done)

    for (const viewer of PLAYERS) {
      const events = perspectiveOf(done.state, viewer)
        .log.map(({ event }) => event)
        .filter((event) => event.kind === '命令を実行した' && event.instruction.kind === '相手に手札を捨てさせる')
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ controller: '先攻', instruction: { count: 2 } })
      const instruction = events[0]?.kind === '命令を実行した' ? events[0].instruction : undefined
      expect(instruction !== undefined && 'cards' in instruction ? instruction.cards : []).toHaveLength(2)
    }
  })
})

// 総合ルール 第4部 第8章 2-3（ADR-0008、ADR-0052）
describe('戻れる範囲と取り消せるか', () => {
  const start = () => mainPhaseWith(alternating, hand(['A', 'B', 'C', 'D']))

  it('行動した側が最初に選ぶ時は、取り消せて、続けて答えた数は 0 である', () => {
    const progress = applyWithAnswers(start(), PLAY, [])

    expectChoice(progress)
    expect(progress.choice.player).toBe('先攻')
    expect(progress.choice.answered).toBe(0)
    expect(progress.choice.mayCancel).toBe(true)
  })

  it('相手に替わったら 0 から数え直し、行動した側の取り消しは閉じる', () => {
    const progress = applyWithAnswers(start(), PLAY, [0])

    expectChoice(progress)
    expect(progress.choice.player).toBe('後攻')
    expect(progress.choice.answered).toBe(0)
    expect(progress.choice.mayCancel).toBe(false)
  })

  it('相手が続けて答えると、その分だけ数える', () => {
    const progress = applyWithAnswers(start(), PLAY, [0, 0])

    expectChoice(progress)
    expect(progress.choice.player).toBe('後攻')
    expect(progress.choice.answered).toBe(1)
    expect(progress.choice.mayCancel).toBe(false)
  })

  it('相手の答えの後、行動した側に戻ると、0 から数え直し、取り消せない', () => {
    const progress = applyWithAnswers(start(), PLAY, [0, 0, 0])

    expectChoice(progress)
    expect(progress.choice.player).toBe('先攻')
    expect(progress.choice.answered).toBe(0)
    expect(progress.choice.mayCancel).toBe(false)
  })

  it('聞かずに済んだ選択は、答えに数えない', () => {
    const progress = applyWithAnswers(mainPhaseWith(discarding(1), hand(['A', 'B'])), PLAY, [0])

    expectAdvanced(progress)
  })
})

// 総合ルール 第4部 第8章 2-3（ADR-0052）。行動を取り消せない人は、答え始めた後に見えたものだけで戻れるかが決まる。
describe('取り消せない人が戻れるか', () => {
  it('ストラテジーの効果で相手が 2 枚捨てる時、1 枚目の後に相手は戻れる', () => {
    const start = mainPhaseWith(discarding(2), hand(['A', 'B', 'C', 'D']))

    const second = applyWithAnswers(start, PLAY, [0])

    expectChoice(second)
    expect(second.choice).toMatchObject({ player: '後攻', answered: 1, mayCancel: false, mayGoBack: true })
  })

  it('行動した側は、相手が答えた後は、自分の続けた分の中だけ戻れる', () => {
    const start = mainPhaseWith(alternating, hand(['A', 'B', 'C', 'D']))

    const last = applyWithAnswers(start, PLAY, [0, 0, 0])

    expectChoice(last)
    expect(last.choice).toMatchObject({ player: '先攻', answered: 0, mayCancel: false })
  })

  // 相手の答えで、行動した側に相手の捨てたカードが見える。それは答え始める前なので、自分の続けた分は戻れる。
  it('行動した側は、相手が答えた後に続けた分の中を戻れるが、取り消せない', () => {
    const twice = defineStrategy({
      name: 'テスト・捨てさせて 2 度選ぶ',
      level: 0,
      effect: function* (duel) {
        yield* discardOpponentHand(1)
        yield* chooseAtMostOne(duel.allies())
        yield* chooseAtMostOne(duel.allies())
      },
    })
    const start = mainPhaseWith(twice, hand(['A', 'B', 'C']))

    const progress = applyWithAnswers(start, PLAY, [0, 0])

    expectChoice(progress)
    expect(progress.choice).toMatchObject({ player: '先攻', answered: 1, mayCancel: false, mayGoBack: true })
  })

  it('答え始めた後に新しく見えたものがあれば、戻れない', () => {
    // 相手が 1 枚捨てた後（続けて答えた後）に、支配者の手札が相手に見える。見たのは答え始めた後なので、戻れない。
    const discardThenReveal = defineStrategy({
      name: 'テスト・捨てさせて見せる',
      level: 0,
      effect: function* (duel) {
        yield* discardOpponentHand(1)
        yield* letOpponentChooseFromMyHand(duel)
      },
    })
    const start = mainPhaseWith(discardThenReveal, hand(['A', 'B', 'C']), [handCard('自A', '先攻')])

    const progress = applyWithAnswers(start, PLAY, [0])

    expectChoice(progress)
    expect(progress.choice).toMatchObject({ player: '後攻', purpose: '効果の対象', answered: 1 })
    expect(progress.choice.mayGoBack).toBe(false)
  })
})

// 総合ルール 第5部 第10章 2（ADR-0052）
describe('「才気」', () => {
  const witty = defineUnit({ name: 'テスト・才気', level: 0, bp: 1000, sp: 1000, abilities: [wit] })

  function resolved(opponentHand: readonly CardInstance[], answers: readonly (number | '選ばない')[]): ActionProgress {
    let current = mainPhaseWith(discarding(1), opponentHand)
    current = putInZone(current, '先攻', '手札', [instantiate({ id: '才気ユニット', card: witty, owner: '先攻' })])
    const played = applyWithAnswers(current, { kind: 'カードをプレイする', declaration: { card: '才気ユニット', square: { row: 0, column: 0 } } }, [])
    expectAdvanced(played)
    // 両者が優先権を放棄すると、バンクの能力が解決される。
    const passed = applyWithAnswers(played.state, { kind: '優先権を放棄する' }, [])
    expectAdvanced(passed)
    return applyWithAnswers(passed.state, { kind: '優先権を放棄する' }, answers)
  }

  it('登場した時、相手の手札が 3 枚なら、相手にだけ捨てる手札の選択が届く', () => {
    const progress = resolved(hand(['A', 'B', 'C']), [])

    expectChoice(progress)
    expect(progress.choice.player).toBe('後攻')
    expect(progress.choice.purpose).toBe('捨てる手札')
    expect(progress.choice.candidates).toHaveLength(3)
  })

  it('相手が選んだ 1 枚が相手の捨札に置かれる', () => {
    const progress = resolved(hand(['A', 'B', 'C']), [1])

    expectAdvanced(progress)
    expect(cardsIn(progress.state, '後攻', '捨札')).toHaveLength(1)
    expect(cardsIn(progress.state, '後攻', '手札')).toHaveLength(2)
  })

  it('相手の手札が 1 枚なら聞かずに捨て、0 枚なら何も起きない', () => {
    const one = resolved(hand(['A']), [])
    expectAdvanced(one)
    expect(idsOf(cardsIn(one.state, '後攻', '捨札'))).toEqual(['A'])

    const none = resolved([], [])
    expectAdvanced(none)
    expect(cardsIn(none.state, '後攻', '捨札')).toEqual([])
  })

  // バンクの能力を解決するのは、優先権を放棄した相手の行動である。相手は戻れる。
  it('相手は、自分が続けて答えた分だけ戻れる', () => {
    const progress = resolved(hand(['A', 'B', 'C']), [])

    expectChoice(progress)
    expect(progress.choice.mayGoBack).toBe(true)
    expect(progress.choice.answered).toBe(0)
  })
})

// 総合ルール 第4部 第8章 2-3（ADR-0041、ADR-0052）
describe('相手に支配者の手札を見せて選ばせる', () => {
  const own = () => [handCard('自A', '先攻'), handCard('自B', '先攻'), handCard('自C', '先攻')]
  const start = () => mainPhaseWith(revealing, hand(['A']), own())

  it('相手にだけ、支配者の手札が見せる一覧つきで届く。選ぶことも選ばないこともできる', () => {
    const progress = applyWithAnswers(start(), PLAY, [])

    expectChoice(progress)
    expect(progress.choice.player).toBe('後攻')
    expect(progress.choice.purpose).toBe('効果の対象')
    expect(progress.choice.mayDecline).toBe(true)
    expect(progress.choice.candidates).toHaveLength(3)
    expect(progress.choice.shown?.map(({ instance }) => instance.id)).toEqual(['自A', '自B', '自C'])
    expect(progress.choice.shown?.every(({ candidate }) => candidate !== undefined)).toBe(true)
    // 相手は行動を取り消せない。見たのは答え始める前なので、戻る判定には数えない（戻る答えも無い）。
    expect(progress.choice.mayCancel).toBe(false)
    expect(progress.choice.answered).toBe(0)
  })

  it('選ばれたカードが支配者の捨札に置かれ、見たことが 2 人のログに同じ名前で出る', () => {
    const done = applyWithAnswers(start(), PLAY, [1])

    expectAdvanced(done)
    // 解決を終えたストラテジー自身も、持ち主の捨札に置かれる。
    expect(idsOf(cardsIn(done.state, '先攻', '捨札')).sort()).toEqual(['ストラテジー', '自B'])
    const logs = PLAYERS.map((viewer) =>
      perspectiveOf(done.state, viewer)
        .log.map(({ event }) => event)
        .filter((event) => event.kind === '命令を実行した' && event.instruction.kind === '相手に手札を見せる'),
    )
    expect(logs[0]).toHaveLength(1)
    expect(logs[0]).toEqual(logs[1])
    expect(logs[0]?.[0]).toMatchObject({ instruction: { count: 3, cards: ['自A', '自B', '自C'] } })
  })

  // 選んだ行は、実際に選んだ人（相手）の行になる。続く行（捨札へ置いた行）は支配者の行のまま。
  it('選んだ行は相手の行になり、捨札へ置いた行は支配者の行のままになる', () => {
    const done = applyWithAnswers(start(), PLAY, [1])

    expectAdvanced(done)
    expect(instructionEvents(done.state, '選ぶ')).toEqual([
      { kind: '命令を実行した', controller: '後攻', instruction: { kind: '選ぶ', card: '自B', square: undefined } },
    ])
    expect(instructionEvents(done.state, 'ゾーンへ置く')[0]).toMatchObject({ controller: '先攻' })
  })

  it('選ばなかった行も、相手の行になる', () => {
    const done = applyWithAnswers(start(), PLAY, ['選ばない'])

    expectAdvanced(done)
    expect(instructionEvents(done.state, '選ぶ')).toEqual([
      {
        kind: '命令を実行した',
        controller: '後攻',
        instruction: { kind: '選ぶ', card: undefined, square: undefined, declined: true },
      },
    ])
  })

  it('相手は選ばないこともでき、その時は何も捨てられない', () => {
    const done = applyWithAnswers(start(), PLAY, ['選ばない'])

    expectAdvanced(done)
    expect(idsOf(cardsIn(done.state, '先攻', '捨札'))).toEqual(['ストラテジー'])
    expect(cardsIn(done.state, '先攻', '手札')).toHaveLength(3)
  })

  it('支配者の手札が 0 枚なら、選択を出さずにログだけを積む', () => {
    const done = applyWithAnswers(mainPhaseWith(revealing, hand(['A']), []), PLAY, [])

    expectAdvanced(done)
    expect(instructionEvents(done.state, '相手に手札を見せる')).toHaveLength(1)
    expect(instructionEvents(done.state, '相手に手札を見せる')[0]).toMatchObject({
      instruction: { kind: '相手に手札を見せる', count: 0, cards: [] },
    })
  })
})
