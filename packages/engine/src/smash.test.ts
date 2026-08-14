import { describe, expect, it } from 'vitest'
// 山札やエネルギーゾーンを組み立てるためだけに `putInZone` を使う。engine の中からゾーンを
// 差し替えるための関数であり、公開する API ではない（`play.test.ts` と同じ）。
import { putInZone } from './duel.js'
import {
  SMASH_JUDGMENT_STEPS,
  cardsIn,
  cardsOn,
  choose,
  defineUnit,
  destroy,
  emptyDuelState,
  hope,
  instantiate,
  passPriority,
  putOnSquare,
  smash,
  smashesOf,
} from './index.js'
import type {
  ActionOutcome,
  Card,
  CardInstance,
  Chooser,
  DuelState,
  SmashJudgmentStep,
  Square,
  UnitCard,
} from './index.js'

/** 選択を求められたら常に最初の候補を選ぶ。どれを選ぶかを問わないテストで使う。 */
const chooseFirst: Chooser = (candidates) => candidates[0]

// 検証したいルールだけを持つ架空のテストカード（ADR-0002）。
const vanilla = defineUnit({ name: 'テスト・バニラ', level: 1, colors: ['赤'], bp: 1000, sp: 1000 })

/** ＳＰ 0 のユニット。敵エリアの＋500 だけでダメージを与えるのに使う。 */
const sp0 = defineUnit({ name: 'テスト・ＳＰ0', level: 1, colors: ['赤'], bp: 1000, sp: 0 })

/** ＳＰ 1000 のユニット。中央エリアからのスマッシュでちょうど 1 回の判定を起こす。 */
const sp1000 = vanilla

/** ＳＰ 1500 のユニット。敵エリアからのスマッシュで 2000 のダメージを与える。 */
const sp1500 = defineUnit({ name: 'テスト・ＳＰ1500', level: 1, colors: ['赤'], bp: 1000, sp: 1500 })

/** 「希望」で敵を 1 枚破壊するレベル 1 の赤いカード（総合ルール 第5部 第3章）。 */
const hopeful = defineUnit({
  name: 'テスト・希望',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [
    hope(function* (duel) {
      const enemy = yield* choose(duel.enemies())
      if (enemy !== undefined) yield* destroy(enemy)
    }),
  ],
})

/** 先攻から見た中央エリアと敵エリアのスクエア。 */
const centerSquare: Square = { row: 1, column: 1 }
const anotherCenterSquare: Square = { row: 1, column: 0 }
const enemySquare: Square = { row: 2, column: 1 }

function pass(state: DuelState): DuelState {
  return passPriority(state, chooseFirst)
}

/** 行えたはずの行動の結果の盤面。 */
function stateOf(outcome: ActionOutcome): DuelState {
  if (outcome.kind !== '行った') throw new Error(`行えなかった: ${outcome.violation}`)
  return outcome.state
}

const idsOf = (cards: readonly CardInstance[]) => cards.map((card) => card.id)

/** どちらのプレイヤーも山札を切らさない枚数。デュエルの終了に巻き込まれないようにする。 */
const LIBRARY_SIZE = 10

/**
 * 山札を積んだ、カードの置かれていない盤面。後攻の山札の上から順に `library` が積まれる。
 *
 * 山札にあるカードが 0 枚以下のプレイヤーは、次に優先権が発生した時に敗北する
 * （総合ルール 第3部 第3章 2）。ダメージを受けるのは後攻なので、希望ステップでめくられる
 * のも後攻の山札である。
 */
function stockedDuelState(library: readonly Card[]): DuelState {
  const cards = [...library, ...Array.from({ length: LIBRARY_SIZE }, () => vanilla)]
  const second = putInZone(
    emptyDuelState(),
    '後攻',
    '山札',
    cards.map((card, index) => instantiate({ id: `後攻の山札${index}`, card, owner: '後攻' })),
  )
  return putInZone(
    second,
    '先攻',
    '山札',
    Array.from({ length: LIBRARY_SIZE }, (_, index) =>
      instantiate({ id: `先攻の山札${index}`, card: vanilla, owner: '先攻' }),
    ),
  )
}

type Placement = readonly [Square, string, UnitCard]

