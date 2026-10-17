import { describe, expect, it } from 'vitest'
// 次の import は、engine の内側の部品を直接使うためのもので、公開する API ではない（`index.ts` から
// 出していない）。`putInZone` は山札とプランゾーンを組み立てるためだけに、`orderShown` は一覧の
// 並べ方だけを確かめるために使う（`look-at-hand.test.ts` と同じ）。
import { putInZone } from './duel.js'
import { orderShown } from './protocol.js'
import {
  PLAYERS,
  applyLegalAction,
  applyWithAnswers,
  cardsIn,
  chooseAtMostOne,
  chooseAtMostOneFromLibrary,
  defineStrategy,
  defineUnit,
  emptyDuelState,
  instantiate,
  passPriority,
  perspectiveOf,
  placeInZone,
  playSelfPlay,
  prepareDuel,
  putOnSquare,
  randomChooser,
  randomFromSeed,
  readLibrary,
  runSelfPlayBatch,
  shuffleLibrary,
  toWire,
} from './index.js'
import type {
  ActionProgress,
  CardInstance,
  CardInZone,
  Chooser,
  Deck,
  DuelEvent,
  DuelState,
  LegalAction,
  Player,
  Square,
} from './index.js'

const chooseFirst: Chooser = (candidates) => candidates[0]

const filler = defineUnit({ name: 'テスト・山札', level: 1, bp: 1000, sp: 1000 })

const target = defineUnit({ name: 'テスト・目当て', level: 1, bp: 1000, sp: 1000 })

function libraryCard(id: string, name: string, owner: Player): CardInstance {
  return instantiate({ id, card: defineUnit({ name, level: 1, bp: 1000, sp: 1000 }), owner })
}

/** 山札を読み、名前が「目当て」のカードを 1 枚まで選んで手札に加え、山札をシャッフルする。 */
const searchAndShuffle = defineStrategy({
  name: 'テスト・探してシャッフル',
  level: 0,
  effect: function* () {
    const found = yield* chooseAtMostOneFromLibrary((card) => card.card.name === 'テスト・目当て')
    if (found !== undefined) yield* placeInZone(found, '手札', 'リリース')
    yield* shuffleLibrary()
  },
})

/** 山札をシャッフルするだけのストラテジー。 */
const shuffleOnly = defineStrategy({
  name: 'テスト・シャッフルだけ',
  level: 0,
  effect: function* () {
    yield* shuffleLibrary()
  },
})

/** 山札を読んで、読んだだけで終わるストラテジー（読んだのにシャッフルしない）。 */
const readOnly = defineStrategy({
  name: 'テスト・読むだけ',
  level: 0,
  effect: function* () {
    yield* readLibrary()
  },
})

/** 山札を読み、条件に合うカードを選んだ後に、味方を 1 体まで選ぶストラテジー。戻れなさを見る。 */
const searchThenChoose = defineStrategy({
  name: 'テスト・探して選ぶ',
  level: 0,
  effect: function* (duel) {
    yield* chooseAtMostOneFromLibrary((card) => card.card.name === 'テスト・目当て')
    yield* chooseAtMostOne(duel.allies())
  },
})

const homeSquare: Square = { row: 0, column: 1 }

const PLAY: LegalAction = { kind: 'カードをプレイする', declaration: { card: 'ストラテジー' } }

/**
 * 先攻がストラテジーをプレイできるメインフェイズの盤面。先攻の山札は引数で決め、後攻の山札は
 * 10 枚。`look-at-hand.test.ts` の `mainPhaseWith` と同じ作り。
 */
function mainPhaseWith(
  strategy: ReturnType<typeof defineStrategy>,
  library: readonly CardInstance[],
  plan: readonly CardInstance[] = [],
): DuelState {
  // 進行を進める間に山札が尽きないよう、山札はあとで差し替える。
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
  current = putInZone(putInZone(current, '先攻', '山札', library), '先攻', 'プランゾーン', plan)

  const withStrategy = putInZone(current, '先攻', '手札', [instantiate({ id: 'ストラテジー', card: strategy, owner: '先攻' })])
  return putOnSquare(withStrategy, homeSquare, instantiate({ id: '味方', card: filler, owner: '先攻' }))
}

