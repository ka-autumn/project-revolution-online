import { describe, expect, it } from 'vitest'
import { cardsIn, defineUnit, passPriority, prepareDuel } from './index.js'
import type { Deck, DuelState, Phase } from './index.js'

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

/** 両方のプレイヤーが優先権を放棄して、そのフェイズを終わらせた盤面。 */
function endPhase(state: DuelState): DuelState {
  return passPriority(passPriority(state))
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
    const passed = passPriority(startedDuel())

    expect(passed.turn.priority).toBe('先攻')
    expect(passed.turn.phase).toBe('リリースフェイズ')
  })

  // どのフェイズに移るかは「フェイズの進行」で検証する。ここで見るのは、両方が
  // 放棄した時にフェイズが終わることだけ。
  it('両方が連続して放棄すると、そのフェイズが終了する', () => {
    const next = passPriority(passPriority(startedDuel()))

    expect(next.turn.phase).not.toBe('リリースフェイズ')
  })

  // 総合ルール 第3部 第5章 1 ほか、各フェイズの 1
  it('次のフェイズでも、非アクティブプレイヤーから優先権が発生し直す', () => {
    const next = passPriority(passPriority(startedDuel()))

    expect(next.turn.priority).toBe('後攻')
  })

  it('放棄が続いていなければ、フェイズは終了しない', () => {
    // 1 人目が放棄して 2 人目に優先権が移り、2 人目が放棄した時に初めて終了する。
    // 「連続して」なので、1 人が 1 回放棄しただけでは終わらない。
    expect(passPriority(startedDuel()).turn.phase).toBe('リリースフェイズ')
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