/**
 * アクティブプレイヤー（先攻）が行動できる、第 1 ターンのスマッシュフェイズの盤面。
 *
 * ユニットは効果ではなく盤面に直接置く。中央エリアのスクエアを指定してプレイされたユニットは
 * ルールエフェクトによって捨札に置かれてしまう（総合ルール 第4部 第14章 4-9）ためである。
 */
function smashPhase(placements: readonly Placement[], library: readonly Card[] = []): DuelState {
  const board = placements.reduce(
    (state, [square, id, card]) => putOnSquare(state, square, instantiate({ id, card, owner: '先攻' })),
    stockedDuelState(library),
  )

  let current = board
  while (current.turn.phase !== 'スマッシュフェイズ') current = pass(current)
  return pass(current)
}

/** 先攻が中央エリアのユニットでスマッシュしたところの盤面。 */
function smashedFromCenter(card: UnitCard = sp1000, library: readonly Card[] = []): DuelState {
  return stateOf(smash(smashPhase([[centerSquare, 'スマッシュ役', card]], library), 'スマッシュ役'))
}

/** 先攻が敵エリアのユニットでスマッシュしたところの盤面（ＳＰ＋500 のダメージ）。 */
function smashedFromEnemyArea(card: UnitCard, library: readonly Card[] = []): DuelState {
  return stateOf(smash(smashPhase([[enemySquare, 'スマッシュ役', card]], library), 'スマッシュ役'))
}

/**
 * スマッシュ判定のどこまで進んでいるか。
 *
 * 希望ステップと確定ステップは繰り返される（総合ルール 第3部 第17章 3）ので、ステップ名
 * だけでは進んだかどうかが分からない。待機中のものを含めた数も見る（同 2-2）。
 */
function progressOf(state: DuelState): string {
  const judgment = state.smashJudgments.at(-1)
  if (judgment === undefined) return 'スマッシュ判定の終了後'
  return `${state.smashJudgments.length}／第${judgment.round}／${judgment.step}`
}

/** 進行中のステップが終わるまで、両方のプレイヤーが優先権を放棄し続けた盤面。 */
function endStep(state: DuelState): DuelState {
  let current = state
  while (current.result === undefined && progressOf(current) === progressOf(state)) current = pass(current)
  return current
}

/** 処理中のスマッシュ判定のステップ。スマッシュ判定が終わっていれば `undefined`。 */
function stepOf(state: DuelState): SmashJudgmentStep | undefined {
  return state.smashJudgments.at(-1)?.step
}

/** スマッシュ判定が終わるまでに通ったステップを、通った順に並べたもの。 */
function stepsOf(state: DuelState): readonly string[] {
  const steps: string[] = []
  for (let current = state; current.smashJudgments.length > 0; current = endStep(current)) {
    const judgment = current.smashJudgments.at(-1)
    if (judgment === undefined) break
    const name = judgment.step === '回復ステップ' ? judgment.step : `第${judgment.round}${judgment.step}`
    if (name !== steps.at(-1)) steps.push(name)
    if (current.result !== undefined) break
  }
  return steps
}

// 総合ルール 第3部 第17章 1、第4部 第14章 4-12（ADR-0006）
describe('スマッシュ判定の発生', () => {
  it('プレイヤーが受けたダメージが合計 1000 以上になると発生する', () => {
    const smashed = smashedFromCenter(sp1000)

    expect(smashed.smashJudgments).toHaveLength(1)
    expect(smashed.smashJudgments[0]?.player).toBe('後攻')
  })

  it('1000 未満のダメージでは発生しない', () => {
    // 敵エリアのＳＰ0 のユニットが与えるのは 500（総合ルール 第3部 第9章 1 の (2) の行動）。
    const smashed = smashedFromEnemyArea(sp0)

    expect(smashed.smashJudgments).toEqual([])
    expect(smashed.damage['後攻']).toBe(500)
  })

  it('回復ステップから始まる', () => {
    expect(stepOf(smashedFromCenter())).toBe('回復ステップ')
  })

  // 総合ルール 第3部 第18章 1
  it('発生すると非アクティブプレイヤーに優先権が発生する', () => {
    expect(smashedFromCenter().turn.priority).toBe('後攻')
  })
})

