import { describe, expect, it } from 'vitest'
// ゾーンと盤面を組み立てるためだけに使う。engine の中から盤面を差し替えるための関数であり、
// 公開する API ではない（`protocol.test.ts` と同じ）。
import { putInZone } from './duel.js'
import { describeShown } from './protocol.js'
import {
  PLAYERS,
  applyLegalAction,
  applyWithAnswers,
  cardsIn,
  chooseAtMostOne,
  defineStrategy,
  defineUnit,
  drawCards,
  emptyDuelState,
  instantiate,
  lookAtOpponentHand,
  passPriority,
  perspectiveOf,
  playSelfPlay,
  putOnSquare,
  randomChooser,
  randomFromSeed,
  runSelfPlayBatch,
} from './index.js'
import type {
  ActionProgress,
  CardInstance,
  Chooser,
  Deck,
  DuelEvent,
  DuelState,
  LegalAction,
  Player,
  Square,
} from './index.js'

/** 選択を求められたら常に最初の候補を選ぶ。盤面を進めるためだけに使う。 */
const chooseFirst: Chooser = (candidates) => candidates[0]

const filler = defineUnit({ name: 'テスト・山札', level: 1, bp: 1000, sp: 1000 })

/** 架空のカードを手札に持たせるための入れ物。名前だけが違う。 */
function handCard(id: string, name: string, owner: Player): CardInstance {
  return instantiate({ id, card: defineUnit({ name, level: 1, bp: 1000, sp: 1000 }), owner })
}

/** 相手の手札を見るだけのレベル 0 のストラテジー。 */
const lookOnly = defineStrategy({
  name: 'テスト・見るだけ',
  level: 0,
  effect: function* () {
    yield* lookAtOpponentHand()
  },
})

/** 相手の手札を見て、確認の後に 1 枚引くレベル 0 のストラテジー。見た後も効果が続くことを見る。 */
const lookThenDraw = defineStrategy({
  name: 'テスト・見て引く',
  level: 0,
  effect: function* (duel) {
    yield* lookAtOpponentHand()
    yield* drawCards(duel.controller, 1)
  },
})

/** 相手の手札を見て、その後に味方を 1 体まで選ぶレベル 0 のストラテジー。見た後の選択が戻せないことを見る。 */
const lookThenChoose = defineStrategy({
  name: 'テスト・見て選ぶ',
  level: 0,
  effect: function* (duel) {
    yield* lookAtOpponentHand()
    yield* chooseAtMostOne(duel.allies())
  },
})

/** 味方を 1 体まで選んでから、相手の手札を見るレベル 0 のストラテジー。見る前の選択は戻せることを見る。 */
const chooseThenLook = defineStrategy({
  name: 'テスト・選んで見る',
  level: 0,
  effect: function* (duel) {
    yield* chooseAtMostOne(duel.allies())
    yield* lookAtOpponentHand()
  },
})

const homeSquare: Square = { row: 0, column: 1 }

/**
 * 先攻がストラテジーをプレイできるメインフェイズの盤面。両者の山札は 10 枚、後攻の手札は
 * 引数で決める。`protocol.test.ts` の `phaseReadyToAct` と同じ作り。
 */
function mainPhaseWith(strategy: CardInstance, opponentHand: readonly CardInstance[]): DuelState {
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

  const withStrategy = putInZone(current, '先攻', '手札', [strategy])
  const withOpponentHand = putInZone(withStrategy, '後攻', '手札', opponentHand)
  // 選べる味方が 1 体いる盤面にしておく。
  return putOnSquare(withOpponentHand, homeSquare, instantiate({ id: '味方', card: filler, owner: '先攻' }))
}

const PLAY: LegalAction = { kind: 'カードをプレイする', declaration: { card: 'ストラテジー' } }

const opponentHand = (): readonly CardInstance[] => [
  handCard('相手手札C', 'テスト・ちゅう', '後攻'),
  handCard('相手手札A', 'テスト・あ', '後攻'),
  handCard('相手手札B', 'テスト・いい', '後攻'),
]

function strategyOf(card: ReturnType<typeof defineStrategy>): CardInstance {
  return instantiate({ id: 'ストラテジー', card, owner: '先攻' })
}

function expectChoice(progress: ActionProgress): asserts progress is ActionProgress & { kind: '選んでほしい' } {
  if (progress.kind !== '選んでほしい') throw new Error(`選んでほしいはずだった: ${progress.kind}`)
}

