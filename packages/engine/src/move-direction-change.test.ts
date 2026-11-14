import { describe, expect, it } from 'vitest'
// 手札やエネルギーゾーンを組み立てるためだけに `putInZone` を使う。engine の中からゾーンを
// 差し替えるための関数であり、公開する API ではない（`move.test.ts` と同じ）。
import { putInZone } from './duel.js'
import { continuousData } from './continuous.js'
import {
  PLAYERS,
  cardsOn,
  createContinuousEffect,
  defineUnit,
  emptyDuelState,
  instantiate,
  movePreventing,
  moveUnit,
  passPriority,
  perspectiveOf,
  putOnSquare,
  replacingMoveDirection,
  resolveEffect,
} from './index.js'
import type {
  ActionOutcome,
  CardId,
  Chooser,
  DuelState,
  Effect,
  MoveDirection,
  Player,
  ResolutionVia,
  Square,
  UnitCard,
} from './index.js'

// 総合ルール 第2部 第2章 2、第4部 第12章 5-2・5-4（ADR-0071）。移動方向の変更は、ムーブアイコンを
// 置き換える継続効果である。カードはすべてテスト用の架空のもの。

const chooseFirst: Chooser = (candidates) => candidates[0]
const VIA: ResolutionVia = '誘発'

/** 前・左・右に移動できるユニット。 */
const threeWay = defineUnit({
  name: 'テスト・三方向ユニット',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  moveIcon: ['上', '左', '右'],
})

/** ムーブアイコンを持たないユニット。 */
const stationary = defineUnit({ name: 'テスト・移動不可ユニット', level: 1, colors: ['赤'], bp: 1000, sp: 1000 })

const homeSquare: Square = { row: 0, column: 1 }
const forwardSquare: Square = { row: 1, column: 1 }
const leftSquare: Square = { row: 0, column: 0 }
const rightSquare: Square = { row: 0, column: 2 }

const unit = (id: CardId, card: UnitCard, owner: Player = '先攻') => instantiate({ id, card, owner })

function stocked(): DuelState {
  return PLAYERS.reduce(
    (state, player) =>
      putInZone(
        state,
        player,
        '山札',
        Array.from({ length: 10 }, (_, index) => unit(`${player}の山札${index}`, stationary, player)),
      ),
    emptyDuelState(),
  )
}

/** 先攻が行動できる、第 1 ターンのメインフェイズの盤面。 */
function mainPhase(): DuelState {
  let state = stocked()
  while (state.turn.phase !== 'メインフェイズ') state = passPriority(state, chooseFirst)
  return passPriority(state, chooseFirst)
}

const stateOf = (outcome: ActionOutcome): DuelState => {
  if (outcome.kind !== '行った') throw new Error(`行えなかった: ${outcome.violation}`)
  return outcome.state
}

const canMove = (state: DuelState, id: CardId, destination: Square): boolean =>
  moveUnit(state, id, destination, chooseFirst).kind === '行った'

/** 味方全員の移動方向を、ターンの終わりまで、その向きだけにする効果。 */
const allAlliesMoveTo = (...directions: readonly MoveDirection[]): Effect =>
  function* (duel) {
    yield* createContinuousEffect(
      'ターンの終わりまで',
      ...duel.allies().map((ally) => replacingMoveDirection(ally, directions)),
    )
  }

