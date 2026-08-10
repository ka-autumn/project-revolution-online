import { describe, expect, it } from 'vitest'
// ダメージを与えるためだけに `dealDamage` と `damagePlayer` を使う。engine の中から盤面を
// 組み替えるための関数であり、公開する API ではない。
import { damagePlayer, dealDamage } from './duel.js'
import {
  cardsIn,
  cardsOn,
  defineUnit,
  instantiate,
  passPriority,
  prepareDuel,
  putOnSquare,
  triggeredAbility,
} from './index.js'
import type { Chooser, Deck, DuelState, Phase, Square } from './index.js'

/** 60 枚すべてが別々の名前のデッキ。同じカード名は 4 枚までという規定を避けるため。 */
function testDeck(prefix: string): Deck {
  return Array.from({ length: 60 }, (_, index) =>
    defineUnit({ name: `${prefix}${index}`, level: 1, bp: 1000, sp: 1000 }),
  )
}

/** 準備が終わった盤面。どちらの席が先攻になったかはここでは問わない。 */
function startedDuel(): DuelState {
  const preparation = prepareDuel({ decks: [testDeck('席0'), testDeck('席1')], seed: 20260809 })
  if (preparation.kind !== '準備完了') throw new Error('準備できるデッキのはずだった')
  return preparation.state
}

/** 選択を求められたら常に最初の候補を選ぶ。どれを選ぶかを問わないテストで使う。 */
const chooseFirst: Chooser = (candidates) => candidates[0]

/** 優先権を放棄する。 */
function pass(state: DuelState): DuelState {
  return passPriority(state, chooseFirst)
}

/**
 * 進行中のフェイズが終わるまで、両方のプレイヤーが優先権を放棄し続けた盤面。
 *
 * 放棄 2 回で終わるとは限らない。リカバリーフェイズは連続放棄を 2 度必要とし
 * （総合ルール 第3部 第10章 3・4）、バンクに能力があれば連続放棄でそれが解決される
 * （同 第4部 第8章 1-1）だけでフェイズは終わらない。
 */
function endPhase(state: DuelState): DuelState {
  let current = state
  while (current.turn.phase === state.turn.phase && current.turn.number === state.turn.number) {
    current = pass(current)
  }
  return current
}

/** 何もせずにフェイズを送り、そのターンが始まったところまで進めた盤面。 */
function turnNumbered(state: DuelState, number: number): DuelState {
  let current = state
  while (current.turn.number < number) current = endPhase(current)
  return current
}

/** そのターンで実際に行われるフェイズを、行われる順に並べたもの。 */
function phasesOfTurn(state: DuelState): readonly Phase[] {
  const { number } = state.turn
  const phases: Phase[] = []
  for (let current = state; current.turn.number === number; current = endPhase(current)) {
    phases.push(current.turn.phase)
  }
  return phases
}

// 総合ルール 第3部 第4章 1（ADR-0006）
describe('デュエルの開始時のターン', () => {
  it('先攻のプレイヤーの第 1 ターンから始まる', () => {
    const { turn } = startedDuel()

    expect(turn.number).toBe(1)
    expect(turn.active).toBe('先攻')
  })

  // 総合ルール 第3部 第4章 2
  it('最初のフェイズはリリースフェイズである', () => {
    expect(startedDuel().turn.phase).toBe('リリースフェイズ')
  })

  // 総合ルール 第3部 第5章 1
  it('非アクティブプレイヤーに優先権が発生している', () => {
    expect(startedDuel().turn.priority).toBe('後攻')
  })
})

// 総合ルール 第3部 第4章 4（ADR-0006）
describe('優先権の放棄', () => {
  it('片方が放棄すると、もう一方のプレイヤーに優先権が移る', () => {
    const passed = pass(startedDuel())

    expect(passed.turn.priority).toBe('先攻')
    expect(passed.turn.phase).toBe('リリースフェイズ')
  })

  // どのフェイズに移るかは「フェイズの進行」で検証する。ここで見るのは、両方が
  // 放棄した時にフェイズが終わることだけ。
  it('バンクが空のまま両方が連続して放棄すると、そのフェイズが終了する', () => {
    const next = pass(pass(startedDuel()))

    expect(next.turn.phase).not.toBe('リリースフェイズ')
  })

  // 総合ルール 第3部 第5章 1 ほか、各フェイズの 1
  it('次のフェイズでも、非アクティブプレイヤーから優先権が発生し直す', () => {
    const next = pass(pass(startedDuel()))

    expect(next.turn.priority).toBe('後攻')
  })

  it('放棄が続いていなければ、フェイズは終了しない', () => {
    // 1 人目が放棄して 2 人目に優先権が移り、2 人目が放棄した時に初めて終了する。
    // 「連続して」なので、1 人が 1 回放棄しただけでは終わらない。
    expect(pass(startedDuel()).turn.phase).toBe('リリースフェイズ')
  })
})