/** 名前の違う山札。持ち順は名前順でも識別子順でもない並びにしてある。 */
function sampleLibrary(): readonly CardInstance[] {
  return [
    libraryCard('先攻-5', 'テスト・ろ', '先攻'),
    libraryCard('先攻-2', 'テスト・目当て', '先攻'),
    libraryCard('先攻-9', 'テスト・い', '先攻'),
    libraryCard('先攻-0', 'テスト・目当て', '先攻'),
    libraryCard('先攻-7', 'テスト・は', '先攻'),
  ]
}

function expectChoice(progress: ActionProgress): asserts progress is ActionProgress & { kind: '選んでほしい' } {
  if (progress.kind !== '選んでほしい') throw new Error(`選んでほしいはずだった: ${progress.kind}`)
}

function expectAdvanced(progress: ActionProgress): asserts progress is ActionProgress & { kind: '進んだ' } {
  if (progress.kind !== '進んだ') throw new Error(`進んだはずだった: ${progress.kind}`)
}

function instructionEvents(state: DuelState, kind: string): readonly DuelEvent[] {
  return state.log
    .map(({ event }) => event)
    .filter((event) => event.kind === '命令を実行した' && event.instruction.kind === kind)
}

const libraryIds = (state: DuelState, player: Player = '先攻'): readonly string[] =>
  cardsIn(state, player, '山札').map((card) => card.id)

// 総合ルール 第2部 第21章 2-2、第2部 第21章 3-1（ADR-0042）
describe('山札を読む・シャッフルする命令', () => {
  it('山札を読む命令を出し、返ってきた中身をそのまま効果に渡す', () => {
    const steps = readLibrary()
    const read: readonly CardInZone[] = [{ id: '先攻-1', zone: '山札', card: filler }]

    expect(steps.next()).toEqual({ done: false, value: { kind: '自分の山札を読む' } })
    expect(steps.next(read)).toEqual({ done: true, value: read })
  })

  it('シャッフルの命令は項目を持たない', () => {
    expect(shuffleLibrary().next()).toEqual({ done: false, value: { kind: '山札をシャッフルする' } })
  })

  it('山札から選ぶ記述は、読んだ全体を見せる一覧として「1 枚まで選ぶ」に渡す', () => {
    const steps = chooseAtMostOneFromLibrary((card) => card.card.name === 'テスト・目当て')
    const read: readonly CardInZone[] = [
      { id: '先攻-1', zone: '山札', card: filler },
      { id: '先攻-2', zone: 'プランゾーン', card: target },
    ]

    expect(steps.next()).toEqual({ done: false, value: { kind: '自分の山札を読む' } })
    const asked = steps.next(read)

    expect(asked).toEqual({
      done: false,
      value: { kind: '選ぶ', candidates: [read[1]], mayDecline: true, shown: read },
    })
  })
})

