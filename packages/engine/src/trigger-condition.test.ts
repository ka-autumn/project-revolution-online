import { describe, expect, it } from 'vitest'
// バンクへ入れる・解決する手続きを直接呼ぶ。優先権の受け渡しを経ずに、誘発・無効化だけを
// 確かめるために、ここでだけ使う。公開する API ではない。
import { putTriggeredIntoBank, resolveFromBank } from './bank.js'
// スクエアから捨札への移動と、誘発イベントを満たすこと。誘発が移動前の盤面から起こる
// ことを直接確かめるために、ここでだけ使う。公開する API ではない。
import { discardFromSquares } from './discard.js'
import { trigger } from './trigger.js'
import {
  damagePlayer,
  defineUnit,
  emptyDuelState,
  instantiate,
  putOnSquare,
  triggeredAbility,
} from './index.js'
import type { CardInstance, Chooser, DuelState, Square } from './index.js'

const chooseFirst: Chooser = (candidates) => candidates[0]

const discardEvent = 'あなたのユニットがスクエアから捨札に置かれた時'

/** 自分自身が捨札に置かれた時だけ誘発するテストカード（ADR-0002）。 */
const selfDiscardWatcher = defineUnit({
  name: 'テスト・自分の捨札',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [triggeredAbility(discardEvent, function* () {}, (occasion, _controller, self) => occasion.id === self?.id)],
})

/** あなたのユニットが捨札に置かれるたびに誘発するテストカード。 */
const anyDiscardWatcher = defineUnit({
  name: 'テスト・味方の捨札',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [triggeredAbility(discardEvent, function* () {})],
})

/** 「エネルギーフェイズの始め、味方が 2 体以上ならば、ダメージを受ける」テストカード。 */
const crowdedDamager = defineUnit({
  name: 'テスト・味方が 2 体以上ならダメージ',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [
    triggeredAbility(
      'エネルギーフェイズの始め',
      function* (duel) {
        yield* damagePlayer(duel.controller, 1000)
      },
      undefined,
      (duel) => duel.allies().length >= 2,
    ),
  ],
})

/** 「自分自身が捨札に置かれた時、敵が 1 体でもいるならば、ダメージを受ける」テストカード。 */
const lastGaspDamager = defineUnit({
  name: 'テスト・自分の捨札で敵がいればダメージ',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [
    triggeredAbility(
      discardEvent,
      function* (duel) {
        yield* damagePlayer(duel.controller, 1000)
      },
      (occasion, _controller, self) => occasion.id === self?.id,
      (duel) => duel.enemies().length >= 1,
    ),
  ],
})

/** 「自分自身が捨札に置かれた時、自分がスクエアにいるならば」。誘発時の盤面を確かめる。 */
const standingWatcher = defineUnit({
  name: 'テスト・自分の捨札でスクエアにいるなら',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [
    triggeredAbility(
      discardEvent,
      function* () {},
      (occasion, _controller, self) => occasion.id === self?.id,
      (duel, _controller, self) => duel.allies().some((ally) => ally.id === self.id),
    ),
  ],
})

/** きっかけを持たない誘発イベントに、絞り込みを付けてしまったテストカード。 */
const miswrittenUnit = defineUnit({
  name: 'テスト・書き間違い',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [
    // 型が止めるので、止まらないよう通して作る。実行時の守りを確かめるため。
    triggeredAbility('エネルギーフェイズの始め', function* () {}, (() => true) as never),
  ],
})

const vanilla = defineUnit({ name: 'テスト・バニラ', level: 1, colors: ['赤'], bp: 1000, sp: 1000 })

const a: Square = { row: 2, column: 0 }
const b: Square = { row: 2, column: 1 }
const c: Square = { row: 2, column: 2 }
const enemySquare: Square = { row: 0, column: 0 }

function boardOf(...placements: readonly (readonly [Square, CardInstance])[]): DuelState {
  return placements.reduce((state, [square, card]) => putOnSquare(state, square, card), emptyDuelState())
}

/** 誘発した能力のうち、バンクに入ったものを解決する。 */
function resolveAll(state: DuelState): DuelState {
  return resolveFromBank(putTriggeredIntoBank(state), chooseFirst)
}

function executedInstructions(state: DuelState): number {
  return state.log.filter((recorded) => recorded.event.kind === '命令を実行した').length
}

function resolvedAbilities(state: DuelState): number {
  return state.log.filter((recorded) => recorded.event.kind === '能力を解決した').length
}

