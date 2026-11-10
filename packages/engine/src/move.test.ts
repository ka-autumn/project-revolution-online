import { describe, expect, it, vi } from 'vitest'
// 手札やトラップゾーンを組み立てるためだけに `putInZone` を使う。engine の中からゾーンを
// 差し替えるための関数であり、公開する API ではない。
import { moveToSquare, moveToZoneWithoutTriggers, putInZone } from './duel.js'
import {
  PLAYERS,
  cardsIn,
  cardsOn,
  choose,
  courage,
  defineTrap,
  defineUnit,
  emptyDuelState,
  indexOfSquare,
  instantiate,
  legalActions,
  moveCosting,
  movePreventing,
  moveUnit,
  passPriority,
  placeOnSquare,
  putOnSquare,
  resolveEffect,
  squaresAdjacent,
  triggeredAbility,
  trust,
} from './index.js'
import type { ActionOutcome, CardInstance, Chooser, DuelState, Effect, Phase, Player, Square, UnitCard } from './index.js'

/** 選択を求められたら常に最初の候補を選ぶ。どれを選ぶかを問わないテストで使う。 */
const chooseFirst: Chooser = (candidates) => candidates[0]

/** 上下左右すべてのムーブアイコンを持つレベル 1 の赤いユニット。 */
const omniMover = defineUnit({
  name: 'テスト・全方位移動ユニット',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  moveIcon: ['上', '下', '左', '右'],
})

/** ムーブアイコンを持たないレベル 1 の赤いユニット。 */
const nonMover = defineUnit({ name: 'テスト・移動不可ユニット', level: 1, colors: ['赤'], bp: 1000, sp: 1000 })

/** 「移動が起動された時」に誘発する能力を持つ、上向きのムーブアイコンを持つユニット。 */
const movingUnit = defineUnit({
  name: 'テスト・移動誘発ユニット',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  moveIcon: ['上'],
  abilities: [triggeredAbility('移動が起動された時', function* () {})],
})

/** 先攻から見た味方エリアのスクエアと、その隣の左右・奥のスクエア（`areaOf` の決めた向き）。 */
const homeSquare: Square = { row: 0, column: 1 }
const homeLeftSquare: Square = { row: 0, column: 0 }
const centerSquare: Square = { row: 1, column: 1 }
const farSquare: Square = { row: 2, column: 1 }

function unit(id: string, card: UnitCard = omniMover, owner: Player = '先攻'): CardInstance {
  return instantiate({ id, card, owner })
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
        Array.from({ length: 10 }, (_, index) => unit(`${player}の山札${index}`, omniMover, player)),
      ),
    emptyDuelState(),
  )
}

