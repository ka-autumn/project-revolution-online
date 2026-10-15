import { describe, expect, it } from 'vitest'
// 手札やゾーンを組み立てるためだけに `putInZone` を使う。engine の中からゾーンを差し替える
// ための関数であり、公開する API ではない（`battle.test.ts` と同じ）。
import { putInZone } from './duel.js'
import {
  PLAYERS,
  cardsOn,
  defineTrap,
  defineUnit,
  emptyDuelState,
  instantiate,
  legalActions,
  passPriority,
  placeOnSquare,
  playCard,
  putOnSquare,
  triggeredAbility,
} from './index.js'
import type { ActionOutcome, Chooser, DuelState, Player, Square, UnitCard } from './index.js'

/**
 * バトルの途中に効果でユニットが置かれて侵入が起きた時の、トラップの権利。
 *
 * 総合ルール 第2部 第20章 3-8 ただし書き、第3部 第11章 2-1・4-1・5、ADR-0039（ADR-0006）。
 * この場面は、効果でユニットが置かれた時の侵入で組んでいる。権利の発生・止まる・パスで失うの
 * 判定は、きっかけの種類によらず同じ判定を通る。攻撃のトラップの形は `trap-attack-smash.test.ts`
 * で確かめている。
 */

const chooseFirst: Chooser = (candidates) => candidates[0]

const vanilla = defineUnit({ name: 'テスト・バニラ', level: 1, colors: ['赤'], bp: 3000, sp: 1000 })

/** 先攻から見た味方エリアのスクエア。バトルが起きる。 */
const battleSquare: Square = { row: 0, column: 1 }
/** 後攻のトラップの侵入のスクエア（絶対位置）。トリガーアイコンは後攻から見た向きで書く。 */
const invadedSquare: Square = { row: 2, column: 0 }
const trapIconSquare: Square = { row: 0, column: 2 }

/** 後攻の、侵入のスクエアを 1 つ持つ赤いトラップ。効果は持たない。 */
const intrusionTrap = defineTrap({
  name: 'テスト・侵入トラップ',
  level: 1,
  colors: ['赤'],
  triggerIcon: { kind: '侵入', squares: [trapIconSquare] },
})

/** 第１バトルステップの始めに、先攻の捨札の 1 枚目を `invadedSquare` に置くユニット。 */
const placer = defineUnit({
  name: 'テスト・置くユニット',
  level: 1,
  colors: ['赤'],
  bp: 3000,
  sp: 1000,
  abilities: [
    triggeredAbility('第１バトルステップの始め', function* (duel) {
      const [card] = duel.discardPile()
      if (card !== undefined) yield* placeOnSquare(card, invadedSquare, 'リリース')
    }),
  ],
})

function pass(state: DuelState): DuelState {
  return passPriority(state, chooseFirst)
}

function unitOf(id: string, card: UnitCard, owner: Player) {
  return instantiate({ id, card, owner })
}

function stateOf(outcome: ActionOutcome): DuelState {
  if (outcome.kind !== '行った') throw new Error(`行えなかった: ${outcome.violation}`)
  return outcome.state
}

/**
 * 先攻が `placer` をプレイして、`battleSquare` でバトルが発生する盤面。後攻のトラップゾーンには
 * 侵入のトラップがあり、エネルギーも払える。`standing` は後攻が `invadedSquare` に置いておくユニット
 * （先攻のユニットが置かれるとバトル中のバトルが発生する）。
 */
