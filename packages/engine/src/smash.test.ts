import { describe, expect, it } from 'vitest'
// 山札やエネルギーゾーンを組み立てるためだけに `putInZone` を使う。engine の中からゾーンを
// 差し替えるための関数であり、公開する API ではない（`play.test.ts` と同じ）。
import { putInZone } from './duel.js'
import {
  SMASH_JUDGMENT_STEPS,
  cardsIn,
  cardsOn,
  choose,
  damagePlayer,
  defineUnit,
  destroy,
  emptyDuelState,
  hope,
  instantiate,
  passPriority,
  placeOnSquare,
  putOnSquare,
  smash,
  smashesOf,
  triggeredAbility,
} from './index.js'
import type {
  ActionOutcome,
  Card,
  CardInstance,
  Chooser,
  DuelEvent,
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

/** 後攻のエネルギーゾーンにカードを置く。「希望」の条件（総合ルール 第3部 第19章 1）を満たす。 */
function withEnergy(state: DuelState, cards: readonly Card[]): DuelState {
  return putInZone(
    state,
    '後攻',
    'エネルギーゾーン',
    cards.map((card, index) => instantiate({ id: `後攻のエネ${index}`, card, owner: '後攻' })),
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

/**
 * スマッシュ判定の記録（#133）。
 *
 * **判定が発生したこと自体が盤面に残らない。** 終わってしまえばステップも並びも消えるので、
 * 積んでおかなければ後から読めない（ADR-0011）。回復ステップの回復も、何も起こらなかった
 * ステップも同じである——それぞれのステップは、何も起こらない場合でも存在する
 * （総合ルール 第3部 第17章 3）。
 */
describe('スマッシュ判定の記録', () => {
  /** 判定が全部終わるまで進めた盤面。 */
  function afterJudgments(state: DuelState): DuelState {
    let current = state
    while (current.smashJudgments.length > 0) current = endStep(current)
    return current
  }

  /** 積まれたできごとだけを、起きた順に取り出す。 */
  function events(state: DuelState): readonly DuelEvent[] {
    return state.log.map(({ event }) => event)
  }

  // 総合ルール 第3部 第17章 1・3。**終わりが無いと区切りが閉じない。**
  it('始まりと終わりが残る', () => {
    const done = afterJudgments(smashedFromCenter(sp1000))
    const both = events(done).filter(
      (event) => event.kind === 'スマッシュ判定が始まった' || event.kind === 'スマッシュ判定が終わった',
    )

    expect(both).toEqual([
      { kind: 'スマッシュ判定が始まった', player: '後攻', repeats: 1 },
      { kind: 'スマッシュ判定が終わった', player: '後攻' },
    ])
  })

  /**
   * 総合ルール 第3部 第17章 3: 「希望ステップ」と「確定ステップ」が複数回発生して区別が必要な
   * 場合、繰り返した回数によって「第１希望ステップ」のように表現する。
   *
   * 何回目かは、繰り返しの回数（`repeats`）と突き合わせないと最後かどうかも決まらない。
   * ステップの名前だけでは足りないので、回数も一緒に積む。
   */
  it('ステップが、繰り返しの何回目かとあわせて残る', () => {
    // 敵エリアのＳＰ1500 のユニットが与えるのは 2000（総合ルール 第3部 第9章 1 の (2) の行動）。
    const done = afterJudgments(smashedFromEnemyArea(sp1500))
    const steps = events(done).flatMap((event) =>
      event.kind === 'スマッシュ判定のステップが変わった' ? [`${event.round}／${event.step}`] : [],
    )

    expect(steps).toEqual([
      '0／回復ステップ',
      '1／希望ステップ',
      '1／確定ステップ',
      '2／希望ステップ',
      '2／確定ステップ',
    ])
  })

  /**
   * #133。手順の見出しは、その手順の外側に立つ（`log.ts` の `LoggedEvent.during`）。
   * 判定の中で起きたことが 1 つ深くなる。
   */
  it('判定の始まりと終わりは、その中のできごとより浅いところに積まれる', () => {
    const done = afterJudgments(smashedFromCenter(sp1000))
    const depths = new Map(done.log.map(({ event, during }): readonly [string, number] => [event.kind, during.length]))

    expect(depths.get('スマッシュ判定が始まった')).toBe(0)
    expect(depths.get('スマッシュ判定が終わった')).toBe(0)
    expect(depths.get('スマッシュ判定のステップが変わった')).toBe(1)
    expect(depths.get('希望ステップでめくった')).toBe(1)
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

  /**
   * 回復したことが積まれる（#157）。
   *
   * 回復は盤面の数値を書き換えるだけなので、後から見比べても何が起きたのかは読めない。
   * **積むのは実際に減った量である**——回数から決まる回復量ではない。
   */
  describe('記録', () => {
    /** 積まれた「ダメージを回復した」だけを、起きた順に取り出す。 */
    function recoveries(state: DuelState): readonly Extract<DuelEvent, { kind: 'ダメージを回復した' }>[] {
      return state.log
        .map(({ event }) => event)
        .filter((event): event is Extract<DuelEvent, { kind: 'ダメージを回復した' }> =>
          event.kind === 'ダメージを回復した',
        )
    }

    it('回復した量が積まれる', () => {
      expect(recoveries(smashedFromCenter(sp1000))).toEqual([
        { kind: 'ダメージを回復した', player: '後攻', amount: 1000 },
      ])
    })

    it('繰り返しの回数だけ回復したことが、1 件にまとまって積まれる', () => {
      // 敵エリアのＳＰ1500 が与えるのは 2000。希望ステップは 2 回で、回復も 2000 である。
      expect(recoveries(smashedFromEnemyArea(sp1500))).toEqual([
        { kind: 'ダメージを回復した', player: '後攻', amount: 2000 },
      ])
    })

    it('1000 の倍数に満たない分は、回復した量に数えない', () => {
      // 敵エリアのＳＰ0 で 500、続けて敵エリアのＳＰ1500 で 2000 の、合計 2500。
      const first = smashPhase([
        [enemySquare, '1 枚目', sp0],
        [{ row: 2, column: 0 }, '2 枚目', sp1500],
      ])
      const once = pass(stateOf(smash(first, '1 枚目')))
      const twice = stateOf(smash(once, '2 枚目'))

      expect(recoveries(twice)).toEqual([{ kind: 'ダメージを回復した', player: '後攻', amount: 2000 }])
    })
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

// 総合ルール 第2部 第20章 1-1・第3部 第9章 1（ADR-0006、ADR-0012）
describe('スマッシュ判定中の行動', () => {
  /** 判定が発生した後、アクティブプレイヤーに優先権が戻ったところの盤面。 */
  function duringJudgment(): DuelState {
    const state = smashPhase([
      [centerSquare, '1 枚目', sp1000],
      [anotherCenterSquare, '2 枚目', sp1000],
    ])
    return pass(stateOf(smash(state, '1 枚目')))
  }

  /**
   * 総合ルール 第3部 第9章 1 には「バトル中以外」のような断りが無いが、バトル中に行えない
   * のと同じ理由で、スマッシュ判定の進行中にも行えない（ADR-0012）。
   */
  it('アクティブプレイヤーは、判定が進行中なら優先権を持っていてもスマッシュできない', () => {
    const during = duringJudgment()

    expect(during.smashJudgments).toHaveLength(1)
    expect(during.turn.phase).toBe('スマッシュフェイズ')
    expect(during.turn.priority).toBe('先攻')
    expect(during.bank).toEqual([])
    expect(smash(during, '2 枚目')).toEqual({ kind: '行えない', violation: '行える時ではない' })
  })

  it('判定が終われば、同じフェイズでスマッシュできるようになる', () => {
    let current = duringJudgment()
    while (current.smashJudgments.length > 0) current = pass(current)
    const ready = pass(current)

    expect(ready.turn.phase).toBe('スマッシュフェイズ')
    // 行えたことは、そのダメージで新しい判定が始まることで分かる。ダメージそのものは
    // その判定の回復ステップで 1000 回復している（総合ルール 第3部 第18章 1）。
    expect(stateOf(smash(ready, '2 枚目')).smashJudgments).toHaveLength(1)
  })
})

// 総合ルール 第3部 第17章 2-2、第20章 1 の【例】（ADR-0006）
describe('スマッシュ判定中のスマッシュ判定', () => {
  /** 「希望」で先攻に 1000 のダメージを与える、レベル 1 の赤いカード。 */
  const damagingHope = defineUnit({
    name: 'テスト・希望ダメージ',
    level: 1,
    colors: ['赤'],
    bp: 1000,
    sp: 1000,
    abilities: [
      hope(function* () {
        yield* damagePlayer('先攻', 1000)
      }),
    ],
  })

  /**
   * 後攻のスマッシュ判定の希望ステップでめくれた「希望」が、先攻に 1000 のダメージを与えて
   * 2 つ目の判定を起こした盤面。
   *
   * 総合ルール 第3部 第20章 1 の【例】（希望ステップで「相手に1000ダメージ！」の希望が解決
   * され、新しいスマッシュ判定が発生して先の判定が待機中になる）と同じ形である。判定の最中に
   * スマッシュはできない（ADR-0012）ので、入れ子の判定は判定の中で解決される効果から起こる。
   */
  function judgmentInJudgment(): DuelState {
    return endStep(withEnergy(smashedFromCenter(sp1000, [damagingHope]), [vanilla]))
  }

  it('後から発生したスマッシュ判定を先に処理する', () => {
    const state = judgmentInJudgment()

    expect(state.smashJudgments).toHaveLength(2)
    expect(state.smashJudgments.map((judgment) => judgment.player)).toEqual(['後攻', '先攻'])
    expect(stepOf(state)).toBe('回復ステップ')
  })

  // 総合ルール 第3部 第17章 2-2: 待機中のスマッシュ判定は、後から発生したスマッシュ判定を
  // 処理した後、通常のスマッシュ判定に戻って残りの手順が処理される。
  it('後から発生したものが終わると、待機中だったものが残りの手順を処理する', () => {
    let current = judgmentInJudgment()
    while (current.smashJudgments.length > 1) current = endStep(current)

    expect(current.smashJudgments).toHaveLength(1)
    expect(current.smashJudgments[0]?.player).toBe('後攻')
    // 待機させたのは希望ステップの途中なので、そのステップから続く。終わっていない
    // ステップをやり直すわけではないので、山札はもうめくられない。
    expect(stepOf(current)).toBe('希望ステップ')
    expect(cardsIn(current, '後攻', 'スマッシュゾーン')).toHaveLength(1)
    expect(stepOf(endStep(current))).toBe('確定ステップ')
  })

  it('待機中のスマッシュ判定が表向きにしたカードは、その間もスマッシュではない', () => {
    const state = judgmentInJudgment()

    // 待機中の判定が希望ステップで表向きに置いた 1 枚が、裏返らないまま残っている。
    expect(cardsIn(state, '後攻', 'スマッシュゾーン')).toHaveLength(1)
    expect(smashesOf(state, '後攻')).toEqual([])
  })

  /**
   * #133。**待機は盤面に残らない。** 待機中かどうかは並び（`DuelState.smashJudgments`）の
   * 位置でしかないので、後から盤面を見ても、どの時点でどちらが動いていたかは読めない。
   */
  it('待機中になったことと、戻ったことが残る', () => {
    let current = judgmentInJudgment()
    while (current.smashJudgments.length > 0) current = endStep(current)

    const held = current.log
      .map(({ event }) => event)
      .filter(
        (event) => event.kind === 'スマッシュ判定が待機中になった' || event.kind === 'スマッシュ判定が戻った',
      )

    expect(held).toEqual([
      { kind: 'スマッシュ判定が待機中になった', player: '後攻' },
      { kind: 'スマッシュ判定が戻った', player: '後攻' },
    ])
  })

  /**
   * #133。入れ子になった判定は、待機させた判定より 1 つ深いところに積まれる
   * （`log.ts` の `LoggedEvent.during`）。**深さだけでなく、誰の判定かでも見分けられる。**
   */
  it('入れ子になった判定は、外側の判定より 1 つ深いところに積まれる', () => {
    const nested = judgmentInJudgment()
    const inner = nested.log.find(
      ({ event }) => event.kind === 'スマッシュ判定が始まった' && event.player === '先攻',
    )

    expect(inner?.during).toEqual([{ kind: 'スマッシュ判定', player: '後攻' }])
  })
})

// 総合ルール 第3部 第17章 2-1（#167、ADR-0006）
describe('スマッシュ判定中のバトル', () => {
  /** 「希望」で、捨札にあるユニットを 1 枚選び、指定したスクエアに置く、レベル 1 の赤いカード。 */
  const battlingHope = defineUnit({
    name: 'テスト・希望バトル',
    level: 1,
    colors: ['赤'],
    bp: 1000,
    sp: 1000,
    abilities: [
      hope(function* (duel) {
        const [card] = duel.discardPile()
        if (card !== undefined) yield* placeOnSquare(card, anotherCenterSquare, 'リリース')
      }),
    ],
  })

  /**
   * 後攻のスマッシュ判定の希望ステップでめくれた「希望」が、後攻の捨札にあったユニットを、
   * 先攻のユニットがすでにいるスクエアへ置いて、判定中に新しいバトルを起こした盤面。
   *
   * 総合ルール 第3部 第17章 2-1 の形——スマッシュ判定中にバトルが発生し、判定は待機中に
   * なって、バトルを先に処理する——である。判定の最中にスマッシュはできない（ADR-0012）
   * ので、`スマッシュ判定中のスマッシュ判定` と同じく、判定の中で解決される効果（今回は
   * ダメージではなくスクエアへの配置）から起こる。
   */
  function battleInJudgment(): DuelState {
    const smashed = withEnergy(smashedFromCenter(sp1000, [battlingHope]), [vanilla])
    const withDiscard = putInZone(smashed, '後攻', '捨札', [
      instantiate({ id: '捨札のユニット', card: vanilla, owner: '後攻' }),
    ])
    const withEnemy = putOnSquare(
      withDiscard,
      anotherCenterSquare,
      instantiate({ id: '先に置かれた敵', card: vanilla, owner: '先攻' }),
    )
    return endStep(withEnemy)
  }

  /** バトルの、進行中のステップが終わるまで、両方が優先権を放棄し続けた盤面。 */
  function endBattleStep(state: DuelState): DuelState {
    const before = state.battles.at(-1)?.step
    let current = state
    while (current.battles.at(-1)?.step === before) current = pass(current)
    return current
  }

  it('バトルが発生し、判定は待機中のまま残る', () => {
    const state = battleInJudgment()

    expect(state.battles).toHaveLength(1)
    expect(state.battles[0]?.square).toEqual(anotherCenterSquare)
    expect(state.battles[0]?.step).toBe('第１バトルステップ')
    expect(state.smashJudgments).toHaveLength(1)
    expect(state.smashJudgments[0]?.step).toBe('希望ステップ')
  })

  // 総合ルール 第3部 第17章 2-1: 待機中のスマッシュ判定を解決する前に、バトルを処理する。
  it('待機中の判定ではなく、バトルのステップが進む', () => {
    const state = battleInJudgment()

    const next = endBattleStep(state)

    expect(next.battles[0]?.step).toBe('第１ダメージステップ')
    // 判定は待機中のまま、希望ステップから進んでいない。
    expect(next.smashJudgments[0]?.step).toBe('希望ステップ')
  })

  it('バトルが終わると、待機中だった判定が残りの手順を処理する', () => {
    let current = battleInJudgment()
    while (current.battles.length > 0) current = endBattleStep(current)

    expect(current.smashJudgments).toHaveLength(1)
    expect(stepOf(current)).toBe('希望ステップ')
    expect(stepOf(endStep(current))).toBe('確定ステップ')
  })

  /**
   * #133。入れ子になったバトルは、待機させた判定より 1 つ深いところに積まれる
   * （`log.ts` の `LoggedEvent.during`）。`入れ子になった判定は、外側の判定より 1 つ深い
   * ところに積まれる`（スマッシュ判定中のスマッシュ判定）と同じ形。
   */
  it('入れ子になったバトルは、外側の判定より 1 つ深いところに積まれる', () => {
    const nested = battleInJudgment()
    const inner = nested.log.find(({ event }) => event.kind === 'バトルが始まった')

    expect(inner?.during).toEqual([{ kind: 'スマッシュ判定', player: '後攻' }])
  })
})

/**
 * 効果がプレイヤーにダメージを与えた場合（#103）。
 *
 * 効果はバンクから解決される（総合ルール 第2部 第21章 11-3）ので、**ダメージが入る時点で
 * バンクは空ではない。** スマッシュが与える場合（同 第3部 第9章 1）と違って、判定が発生した
 * 時にバンクが使用中でありうる。
 */
describe('効果によるダメージからのスマッシュ判定', () => {
  /** 「後攻に 1000 のダメージを与える」誘発型能力を持つユニット。 */
  const damaging = defineUnit({
    name: 'テスト・ダメージを与える',
    level: 1,
    colors: ['赤'],
    bp: 1000,
    sp: 1000,
    abilities: [
      triggeredAbility('登場した時', function* () {
        yield* damagePlayer('後攻', 1000)
      }),
    ],
  })

  /** 何もしない誘発型能力を持つユニット。バンクに残る能力として使う。 */
  const quiet = defineUnit({
    name: 'テスト・何もしない',
    level: 1,
    colors: ['赤'],
    bp: 1000,
    sp: 1000,
    abilities: [triggeredAbility('登場した時', function* () {})],
  })

  /** そのカードの、1 つ目の誘発型能力をバンクに積む形。 */
  function banked(id: string, card: UnitCard, square: Square) {
    const [ability] = card.abilities
    if (ability?.kind !== '誘発型能力') throw new Error('誘発型能力のはずだった')

    return { ability, source: id, controller: '先攻' as const, self: { id, square, card, controller: '先攻' as const } }
  }

  /**
   * ダメージを与える能力と、そうでない能力が、この順にバンクで解決を待っている盤面。
   *
   * **2 つ積むのが要点である。** 1 つ目を解決するとダメージが入ってスマッシュ判定が発生する
   * が、その時バンクには 2 つ目が残っている。
   */
  function bothInBank(): DuelState {
    const placed = putOnSquare(
      putOnSquare(stockedDuelState([]), centerSquare, instantiate({ id: 'ダメージ役', card: damaging, owner: '先攻' })),
      anotherCenterSquare,
      instantiate({ id: '静かな役', card: quiet, owner: '先攻' }),
    )
    return {
      ...placed,
      bank: [banked('ダメージ役', damaging, centerSquare), banked('静かな役', quiet, anotherCenterSquare)],
    }
  }

  /** バンクの 1 つ目を解決して、スマッシュ判定が発生したところ。 */
  function afterResolving(): DuelState {
    return pass(pass(bothInBank()))
  }

  // 総合ルール 第4部 第14章 4-12: 合計 1000 以上のダメージを受けた時、スマッシュ判定が発生する。
  it('効果がダメージを与えても、スマッシュ判定が発生する', () => {
    expect(afterResolving().smashJudgments).toHaveLength(1)
  })

  // 総合ルール 第3部 第17章 2: スマッシュ判定が発生した時にバンクが使用中なら、そのバンクは
  // 待機中となり、解決する前にスマッシュ判定を開始する。
  it('発生した時に使用中だったバンクは、待機中になる', () => {
    const state = afterResolving()

    expect(state.bank).toEqual([])
    expect(state.smashJudgments.at(-1)?.heldBank.map((each) => each.source)).toEqual(['静かな役'])
  })

  /**
   * 待機させないと、判定のステップが進むかわりに残っていたバンクが解決されてしまう。
   * **判定が数手ぶん遅れて進む**のがこの Issue の症状である。
   *
   * 連続した放棄 1 回（総合ルール 第3部 第4章 4）で、進行中のステップが終了する。
   */
  it('待機中のバンクは、判定のステップの進行を止めない', () => {
    expect(stepOf(pass(pass(afterResolving())))).toBe('希望ステップ')
  })

  // 総合ルール 第3部 第17章 4: 待機中のバンクは、スマッシュ判定が終了した後、通常のバンクに
  // 戻って処理される。
  it('判定が終わると、待機していたバンクが戻る', () => {
    let current = afterResolving()
    while (current.smashJudgments.length > 0 && current.result === undefined) current = endStep(current)

    expect(current.bank.map((each) => each.source)).toEqual(['静かな役'])
  })

  /**
   * 判定中に発生した誘発型能力は、待機中のバンクとは別の新しいバンクで解決される
   * （総合ルール 第3部 第17章 2）。戻す先を取り違えないことをここで見る。
   */
  it('判定中に積まれた能力は、待機していた分と混ざらない', () => {
    const during = afterResolving()
    const withNew = { ...during, bank: [banked('静かな役', quiet, anotherCenterSquare)] }

    expect(withNew.smashJudgments.at(-1)?.heldBank).toHaveLength(1)
    expect(withNew.bank).toHaveLength(1)
  })
})