// 総合ルール 第3部 第4章 2（ADR-0006）
describe('フェイズの進行', () => {
  // 先攻の第 1 ターンはドローフェイズがとばされるため、後攻の最初のターンで見る。
  it('ターンは 6 つのフェイズを総合ルールの順に行う', () => {
    expect(phasesOfTurn(turnNumbered(startedDuel(), 2))).toEqual([
      'リリースフェイズ',
      'ドローフェイズ',
      'エネルギーフェイズ',
      'メインフェイズ',
      'スマッシュフェイズ',
      'リカバリーフェイズ',
    ])
  })

  // 総合ルール 第3部 第4章 1・6
  it('すべてのフェイズが終了すると、アクティブプレイヤーが交代して次のターンに移る', () => {
    const second = turnNumbered(startedDuel(), 2)
    const third = turnNumbered(second, 3)

    expect(second.turn.active).toBe('後攻')
    expect(third.turn.active).toBe('先攻')
  })
})

// 総合ルール 第3部 第2章 2・第6章 1-2（ADR-0006）
describe('先攻の第 1 ターン', () => {
  // 総合ルール 第3部 第4章 5: とばされたフェイズは、存在しないものとして進める。
  it('ドローフェイズをとばす', () => {
    expect(phasesOfTurn(startedDuel())).toEqual([
      'リリースフェイズ',
      'エネルギーフェイズ',
      'メインフェイズ',
      'スマッシュフェイズ',
      'リカバリーフェイズ',
    ])
  })

  it('とばすのは先攻の第 1 ターンだけで、後攻の第 1 ターンはとばさない', () => {
    expect(phasesOfTurn(turnNumbered(startedDuel(), 2))).toContain('ドローフェイズ')
  })

  it('とばすのは第 1 ターンだけで、先攻の第 2 ターンはとばさない', () => {
    expect(phasesOfTurn(turnNumbered(startedDuel(), 3))).toContain('ドローフェイズ')
  })
})