const resolved = (state: DuelState, effect: Effect): DuelState =>
  resolveEffect(state, effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

describe('移動方向の変更', () => {
  it('変更する前は、書かれたムーブアイコンのとおりに移動できる', () => {
    const state = putOnSquare(mainPhase(), homeSquare, unit('ユニット', threeWay))

    expect(canMove(state, 'ユニット', leftSquare)).toBe(true)
    expect(canMove(state, 'ユニット', rightSquare)).toBe(true)
    expect(canMove(state, 'ユニット', forwardSquare)).toBe(true)
  })

  it('前にだけ移動できるようになる。横へは移動できない', () => {
    const state = resolved(putOnSquare(mainPhase(), homeSquare, unit('ユニット', threeWay)), allAlliesMoveTo('上'))

    expect(canMove(state, 'ユニット', forwardSquare)).toBe(true)
    expect(canMove(state, 'ユニット', leftSquare)).toBe(false)
    expect(canMove(state, 'ユニット', rightSquare)).toBe(false)
  })

  it('ムーブアイコンを持たないユニットも、指定された方向に移動できるようになる', () => {
    const board = putOnSquare(mainPhase(), homeSquare, unit('ユニット', stationary))

    expect(canMove(board, 'ユニット', forwardSquare)).toBe(false)
    const state = resolved(board, allAlliesMoveTo('上'))
    expect(canMove(state, 'ユニット', forwardSquare)).toBe(true)
    expect(cardsOn(stateOf(moveUnit(state, 'ユニット', forwardSquare, chooseFirst)), forwardSquare)[0]?.id).toBe('ユニット')
  })

  it('適用した後のデータの移動方向が変更される。書かれたカードは変更されない', () => {
    const state = resolved(putOnSquare(mainPhase(), homeSquare, unit('ユニット', threeWay)), allAlliesMoveTo('上'))

    expect(continuousData(state)('ユニット', threeWay).moveIcon).toEqual(['上'])
    expect(threeWay.moveIcon).toEqual(['上', '左', '右'])
  })

  it('変更を受けていないユニットは、渡されたカードがそのまま返る', () => {
    const state = putOnSquare(mainPhase(), homeSquare, unit('ユニット', threeWay))

    expect(continuousData(state)('ユニット', threeWay)).toBe(threeWay)
  })

  it('敵の移動方向は変更されない', () => {
    const board = putOnSquare(putOnSquare(mainPhase(), homeSquare, unit('味方', threeWay)), rightSquare, unit('敵', threeWay, '後攻'))
    const state = resolved(board, allAlliesMoveTo('上'))

    expect(continuousData(state)('敵', threeWay).moveIcon).toEqual(['上', '左', '右'])
  })

  it('解決した後にスクエアに置かれたユニットには及ばない', () => {
    const made = resolved(putOnSquare(mainPhase(), homeSquare, unit('味方', threeWay)), allAlliesMoveTo('上'))
    const later = putOnSquare(made, rightSquare, unit('後から置かれた味方', threeWay))

    expect(continuousData(later)('後から置かれた味方', threeWay).moveIcon).toEqual(['上', '左', '右'])
  })

  // 同 第12章 5-4: 発生した順に適用する。置き換えを続ければ、あとのものだけが残る。
  it('置き換えが重なれば、あとに発生した向きだけが残る', () => {
    const board = putOnSquare(mainPhase(), homeSquare, unit('ユニット', threeWay))
    const state = resolved(resolved(board, allAlliesMoveTo('上')), allAlliesMoveTo('右'))

    expect(continuousData(state)('ユニット', threeWay).moveIcon).toEqual(['右'])
    expect(canMove(state, 'ユニット', rightSquare)).toBe(true)
    expect(canMove(state, 'ユニット', forwardSquare)).toBe(false)
  })

  it('ターンが終わると、書かれたムーブアイコンに戻る', () => {
    let state = resolved(putOnSquare(mainPhase(), homeSquare, unit('ユニット', threeWay)), allAlliesMoveTo('上'))
    const turn = state.turn.number
    while (state.turn.number === turn) state = passPriority(state, chooseFirst)

    expect(state.createdContinuousEffects).toEqual([])
    expect(continuousData(state)('ユニット', threeWay)).toBe(threeWay)
  })

  it('効果に見せる盤面のユニットも、変更した後の移動方向を持つ', () => {
    const seen: (readonly MoveDirection[])[] = []
    const reading: Effect = function* (duel) {
      seen.push(...duel.allies().map((ally) => ally.card.moveIcon))
    }
    const state = resolved(putOnSquare(mainPhase(), homeSquare, unit('ユニット', threeWay)), allAlliesMoveTo('上'))
    resolved(state, reading)

    expect(seen).toEqual([['上']])
  })

  // 移動を妨げる常在型能力（ADR-0068）は、移動先の候補が決まった後に判定する。
  it('移動を妨げる常在型能力は、変更されたユニットにも今までどおり効く', () => {
    const blocker = defineUnit({
      name: 'テスト・前を塞ぐユニット',
      level: 1,
      colors: ['赤'],
      bp: 1000,
      sp: 1000,
      abilities: [movePreventing((_duel, occasion) => occasion.destination.row === 1)],
    })
    const board = putOnSquare(putOnSquare(mainPhase(), homeSquare, unit('ユニット', threeWay)), leftSquare, unit('妨げる', blocker))
    const state = resolved(board, allAlliesMoveTo('上', '右'))

    // 妨げられるのは、前（行 1）への移動だけである。変更後の向きの右へは移動できる。
    expect(canMove(state, 'ユニット', forwardSquare)).toBe(false)
    expect(canMove(state, 'ユニット', rightSquare)).toBe(true)
  })

  it('視点のデータには、変更を受けたユニットの分だけ移動方向が含まれる', () => {
    const board = putOnSquare(putOnSquare(mainPhase(), homeSquare, unit('味方', threeWay)), rightSquare, unit('敵', threeWay, '後攻'))
    const projected = perspectiveOf(resolved(board, allAlliesMoveTo('上')), '後攻')

    expect(projected.effective.find((each) => each.card === '味方')?.moveIcon).toEqual(['上'])
    expect(projected.effective.find((each) => each.card === '敵')).not.toHaveProperty('moveIcon')
  })
})