// 総合ルール 第3部 第17章 3（ADR-0006）
describe('スマッシュ判定のステップ', () => {
  it('3 つのステップを総合ルールの順に行う', () => {
    expect(SMASH_JUDGMENT_STEPS).toEqual(['回復ステップ', '希望ステップ', '確定ステップ'])
    expect(stepsOf(smashedFromCenter())).toEqual(['回復ステップ', '第1希望ステップ', '第1確定ステップ'])
  })

  // 総合ルール 第3部 第17章 3 の【例】: 2000 のダメージを受けた時のスマッシュ判定は、
  // 回復ステップ → 第１希望ステップ → 第１確定ステップ → 第２希望ステップ →
  // 第２確定ステップ という 5 つのステップで構成される。
  it('受けたダメージ 1000 ごとに希望ステップと確定ステップを繰り返す', () => {
    // 敵エリアのＳＰ1500 のユニットが与えるのは 2000（総合ルール 第3部 第9章 1 の (2) の行動）。
    expect(stepsOf(smashedFromEnemyArea(sp1500))).toEqual([
      '回復ステップ',
      '第1希望ステップ',
      '第1確定ステップ',
      '第2希望ステップ',
      '第2確定ステップ',
    ])
  })

  // 総合ルール 第3部 第4章 4: 連続して優先権が放棄されると、終了するのはフェイズではなく
  // 進行中のステップである。
  it('連続放棄で終わるのはステップであって、フェイズではない', () => {
    const smashed = smashedFromCenter()
    const next = endStep(smashed)

    expect(next.turn.phase).toBe('スマッシュフェイズ')
    expect(stepOf(next)).toBe('希望ステップ')
  })

  // 総合ルール 第3部 第18章 1・第19章 1・第20章 1
  it('ステップが進むたびに、非アクティブプレイヤーが優先権を獲得する', () => {
    const smashed = smashedFromCenter()

    expect(smashed.turn.priority).toBe('後攻')
    expect(endStep(smashed).turn.priority).toBe('後攻')
  })

  it('スマッシュ判定が終わると、フェイズの進行に戻る', () => {
    const smashed = smashedFromCenter()
    let current = smashed
    while (current.smashJudgments.length > 0) current = endStep(current)

    expect(current.turn.phase).toBe('スマッシュフェイズ')
    // フェイズの連続放棄で次のフェイズに進む。
    expect(pass(pass(current)).turn.phase).toBe('リカバリーフェイズ')
  })
})

// 総合ルール 第3部 第18章 1（ADR-0006）
describe('回復ステップ', () => {
  it('希望ステップの回数 1 回につき 1000 回復する', () => {
    expect(smashedFromCenter(sp1000).damage['後攻']).toBe(0)
    expect(smashedFromEnemyArea(sp1500).damage['後攻']).toBe(0)
  })

  it('1000 の倍数に満たない分は回復せずに残る', () => {
    // 敵エリアのＳＰ0 で 500、続けて敵エリアのＳＰ1500 で 2000 の、合計 2500。
    const first = smashPhase([
      [enemySquare, '1 枚目', sp0],
      [{ row: 2, column: 0 }, '2 枚目', sp1500],
    ])
    const once = pass(stateOf(smash(first, '1 枚目')))
    const twice = stateOf(smash(once, '2 枚目'))

    expect(twice.smashJudgments[0]?.repeats).toBe(2)
    expect(twice.damage['後攻']).toBe(500)
  })
})

