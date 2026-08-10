import { describe, expect, it } from 'vitest'
// 手札やトラップゾーンを組み立てるためだけに `putInZone` を使う。engine の中からゾーンを
// 差し替えるための関数であり、公開する API ではない。
import { putInZone } from './duel.js'
import {
  PLAYERS,
  applyMove,
  cardsIn,
  cardsOn,
  defineTrap,
  defineUnit,
  emptyDuelState,
  hasEnded,
  instantiate,
  legalMoves,
  passPriority,
  putOnSquare,
} from './index.js'
import type { Chooser, DuelState, Phase, Square } from './index.js'

/** 選択を求められたら常に最初の候補を選ぶ。どれを選ぶかを問わないテストで使う。 */
const chooseFirst: Chooser = (candidates) => candidates[0]

/** レベル 0 の無色のユニット。 */
const plainUnit = defineUnit({ name: 'テスト・無色ユニット', level: 0, bp: 100, sp: 100 })

/** 上下左右すべてのムーブアイコンを持つレベル 0 のユニット。 */
const moverUnit = defineUnit({ name: 'テスト・移動ユニット', level: 0, bp: 100, sp: 100, moveIcon: ['上', '下', '左', '右'] })

/** 先攻から見た味方エリア・中央エリア・敵エリアのスクエア（`areaOf` の決めた向き）。 */
const homeSquare: Square = { row: 0, column: 1 }
const centerSquare: Square = { row: 1, column: 1 }
const enemySquare: Square = { row: 2, column: 1 }

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
          instantiate({ id: `${player}の山札${index}`, card: plainUnit, owner: player }),
        ),
      ),
    emptyDuelState(),
  )
}

/** そのフェイズで、アクティブプレイヤー（先攻）に優先権が移ったところの盤面。 */
function phaseReadyToAct(phase: Phase): DuelState {
  let current = stockedDuelState()
  while (current.turn.phase !== phase) current = passPriority(current, chooseFirst)
  return passPriority(current, chooseFirst)
}

/** アクティブプレイヤー（先攻）が行動できる、第 1 ターンのメインフェイズの盤面。 */
function mainPhase(): DuelState {
  return phaseReadyToAct('メインフェイズ')
}

const kindsOf = (moves: readonly { readonly kind: string }[]) => moves.map((move) => move.kind)