function expectAdvanced(progress: ActionProgress): asserts progress is ActionProgress & { kind: '進んだ' } {
  if (progress.kind !== '進んだ') throw new Error(`進んだはずだった: ${progress.kind}`)
}

/** 相手の手札を見たことを積んだできごと。 */
function lookEventsOf(state: DuelState): readonly DuelEvent[] {
  return state.log
    .map(({ event }) => event)
    .filter((event) => event.kind === '命令を実行した' && event.instruction.kind === '相手の手札を見る')
}

// 総合ルール 第2部 第23章 2-1、第2部 第21章 4-3（ADR-0041）
describe('相手の手札を見る命令', () => {
  it('見るだけの命令を出し、見たカードは効果に返さない', () => {
    const steps = lookAtOpponentHand()

    expect(steps.next()).toEqual({ done: false, value: { kind: '相手の手札を見る' } })
    // 効果は何も受け取らずに次へ進む。見たカードを読んで分岐する口が無い。
    expect(steps.next(undefined)).toEqual({ done: true, value: undefined })
  })
})

// 総合ルール 第2部 第23章 3、第2部 第21章 4-3（ADR-0008、ADR-0041）
describe('相手の手札を見る確認の選択', () => {
  it('見た側に、相手の手札の一覧つきで、候補が「確認した」だけの選択が届く', () => {
    const progress = applyWithAnswers(mainPhaseWith(strategyOf(lookOnly), opponentHand()), PLAY, [])

    expectChoice(progress)
    const { choice } = progress
    expect(choice.player).toBe('先攻')
    expect(choice.purpose).toBe('見たカードの確認')
    expect(choice.candidates).toEqual([{ kind: '確認' }])
    expect(choice.mayDecline).toBe(false)
    // 見せる一覧は、候補とは別に付く。選べるカードは無いので、候補の番号を持つカードも無い。
    expect(choice.shown?.map(({ instance }) => instance.card.name)).toEqual(['テスト・あ', 'テスト・いい', 'テスト・ちゅう'])
    expect(choice.shown?.every((shown) => shown.candidate === undefined)).toBe(true)
  })

  // 総合ルール 第2部 第21章 4-3: 手札は並べ替えられるので、並びは意味を持たない。引いた順などが
  // 一覧から読めないよう、持っている順ではなく中身だけで並べる。
  it('一覧の並びは、手札の持ち順ではなく中身で決まる', () => {
    const progress = applyWithAnswers(mainPhaseWith(strategyOf(lookOnly), opponentHand()), PLAY, [])

    expectChoice(progress)
    expect(cardsIn(progress.board, '後攻', '手札').map((card) => card.id)).toEqual(['相手手札C', '相手手札A', '相手手札B'])
    expect(progress.choice.shown?.map(({ instance }) => instance.id)).toEqual(['相手手札A', '相手手札B', '相手手札C'])
  })

  it('確認を答えると、効果は先へ進む', () => {
    const start = mainPhaseWith(strategyOf(lookThenDraw), opponentHand())
    const handBefore = cardsIn(start, '先攻', '手札').length

    const progress = applyWithAnswers(start, PLAY, [0])

    expectAdvanced(progress)
    // ストラテジーが手札を離れ、確認の後に引いた 1 枚が加わる。
    expect(cardsIn(progress.state, '先攻', '手札')).toHaveLength(handBefore - 1 + 1)
  })

  it('確認の選択は、候補が 1 つでも聞く', () => {
    const asked = applyWithAnswers(mainPhaseWith(strategyOf(lookOnly), opponentHand()), PLAY, [])

    expect(asked.kind).toBe('選んでほしい')
  })

  // 総合ルール 第2部 第23章 1-1: 手札の枚数は公開情報で、0 枚なら新しく見えるものが無い。
  it('相手の手札が 0 枚なら、選択を出さずにログだけを積む', () => {
    const progress = applyWithAnswers(mainPhaseWith(strategyOf(lookOnly), []), PLAY, [])

    expectAdvanced(progress)
    expect(lookEventsOf(progress.state)).toHaveLength(1)
    expect(lookEventsOf(progress.state)[0]).toMatchObject({ instruction: { kind: '相手の手札を見る', count: 0, cards: [] } })
  })
})