// 総合ルール 第3部 第19章 1（ADR-0006）
describe('希望ステップ', () => {
  /** 希望ステップまで進めた盤面。 */
  function hopeStep(library: readonly Card[] = []): DuelState {
    return endStep(smashedFromCenter(sp1000, library))
  }

  it('ダメージを受けたプレイヤーの山札の 1 番上が、スマッシュゾーンに表向きで置かれる', () => {
    const state = hopeStep()

    expect(idsOf(cardsIn(state, '後攻', 'スマッシュゾーン'))).toEqual(['後攻の山札0'])
    expect(state.smashJudgments.at(-1)?.faceUp).toBe('後攻の山札0')
  })

  it('リリース状態で置かれる', () => {
    expect(cardsIn(hopeStep(), '後攻', 'スマッシュゾーン')[0]?.orientation).toBe('リリース')
  })

  // 総合ルール 第3部 第19章 1: スマッシュゾーンに表向きで置かれているカードはスマッシュ
  // ではない（同 第2部 第21章 7-2）。
  it('表向きで置かれているカードはスマッシュではない', () => {
    expect(smashesOf(hopeStep(), '後攻')).toEqual([])
  })

  // 総合ルール 第2部 第21章 3-1・7-3 の【例】: プランゾーンにあるカードも山札の 1 番上の
  // カードなので、それが置かれる。
  it('プランゾーンにカードがあれば、そのカードが置かれる', () => {
    const smashed = smashedFromCenter()
    const planned = putInZone(smashed, '後攻', 'プランゾーン', [
      instantiate({ id: 'プラン', card: vanilla, owner: '後攻' }),
    ])

    expect(idsOf(cardsIn(endStep(planned), '後攻', 'スマッシュゾーン'))).toEqual(['プラン'])
  })

  // 総合ルール 第5部 第3章 2
  it('「希望」を持つカードは、エネルギーゾーンの条件を満たしていれば効果を解決する', () => {
    const state = withEnergy(smashedFromCenter(sp1000, [hopeful]), [vanilla])

    // 後攻の「希望」が敵、すなわち先攻のユニットを破壊する。
    expect(cardsOn(endStep(state), centerSquare)).toEqual([])
  })

  it('エネルギーゾーンの条件を満たしていなければ解決しない', () => {
    const state = smashedFromCenter(sp1000, [hopeful])

    expect(idsOf(cardsOn(endStep(state), centerSquare))).toEqual(['スマッシュ役'])
  })

  // 総合ルール 第3部 第3章 2: 山札が 0 枚以下のプレイヤーは、次に優先権が発生した時に
  // 敗北する。希望ステップで山札の最後の 1 枚を置くのがその経路になる。
  it('山札の最後の 1 枚を置いたプレイヤーは、次に優先権が発生した時に敗北する', () => {
    // 2000 のダメージなので希望ステップは 2 回あるが、1 回目で山札が尽きる。
    const smashed = putInZone(smashedFromEnemyArea(sp1500), '後攻', '山札', [
      instantiate({ id: '最後の 1 枚', card: vanilla, owner: '後攻' }),
    ])

    const ended = endStep(smashed)
    expect(idsOf(cardsIn(ended, '後攻', 'スマッシュゾーン'))).toEqual(['最後の 1 枚'])
    expect(ended.result).toEqual({ kind: '勝利', winner: '先攻' })
  })

  it('「希望」を持たないカードでは何も起こらない', () => {
    const state = withEnergy(smashedFromCenter(sp1000, [vanilla]), [vanilla])

    expect(idsOf(cardsOn(endStep(state), centerSquare))).toEqual(['スマッシュ役'])
  })

  /** 後攻のエネルギーゾーンにカードを置く。「希望」の条件を満たすために使う。 */
  function withEnergy(state: DuelState, cards: readonly Card[]): DuelState {
    return putInZone(
      state,
      '後攻',
      'エネルギーゾーン',
      cards.map((card, index) => instantiate({ id: `後攻のエネ${index}`, card, owner: '後攻' })),
    )
  }
})

