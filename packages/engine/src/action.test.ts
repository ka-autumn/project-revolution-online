import { describe, expect, it } from 'vitest'
// 手札やエネルギーゾーンを組み立てるためだけに `putInZone` を使う。engine の中から
// ゾーンを差し替えるための関数であり、公開する API ではない。
import { putInZone } from './duel.js'
import {
  PLAYERS,
  cardsIn,
  cardsOn,
  defineUnit,
  discardTrap,
  emptyDuelState,
  instantiate,
  passPriority,
  placeEnergy,
  plan,
  putOnSquare,
  smash,
} from './index.js'
import type { ActionOutcome, CardInstance, Chooser, DuelState, Phase, Square, UnitCard } from './index.js'

/** 選択を求められたら常に最初の候補を選ぶ。どれを選ぶかを問わないテストで使う。 */
const chooseFirst: Chooser = (candidates) => candidates[0]

const testCard = defineUnit({ name: 'テストカード', level: 1, colors: ['赤'], bp: 1000, sp: 1000 })

function card(id: string): CardInstance {
  return instantiate({ id, card: testCard, owner: '先攻' })
}

/**
 * アクティブプレイヤー（先攻）が行動できる、そのフェイズの盤面。
 *
 * フェイズの始めには非アクティブプレイヤーに優先権が発生する（総合ルール 第3部
 * 第7章 1・第8章 1）ので、そこから 1 度放棄させてアクティブプレイヤーに優先権を移す。
 */
function phaseReadyToAct(phase: Phase): DuelState {
  let current = stockedDuelState()
  while (current.turn.phase !== phase) current = passPriority(current, chooseFirst)
  return passPriority(current, chooseFirst)
}

/**
 * 山札を積んだ、カードの置かれていない盤面。山札が 0 枚以下のプレイヤーは次に優先権が
 * 発生した時に敗北する（総合ルール 第3部 第3章 2）ので、優先権を動かすテストでは積んでおく。
 */