// 総合ルール 第2部 第23章 2-1（ADR-0008、ADR-0041）
describe('見た後に戻れない', () => {
  it('確認の選択は、戻せず取り消せない', () => {
    const progress = applyWithAnswers(mainPhaseWith(strategyOf(lookOnly), opponentHand()), PLAY, [])

    expectChoice(progress)
    expect(progress.choice.mayGoBack).toBe(false)
  })

  it('同じ行動の中で見た後に出る選択も、戻せない', () => {
    const progress = applyWithAnswers(mainPhaseWith(strategyOf(lookThenChoose), opponentHand()), PLAY, [0])

    expectChoice(progress)
    expect(progress.choice.purpose).toBe('効果の対象')
    // 盤面は何も変わっていないが、見たことは取り消せない。
    expect(progress.choice.mayGoBack).toBe(false)
  })

  it('見る前の選択は、戻せる', () => {
    const progress = applyWithAnswers(mainPhaseWith(strategyOf(chooseThenLook), opponentHand()), PLAY, [])

    expectChoice(progress)
    expect(progress.choice.purpose).toBe('効果の対象')
    expect(progress.choice.mayGoBack).toBe(true)
  })

  it('0 枚を見ただけなら何も見えていないので、その後の選択は戻せる', () => {
    const progress = applyWithAnswers(mainPhaseWith(strategyOf(lookThenChoose), []), PLAY, [])

    expectChoice(progress)
    expect(progress.choice.mayGoBack).toBe(true)
  })
})

// 総合ルール 第2部 第23章 1-1・2-1（ADR-0004、ADR-0041）
describe('相手の手札の中身が漏れない', () => {
  function finished(): DuelState {
    const progress = applyWithAnswers(mainPhaseWith(strategyOf(lookOnly), opponentHand()), PLAY, [0])
    expectAdvanced(progress)
    return progress.state
  }

  it('見られた側には行動の途中で何も届かず、選択の要求は見た側だけに向く', () => {
    const progress = applyWithAnswers(mainPhaseWith(strategyOf(lookOnly), opponentHand()), PLAY, [])

    expectChoice(progress)
    expect(progress.choice.player).toBe('先攻')
  })

  it('見た後も、見た側の盤面で相手の手札は枚数だけのままである', () => {
    const hand = perspectiveOf(finished(), '先攻').zones['後攻']['手札']

    expect(hand).toHaveLength(3)
    expect(hand.every((card) => card.kind === '見えていない')).toBe(true)
  })

  it('見た側のログでは、見たカードの名前が引ける', () => {
    const board = perspectiveOf(finished(), '先攻')

    expect(board.namedInLog.map((card) => card.card.name).sort()).toEqual(['テスト・あ', 'テスト・いい', 'テスト・ちゅう'])
    const look = board.log.map(({ event }) => event).filter((event) => event.kind === '命令を実行した' && event.instruction.kind === '相手の手札を見る')
    expect(look).toHaveLength(1)
    expect(look[0]).toMatchObject({ instruction: { count: 3, cards: ['相手手札A', '相手手札B', '相手手札C'] } })
  })

  it('見られた側のログにも、同じ内容で出る', () => {
    const state = finished()
    const looker = lookEventsOf(state)[0]
    const sees = (viewer: Player) =>
      perspectiveOf(state, viewer).log.map(({ event }) => event).filter((event) => event.kind === '命令を実行した' && event.instruction.kind === '相手の手札を見る')

    expect(sees('後攻')).toEqual([looker])
    expect(sees('先攻')).toEqual(sees('後攻'))
  })

  it('相手の手札のカードを名指しするのは、見たことのログだけである', () => {
    const board = perspectiveOf(finished(), '先攻')
    const opponentHandIds = new Set(['相手手札A', '相手手札B', '相手手札C'])
    const naming = board.log.filter(({ event }) => JSON.stringify(event).split('"').some((word) => opponentHandIds.has(word)))

    expect(naming).toHaveLength(1)
    expect(naming[0]?.event).toMatchObject({ kind: '命令を実行した', instruction: { kind: '相手の手札を見る' } })
  })

  it('見る前の盤面には、相手の手札が名指しで載っていない', () => {
    const before = mainPhaseWith(strategyOf(lookOnly), opponentHand())

    expect(perspectiveOf(before, '先攻').namedInLog).toEqual([])
  })
})