// 総合ルール 第2部 第21章 2-2、第2部 第23章 3（ADR-0042、ADR-0041）
describe('山札を読んで選ぶ選択', () => {
  it('選ぶ人に、山札の全体が見せる一覧として届き、条件に合うカードだけが候補になる', () => {
    const progress = applyWithAnswers(mainPhaseWith(searchAndShuffle, sampleLibrary()), PLAY, [])

    expectChoice(progress)
    const { choice } = progress
    expect(choice.player).toBe('先攻')
    expect(choice.purpose).toBe('山札から選ぶ')
    expect(choice.mayDecline).toBe(true)
    expect(choice.shown).toHaveLength(5)
    expect(choice.candidates).toHaveLength(2)
    // 選べるのは条件に合うカードだけで、どちらも見せる一覧の中にあり、選ぶ人から見えている候補として届く。
    expect(choice.candidates.every((candidate) => candidate.kind === '見えている')).toBe(true)
    expect(choice.shown?.filter(({ candidate }) => candidate !== undefined).map(({ instance }) => instance.card.name)).toEqual([
      'テスト・目当て',
      'テスト・目当て',
    ])
  })

  // 総合ルール 第2部 第21章 3-1: プランゾーンのカードは山札の 1 番上にあるカードである。
  it('プランゾーンのカードも、一覧に含まれ、条件に合えば選べる', () => {
    const plan = [libraryCard('先攻-1', 'テスト・目当て', '先攻')]
    const progress = applyWithAnswers(mainPhaseWith(searchAndShuffle, sampleLibrary(), plan), PLAY, [])

    expectChoice(progress)
    expect(progress.choice.shown).toHaveLength(6)
    expect(progress.choice.candidates).toHaveLength(3)
  })

  // 山札の順序は隠れた情報で、一覧に持ち順が残ると読み取れてしまう（ADR-0042）。
  it('一覧は、選べるカードを先に、それぞれの中は名前順、同じ名前の中は識別子順に並ぶ', () => {
    const progress = applyWithAnswers(mainPhaseWith(searchAndShuffle, sampleLibrary()), PLAY, [])

    expectChoice(progress)
    expect(cardsIn(progress.board, '先攻', '山札').map((card) => card.id)).toEqual([
      '先攻-5',
      '先攻-2',
      '先攻-9',
      '先攻-0',
      '先攻-7',
    ])
    expect(progress.choice.shown?.map(({ instance }) => instance.id)).toEqual(['先攻-0', '先攻-2', '先攻-9', '先攻-7', '先攻-5'])
  })

  it('一覧の並びは、渡された並びに依らない', () => {
    const progress = applyWithAnswers(mainPhaseWith(searchAndShuffle, sampleLibrary()), PLAY, [])
    expectChoice(progress)
    const { shown } = progress.choice
    if (shown === undefined) throw new Error('見せる一覧があるはずだった')

    expect(orderShown([...shown].reverse())).toEqual(shown)
    expect(orderShown([shown[2], shown[4], shown[0], shown[3], shown[1]].flatMap((one) => (one === undefined ? [] : [one])))).toEqual(
      shown,
    )
  })

  it('選んだカードを手札に加え、残りをシャッフルして先へ進める', () => {
    const start = mainPhaseWith(searchAndShuffle, sampleLibrary())

    const progress = applyWithAnswers(start, PLAY, [0])

    expectAdvanced(progress)
    // 一覧の先頭の候補は、候補の番号 0 のカード。山札の持ち順では 2 番目にあった目当てを選んでいる。
    expect(cardsIn(progress.state, '先攻', '手札').map((card) => card.card.name)).toContain('テスト・目当て')
    expect(cardsIn(progress.state, '先攻', '山札')).toHaveLength(4)
    expect(instructionEvents(progress.state, '山札をシャッフルする')).toHaveLength(1)
  })

  // 総合ルール 第2部 第23章 3: 非公開情報の特定の一部を公開するよう求める効果では、見つけられなかったことを選べる。
  it('条件に合うカードがあっても、選ばないことを選んで先へ進める', () => {
    const progress = applyWithAnswers(mainPhaseWith(searchAndShuffle, sampleLibrary()), PLAY, ['選ばない'])

    expectAdvanced(progress)
    expect(cardsIn(progress.state, '先攻', '山札')).toHaveLength(5)
  })

  it('条件に合うカードが無くても聞く。選ばないことを選んで先へ進める', () => {
    const noTarget = [libraryCard('先攻-1', 'テスト・い', '先攻'), libraryCard('先攻-2', 'テスト・ろ', '先攻')]
    const start = mainPhaseWith(searchAndShuffle, noTarget)

    const asked = applyWithAnswers(start, PLAY, [])

    expectChoice(asked)
    expect(asked.choice.candidates).toEqual([])
    expect(asked.choice.mayDecline).toBe(true)
    expect(asked.choice.shown).toHaveLength(2)
    expectAdvanced(applyWithAnswers(start, PLAY, ['選ばない']))
  })

  it('読める山札が 1 枚も無ければ、聞かずに先へ進む', () => {
    const progress = applyWithAnswers(mainPhaseWith(searchAndShuffle, []), PLAY, [])

    expectAdvanced(progress)
    expect(instructionEvents(progress.state, '自分の山札を読む')).toEqual([
      expect.objectContaining({ instruction: { kind: '自分の山札を読む', count: 0 } }),
    ])
  })
})