describe('「自分自身が捨札に置かれた時」だけ誘発する能力', () => {
  // 総合ルール 第4部 第7章 6・10（ADR-0006）
  it('自分自身が置かれれば誘発する', () => {
    const state = boardOf([a, instantiate({ id: '自分', card: selfDiscardWatcher, owner: '先攻' })])

    const discarded = discardFromSquares(state, ['自分'])

    expect(discarded.triggered.map((each) => each.source)).toEqual(['自分'])
  })

  // 総合ルール 第4部 第7章 6（ADR-0006）
  it('同じ支配者の別のユニットが置かれても誘発しない', () => {
    const state = boardOf(
      [a, instantiate({ id: '自分', card: selfDiscardWatcher, owner: '先攻' })],
      [b, instantiate({ id: '別のユニット', card: vanilla, owner: '先攻' })],
    )

    const discarded = discardFromSquares(state, ['別のユニット'])

    expect(discarded.triggered).toEqual([])
  })

  // 総合ルール 第4部 第7章 6・10（ADR-0006）
  it('2 体が同時に置かれ、両方がこの能力を持つなら、それぞれ 1 度ずつ誘発する', () => {
    const state = boardOf(
      [a, instantiate({ id: '一体目', card: selfDiscardWatcher, owner: '先攻' })],
      [b, instantiate({ id: '二体目', card: selfDiscardWatcher, owner: '先攻' })],
    )

    const discarded = discardFromSquares(state, ['一体目', '二体目'])

    expect(discarded.triggered.map((each) => each.source)).toEqual(['一体目', '二体目'])
  })

  // 総合ルール 第4部 第7章 6（ADR-0006）
  it('絞り込みを持たない能力は、味方の誰が置かれても誘発する', () => {
    const state = boardOf(
      [a, instantiate({ id: '能力持ち', card: anyDiscardWatcher, owner: '先攻' })],
      [b, instantiate({ id: '別のユニット', card: vanilla, owner: '先攻' })],
    )

    const discarded = discardFromSquares(state, ['別のユニット'])

    expect(discarded.triggered.map((each) => each.source)).toEqual(['能力持ち'])
  })
})

describe('きっかけを持たない誘発イベントの絞り込み', () => {
  // 総合ルール 第4部 第7章 6（ADR-0006）
  it('絞り込みが付いていれば投げる', () => {
    const state = boardOf([a, instantiate({ id: '書き間違い', card: miswrittenUnit, owner: '先攻' })])

    expect(() => trigger(state, 'エネルギーフェイズの始め')).toThrow('きっかけを持たない誘発イベントに絞り込みが付いている')
  })
})

describe('条件付誘発型能力', () => {
  const crowded = (): DuelState =>
    boardOf(
      [a, instantiate({ id: '能力持ち', card: crowdedDamager, owner: '先攻' })],
      [b, instantiate({ id: '味方', card: vanilla, owner: '先攻' })],
    )

  // 総合ルール 第4部 第7章 8（ADR-0006）
  it('誘発する時に条件を満たしていなければ誘発しない', () => {
    const state = boardOf([a, instantiate({ id: '能力持ち', card: crowdedDamager, owner: '先攻' })])

    expect(trigger(state, 'エネルギーフェイズの始め').triggered).toEqual([])
  })

  // 総合ルール 第4部 第7章 8（ADR-0006）
  it('誘発する時に満たしていて、解決する時には満たさなくなっていれば、効果は実行されず能力はバンクから無くなる', () => {
    const triggered = trigger(crowded(), 'エネルギーフェイズの始め')
    expect(triggered.triggered).toHaveLength(1)

    const emptied = discardFromSquares(triggered, ['味方'])
    const resolved = resolveAll(emptied)

    expect(executedInstructions(resolved)).toBe(0)
    expect(resolvedAbilities(resolved)).toBe(0)
    expect(resolved.bank).toEqual([])
    expect(resolved.triggered).toEqual([])
  })

  // 総合ルール 第4部 第7章 8（ADR-0006）
  it('誘発する時にも解決する時にも満たしていれば、効果が実行される', () => {
    const resolved = resolveAll(trigger(crowded(), 'エネルギーフェイズの始め'))

    expect(executedInstructions(resolved)).toBe(1)
    expect(resolvedAbilities(resolved)).toBe(1)
    expect(resolved.bank).toEqual([])
  })

  // 総合ルール 第4部 第7章 8・10、第4部 第8章 2-5（ADR-0006）
  it('「捨札に置かれた時」と組み合わせても、発生源がスクエアにいないまま条件を確かめて解決できる', () => {
    const state = boardOf(
      [a, instantiate({ id: '自分', card: lastGaspDamager, owner: '先攻' })],
      [enemySquare, instantiate({ id: '敵', card: vanilla, owner: '後攻' })],
    )

    const discarded = discardFromSquares(state, ['自分'])
    expect(discarded.triggered.map((each) => each.source)).toEqual(['自分'])

    const resolved = resolveAll(discarded)

    expect(executedInstructions(resolved)).toBe(1)
  })

  // 総合ルール 第4部 第7章 8・10（ADR-0006）
  it('捨札に置かれた時の誘発条件は、移動前の盤面で確かめる', () => {
    const state = boardOf([c, instantiate({ id: '自分', card: standingWatcher, owner: '先攻' })])

    const discarded = discardFromSquares(state, ['自分'])

    expect(discarded.triggered.map((each) => each.source)).toEqual(['自分'])
  })
})