// ADR-0005: 合法手を列挙する機能は、AI のためではなくエンジンの必須機能になる。
describe('合法手の列挙', () => {
  it('他に行える行動が無くても、優先権の放棄は常に含まれる', () => {
    expect(kindsOf(legalMoves(mainPhase()))).toContain('優先権を放棄する')
  })

  it('デュエルが終了していれば何も無い', () => {
    const ended: DuelState = { ...mainPhase(), result: { kind: '勝利', winner: '先攻' } }

    expect(legalMoves(ended)).toEqual([])
  })

  it('エネルギーフェイズには、手札のカードをエネルギーゾーンに置く手が含まれる', () => {
    const state = putInZone(phaseReadyToAct('エネルギーフェイズ'), '先攻', '手札', [
      instantiate({ id: '手札', card: plainUnit, owner: '先攻' }),
    ])

    expect(legalMoves(state)).toContainEqual({ kind: 'エネルギーを置く', card: '手札' })
  })

  it('同じエネルギーフェイズにすでに置いていれば、もう含まれない', () => {
    const state = putInZone(phaseReadyToAct('エネルギーフェイズ'), '先攻', '手札', [
      instantiate({ id: '手札', card: plainUnit, owner: '先攻' }),
    ])
    const placed = applyMove(state, { kind: 'エネルギーを置く', card: '手札' }, chooseFirst)
    // 置いた時点で優先権が非アクティブプレイヤーに移っているので戻す。
    const back = passPriority(placed, chooseFirst)

    expect(kindsOf(legalMoves(back))).not.toContain('エネルギーを置く')
  })

  it('メインフェイズには、手札のユニットを自分のユニットが無いスクエアへプレイする手が含まれる', () => {
    const state = putInZone(mainPhase(), '先攻', '手札', [instantiate({ id: '手札', card: plainUnit, owner: '先攻' })])

    const moves = legalMoves(state)

    expect(moves).toContainEqual({ kind: 'カードをプレイする', declaration: { card: '手札', square: homeSquare } })
    expect(moves).toContainEqual({ kind: 'カードをプレイする', declaration: { card: '手札', square: centerSquare } })
    // 敵エリアのスクエアは指定できない（総合ルール 第2部 第20章 1-3）。
    expect(moves).not.toContainEqual({ kind: 'カードをプレイする', declaration: { card: '手札', square: enemySquare } })
  })

  it('手札のカードをトラップとしてプレイする手も含まれる', () => {
    const state = putInZone(mainPhase(), '先攻', '手札', [instantiate({ id: '手札', card: plainUnit, owner: '先攻' })])

    expect(legalMoves(state)).toContainEqual({ kind: 'トラップとしてプレイする', card: '手札' })
  })

  it('自分のトラップゾーンにあるカードを廃棄する手も含まれる', () => {
    const state = putInZone(mainPhase(), '先攻', 'トラップゾーン', [
      instantiate({ id: 'トラップ', card: plainUnit, owner: '先攻' }),
    ])

    expect(legalMoves(state)).toContainEqual({ kind: 'トラップを廃棄する', card: 'トラップ' })
  })

  it('ムーブアイコンの方向に隣接するスクエアへユニットを移動する手が含まれる', () => {
    const state = putOnSquare(mainPhase(), homeSquare, instantiate({ id: 'ユニット', card: moverUnit, owner: '先攻' }))

    const moves = legalMoves(state)

    expect(moves).toContainEqual({ kind: 'ユニットを移動する', unit: 'ユニット', destination: centerSquare })
    // ムーブアイコンの無い方向、または隣接しない方向へは移動できない。
    expect(moves).not.toContainEqual({ kind: 'ユニットを移動する', unit: 'ユニット', destination: enemySquare })
  })

  it('ムーブアイコンを持たないユニットには移動する手が含まれない', () => {
    const state = putOnSquare(mainPhase(), homeSquare, instantiate({ id: 'ユニット', card: plainUnit, owner: '先攻' }))

    expect(kindsOf(legalMoves(state))).not.toContain('ユニットを移動する')
  })

  it('中央エリア・敵エリアにある自分のリリース状態のユニットをスマッシュする手が含まれる', () => {
    const state = putOnSquare(
      phaseReadyToAct('スマッシュフェイズ'),
      centerSquare,
      instantiate({ id: 'ユニット', card: plainUnit, owner: '先攻' }),
    )

    expect(legalMoves(state)).toContainEqual({ kind: 'スマッシュする', unit: 'ユニット' })
  })

  it('発動する権利の無いトラップには発動する手が含まれない', () => {
    const trapCard = defineTrap({ name: 'テスト・トラップ', level: 0 })
    const state = putInZone(mainPhase(), '先攻', 'トラップゾーン', [
      instantiate({ id: 'トラップ', card: trapCard, owner: '先攻' }),
    ])

    expect(kindsOf(legalMoves(state))).not.toContain('トラップを発動する')
  })

  it('発動する権利があるトラップには発動する手が含まれる', () => {
    const trapCard = defineTrap({ name: 'テスト・トラップ', level: 0 })
    const state: DuelState = {
      ...putInZone(mainPhase(), '先攻', 'トラップゾーン', [instantiate({ id: 'トラップ', card: trapCard, owner: '先攻' })]),
      trapConditionsMet: ['トラップ'],
    }

    expect(legalMoves(state)).toContainEqual({ kind: 'トラップを発動する', card: 'トラップ' })
  })
})

// ADR-0005: 合法手を実際に適用する。
describe('合法手の適用', () => {
  it('その手を選んだ通りに盤面が変わる', () => {
    const state = putInZone(mainPhase(), '先攻', '手札', [instantiate({ id: '手札', card: plainUnit, owner: '先攻' })])

    const after = applyMove(state, { kind: 'カードをプレイする', declaration: { card: '手札', square: homeSquare } }, chooseFirst)

    expect(cardsOn(after, homeSquare).map((each) => each.id)).toEqual(['手札'])
    expect(cardsIn(after, '先攻', '手札')).toEqual([])
  })

  it('優先権を放棄する手はデュエルが終了していても例外にならない', () => {
    const ended: DuelState = { ...mainPhase(), result: { kind: '勝利', winner: '先攻' } }

    const after = applyMove(ended, { kind: '優先権を放棄する' }, chooseFirst)

    expect(hasEnded(after)).toBe(true)
  })
})