// 総合ルール 第2部 第21章 3-5（ADR-0042）
describe('山札をシャッフルする', () => {
  it('山札のカードは減らず、並びが変わる', () => {
    const start = mainPhaseWith(shuffleOnly, sampleLibrary())

    const after = applyLegalAction(start, PLAY, chooseFirst)

    expect([...libraryIds(after)].sort()).toEqual([...libraryIds(start)].sort())
    expect(libraryIds(after)).not.toEqual(libraryIds(start))
  })

  it('プランゾーンのカードは裏向きにして山札に混ぜられ、混ぜた後のプランゾーンは無い', () => {
    const plan = [libraryCard('先攻-1', 'テスト・プラン', '先攻')]
    const start = mainPhaseWith(shuffleOnly, sampleLibrary(), plan)

    const after = applyLegalAction(start, PLAY, chooseFirst)

    expect(cardsIn(after, '先攻', 'プランゾーン')).toEqual([])
    expect(libraryIds(after)).toHaveLength(6)
    expect(libraryIds(after)).toContain('先攻-1')
  })

  it('相手の山札は混ぜない', () => {
    const start = mainPhaseWith(shuffleOnly, sampleLibrary())

    const after = applyLegalAction(start, PLAY, chooseFirst)

    expect(libraryIds(after, '後攻')).toEqual(libraryIds(start, '後攻'))
  })

  it('読んだのにシャッフルしない効果は止めない', () => {
    const progress = applyWithAnswers(mainPhaseWith(readOnly, sampleLibrary()), PLAY, [])

    expectAdvanced(progress)
    expect(instructionEvents(progress.state, '山札をシャッフルする')).toHaveLength(0)
  })
})

// ADR-0005、ADR-0008、ADR-0018、ADR-0042: 途中のシャッフルは盤面が持つ乱数列の続きから取る。
describe('途中のシャッフルの再現', () => {
  it('同じ盤面からは、何度打ち直しても同じ並びになる', () => {
    const start = mainPhaseWith(shuffleOnly, sampleLibrary())

    const once = applyLegalAction(start, PLAY, chooseFirst)
    const again = applyLegalAction(start, PLAY, chooseFirst)

    expect(libraryIds(again)).toEqual(libraryIds(once))
    expect(again.random).toEqual(once.random)
  })

  it('選択のたびに行動を最初から打ち直しても、同じ並びになる', () => {
    const start = mainPhaseWith(searchAndShuffle, sampleLibrary())
    const first = applyWithAnswers(start, PLAY, [0])
    const second = applyWithAnswers(start, PLAY, [0])
    expectAdvanced(first)
    expectAdvanced(second)

    expect(libraryIds(second.state)).toEqual(libraryIds(first.state))
  })

  it('乱数列の続きは進み、次のシャッフルは別の並びになりうる', () => {
    const start = mainPhaseWith(shuffleOnly, sampleLibrary())

    const after = applyLegalAction(start, PLAY, chooseFirst)

    expect(after.random).not.toEqual(start.random)
  })

  it('乱数列の続きが違う盤面からは、違う並びになる', () => {
    const start = mainPhaseWith(shuffleOnly, sampleLibrary())
    const other = { ...start, random: randomFromSeed(12345) }

    const orders = [start, other].map((state) => libraryIds(applyLegalAction(state, PLAY, chooseFirst)))

    expect(orders[0]).not.toEqual(orders[1])
  })

  it('準備で作った盤面の乱数列は、CPU や自己対戦が使う列とは別の続きから始まる', () => {
    const deck: Deck = Array.from({ length: 15 }, (_, index) =>
      Array.from({ length: 4 }, () => defineUnit({ name: `テスト・準備${index}`, level: 0, bp: 100, sp: 100 })),
    ).flat()

    const prepared = prepareDuel({ decks: [deck, deck], seed: 42 })
    const again = prepareDuel({ decks: [deck, deck], seed: 42 })
    if (prepared.kind !== '準備完了' || again.kind !== '準備完了') throw new Error('準備できるはずだった')

    expect(prepared.state.random).not.toEqual(prepared.random)
    expect(again.state.random).toEqual(prepared.state.random)
    expect(again.random).toEqual(prepared.random)
  })
})