function battleWithTrap(standing: boolean): DuelState {
  let current = PLAYERS.reduce(
    (state, player) =>
      putInZone(
        state,
        player,
        '山札',
        Array.from({ length: 10 }, (_, index) => unitOf(`${player}の山札${index}`, vanilla, player)),
      ),
    emptyDuelState(),
  )
  while (current.turn.phase !== 'メインフェイズ') current = pass(current)

  const hand = [unitOf('攻撃した', placer, '先攻')]
  const energies = [unitOf('先攻のエネ', vanilla, '先攻')]
  const ready = putInZone(putInZone(pass(current), '先攻', '手札', hand), '先攻', 'エネルギーゾーン', energies)
  const withDiscard = putInZone(ready, '先攻', '捨札', [unitOf('置かれるユニット', vanilla, '先攻')])
  const withTrap = putInZone(putInZone(withDiscard, '後攻', 'トラップゾーン', [
    instantiate({ id: 'トラップ', card: intrusionTrap, owner: '後攻' }),
  ]), '後攻', 'エネルギーゾーン', [unitOf('後攻のエネ', vanilla, '後攻')])
  const attacked = putOnSquare(withTrap, battleSquare, unitOf('攻撃された', vanilla, '後攻'))
  const board = standing ? putOnSquare(attacked, invadedSquare, unitOf('居座るユニット', vanilla, '後攻')) : attacked

  return stateOf(playCard(board, { card: '攻撃した', square: battleSquare }, chooseFirst))
}

const kindsOf = (state: DuelState) => legalActions(state).map((action) => action.kind)
const mayActivate = (state: DuelState): boolean =>
  kindsOf(state).includes('トラップを発動する') && state.turn.priority === '後攻'

/** 条件が満たされる（効果で置かれる）まで、優先権を放棄し続ける。 */
function untilMet(state: DuelState): DuelState {
  let current = state
  for (let i = 0; i < 30 && current.trapConditionsMet.length === 0; i += 1) current = pass(current)
  if (current.trapConditionsMet.length === 0) throw new Error('条件が満たされなかった')
  return current
}

describe('バトルの途中に効果で置かれて侵入が起きた時', () => {
  it('条件より前から進行中のバトルは権利を止めず、次に優先権を得た時に発動できる', () => {
    const met = untilMet(battleWithTrap(false))

    expect(met.battles).toHaveLength(1)
    expect(cardsOn(met, invadedSquare).map((card) => card.id)).toEqual(['置かれるユニット'])
    expect(mayActivate(met)).toBe(true)
  })

  // 攻撃のトラップの権利は、第２バトルステップ以降に持ち越されない（Issue の場面 1）。侵入に
  // 置き換えている。第１バトルステップで発動せずにパスすると、権利を失う。
  it('権利が発生している間にパスすれば失い、第２バトルステップ以降にも持ち越されない', () => {
    let current = untilMet(battleWithTrap(false))
    expect(mayActivate(current)).toBe(true)

    current = pass(current)

    expect(current.trapConditionsMet).toEqual([])
    const steps = new Set<string>()
    while (current.battles.length > 0) {
      current = pass(current)
      expect(mayActivate(current)).toBe(false)
      const step = current.battles.at(-1)?.step
      if (step !== undefined) steps.add(step)
    }
    // 第２バトルステップ以降まで進んだうえで、一度も発動できなかった。
    expect(steps.has('第２バトルステップ')).toBe(true)
  })
})

describe('バトル中のバトル', () => {
  // 先のバトルの途中に置かれて、後のバトルが発生する。後のバトルは条件の後に発生したので、
  // 後のバトルの間は権利が止まる。後のバトルが終われば、先のバトルの中で権利が発生する
  // （Issue の場面 2）。侵入に置き換えている。
  it('後のバトルの間は権利が止まり、パスしても失わない。終わると先のバトルの中で発生する', () => {
    let current = untilMet(battleWithTrap(true))
    expect(current.battles).toHaveLength(2)

    // 後のバトルの間は、止まっている。パスしても件は残る。
    let guard = 0
    while (current.battles.length > 1) {
      expect(mayActivate(current)).toBe(false)
      expect(current.trapConditionsMet).toHaveLength(1)
      current = pass(current)
      guard += 1
      if (guard > 40) throw new Error('後のバトルが終わらなかった')
    }

    // 後のバトルが終わった。先のバトルの中で、権利が発生している。
    expect(current.battles).toHaveLength(1)
    expect(current.trapConditionsMet).toHaveLength(1)
    while (current.turn.priority !== '後攻') current = pass(current)
    expect(mayActivate(current)).toBe(true)
  })
})