/** アクティブプレイヤー（先攻）が行動できる、第 1 ターンのメインフェイズの盤面。 */
function mainPhase(): DuelState {
  return phaseReadyToAct('メインフェイズ')
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

// 総合ルール 第4部 第6章 2（ADR-0006）
describe('ユニットの移動', () => {
  it('ムーブアイコンの方向に隣接するスクエアへ移動できる', () => {
    const state = putOnSquare(mainPhase(), homeSquare, unit('ユニット'))

    const after = stateOf(moveUnit(state, 'ユニット', centerSquare, chooseFirst))

    expect(cardsOn(after, homeSquare)).toEqual([])
    expect(cardsOn(after, centerSquare)[0]?.id).toBe('ユニット')
  })

  // 総合ルール 第4部 第8章 3
  it('リリース状態で置かれる', () => {
    const state = putOnSquare(mainPhase(), homeSquare, unit('ユニット'))

    const after = stateOf(moveUnit(state, 'ユニット', centerSquare, chooseFirst))

    expect(cardsOn(after, centerSquare)[0]?.orientation).toBe('リリース')
  })

  // 総合ルール 第4部 第6章 2-5
  it('解決した後、非アクティブプレイヤーが優先権を獲得する', () => {
    const state = putOnSquare(mainPhase(), homeSquare, unit('ユニット'))

    expect(stateOf(moveUnit(state, 'ユニット', centerSquare, chooseFirst)).turn.priority).toBe('後攻')
  })

  it('ムーブアイコンの無い方向へは移動できない', () => {
    const state = putOnSquare(mainPhase(), homeSquare, unit('ユニット', nonMover))

    expect(violationOf(moveUnit(state, 'ユニット', centerSquare, chooseFirst))).toBe('移動先として指定できないスクエア')
  })

  it('隣接していないスクエアへは移動できない', () => {
    const state = putOnSquare(mainPhase(), homeSquare, unit('ユニット'))

    expect(violationOf(moveUnit(state, 'ユニット', farSquare, chooseFirst))).toBe('移動先として指定できないスクエア')
  })

  it('フリーズ状態のユニットは移動できない', () => {
    const frozen = instantiate({ id: 'ユニット', card: omniMover, owner: '先攻', orientation: 'フリーズ' })
    const state = putOnSquare(mainPhase(), homeSquare, frozen)

    expect(violationOf(moveUnit(state, 'ユニット', centerSquare, chooseFirst))).toBe('移動できるユニットではない')
  })

  it('相手が支配するユニットは移動できない', () => {
    const state = putOnSquare(mainPhase(), homeSquare, unit('相手のユニット', omniMover, '後攻'))

    expect(violationOf(moveUnit(state, '相手のユニット', centerSquare, chooseFirst))).toBe('移動できるユニットではない')
  })

  it('スクエアにないユニットは移動できない', () => {
    expect(violationOf(moveUnit(mainPhase(), 'いない', centerSquare, chooseFirst))).toBe('移動できるユニットではない')
  })

  it('メインフェイズでなければ行えない', () => {
    const state = putOnSquare(phaseReadyToAct('エネルギーフェイズ'), homeSquare, unit('ユニット'))

    expect(violationOf(moveUnit(state, 'ユニット', centerSquare, chooseFirst))).toBe('行える時ではない')
  })
})

// 総合ルール 第4部 第6章 2-1（ADR-0006）
describe('自分が支配するユニットのあるスクエアへの移動', () => {
  it('移動できない', () => {
    const state = putOnSquare(
      putOnSquare(mainPhase(), homeSquare, unit('ユニット')),
      centerSquare,
      unit('先客'),
    )

    expect(violationOf(moveUnit(state, 'ユニット', centerSquare, chooseFirst))).toBe('移動先として指定できないスクエア')
  })

  it('相手が支配するユニットのあるスクエアへは移動できる', () => {
    const state = putOnSquare(
      putOnSquare(mainPhase(), homeSquare, unit('ユニット')),
      centerSquare,
      unit('敵', omniMover, '後攻'),
    )

    const after = stateOf(moveUnit(state, 'ユニット', centerSquare, chooseFirst))

    expect(cardsOn(after, centerSquare).map((each) => each.id)).toContain('ユニット')
  })
})

// 総合ルール 第2部 第21章 8-6（ADR-0006）
describe('移動してもゾーン移動を伴わない', () => {
  it('移動の前後で同じカードインスタンスとして扱われる', () => {
    const mover = unit('ユニット')
    const state = putOnSquare(mainPhase(), homeSquare, mover)

    const after = stateOf(moveUnit(state, 'ユニット', centerSquare, chooseFirst))

    expect(cardsOn(after, centerSquare)[0]?.card).toBe(mover.card)
  })
})

// 総合ルール 第4部 第6章 2-5（ADR-0006）
describe('移動が起動された時', () => {
  it('移動したそのユニット自身の能力が誘発する', () => {
    const state = putOnSquare(mainPhase(), homeSquare, unit('ユニット', movingUnit))

    const after = stateOf(moveUnit(state, 'ユニット', centerSquare, chooseFirst))

    expect(after.bank.map((banked) => banked.source)).toEqual(['ユニット'])
  })

  it('他のユニットの「移動が起動された時」の能力は誘発しない', () => {
    const state = putOnSquare(
      putOnSquare(mainPhase(), homeSquare, unit('動くユニット')),
      homeLeftSquare,
      unit('見てるだけ', movingUnit),
    )

    const after = stateOf(moveUnit(state, '動くユニット', centerSquare, chooseFirst))

    expect(after.bank).toEqual([])
  })
})

// 総合ルール 第5部 第4章（ADR-0006）
describe('「信頼」による移動の制限', () => {
  /** 「信頼」を持つユニット。自分では動かないので、ムーブアイコンは持たせていない。 */
  const trusted = defineUnit({
    name: 'テスト・信頼ユニット',
    level: 1,
    colors: ['赤'],
    bp: 1000,
    sp: 1000,
    abilities: [trust],
  })

  /** `centerSquare` の左に接するスクエア。 */
  const centerLeftSquare: Square = { row: 1, column: 0 }

  /** 移動しようとしているユニットと、指定したスクエアに置いた「信頼」持ちのいる盤面。 */
  function facing(square: Square, owner: Player): DuelState {
    return putOnSquare(putOnSquare(mainPhase(), homeSquare, unit('ユニット')), square, unit('信頼持ち', trusted, owner))
  }

  // 総合ルール 第5部 第4章 2
  it('相手の「信頼」の左右に接するスクエアへは移動できない', () => {
    expect(violationOf(moveUnit(facing(centerLeftSquare, '後攻'), 'ユニット', centerSquare, chooseFirst))).toBe(
      '「信頼」によって移動できない',
    )
  })

  // 総合ルール 第5部 第4章 2。制限されるのは左右に接するスクエアだけである。
  it('相手の「信頼」の上下に接するスクエアへは移動できる', () => {
    const after = stateOf(moveUnit(facing(farSquare, '後攻'), 'ユニット', centerSquare, chooseFirst))

    expect(cardsOn(after, centerSquare)[0]?.id).toBe('ユニット')
  })

  // 総合ルール 第5部 第4章 2。制限されるのは「相手」だけである。
  it('自分の「信頼」は自分のユニットの移動を妨げない', () => {
    const after = stateOf(moveUnit(facing(centerLeftSquare, '先攻'), 'ユニット', centerSquare, chooseFirst))

    expect(cardsOn(after, centerSquare)[0]?.id).toBe('ユニット')
  })
})

// 総合ルール 第2部 第20章 3-6（ADR-0006）
describe('移動による侵入', () => {
  it('相手のユニットがトリガーアイコンのスクエアへ移動すると、発動する権利を得る', () => {
    const trap = instantiate({
      id: 'トラップ',
      card: defineTrap({ name: 'テスト・侵入トラップ', level: 1, triggerIcon: { kind: '侵入', squares: [centerSquare] } }),
      owner: '後攻',
    })
    const state = putInZone(putOnSquare(mainPhase(), homeSquare, unit('ユニット')), '後攻', 'トラップゾーン', [trap])

    const after = stateOf(moveUnit(state, 'ユニット', centerSquare, chooseFirst))

    expect(after.trapConditionsMet.map((met) => met.trap)).toEqual(['トラップ'])
  })

  /**
   * 総合ルール 第5部 第2章 2。同じできごとで「勇気」の起動条件も満たされる。移動先が相手から
   * 見て中央エリアなので、相手が起動する権利を得る。起動条件にはエネルギーの部分も含まれる
   * ので、相手の手札に「勇気」を置き、エネルギーも用意しておく。
   */
  it('相手のユニットが中央エリアへ移動すると、相手が「勇気」の起動条件を満たす', () => {
    const courageCard = defineUnit({
      name: 'テスト・勇気持ち',
      level: 1,
      colors: ['赤'],
      bp: 1000,
      sp: 1000,
      abilities: [courage(4000)],
    })
    const held = putInZone(mainPhase(), '後攻', '手札', [unit('相手の勇気', courageCard, '後攻')])
    const energized = putInZone(held, '後攻', 'エネルギーゾーン', [unit('相手のエネルギー', omniMover, '後攻')])
    const state = putOnSquare(energized, homeSquare, unit('ユニット'))

    const after = stateOf(moveUnit(state, 'ユニット', centerSquare, chooseFirst))

    expect(after.courageConditionsMet.map((met) => met.player)).toEqual(['後攻'])
    expect(after.courageConditionsMet[0]?.placed.square).toEqual(centerSquare)
    expect(after.courageConditionsMet[0]?.satisfied).toEqual(['相手の勇気'])
  })
})

// 総合ルール 第4部 第6章 2-2・2-3（ADR-0006）
describe('移動に課される追加コスト', () => {
  /**
   * 「敵が味方のいるスクエアに移動する時、相手は自分のエネルギーを 2 枚選びフリーズする。
   * そうできないなら、移動できない」という常在型能力を持つユニット。
   */
  const taxing = defineUnit({
    name: 'テスト・移動に課税',
    level: 1,
    colors: ['赤'],
    bp: 1000,
    sp: 1000,
    abilities: [
      moveCosting((duel, occasion) => {
        if (!duel.enemies().some((enemy) => enemy.id === occasion.unit.id)) return undefined
        const defended = duel
          .allies()
          .some((ally) => indexOfSquare(ally.square) === indexOfSquare(occasion.destination))
        return defended ? { energiesFrozen: 2 } : undefined
      }),
    ],
  })

  /**
   * 先攻のユニットが味方エリアにいて、後攻が中央エリアに課税するユニットを置いた盤面。
   * 先攻のエネルギーゾーンには、渡した枚数のリリース状態のカードがある。
   */
  function facingTax(energies: number, defended: Square = centerSquare): DuelState {
    const board = putOnSquare(mainPhase(), homeSquare, unit('ユニット'))
    const withDefender = putOnSquare(board, defended, unit('課税するユニット', taxing, '後攻'))
    return putInZone(
      withDefender,
      '先攻',
      'エネルギーゾーン',
      Array.from({ length: energies }, (_, index) => unit(`エネ${index}`)),
    )
  }

  it('コストを支払えば移動できる', () => {
    const after = stateOf(moveUnit(facingTax(2), 'ユニット', centerSquare, chooseFirst))

    expect(cardsOn(after, centerSquare).map((each) => each.id)).toContain('ユニット')
  })

  it('支払ったぶんのエネルギーがフリーズされる', () => {
    const after = stateOf(moveUnit(facingTax(3), 'ユニット', centerSquare, chooseFirst))

    const frozen = cardsIn(after, '先攻', 'エネルギーゾーン').filter((each) => each.orientation === 'フリーズ')
    expect(frozen.length).toBe(2)
  })

  // 「できない」という効果が優先される（総合ルール 第1部 第1章 2）。
  it('コストを支払えなければ移動できない', () => {
    expect(violationOf(moveUnit(facingTax(1), 'ユニット', centerSquare, chooseFirst))).toBe('コストを支払えない')
  })

  it('支払えなかった時、途中まで支払ったエネルギーは残らない', () => {
    const state = facingTax(1)

    moveUnit(state, 'ユニット', centerSquare, chooseFirst)

    expect(cardsIn(state, '先攻', 'エネルギーゾーン')[0]?.orientation).toBe('リリース')
  })

  // 「味方のいるスクエアに移動する時」なので、味方のいないスクエアへの移動には課されない。
  it('条件を満たさない移動には課されない', () => {
    const after = stateOf(moveUnit(facingTax(0, homeLeftSquare), 'ユニット', centerSquare, chooseFirst))

    expect(cardsOn(after, centerSquare).map((each) => each.id)).toContain('ユニット')
  })
})

// 総合ルール 第3部 第8章 2-5（ADR-0006、ADR-0068）
describe('移動を妨げる常在型能力', () => {
  /** 「隣にいる敵と味方は移動できない」というテキストの常在型能力を持つ、自分では動かないユニット。 */
  const guard = defineUnit({
    name: 'テスト・隣を止めるユニット',
    level: 1,
    colors: ['赤'],
    bp: 1000,
    sp: 1000,
    abilities: [
      movePreventing((duel, occasion) => {
        const self = duel.self()
        if (self === undefined || self.id === occasion.unit.id) return false
        return squaresAdjacent(self.square).some((beside) => indexOfSquare(beside) === indexOfSquare(occasion.unit.square))
      }),
    ],
  })

  /** 「このカードは１ターンに１回しか移動できない」というテキストの常在型能力を持つユニット。 */
  const tired = defineUnit({
    name: 'テスト・1回しか移動できないユニット',
    level: 1,
    colors: ['赤'],
    bp: 1000,
    sp: 1000,
    moveIcon: ['上', '下', '左', '右'],
    abilities: [
      movePreventing((duel, occasion) => {
        const self = duel.self()
        return self !== undefined && self.id === occasion.unit.id && duel.movesThisTurn(occasion.unit) >= 1
      }),
    ],
  })

  /** `homeSquare` の左下の、斜めに接するスクエア。 */
  const centerLeftSquare: Square = { row: 1, column: 0 }

  /** 動かしたいユニットが `homeSquare` に、止めるユニットが指定したスクエアにいる盤面。 */
  function guarded(guardSquare: Square, guardOwner: Player = '後攻'): DuelState {
    return putOnSquare(
      putOnSquare(mainPhase(), homeSquare, unit('ユニット')),
      guardSquare,
      unit('止めるユニット', guard, guardOwner),
    )
  }

  // 総合ルール 第3部 第8章 2-5。隣にいる敵も味方も止める。
  it('隣にいる味方は移動できない', () => {
    expect(violationOf(moveUnit(guarded(homeLeftSquare, '先攻'), 'ユニット', centerSquare, chooseFirst))).toBe(
      '能力によって移動できない',
    )
  })

  it('隣にいる敵は移動できない', () => {
    expect(violationOf(moveUnit(guarded(homeLeftSquare, '後攻'), 'ユニット', centerSquare, chooseFirst))).toBe(
      '能力によって移動できない',
    )
  })

  // 総合ルール 第2部 第21章 8-7。斜めに接するスクエアは「隣」ではない。
  it('斜めに接するユニットは移動できる', () => {
    const after = stateOf(moveUnit(guarded(centerLeftSquare), 'ユニット', centerSquare, chooseFirst))

    expect(cardsOn(after, centerSquare)[0]?.id).toBe('ユニット')
  })

  it('止めるユニット自身は移動できる', () => {
    const state = putOnSquare(mainPhase(), homeSquare, unit('止めるユニット', { ...guard, moveIcon: ['上'] } as UnitCard, '先攻'))

    expect(cardsOn(stateOf(moveUnit(state, '止めるユニット', centerSquare, chooseFirst)), centerSquare)).toHaveLength(1)
  })

  it('止めるユニットがスクエアを離れると、隣にいたユニットはまた移動できる', () => {
    const left = moveToZoneWithoutTriggers(guarded(homeLeftSquare), '止めるユニット', '手札')

    expect(cardsOn(stateOf(moveUnit(left, 'ユニット', centerSquare, chooseFirst)), centerSquare)).toHaveLength(1)
  })

  it('妨げられた移動は、移動の候補に含まれない', () => {
    const moves = legalActions(guarded(homeLeftSquare)).filter((action) => action.kind === 'ユニットを移動する')

    expect(moves).toEqual([])
  })

  // 総合ルール 第3部 第8章 2-5。効果でスクエアからスクエアへ置くことは移動ではない。
  it('効果でスクエアからスクエアへ置かれることは妨げられない', () => {
    const placed = moveToSquare(guarded(homeLeftSquare), 'ユニット', centerSquare, { controller: '先攻', orientation: 'リリース' })

    expect(cardsOn(placed, centerSquare)[0]?.id).toBe('ユニット')
    expect(placed.movedThisTurn).toEqual([])
  })

  // 総合ルール 第3部 第8章 2-5。効果の命令でスクエアからスクエアへ置く経路を通す。
  describe('効果でスクエアからスクエアへ置く', () => {
    const placeAlly = (square: Square): Effect =>
      function* (duel) {
        const ally = yield* choose(duel.allies())
        if (ally !== undefined) yield* placeOnSquare(ally, square, 'リリース')
      }
    const resolve = (state: DuelState, effect: Effect) =>
      resolveEffect(state, effect, { controller: '先攻', via: 'プレイ', chooser: chooseFirst })

    it('隣を止める能力があっても置けて、移動の記録は増えない', () => {
      const resolved = resolve(guarded(homeLeftSquare), placeAlly(centerSquare))

      expect(cardsOn(resolved, centerSquare).map((each) => each.id)).toEqual(['ユニット'])
      expect(resolved.movedThisTurn).toEqual([])
    })

    it('1 ターンに 1 回しか移動できないユニットは、置き直された後も 1 回移動できる', () => {
      const board = putOnSquare(mainPhase(), homeSquare, unit('疲れたユニット', tired))
      const resolved = resolve(board, placeAlly(centerSquare))

      expect(resolved.movedThisTurn).toEqual([])
      expect(cardsOn(stateOf(moveUnit(resolved, '疲れたユニット', farSquare, chooseFirst)), farSquare)).toHaveLength(1)
    })
  })

  // 移動を妨げる判定は、追加コストの支払いより前に行う（ADR-0068）。
  it('妨げられる移動では、追加コストのための選択を求めない', () => {
    const both = defineUnit({
      name: 'テスト・コストを課して止める',
      level: 1,
      colors: ['赤'],
      bp: 1000,
      sp: 1000,
      abilities: [moveCosting(() => ({ energiesFrozen: 1 })), movePreventing(() => true)],
    })
    const board = putOnSquare(putOnSquare(mainPhase(), homeSquare, unit('ユニット')), farSquare, unit('コストを課して止める', both, '後攻'))
    const state = putInZone(board, '先攻', 'エネルギーゾーン', [unit('エネ')])
    const chooser = vi.fn<Chooser>(chooseFirst)

    expect(violationOf(moveUnit(state, 'ユニット', centerSquare, chooser))).toBe('能力によって移動できない')
    expect(chooser).not.toHaveBeenCalled()
  })

  describe('1 ターンに 1 回しか移動できない', () => {
    function withTired(): DuelState {
      return putOnSquare(mainPhase(), homeSquare, unit('疲れたユニット', tired))
    }

    /** 移動した後は非アクティブプレイヤーに優先権が移る（総合ルール 第4部 第6章 2-5）ので、放棄させて戻す。 */
    function movedOnce(): DuelState {
      return passPriority(stateOf(moveUnit(withTired(), '疲れたユニット', centerSquare, chooseFirst)), chooseFirst)
    }

    it('1 回目の移動はできて、同じターンの 2 回目は移動できない', () => {
      const first = movedOnce()
      // 移動したユニットはリリース状態で置かれるので、2 回目を妨げているのは能力だけである。
      expect(first.movedThisTurn).toEqual(['疲れたユニット'])
      expect(violationOf(moveUnit(first, '疲れたユニット', farSquare, chooseFirst))).toBe('能力によって移動できない')
    })

    it('次のターンには、また移動できる', () => {
      let current = movedOnce()
      while (current.turn.number < 3 || current.turn.phase !== 'メインフェイズ') {
        current = passPriority(current, chooseFirst)
      }
      current = passPriority(current, chooseFirst)

      expect(current.movedThisTurn).toEqual([])
      expect(cardsOn(stateOf(moveUnit(current, '疲れたユニット', farSquare, chooseFirst)), farSquare)).toHaveLength(1)
    })

    // 総合ルール 第2部 第21章 1-4。ゾーンを移ったカードは新しいカードとして扱われる。
    it('手札に戻って同じターンに出し直されたら、もう 1 回移動できる', () => {
      const first = movedOnce()
      const back = moveToZoneWithoutTriggers(first, '疲れたユニット', '手札')
      const replayed = moveToSquare(back, '疲れたユニット', homeSquare, { controller: '先攻', orientation: 'リリース' })

      expect(replayed.movedThisTurn).toEqual([])
      expect(cardsOn(stateOf(moveUnit(replayed, '疲れたユニット', centerSquare, chooseFirst)), centerSquare)).toHaveLength(1)
    })

    it('スクエアからスクエアへ置かれても、移動した記録は残る', () => {
      const first = movedOnce()
      const placed = moveToSquare(first, '疲れたユニット', homeSquare, { controller: '先攻', orientation: 'リリース' })

      expect(placed.movedThisTurn).toEqual(['疲れたユニット'])
    })
  })
})
