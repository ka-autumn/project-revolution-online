import { describe, expect, it } from 'vitest'
// ダメージを与えるためだけに `dealDamage` と `damagePlayer` を使う。engine の中から盤面を
// 組み替えるための関数であり、公開する API ではない。
import { damagePlayer, dealDamage, putInZone } from './duel.js'
import {
  cardsIn,
  cardsOn,
  defineUnit,
  instantiate,
  passPriority,
  placeInZone,
  prepareDuel,
  putOnSquare,
  triggeredAbility,
} from './index.js'
import type {
  Chooser,
  CourageConditionMet,
  CreatedAbility,
  Deck,
  DuelState,
  Phase,
  Player,
  Square,
  UnitOnSquare,
} from './index.js'

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

// 総合ルール 第3部 第5章 1（ADR-0006）
describe('リリースフェイズ', () => {
  const someSquare: Square = { row: 2, column: 1 }
  const anotherSquare: Square = { row: 1, column: 2 }
  const testUnit = defineUnit({ name: 'テスト・リリース', level: 1, bp: 1000, sp: 1000 })

  /** そのプレイヤーが支配する、フリーズ状態のスクエアのカードとエネルギーゾーンのカードを置いた盤面。 */
  function withFrozenCardsOf(state: DuelState, player: Player): DuelState {
    const onSquare = instantiate({ id: `${player}のスクエア`, card: testUnit, owner: player, orientation: 'フリーズ' })
    const withSquare = putOnSquare(state, someSquare, onSquare)
    const energy = instantiate({ id: `${player}のエネルギー`, card: testUnit, owner: player, orientation: 'フリーズ' })
    return putInZone(withSquare, player, 'エネルギーゾーン', [energy])
  }

  it('アクティブプレイヤーが支配するフリーズ状態のカードがリリースされる', () => {
    // 先攻の第 1 ターンにフリーズ状態で置き、先攻の次のターン（第 3 ターン）の
    // リリースフェイズまで進める。
    const withFrozen = withFrozenCardsOf(startedDuel(), '先攻')
    const turn3 = turnNumbered(withFrozen, 3)

    expect(turn3.turn.phase).toBe('リリースフェイズ')
    expect(cardsOn(turn3, someSquare)[0]?.orientation).toBe('リリース')
    expect(cardsIn(turn3, '先攻', 'エネルギーゾーン')[0]?.orientation).toBe('リリース')
  })

  it('相手が支配するフリーズ状態のカードはリリースされない', () => {
    // 先攻と後攻、両方が支配するフリーズ状態のカードを置いてから後攻の第 2 ターンの
    // リリースフェイズまで進める。リリースされるのはそのフェイズのアクティブプレイヤーで
    // ある後攻が支配するカードだけで、先攻が支配するカードはリリースされない。
    const put = putInZone(
      putOnSquare(
        putOnSquare(startedDuel(), someSquare, instantiate({ id: '先攻のスクエア', card: testUnit, owner: '先攻', orientation: 'フリーズ' })),
        anotherSquare,
        instantiate({ id: '後攻のスクエア', card: testUnit, owner: '後攻', orientation: 'フリーズ' }),
      ),
      '先攻',
      'エネルギーゾーン',
      [instantiate({ id: '先攻のエネルギー', card: testUnit, owner: '先攻', orientation: 'フリーズ' })],
    )
    const turn2 = turnNumbered(put, 2)

    expect(turn2.turn.phase).toBe('リリースフェイズ')
    expect(cardsOn(turn2, someSquare)[0]?.orientation).toBe('フリーズ')
    expect(cardsIn(turn2, '先攻', 'エネルギーゾーン')[0]?.orientation).toBe('フリーズ')
    expect(cardsOn(turn2, anotherSquare)[0]?.orientation).toBe('リリース')
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

/**
 * 総合ルール 第4部 第3章 4（ADR-0006）。
 *
 * カードや能力によって作成された誘発型能力は、どのカードにも書かれていないので、スクエアに
 * あるカードを走査しても見つからない。盤面が直接持っているものが、そのできごとが起きた時に
 * 誘発する。ここで見るのは「次のあなたのターンの終わり」がいつなのかと、誘発した能力が
 * 対象を受け取れることである。
 */
describe('作成された誘発型能力', () => {
  const someSquare: Square = { row: 2, column: 1 }

  const target = defineUnit({ name: 'テスト・作られた能力の対象', level: 1, bp: 1000, sp: 1000 })

  /**
   * 対象のユニットをエネルギーゾーンにフリーズして置く、作成された誘発型能力。
   *
   * 対象は engine から効果へ手渡される（`effect.ts` の `CreatedAbilityEffect`）。命令の対象に
   * できているかどうかが、置かれたかどうかで分かる。
   */
  const returnToEnergy = (controller: Player): CreatedAbility => ({
    ability: {
      kind: '作成された誘発型能力',
      trigger: 'あなたのターンの終わり',
      effect: function* (_duel, affected) {
        yield* placeInZone(affected, 'エネルギーゾーン', 'フリーズ')
      },
    },
    controller,
    affecting: '対象',
  })

  /**
   * そのプレイヤーが支配する能力が作られていて、対象がスクエアにいる盤面。
   *
   * 作るところは効果の側の仕事（`resolve.test.ts`）なので、ここでは盤面に直接置く。
   */
  function withCreated(state: DuelState, controller: Player): DuelState {
    const unit = instantiate({ id: '対象', card: target, owner: controller })
    return { ...putOnSquare(state, someSquare, unit), createdAbilities: [returnToEnergy(controller)] }
  }

  /** そのターンのリカバリーフェイズが始まった盤面。 */
  function recoveryPhaseOfTurn(state: DuelState, number: number): DuelState {
    let current = turnNumbered(state, number)
    while (current.turn.phase !== 'リカバリーフェイズ') current = endPhase(current)
    return current
  }

  /** 第 1 ターン（先攻のターン）に、後攻が支配する能力が作られた盤面。 */
  const created = () => withCreated(startedDuel(), '後攻')

  it('相手のターンの終わりでは誘発しない', () => {
    const endOfFirstTurn = pass(pass(recoveryPhaseOfTurn(created(), 1)))

    expect(endOfFirstTurn.bank).toEqual([])
    expect(endOfFirstTurn.createdAbilities).toHaveLength(1)
  })

  it('次のあなたのターンの終わりに誘発する', () => {
    const endOfSecondTurn = pass(pass(recoveryPhaseOfTurn(created(), 2)))

    expect(endOfSecondTurn.bank).toHaveLength(1)
    // 誘発と同時に盤面から取り除かれる。これが「1 度だけ」（同 4）にあたる。
    expect(endOfSecondTurn.createdAbilities).toEqual([])
  })

  it('解決されると、対象のユニットが効果の命令を受ける', () => {
    const resolved = pass(pass(pass(pass(recoveryPhaseOfTurn(created(), 2)))))

    expect(cardsOn(resolved, someSquare)).toEqual([])
    expect(cardsIn(resolved, '後攻', 'エネルギーゾーン').map((card) => card.id)).toEqual(['対象'])
    expect(cardsIn(resolved, '後攻', 'エネルギーゾーン')[0]?.orientation).toBe('フリーズ')
  })

  // 総合ルール 第4部 第3章 4-1
  it('対象がスクエアを離れていれば、そもそも誘発しない', () => {
    // 消滅させずに対象だけを取り除いた盤面。消滅（同 4-1）が働かなかった場合にどうなるかを
    // 見るためのもので、通常の経路ではこの形にはならない。
    const withoutTarget = (state: DuelState): DuelState => ({
      ...state,
      squares: state.squares.map((cards) => cards.filter((card) => card.id !== '対象')),
    })

    const endOfSecondTurn = pass(pass(withoutTarget(recoveryPhaseOfTurn(created(), 2))))

    expect(endOfSecondTurn.bank).toEqual([])
  })
})

/**
 * 総合ルール 第5部 第2章 2「１度でも優先権をパスすると……起動する権利を失います」（ADR-0006）。
 *
 * 権利を失わせるのは `courage.ts` の `loseCourageRightOnPass` だが、それを呼ぶのが優先権の
 * 放棄だけであることは、ここでしか確かめられない。
 */
describe('優先権の放棄と「勇気」の起動条件', () => {
  const placedCard = defineUnit({ name: 'テスト・置かれたユニット', level: 1, bp: 1000, sp: 1000 })

  /** そのプレイヤーの起動条件が満たされている、第 1 ターンの盤面。 */
  function withCourageCondition(player: Player): DuelState {
    const placed: UnitOnSquare = {
      id: '置かれたユニット',
      square: { row: 1, column: 1 },
      card: placedCard,
      controller: player === '先攻' ? '後攻' : '先攻',
    }
    const met: CourageConditionMet = { player, placed, satisfied: ['手札の勇気'] }
    return { ...startedDuel(), courageConditionsMet: [met] }
  }

  // 第 1 ターンの始めに優先権を持っているのは非アクティブプレイヤー（後攻）である。
  it('優先権をパスしたプレイヤーは起動条件を失う', () => {
    expect(pass(withCourageCondition('後攻')).courageConditionsMet).toEqual([])
  })

  it('相手が優先権をパスしても、自分の起動条件は残る', () => {
    expect(pass(withCourageCondition('先攻')).courageConditionsMet).toHaveLength(1)
  })
})
