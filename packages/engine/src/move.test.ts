import { describe, expect, it } from 'vitest'
// 手札やトラップゾーンを組み立てるためだけに `putInZone` を使う。engine の中からゾーンを
// 差し替えるための関数であり、公開する API ではない。
import { putInZone } from './duel.js'
import {
  PLAYERS,
  cardsIn,
  cardsOn,
  courage,
  defineTrap,
  defineUnit,
  emptyDuelState,
  indexOfSquare,
  instantiate,
  moveCosting,
  moveUnit,
  passPriority,
  putOnSquare,
  triggeredAbility,
  trust,
} from './index.js'
import type { ActionOutcome, CardInstance, Chooser, DuelState, Phase, Player, Square, UnitCard } from './index.js'

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
      card: defineTrap({ name: 'テスト・侵入トラップ', level: 1, triggerIcon: [centerSquare] }),
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