// 総合ルール 第3部 第10章 3・4（ADR-0006）
describe('リカバリーフェイズ', () => {
  const someSquare: Square = { row: 2, column: 1 }

  /**
   * 「ターンの終わり」に誘発する能力を持つテストカード（ADR-0002）。
   *
   * ここで見るのは能力がバンクに入ることと、バンクにある間はフェイズが終わらないこと
   * だけなので、効果は何もしない。
   */
  const endOfTurnUnit = defineUnit({
    name: 'テスト・ターンの終わり',
    level: 1,
    bp: 1000,
    sp: 1000,
    abilities: [triggeredAbility('ターンの終わり', function* () {})],
  })

  /** 第 1 ターンのリカバリーフェイズが始まった盤面。 */
  function recoveryPhase(): DuelState {
    let current = startedDuel()
    while (current.turn.phase !== 'リカバリーフェイズ') current = endPhase(current)
    return current
  }

  /** そのユニットがスクエアに置かれた、第 1 ターンのリカバリーフェイズ。 */
  function recoveryPhaseWithUnit(): DuelState {
    const unit = instantiate({ id: 'ターンの終わりのユニット', card: endOfTurnUnit, owner: '先攻' })
    return putOnSquare(recoveryPhase(), someSquare, unit)
  }

  it('1 度目の連続放棄では終了しない', () => {
    expect(pass(pass(recoveryPhase())).turn.phase).toBe('リカバリーフェイズ')
  })

  it('2 度目の連続放棄で終了し、次のターンに移る', () => {
    const next = pass(pass(pass(pass(recoveryPhase()))))

    expect(next.turn.number).toBe(2)
    expect(next.turn.phase).toBe('リリースフェイズ')
  })

  it('1 度目の連続放棄で「ターンの終わり」に誘発する能力がバンクに入る', () => {
    const banked = pass(pass(recoveryPhaseWithUnit()))

    expect(banked.bank.map((ability) => ability.source)).toEqual(['ターンの終わりのユニット'])
    expect(banked.turn.phase).toBe('リカバリーフェイズ')
  })

  it('バンクに入った能力を解決してから終了する', () => {
    const banked = pass(pass(recoveryPhaseWithUnit()))
    const resolved = pass(pass(banked))

    expect(resolved.bank).toEqual([])
    expect(resolved.turn.phase).toBe('リカバリーフェイズ')
    expect(pass(pass(resolved)).turn.number).toBe(2)
  })

  // 総合ルール 第3部 第10章 1
  it('始めに、カードに与えられているダメージが取り除かれる', () => {
    const unit = instantiate({ id: '傷ついたユニット', card: endOfTurnUnit, owner: '先攻' })
    const board = putOnSquare(startedDuel(), someSquare, unit)
    // ＢＰ1000 のユニットにＢＰ未満のダメージを与える。ＢＰと同じかそれ以上のダメージを
    // 受けたユニットは、その前に捨札に置かれてしまう（総合ルール 第4部 第14章 4-6）。
    const damaged = dealDamage(board, '傷ついたユニット', 999)

    let current = damaged
    while (current.turn.phase !== 'リカバリーフェイズ') current = endPhase(current)

    expect(cardsOn(current, someSquare)[0]?.damage).toBe(0)
  })

  // 総合ルール 第3部 第10章 1: 取り除かれるのはすべてのカードとすべてのプレイヤーに
  // 与えられているダメージである。
  it('始めに、プレイヤーに与えられているダメージも取り除かれる', () => {
    // スマッシュ判定が発生しない量（同 第4部 第14章 4-12）のダメージを与える。
    const damaged = damagePlayer(startedDuel(), '後攻', 500)

    let current = damaged
    while (current.turn.phase !== 'リカバリーフェイズ') current = endPhase(current)

    expect(current.damage['後攻']).toBe(0)
  })

  // 総合ルール 第3部 第10章 5
  it('「ターンの終わり」に誘発する能力は、そのターン中に 1 度しか誘発しない', () => {
    const banked = pass(pass(recoveryPhaseWithUnit()))
    const ended = endPhase(banked)

    expect(ended.turn.number).toBe(2)
    expect(ended.bank).toEqual([])
  })
})

// 総合ルール 第3部 第6章 1-1（ADR-0006）
describe('ドローフェイズ', () => {
  /** そのターンのドローフェイズが始まった盤面。 */
  function drawPhaseOfTurn(number: number): DuelState {
    let current = turnNumbered(startedDuel(), number)
    while (current.turn.phase !== 'ドローフェイズ') current = endPhase(current)
    return current
  }

  it('アクティブプレイヤーがカードを 1 枚引く', () => {
    const beforeDrawing = turnNumbered(startedDuel(), 2)
    const drawPhase = drawPhaseOfTurn(2)

    expect(cardsIn(drawPhase, '後攻', '手札')).toHaveLength(6)
    expect(cardsIn(drawPhase, '後攻', '山札')).toHaveLength(54)
    // 引いたのは、そのフェイズに入る前の山札の 1 番上のカードである。
    expect(cardsIn(drawPhase, '後攻', '手札').at(-1)).toEqual(cardsIn(beforeDrawing, '後攻', '山札')[0])
  })

  it('引くのはアクティブプレイヤーだけである', () => {
    expect(cardsIn(drawPhaseOfTurn(2), '先攻', '手札')).toHaveLength(5)
  })

  // 総合ルール 第3部 第2章 2: 先攻の第 1 ターンはこのフェイズをとばすので、
  // 先攻が初めてカードを引くのは第 3 ターン（先攻の 2 回目のターン）になる。
  it('先攻は第 1 ターンにカードを引かない', () => {
    expect(cardsIn(turnNumbered(startedDuel(), 2), '先攻', '手札')).toHaveLength(5)
    expect(cardsIn(drawPhaseOfTurn(3), '先攻', '手札')).toHaveLength(6)
  })
})