// 総合ルール 第3部 第20章 1（ADR-0006）
describe('確定ステップ', () => {
  it('表向きで置かれているカードが裏返り、スマッシュになる', () => {
    const confirmed = endStep(endStep(smashedFromCenter()))

    expect(stepOf(confirmed)).toBe('確定ステップ')
    expect(confirmed.smashJudgments.at(-1)?.faceUp).toBeUndefined()
    expect(idsOf(smashesOf(confirmed, '後攻'))).toEqual(['後攻の山札0'])
  })

  // 総合ルール 第3部 第20章 1 の【例】: 相手のスマッシュは 6。中央エリアにあるＳＰ1000 の
  // ユニットでスマッシュすると、相手のスマッシュが 7 になり、確定ステップで優先権が発生した
  // 時点でルールエフェクトがチェックされ、相手が敗北する。
  it('スマッシュが 7 枚になったプレイヤーは、確定ステップで敗北する', () => {
    const smashed = withSmashes(smashedFromCenter(sp1000), 6)

    // 希望ステップの間は表向きなのでスマッシュではなく、まだ 6 枚のままである。
    const hopeStep = endStep(smashed)
    expect(smashesOf(hopeStep, '後攻')).toHaveLength(6)
    expect(hopeStep.result).toBeUndefined()

    expect(endStep(hopeStep).result).toEqual({ kind: '勝利', winner: '先攻' })
  })

  // 総合ルール 第3部 第20章 1 の【例】: 相手のスマッシュは 6。敵エリアのＳＰ0 のユニットで
  // 500、続いて敵エリアのＳＰ1000 のユニットで合計 2000 のダメージを与えると、希望ステップと
  // 確定ステップを 2 回繰り返すスマッシュ判定になるが、第１確定ステップで相手が敗北する。
  it('繰り返しが残っていても、敗北した時点でデュエルは終了する', () => {
    const board = withSmashes(
      smashPhase([
        [enemySquare, '1 枚目', sp0],
        [{ row: 2, column: 0 }, '2 枚目', sp1000],
      ]),
      6,
    )
    const once = pass(stateOf(smash(board, '1 枚目')))
    const judgment = stateOf(smash(once, '2 枚目'))

    expect(judgment.smashJudgments[0]?.repeats).toBe(2)
    // 回復ステップ → 第１希望ステップ → 第１確定ステップ で終わる。
    expect(stepsOf(judgment)).toEqual(['回復ステップ', '第1希望ステップ', '第1確定ステップ'])
    expect(endStep(endStep(judgment)).result).toEqual({ kind: '勝利', winner: '先攻' })
  })

  /** 後攻のスマッシュゾーンにカードを `count` 枚置いた盤面。 */
  function withSmashes(state: DuelState, count: number): DuelState {
    return putInZone(
      state,
      '後攻',
      'スマッシュゾーン',
      Array.from({ length: count }, (_, index) =>
        instantiate({ id: `後攻のスマッシュ${index}`, card: vanilla, owner: '後攻' }),
      ),
    )
  }
})

// 総合ルール 第3部 第17章 2-2（ADR-0006）
describe('スマッシュ判定中のスマッシュ判定', () => {
  /**
   * スマッシュ判定の希望ステップで、アクティブプレイヤーがもう 1 度スマッシュした盤面。
   *
   * スマッシュには「バトル中以外」のような制限が無い（総合ルール 第3部 第9章 1）ので、
   * スマッシュ判定の最中でも、バンクが空で優先権を持っていれば行える。
   */
  function judgmentInJudgment(): DuelState {
    const state = smashPhase([
      [centerSquare, '1 枚目', sp1000],
      [anotherCenterSquare, '2 枚目', sp1000],
    ])
    const first = endStep(stateOf(smash(state, '1 枚目')))

    return stateOf(smash(pass(first), '2 枚目'))
  }

  it('後から発生したスマッシュ判定を先に処理する', () => {
    const state = judgmentInJudgment()

    expect(state.smashJudgments).toHaveLength(2)
    expect(stepOf(state)).toBe('回復ステップ')
  })

  // 総合ルール 第3部 第17章 2-2: 待機中のスマッシュ判定は、後から発生したスマッシュ判定を
  // 処理した後、通常のスマッシュ判定に戻って残りの手順が処理される。
  it('後から発生したものが終わると、待機中だったものが残りの手順を処理する', () => {
    let current = judgmentInJudgment()
    while (current.smashJudgments.length > 1) current = endStep(current)

    expect(current.smashJudgments).toHaveLength(1)
    // 待機させたのは希望ステップの途中なので、そのステップから続く。終わっていない
    // ステップをやり直すわけではないので、山札はもうめくられない。
    expect(stepOf(current)).toBe('希望ステップ')
    expect(cardsIn(current, '後攻', 'スマッシュゾーン')).toHaveLength(2)
    expect(stepOf(endStep(current))).toBe('確定ステップ')
  })

  it('待機中のスマッシュ判定が表向きにしたカードは、その間もスマッシュではない', () => {
    const state = judgmentInJudgment()

    // 待機中の判定が希望ステップで表向きに置いた 1 枚が、裏返らないまま残っている。
    expect(cardsIn(state, '後攻', 'スマッシュゾーン')).toHaveLength(1)
    expect(smashesOf(state, '後攻')).toEqual([])
  })
})