function stockedDuelState(): DuelState {
  return PLAYERS.reduce(
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
}

/** 行えたはずの行動の結果の盤面。 */
function stateOf(outcome: ActionOutcome): DuelState {
  if (outcome.kind !== '行った') throw new Error(`行えなかった: ${outcome.violation}`)
  return outcome.state
}

/** 行えなかったはずの行動の理由。 */
function violationOf(outcome: ActionOutcome): string {
  if (outcome.kind !== '行えない') throw new Error('行えてしまった')
  return outcome.violation
}

const idsOf = (cards: readonly CardInstance[]) => cards.map((each) => each.id)

// 総合ルール 第3部 第7章 1（ADR-0006）
describe('エネルギーゾーンにカードを置く', () => {
  /** 手札が 2 枚ある、エネルギーフェイズの盤面。 */
  function energyPhase(): DuelState {
    return putInZone(phaseReadyToAct('エネルギーフェイズ'), '先攻', '手札', [card('手札'), card('手札 2')])
  }

  it('自分の手札のカードがリリース状態でエネルギーゾーンに置かれる', () => {
    const after = stateOf(placeEnergy(energyPhase(), '手札'))

    expect(idsOf(cardsIn(after, '先攻', 'エネルギーゾーン'))).toEqual(['手札'])
    expect(cardsIn(after, '先攻', 'エネルギーゾーン')[0]?.orientation).toBe('リリース')
    expect(idsOf(cardsIn(after, '先攻', '手札'))).toEqual(['手札 2'])
  })

  // 総合ルール 第3部 第7章 1: 置けるのは「自分の手札を 1 枚」である。行った後もバンクは
  // 空のまま優先権が戻ってくるので、回数を数えていないと何枚でも置けてしまう。
  it('同じエネルギーフェイズに 2 枚目は置けない', () => {
    const placed = stateOf(placeEnergy(energyPhase(), '手札'))
    // 置いた時点で優先権が非アクティブプレイヤーに移っているので戻す。
    const back = passPriority(placed, chooseFirst)

    expect(violationOf(placeEnergy(back, '手札 2'))).toBe('行える時ではない')
  })

  it('次のターンのエネルギーフェイズにはまた置ける', () => {
    const placed = stateOf(placeEnergy(energyPhase(), '手札'))
    let current = passPriority(placed, chooseFirst)
    while (current.turn.number === placed.turn.number) current = passPriority(current, chooseFirst)
    while (current.turn.phase !== 'エネルギーフェイズ') current = passPriority(current, chooseFirst)
    // 後攻のターンなので、後攻の手札に置くカードを用意する。
    const next = putInZone(passPriority(current, chooseFirst), '後攻', '手札', [
      instantiate({ id: '後攻の手札', card: testCard, owner: '後攻' }),
    ])

    expect(idsOf(cardsIn(stateOf(placeEnergy(next, '後攻の手札')), '後攻', 'エネルギーゾーン'))).toEqual([
      '後攻の手札',
    ])
  })

  // 総合ルール 第4部 第5章 2: 特別な行動を行った後、非アクティブプレイヤーが優先権を
  // 獲得する。
  it('置いた後、非アクティブプレイヤーが優先権を獲得する', () => {
    expect(stateOf(placeEnergy(energyPhase(), '手札')).turn.priority).toBe('後攻')
  })

  it('エネルギーフェイズでなければ行えない', () => {
    const mainPhase = putInZone(phaseReadyToAct('メインフェイズ'), '先攻', '手札', [card('手札')])

    expect(violationOf(placeEnergy(mainPhase, '手札'))).toBe('行える時ではない')
  })

  it('手札にないカードは置けない', () => {
    expect(violationOf(placeEnergy(energyPhase(), '山札のカード'))).toBe('そのゾーンにない')
  })
})

// 総合ルール 第3部 第8章 2-3（ADR-0006）
describe('プランする', () => {
  /** 山札が 2 枚、エネルギーが 1 枚ある、メインフェイズの盤面。 */
  function beforePlanning(): DuelState {
    const state = putInZone(phaseReadyToAct('メインフェイズ'), '先攻', '山札', [card('1 枚目'), card('2 枚目')])
    return putInZone(state, '先攻', 'エネルギーゾーン', [card('エネ')])
  }

  it('山札の 1 番上のカードが表返ってプランゾーンに置かれる', () => {
    const after = stateOf(plan(beforePlanning(), chooseFirst))

    expect(idsOf(cardsIn(after, '先攻', 'プランゾーン'))).toEqual(['1 枚目'])
    // プランゾーンにあるカードは同時に山札の 1 番上のカードでもある
    // （総合ルール 第2部 第21章 3-1）ので、山札からは取り除いて持つ。
    expect(idsOf(cardsIn(after, '先攻', '山札'))).toEqual(['2 枚目'])
  })

  it('コストとしてエネルギーが 1 枚フリーズされる', () => {
    const after = stateOf(plan(beforePlanning(), chooseFirst))

    expect(cardsIn(after, '先攻', 'エネルギーゾーン')[0]?.orientation).toBe('フリーズ')
  })

  it('すでにプランがあれば、それを捨札に置いてから次のカードを表返す', () => {
    const planned = stateOf(plan(beforePlanning(), chooseFirst))
    // 1 回目でエネルギーを使い切っているので、2 回目のためにもう 1 枚置く。
    const ready = putInZone(passPriority(planned, chooseFirst), '先攻', 'エネルギーゾーン', [
      ...cardsIn(planned, '先攻', 'エネルギーゾーン'),
      card('エネ 2'),
    ])

    const after = stateOf(plan(ready, chooseFirst))

    expect(idsOf(cardsIn(after, '先攻', 'プランゾーン'))).toEqual(['2 枚目'])
    expect(idsOf(cardsIn(after, '先攻', '捨札'))).toEqual(['1 枚目'])
  })

  // 総合ルール 第2部 第21章 7-5、第1部 第2章 3-3: プランはスマッシュで支払える例外。
  it('スマッシュでも支払える', () => {
    const state = putInZone(
      putInZone(phaseReadyToAct('メインフェイズ'), '先攻', '山札', [card('1 枚目')]),
      '先攻',
      'スマッシュゾーン',
      [card('スマッシュ')],
    )

    const after = stateOf(plan(state, chooseFirst))

    expect(cardsIn(after, '先攻', 'スマッシュゾーン')[0]?.orientation).toBe('フリーズ')
    expect(idsOf(cardsIn(after, '先攻', 'プランゾーン'))).toEqual(['1 枚目'])
  })

  it('コストを支払えなければ行えない', () => {
    const state = putInZone(phaseReadyToAct('メインフェイズ'), '先攻', '山札', [card('1 枚目')])

    expect(violationOf(plan(state, chooseFirst))).toBe('コストを支払えない')
  })

  it('メインフェイズでなければ行えない', () => {
    const state = putInZone(phaseReadyToAct('エネルギーフェイズ'), '先攻', 'エネルギーゾーン', [card('エネ')])

    expect(violationOf(plan(state, chooseFirst))).toBe('行える時ではない')
  })
})

// 総合ルール 第2部 第20章 3-12（ADR-0006）
describe('トラップの廃棄', () => {
  /** トラップゾーンにカードが 1 枚ある、メインフェイズの盤面。 */
  function withTrap(): DuelState {
    return putInZone(phaseReadyToAct('メインフェイズ'), '先攻', 'トラップゾーン', [card('トラップ')])
  }

  it('トラップゾーンにあるカードが自分の捨札に置かれる', () => {
    const after = stateOf(discardTrap(withTrap(), 'トラップ'))

    expect(cardsIn(after, '先攻', 'トラップゾーン')).toEqual([])
    expect(idsOf(cardsIn(after, '先攻', '捨札'))).toEqual(['トラップ'])
  })

  it('トラップゾーンにないカードは廃棄できない', () => {
    expect(violationOf(discardTrap(withTrap(), '別のカード'))).toBe('そのゾーンにない')
  })

  it('メインフェイズでなければ行えない', () => {
    const state = putInZone(phaseReadyToAct('エネルギーフェイズ'), '先攻', 'トラップゾーン', [card('トラップ')])

    expect(violationOf(discardTrap(state, 'トラップ'))).toBe('行える時ではない')
  })
})

// 総合ルール 第3部 第9章 1（ADR-0006）
describe('スマッシュする', () => {
  /** ＳＰ 500 のユニット。スマッシュ判定が発生しない量のダメージを与えるのに使う。 */
  const sp500 = defineUnit({ name: 'テスト・ＳＰ500', level: 1, colors: ['赤'], bp: 1000, sp: 500 })

  /** ＳＰ 0 のユニット。敵エリアの＋500 だけを取り出して確かめるのに使う。 */
  const sp0 = defineUnit({ name: 'テスト・ＳＰ0', level: 1, colors: ['赤'], bp: 1000, sp: 0 })

  /** 先攻から見た味方エリア・中央エリア・敵エリアのスクエア。 */
  const homeSquare: Square = { row: 0, column: 1 }
  const centerSquare: Square = { row: 1, column: 1 }
  const anotherCenterSquare: Square = { row: 1, column: 0 }
  const enemySquare: Square = { row: 2, column: 1 }

  /**
   * アクティブプレイヤー（先攻）のユニットが置かれた、スマッシュフェイズの盤面。
   *
   * 効果ではなく盤面に直接置く。中央エリアを指定してプレイされたユニットはルールエフェクト
   * によって捨札に置かれてしまう（総合ルール 第4部 第14章 4-9）ためである。
   */
  function smashPhaseWith(...units: readonly (readonly [Square, string, UnitCard])[]): DuelState {
    const board = units.reduce(
      (state, [square, id, card]) => putOnSquare(state, square, instantiate({ id, card, owner: '先攻' })),
      stockedDuelState(),
    )
    let current = board
    while (current.turn.phase !== 'スマッシュフェイズ') current = passPriority(current, chooseFirst)
    return passPriority(current, chooseFirst)
  }

  /** そのスクエアにあるカードの向き。 */
  function orientationOf(state: DuelState, square: Square, id: string): string | undefined {
    return cardsOn(state, square).find((each) => each.id === id)?.orientation
  }

  it('中央エリアの自分のユニットをフリーズして、相手にＳＰと同じダメージを与える', () => {
    const after = stateOf(smash(smashPhaseWith([centerSquare, 'スマッシュ役', sp500]), 'スマッシュ役'))

    expect(after.damage['後攻']).toBe(500)
    expect(orientationOf(after, centerSquare, 'スマッシュ役')).toBe('フリーズ')
  })

  // 総合ルール 第3部 第9章 1 の (2) の行動
  it('敵エリアの自分のユニットなら、ＳＰ＋500 のダメージを与える', () => {
    const after = stateOf(smash(smashPhaseWith([enemySquare, 'スマッシュ役', sp0]), 'スマッシュ役'))

    expect(after.damage['後攻']).toBe(500)
  })

  it('味方エリアのユニットではスマッシュできない', () => {
    const state = smashPhaseWith([homeSquare, 'スマッシュ役', sp500])

    expect(violationOf(smash(state, 'スマッシュ役'))).toBe('スマッシュできるユニットではない')
  })

  // 総合ルール 第2部 第24章 1-1: すでにフリーズしているカードはフリーズできない。
  it('フリーズ状態のユニットではスマッシュできない', () => {
    const state = smashPhaseWith([centerSquare, 'スマッシュ役', sp500])
    const frozen = stateOf(smash(state, 'スマッシュ役'))
    const back = passPriority(frozen, chooseFirst)

    expect(violationOf(smash(back, 'スマッシュ役'))).toBe('スマッシュできるユニットではない')
  })

  it('相手のユニットではスマッシュできない', () => {
    const state = smashPhaseWith()
    const enemy = putOnSquare(state, centerSquare, instantiate({ id: '敵', card: sp500, owner: '後攻' }))

    expect(violationOf(smash(enemy, '敵'))).toBe('スマッシュできるユニットではない')
  })

  // 総合ルール 第3部 第9章 1: (1)〜(2)の行動は好きな順番で好きな回数行える。
  it('同じスマッシュフェイズに何回でも行える', () => {
    const state = smashPhaseWith([centerSquare, '1 枚目', sp500], [anotherCenterSquare, '2 枚目', sp500])
    const once = passPriority(stateOf(smash(state, '1 枚目')), chooseFirst)
    const twice = stateOf(smash(once, '2 枚目'))

    expect(once.damage['後攻']).toBe(500)
    // 2 回目で合計 1000 になり、スマッシュ判定が発生してダメージが回復する（総合ルール
    // 第4部 第14章 4-12、第3部 第18章 1）。判定そのものは `smash.test.ts` で確かめる。
    expect(twice.smashJudgments).toHaveLength(1)
  })

  // 総合ルール 第4部 第5章 2: 特別な行動を行った後、非アクティブプレイヤーが優先権を獲得する。
  it('スマッシュした後、非アクティブプレイヤーが優先権を獲得する', () => {
    const after = stateOf(smash(smashPhaseWith([centerSquare, 'スマッシュ役', sp500]), 'スマッシュ役'))

    expect(after.turn.priority).toBe('後攻')
  })

  it('スマッシュフェイズでなければ行えない', () => {
    const state = putOnSquare(
      phaseReadyToAct('メインフェイズ'),
      centerSquare,
      instantiate({ id: 'スマッシュ役', card: sp500, owner: '先攻' }),
    )

    expect(violationOf(smash(state, 'スマッシュ役'))).toBe('行える時ではない')
  })

  it('スクエアにないカードではスマッシュできない', () => {
    expect(violationOf(smash(smashPhaseWith(), '手札のカード'))).toBe('スマッシュできるユニットではない')
  })
})