// ADR-0004、ADR-0042: 乱数列の続きは山札の並びと同じ種類の隠れた情報で、どちらの視点にも載らない。
describe('山札の中身と乱数列の続きが漏れない', () => {
  it('乱数列の続きだけが違う盤面は、どちらの視点から見ても同じに見える', () => {
    const start = mainPhaseWith(shuffleOnly, sampleLibrary())
    const other = { ...start, random: randomFromSeed(999) }

    for (const viewer of PLAYERS) {
      expect(perspectiveOf(other, viewer)).toEqual(perspectiveOf(start, viewer))
    }
  })

  it('送る盤面の文字列に、乱数列の状態の値が現れない', () => {
    const state = { ...mainPhaseWith(shuffleOnly, sampleLibrary()), random: randomFromSeed(918273645) }

    for (const viewer of PLAYERS) {
      expect(JSON.stringify(toWire(perspectiveOf(state, viewer)))).not.toContain('918273645')
    }
  })

  it('選択の要求は、読んだ本人にだけ向く', () => {
    const progress = applyWithAnswers(mainPhaseWith(searchAndShuffle, sampleLibrary()), PLAY, [])

    expectChoice(progress)
    expect(progress.choice.player).toBe('先攻')
  })

  it('相手の視点には、山札のカードの名前も識別子も載らない', () => {
    const progress = applyWithAnswers(mainPhaseWith(searchAndShuffle, sampleLibrary()), PLAY, [0])
    expectAdvanced(progress)

    const seen = JSON.stringify(toWire(perspectiveOf(progress.state, '後攻')))

    for (const name of ['テスト・ろ', 'テスト・い', 'テスト・は']) expect(seen).not.toContain(name)
    for (const id of ['先攻-5', '先攻-9', '先攻-7']) expect(seen).not.toContain(id)
  })

  it('相手のログには、山札を見たことと混ぜたことが名前なしで 1 件ずつ出る', () => {
    const progress = applyWithAnswers(mainPhaseWith(searchAndShuffle, sampleLibrary()), PLAY, [0])
    expectAdvanced(progress)

    const log = perspectiveOf(progress.state, '後攻').log.map(({ event }) => event)
    const looked = log.filter((event) => event.kind === '命令を実行した' && event.instruction.kind === '自分の山札を読む')
    const shuffled = log.filter((event) => event.kind === '命令を実行した' && event.instruction.kind === '山札をシャッフルする')

    expect(looked).toEqual([expect.objectContaining({ instruction: { kind: '自分の山札を読む', count: 5 } })])
    expect(shuffled).toEqual([expect.objectContaining({ instruction: { kind: '山札をシャッフルする', withPlan: false } })])
  })

  it('プランゾーンのカードがある時のシャッフルは、プランも混ぜたことだけがログに出る', () => {
    const plan = [libraryCard('先攻-1', 'テスト・プラン', '先攻')]
    const after = applyLegalAction(mainPhaseWith(shuffleOnly, sampleLibrary(), plan), PLAY, chooseFirst)

    const [shuffled] = instructionEvents(after, '山札をシャッフルする')

    expect(shuffled).toEqual(expect.objectContaining({ instruction: { kind: '山札をシャッフルする', withPlan: true } }))
  })

  it('山札を読んだ枚数は、山札とプランゾーンの合計である', () => {
    const plan = [libraryCard('先攻-1', 'テスト・プラン', '先攻')]
    const progress = applyWithAnswers(mainPhaseWith(searchAndShuffle, sampleLibrary(), plan), PLAY, ['選ばない'])
    expectAdvanced(progress)

    const [looked] = instructionEvents(progress.state, '自分の山札を読む')

    expect(looked).toEqual(expect.objectContaining({ instruction: { kind: '自分の山札を読む', count: 6 } }))
  })
})

// ADR-0041、ADR-0042: 本来見えないものを見せた後は、同じ行動の中で戻れない。
describe('山札を見た後に戻れない', () => {
  it('山札から選ぶ選択は、戻せず取り消せない', () => {
    const progress = applyWithAnswers(mainPhaseWith(searchAndShuffle, sampleLibrary()), PLAY, [])

    expectChoice(progress)
    expect(progress.choice.mayGoBack).toBe(false)
  })

  it('同じ行動の中で山札を読んだ後に出る選択も、戻せない', () => {
    const progress = applyWithAnswers(mainPhaseWith(searchThenChoose, sampleLibrary()), PLAY, ['選ばない'])

    expectChoice(progress)
    expect(progress.choice.purpose).toBe('効果の対象')
    expect(progress.choice.mayGoBack).toBe(false)
  })

  it('読める山札が 1 枚も無ければ何も見えていないので、その後の選択は戻せる', () => {
    const progress = applyWithAnswers(mainPhaseWith(searchThenChoose, []), PLAY, [])

    expectChoice(progress)
    expect(progress.choice.mayGoBack).toBe(true)
  })
})

