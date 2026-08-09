import { describe, expect, it } from 'vitest'
// 手札やトラップゾーンを組み立てるためだけに `putInZone` を使う。engine の中からゾーンを
// 差し替えるための関数であり、公開する API ではない。
import { putInZone } from './duel.js'
import {
  cardsOn,
  defineTrap,
  defineUnit,
  emptyDuelState,
  instantiate,
  moveUnit,
  passPriority,
  putOnSquare,
  triggeredAbility,
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
  let current = emptyDuelState()
  while (current.turn.phase !== phase) current = passPriority(current, chooseFirst)
  return passPriority(current, chooseFirst)
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

    const after = stateOf(moveUnit(state, 'ユニット', centerSquare))

    expect(cardsOn(after, homeSquare)).toEqual([])
    expect(cardsOn(after, centerSquare)[0]?.id).toBe('ユニット')
  })

  // 総合ルール 第4部 第8章 3
  it('リリース状態で置かれる', () => {
    const state = putOnSquare(mainPhase(), homeSquare, unit('ユニット'))

    const after = stateOf(moveUnit(state, 'ユニット', centerSquare))

    expect(cardsOn(after, centerSquare)[0]?.orientation).toBe('リリース')
  })

  // 総合ルール 第4部 第6章 2-5
  it('解決した後、非アクティブプレイヤーが優先権を獲得する', () => {
    const state = putOnSquare(mainPhase(), homeSquare, unit('ユニット'))

    expect(stateOf(moveUnit(state, 'ユニット', centerSquare)).turn.priority).toBe('後攻')
  })

  it('ムーブアイコンの無い方向へは移動できない', () => {
    const state = putOnSquare(mainPhase(), homeSquare, unit('ユニット', nonMover))

    expect(violationOf(moveUnit(state, 'ユニット', centerSquare))).toBe('移動先として指定できないスクエア')
  })

  it('隣接していないスクエアへは移動できない', () => {
    const state = putOnSquare(mainPhase(), homeSquare, unit('ユニット'))

    expect(violationOf(moveUnit(state, 'ユニット', farSquare))).toBe('移動先として指定できないスクエア')
  })

  it('フリーズ状態のユニットは移動できない', () => {
    const frozen = instantiate({ id: 'ユニット', card: omniMover, owner: '先攻', orientation: 'フリーズ' })
    const state = putOnSquare(mainPhase(), homeSquare, frozen)

    expect(violationOf(moveUnit(state, 'ユニット', centerSquare))).toBe('移動できるユニットではない')
  })

  it('相手が支配するユニットは移動できない', () => {
    const state = putOnSquare(mainPhase(), homeSquare, unit('相手のユニット', omniMover, '後攻'))

    expect(violationOf(moveUnit(state, '相手のユニット', centerSquare))).toBe('移動できるユニットではない')
  })

  it('スクエアにないユニットは移動できない', () => {
    expect(violationOf(moveUnit(mainPhase(), 'いない', centerSquare))).toBe('移動できるユニットではない')
  })

  it('メインフェイズでなければ行えない', () => {
    const state = putOnSquare(phaseReadyToAct('エネルギーフェイズ'), homeSquare, unit('ユニット'))

    expect(violationOf(moveUnit(state, 'ユニット', centerSquare))).toBe('行える時ではない')
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

    expect(violationOf(moveUnit(state, 'ユニット', centerSquare))).toBe('移動先として指定できないスクエア')
  })

  it('相手が支配するユニットのあるスクエアへは移動できる', () => {
    const state = putOnSquare(
      putOnSquare(mainPhase(), homeSquare, unit('ユニット')),
      centerSquare,
      unit('敵', omniMover, '後攻'),
    )

    const after = stateOf(moveUnit(state, 'ユニット', centerSquare))

    expect(cardsOn(after, centerSquare).map((each) => each.id)).toContain('ユニット')
  })
})

// 総合ルール 第2部 第21章 8-6（ADR-0006）
describe('移動してもゾーン移動を伴わない', () => {
  it('移動の前後で同じカードインスタンスとして扱われる', () => {
    const mover = unit('ユニット')
    const state = putOnSquare(mainPhase(), homeSquare, mover)

    const after = stateOf(moveUnit(state, 'ユニット', centerSquare))

    expect(cardsOn(after, centerSquare)[0]?.card).toBe(mover.card)
  })
})

// 総合ルール 第4部 第6章 2-5（ADR-0006）
describe('移動が起動された時', () => {
  it('移動したそのユニット自身の能力が誘発する', () => {
    const state = putOnSquare(mainPhase(), homeSquare, unit('ユニット', movingUnit))

    const after = stateOf(moveUnit(state, 'ユニット', centerSquare))

    expect(after.bank.map((banked) => banked.source)).toEqual(['ユニット'])
  })

  it('他のユニットの「移動が起動された時」の能力は誘発しない', () => {
    const state = putOnSquare(
      putOnSquare(mainPhase(), homeSquare, unit('動くユニット')),
      homeLeftSquare,
      unit('見てるだけ', movingUnit),
    )

    const after = stateOf(moveUnit(state, '動くユニット', centerSquare))

    expect(after.bank).toEqual([])
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

    const after = stateOf(moveUnit(state, 'ユニット', centerSquare))

    expect(after.trapRights).toEqual(['トラップ'])
  })
})