// ADR-0005、ADR-0041: 確認の選択は候補が 1 つなので、自動で選ぶ側は特別扱いなしで通り抜ける。
describe('自動で手を選ぶ側が、相手の手札を見る効果を通り抜ける', () => {
  it('最初の候補を選ぶ chooser で、効果は最後まで進む', () => {
    const start = mainPhaseWith(strategyOf(lookThenDraw), opponentHand())

    const after = applyLegalAction(start, PLAY, chooseFirst)

    expect(lookEventsOf(after)).toHaveLength(1)
    // ストラテジーが手札を離れ、確認の後に引いた 1 枚が加わる。
    expect(cardsIn(after, '先攻', '手札')).toHaveLength(cardsIn(start, '先攻', '手札').length)
  })

  it('ランダムに選ぶ chooser でも、効果は最後まで進む', () => {
    const start = mainPhaseWith(strategyOf(lookThenDraw), opponentHand())

    const after = applyLegalAction(start, PLAY, randomChooser(randomFromSeed(7)).chooser)

    expect(lookEventsOf(after)).toHaveLength(1)
  })

  it('ランダムに手を選ぶ自己対戦が、見る効果のあるデッキで最後まで進む', () => {
    // 同じ名前は 4 枚まで（総合ルール 第3部 第1章 3-1）。60 枚を 15 種類 × 4 枚で組む。
    const looks = Array.from({ length: 6 }, (_, index) =>
      defineStrategy({
        name: `テスト・自己対戦で見る${index}`,
        level: 0,
        effect: function* () {
          yield* lookAtOpponentHand()
        },
      }),
    )
    const plain = Array.from({ length: 9 }, (_, index) =>
      defineUnit({ name: `テスト・自己対戦ユニット${index}`, level: 0, bp: 100, sp: 100, moveIcon: ['上', '下', '左', '右'] }),
    )
    const deck: Deck = [...looks, ...plain].flatMap((card) => Array.from({ length: 4 }, () => card))

    const result = runSelfPlayBatch({
      decks: [deck, deck],
      seeds: Array.from({ length: 10 }, (_, seed) => seed),
      maxActions: 3000,
    })

    expect(result.kind).toBe('全て決着')
  })

  it('その自己対戦で、見る効果が実際に使われている', () => {
    const look = defineStrategy({
      name: 'テスト・自己対戦で見る',
      level: 0,
      effect: function* () {
        yield* lookAtOpponentHand()
      },
    })
    const plain = Array.from({ length: 14 }, (_, index) =>
      defineUnit({ name: `テスト・自己対戦ユニット${index}`, level: 0, bp: 100, sp: 100, moveIcon: ['上', '下', '左', '右'] }),
    )
    const deck: Deck = [look, ...plain].flatMap((card) => Array.from({ length: 4 }, () => card))

    const looked = Array.from({ length: 10 }, (_, seed) =>
      playSelfPlay({ setup: { decks: [deck, deck], seed }, maxActions: 3000 }),
    ).filter((result) => result.kind === '決着' && lookEventsOf(result.state).length > 0)

    expect(looked.length).toBeGreaterThan(0)
  })
})

// ADR-0008、ADR-0041。見せる一覧のうち、選べるカードだけが候補の番号を持つ。単位 8（山札を読む）が
// 使う形なので、命令を通せるようになる前に、組み立てだけをここで確かめる。
describe('見せる一覧と候補の対応', () => {
  const [first, second, third] = [
    handCard('一覧1', 'テスト・一', '先攻'),
    handCard('一覧2', 'テスト・二', '先攻'),
    handCard('一覧3', 'テスト・三', '先攻'),
  ]

  it('候補になっているカードは候補の番号を持ち、見えるだけのカードは持たない', () => {
    const candidates = [third, first]

    expect([first, second, third].map((card) => describeShown(card, candidates).candidate)).toEqual([1, undefined, 0])
  })

  it('候補が何も指していなければ、どのカードも番号を持たない', () => {
    expect(describeShown(first, [{ kind: '確認' }]).candidate).toBeUndefined()
  })

  it('カードの中身は、通信に載る表記に直して渡す', () => {
    expect(describeShown(first, []).instance).toMatchObject({ id: '一覧1', card: { name: 'テスト・一' } })
  })
})