// ADR-0005、ADR-0042: 自動で手を選ぶ側は、特別扱いなしで通り抜ける。
describe('自動で手を選ぶ側が、山札を読む・シャッフルする効果を通り抜ける', () => {
  it('最初の候補を選ぶ chooser で、効果は最後まで進む', () => {
    const start = mainPhaseWith(searchAndShuffle, sampleLibrary())

    const after = applyLegalAction(start, PLAY, chooseFirst)

    expect(instructionEvents(after, '山札をシャッフルする')).toHaveLength(1)
    expect(cardsIn(after, '先攻', '手札').map((card) => card.card.name)).toContain('テスト・目当て')
  })

  it('ランダムに選ぶ chooser でも、効果は最後まで進む', () => {
    const start = mainPhaseWith(searchAndShuffle, sampleLibrary())

    for (let seed = 0; seed < 10; seed += 1) {
      const after = applyLegalAction(start, PLAY, randomChooser(randomFromSeed(seed)).chooser)
      expect(instructionEvents(after, '山札をシャッフルする')).toHaveLength(1)
    }
  })

  it('ランダムに手を選ぶ自己対戦が、山札を読む・シャッフルする効果のあるデッキで最後まで進む', () => {
    // 同じ名前は 4 枚まで（総合ルール 第3部 第1章 3-1）。60 枚を 15 種類 × 4 枚で組む。
    const searches = Array.from({ length: 6 }, (_, index) =>
      defineStrategy({
        name: `テスト・自己対戦で探す${index}`,
        level: 0,
        effect: function* () {
          const found = yield* chooseAtMostOneFromLibrary((card) => card.card.name.startsWith('テスト・自己対戦ユニット'))
          if (found !== undefined) yield* placeInZone(found, '手札', 'リリース')
          yield* shuffleLibrary()
        },
      }),
    )
    const plain = Array.from({ length: 9 }, (_, index) =>
      defineUnit({ name: `テスト・自己対戦ユニット${index}`, level: 0, bp: 100, sp: 100, moveIcon: ['上', '下', '左', '右'] }),
    )
    const deck: Deck = [...searches, ...plain].flatMap((card) => Array.from({ length: 4 }, () => card))

    const result = runSelfPlayBatch({
      decks: [deck, deck],
      seeds: Array.from({ length: 10 }, (_, seed) => seed),
      maxActions: 3000,
    })

    expect(result.kind).toBe('全て決着')
    const shuffled = Array.from({ length: 10 }, (_, seed) =>
      playSelfPlay({ setup: { decks: [deck, deck], seed }, maxActions: 3000 }),
    ).filter((one) => one.kind === '決着' && instructionEvents(one.state, '山札をシャッフルする').length > 0)
    expect(shuffled.length).toBeGreaterThan(0)
  })

  it('同じシードの自己対戦は、途中のシャッフルを挟んでも同じ結果になる', () => {
    const search = defineStrategy({
      name: 'テスト・再現で探す',
      level: 0,
      effect: function* () {
        yield* chooseAtMostOneFromLibrary(() => true)
        yield* shuffleLibrary()
      },
    })
    const plain = Array.from({ length: 14 }, (_, index) =>
      defineUnit({ name: `テスト・再現ユニット${index}`, level: 0, bp: 100, sp: 100, moveIcon: ['上', '下', '左', '右'] }),
    )
    const deck: Deck = [search, ...plain].flatMap((card) => Array.from({ length: 4 }, () => card))

    const run = () => playSelfPlay({ setup: { decks: [deck, deck], seed: 3 }, maxActions: 3000 })
    const [one, two] = [run(), run()]

    expect(one.kind).toBe(two.kind)
    if (one.kind === '決着' && two.kind === '決着') {
      expect(one.actionsTaken).toBe(two.actionsTaken)
      expect(one.state.random).toEqual(two.state.random)
    }
  })
})
