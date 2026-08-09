import { describe, expect, it } from 'vitest'
// 手札やエネルギーゾーンを組み立てるためだけに `putInZone` を使う。engine の中から
// ゾーンを差し替えるための関数であり、公開する API ではない。
import { putInZone } from './duel.js'
import {
  cardsIn,
  defineUnit,
  discardTrap,
  emptyDuelState,
  instantiate,
  passPriority,
  placeEnergy,
  plan,
} from './index.js'
import type { ActionOutcome, CardInstance, Chooser, DuelState, Phase } from './index.js'

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
  let current = emptyDuelState()
  while (current.turn.phase !== phase) current = passPriority(current, chooseFirst)
  return passPriority(current, chooseFirst)
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
  /** 手札が 1 枚ある、エネルギーフェイズの盤面。 */
  function energyPhase(): DuelState {
    return putInZone(phaseReadyToAct('エネルギーフェイズ'), '先攻', '手札', [card('手札')])
  }

  it('自分の手札のカードがリリース状態でエネルギーゾーンに置かれる', () => {
    const after = stateOf(placeEnergy(energyPhase(), '手札'))

    expect(idsOf(cardsIn(after, '先攻', 'エネルギーゾーン'))).toEqual(['手札'])
    expect(cardsIn(after, '先攻', 'エネルギーゾーン')[0]?.orientation).toBe('リリース')
    expect(cardsIn(after, '先攻', '手札')).toEqual([])
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
