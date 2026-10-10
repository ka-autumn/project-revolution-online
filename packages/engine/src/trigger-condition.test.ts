import { describe, expect, it, vi } from 'vitest'
// ターンの進行を経ずに、「登場した時」などの誘発とバンクへ入れる・解決する手続きを直接呼ぶ。
// 誘発・無効化だけを確かめるために、ここでだけ使う。公開する API ではない。
import {
  putTriggeredIntoBank,
  resolveFromBank,
  triggerAppearance,
  triggerAttack,
  triggerBattleWin,
  triggerMovement,
} from './bank.js'
// スクエアから捨札への移動と、誘発イベントを満たすこと。誘発が移動前の盤面から起こる
// ことを直接確かめるために、ここでだけ使う。公開する API ではない。
import { discardFromSquares } from './discard.js'
// 盤面の組み替え（別のスクエアへ動かす、ゾーンの中身を差し替える）。公開する API ではない。
import { moveToSquare, putInZone } from './duel.js'
import { trigger } from './trigger.js'
import {
  PLAYERS,
  alsoTreatedAs,
  attributeAdding,
  bpModifying,
  bpPlus,
  damagePlayer,
  defineUnit,
  emptyDuelState,
  instantiate,
  passPriority,
  placeInZone,
  putOnSquare,
  triggeredAbility,
} from './index.js'
import type {
  CardInstance,
  CardInZone,
  Chooser,
  DiscardOccasion,
  DuelState,
  Square,
  TriggerCondition,
  TriggerEvent,
} from './index.js'

const chooseFirst: Chooser = (candidates) => candidates[0]

const discardEvent = 'あなたのユニットがスクエアから捨札に置かれた時'

const nothing = function* () {}

/** 自分自身が捨札に置かれた時だけ誘発するテストカード（ADR-0002）。 */
const selfDiscardWatcher = defineUnit({
  name: 'テスト・自分の捨札',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [triggeredAbility(discardEvent, nothing, (occasion, _controller, self) => occasion.id === self.id)],
})

/** あなたのユニットが捨札に置かれるたびに誘発するテストカード。 */
const anyDiscardWatcher = defineUnit({
  name: 'テスト・味方の捨札',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [triggeredAbility(discardEvent, nothing)],
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
      { condition: (duel) => duel.allies().length >= 2 },
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
      {
        when: (occasion, _controller, self) => occasion.id === self.id,
        condition: (duel) => duel.enemies().length >= 1,
      },
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
    triggeredAbility(discardEvent, nothing, {
      when: (occasion, _controller, self) => occasion.id === self.id,
      condition: (duel) => duel.allies().some((ally) => ally.id === duel.self()?.id),
    }),
  ],
})

/** 「あなたのユニットが捨札に置かれた時、味方が 2 体以上ならば、ダメージを受ける」。残る味方が持つ能力。 */
const crowdedDiscardWatcher = defineUnit({
  name: 'テスト・味方の捨札で味方が 2 体以上ならダメージ',
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
      { condition: (duel) => duel.allies().length >= 2 },
    ),
  ],
})

/** 「エネルギーフェイズの始め、自分が左の列にいるならば」。誘発後に動いた自分自身を読む。 */
const leftColumnWatcher = defineUnit({
  name: 'テスト・左の列にいるなら',
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
      { condition: (duel) => duel.self()?.square.column === 0 },
    ),
  ],
})

/** 「エネルギーフェイズの始め、自分のＢＰが 1500 以上ならば」。継続効果を適用した後の自分自身を読む。 */
const strongWatcher = defineUnit({
  name: 'テスト・ＢＰ 1500 以上なら',
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
      { condition: (duel) => (duel.self()?.card.bp ?? 0) >= 1500 },
    ),
  ],
})

/** 味方すべてのＢＰを +500 し、味方すべてに属性を加える常在型能力を持つテストカード。 */
const aura = defineUnit({
  name: 'テスト・味方を強くする',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [
    bpModifying((duel) => duel.allies().map((ally) => bpPlus(ally, 500))),
    attributeAdding((duel) => duel.allies().map((ally) => alsoTreatedAs(ally, 'テスト属性'))),
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
    // 型が止める（「絞り込みの型」）。止まらないよう通して作る。実行時の守りを確かめるため。
    // @ts-expect-error きっかけを持たない誘発イベントには絞り込みを付けられない
    triggeredAbility('エネルギーフェイズの始め', nothing, () => true),
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

function invalidations(state: DuelState): number {
  return state.log.filter((recorded) => recorded.event.kind === '能力が無効化された').length
}

const sourcesOf = (state: DuelState) => state.triggered.map((each) => each.source)

/** 絞り込みだけを持つ、あなたのユニットが捨札に置かれた時のテストカード。 */
function discardWatcherWhen(name: string, when: TriggerCondition<DiscardOccasion>) {
  return defineUnit({
    name,
    level: 1,
    colors: ['赤'],
    bp: 1000,
    sp: 1000,
    abilities: [triggeredAbility(discardEvent, nothing, when)],
  })
}

describe('絞り込みの型', () => {
  // 総合ルール 第4部 第7章 6（ADR-0006）
  it('きっかけを持たない誘発イベントには、絞り込みを付けられない', () => {
    // @ts-expect-error 述語をそのまま渡しても通らない
    triggeredAbility('エネルギーフェイズの始め', nothing, () => true)
    // @ts-expect-error 名前を付けて渡しても通らない
    triggeredAbility('エネルギーフェイズの始め', nothing, { when: () => true })
    // @ts-expect-error きっかけを見る述語は書けない
    triggeredAbility('エネルギーフェイズの始め', nothing, (occasion) => occasion.kind === '登場')

    // 絞り込みを付けないなら書ける。
    triggeredAbility('エネルギーフェイズの始め', nothing)
    triggeredAbility('エネルギーフェイズの始め', nothing, { condition: () => true })
  })

  // 総合ルール 第4部 第7章 6（ADR-0006）
  it('きっかけを持つ誘発イベントには書け、互いのきっかけを取り違えるとコンパイルエラーになる', () => {
    triggeredAbility('登場した時', nothing, (occasion) => occasion.from === '手札')
    triggeredAbility('登場した時', nothing, { when: (occasion) => occasion.from === '手札' })
    triggeredAbility(discardEvent, nothing, (occasion, _controller, self) => occasion.id === self.id)
    triggeredAbility(discardEvent, nothing, { when: (occasion) => occasion.card.bp > 0, condition: () => true })

    // @ts-expect-error 登場のきっかけは id を持たない
    triggeredAbility('登場した時', nothing, (occasion) => occasion.id === '別のユニット')
    // @ts-expect-error 捨札のきっかけは from を持たない
    triggeredAbility(discardEvent, nothing, (occasion) => occasion.from === '手札')
    // @ts-expect-error 名前を付けて渡しても取り違えは止まる
    triggeredAbility(discardEvent, nothing, { when: (occasion) => occasion.from === '手札' })
  })

  // 総合ルール 第4部 第7章 8（ADR-0006）
  it('誘発条件は第 3 引数に名前を付けて渡す。4 番目の引数では渡せない', () => {
    // @ts-expect-error 4 番目の引数は無い
    triggeredAbility('エネルギーフェイズの始め', nothing, undefined, () => true)

    const onlyCondition = triggeredAbility('エネルギーフェイズの始め', nothing, { condition: () => true })
    expect(onlyCondition.when).toBeUndefined()
    expect(onlyCondition.condition).toBeDefined()

    const both = triggeredAbility(discardEvent, nothing, { when: () => true, condition: () => true })
    expect(both.when).toBeDefined()
    expect(both.condition).toBeDefined()

    const onlyWhen = triggeredAbility(discardEvent, nothing, () => true)
    expect(onlyWhen.when).toBeDefined()
    expect(onlyWhen.condition).toBeUndefined()

    const neither = triggeredAbility(discardEvent, nothing)
    expect(neither.when).toBeUndefined()
    expect(neither.condition).toBeUndefined()
  })
})

describe('「自分自身が捨札に置かれた時」だけ誘発する能力', () => {
  // 総合ルール 第4部 第7章 6・10（ADR-0006）
  it('自分自身が置かれれば誘発する', () => {
    const state = boardOf([a, instantiate({ id: '自分', card: selfDiscardWatcher, owner: '先攻' })])

    const discarded = discardFromSquares(state, ['自分'])

    expect(sourcesOf(discarded)).toEqual(['自分'])
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

    expect(sourcesOf(discarded)).toEqual(['一体目', '二体目'])
  })

  // 総合ルール 第4部 第7章 6（ADR-0006）
  it('絞り込みを持たない能力は、味方の誰が置かれても誘発する', () => {
    const state = boardOf(
      [a, instantiate({ id: '能力持ち', card: anyDiscardWatcher, owner: '先攻' })],
      [b, instantiate({ id: '別のユニット', card: vanilla, owner: '先攻' })],
    )

    const discarded = discardFromSquares(state, ['別のユニット'])

    expect(sourcesOf(discarded)).toEqual(['能力持ち'])
  })
})

describe('捨札に置かれた時のきっかけ', () => {
  // 総合ルール 第4部 第7章 6（ADR-0006）
  it('置かれたユニットのスクエアと支配者を、絞り込みが読める', () => {
    const seen: { readonly square: Square; readonly controller: string }[] = []
    const watcher = discardWatcherWhen('テスト・きっかけを写す', (occasion) => {
      seen.push({ square: occasion.square, controller: occasion.controller })
      return true
    })
    const state = boardOf(
      [a, instantiate({ id: '能力持ち', card: watcher, owner: '先攻' })],
      [c, instantiate({ id: '別のユニット', card: vanilla, owner: '先攻' })],
    )

    discardFromSquares(state, ['別のユニット'])

    expect(seen).toEqual([{ square: c, controller: '先攻' }])
  })

  // 総合ルール 第4部 第7章 6（ADR-0006）
  it('置かれたスクエアで絞り込める', () => {
    const watcher = discardWatcherWhen('テスト・右の列で捨札', (occasion) => occasion.square.column === 2)
    const state = boardOf(
      [a, instantiate({ id: '能力持ち', card: watcher, owner: '先攻' })],
      [b, instantiate({ id: '中央のユニット', card: vanilla, owner: '先攻' })],
      [c, instantiate({ id: '右のユニット', card: vanilla, owner: '先攻' })],
    )

    expect(discardFromSquares(state, ['中央のユニット']).triggered).toEqual([])
    expect(sourcesOf(discardFromSquares(state, ['右のユニット']))).toEqual(['能力持ち'])
  })

  // 総合ルール 第4部 第7章 6（ADR-0006）
  it('相手のユニットが置かれても、自分のユニットの能力の絞り込みは呼ばれない', () => {
    const asked = vi.fn(() => true)
    const watcher = discardWatcherWhen('テスト・呼ばれない', asked)
    const state = boardOf(
      [a, instantiate({ id: '能力持ち', card: watcher, owner: '先攻' })],
      [enemySquare, instantiate({ id: '相手のユニット', card: vanilla, owner: '後攻' })],
    )

    const discarded = discardFromSquares(state, ['相手のユニット'])

    expect(asked).not.toHaveBeenCalled()
    expect(discarded.triggered).toEqual([])
  })

  // 総合ルール 第4部 第7章 6、第12章 2（ADR-0006）
  it('継続効果で属性とＢＰが変わったユニットが置かれた時は、変わった後の値を絞り込みが読める', () => {
    const seen: { readonly bp: number; readonly attributes: readonly string[] }[] = []
    const watcher = defineUnit({
      name: 'テスト・変わった後の値を写す',
      level: 1,
      colors: ['赤'],
      bp: 1000,
      sp: 1000,
      abilities: [
        bpModifying((duel) => duel.allies().map((ally) => bpPlus(ally, 500))),
        attributeAdding((duel) => duel.allies().map((ally) => alsoTreatedAs(ally, 'テスト属性'))),
        triggeredAbility(discardEvent, nothing, (occasion) => {
          seen.push({ bp: occasion.card.bp, attributes: occasion.card.attributes })
          return true
        }),
      ],
    })
    const state = boardOf([a, instantiate({ id: '自分', card: watcher, owner: '先攻' })])

    discardFromSquares(state, ['自分'])

    expect(seen).toEqual([{ bp: 1500, attributes: ['テスト属性'] }])
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
    expect(resolved.log.map((recorded) => recorded.event)).toEqual([
      { kind: '能力が無効化された', controller: '先攻', source: '能力持ち' },
    ])
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
    expect(sourcesOf(discarded)).toEqual(['自分'])

    const resolved = resolveAll(discarded)

    expect(executedInstructions(resolved)).toBe(1)
  })

  // 総合ルール 第4部 第7章 8・10（ADR-0006）
  it('捨札に置かれた時の誘発条件は、移動前の盤面で確かめる', () => {
    const state = boardOf([c, instantiate({ id: '自分', card: standingWatcher, owner: '先攻' })])

    const discarded = discardFromSquares(state, ['自分'])

    expect(sourcesOf(discarded)).toEqual(['自分'])
  })

  // 総合ルール 第4部 第7章 8・10、第8章 2-5（ADR-0006）。残る味方が持つ能力の読み方は条文が
  // 明記していないので、置かれるユニットが能力を持つ時と揃えた。見直す時はこのテストを直す。
  it('スクエアに残る味方が持つ能力の誘発条件は、置かれるユニットがまだ数に入った盤面で判定し、解決する時は置かれた後の盤面で判定する', () => {
    const state = boardOf(
      [a, instantiate({ id: '能力持ち', card: crowdedDiscardWatcher, owner: '先攻' })],
      [b, instantiate({ id: '別のユニット', card: vanilla, owner: '先攻' })],
    )

    const discarded = discardFromSquares(state, ['別のユニット'])
    expect(sourcesOf(discarded)).toEqual(['能力持ち'])

    const resolved = resolveAll(discarded)

    expect(executedInstructions(resolved)).toBe(0)
    expect(invalidations(resolved)).toBe(1)
  })

  describe('絞り込みと誘発条件の両方を持つ', () => {
    /** 絞り込みと誘発条件がそれぞれ何回呼ばれたかを数えるカード。 */
    function counted(whenResult: boolean, conditionResult: boolean) {
      const when = vi.fn(() => whenResult)
      const condition = vi.fn(() => conditionResult)
      const card = defineUnit({
        name: 'テスト・両方を数える',
        level: 1,
        colors: ['赤'],
        bp: 1000,
        sp: 1000,
        abilities: [triggeredAbility(discardEvent, nothing, { when, condition })],
      })
      const state = boardOf(
        [a, instantiate({ id: '能力持ち', card, owner: '先攻' })],
        [b, instantiate({ id: '別のユニット', card: vanilla, owner: '先攻' })],
      )
      return { when, condition, discarded: discardFromSquares(state, ['別のユニット']) }
    }

    // 総合ルール 第4部 第7章 8（ADR-0006）
    it('絞り込みが偽なら、誘発条件は評価されず、誘発しない', () => {
      const { when, condition, discarded } = counted(false, true)

      expect(when).toHaveBeenCalledTimes(1)
      expect(condition).not.toHaveBeenCalled()
      expect(discarded.triggered).toEqual([])
    })

    // 総合ルール 第4部 第7章 8（ADR-0006）
    it('絞り込みが真で誘発条件が偽なら、誘発しない', () => {
      const { condition, discarded } = counted(true, false)

      expect(condition).toHaveBeenCalledTimes(1)
      expect(discarded.triggered).toEqual([])
    })

    // 総合ルール 第4部 第7章 8（ADR-0006）
    it('両方が真なら誘発する', () => {
      const { discarded } = counted(true, true)

      expect(sourcesOf(discarded)).toEqual(['能力持ち'])
    })
  })

  describe('発生源自身のできごとで誘発する経路でも、誘発条件を確かめる', () => {
    const cases: readonly {
      readonly event: TriggerEvent
      readonly fire: (state: DuelState, id: string) => DuelState
    }[] = [
      {
        event: '登場した時',
        fire: (state, id) => triggerAppearance(state, id, { kind: '登場', square: a, from: '手札' }),
      },
      { event: '移動が起動された時', fire: (state, id) => triggerMovement(state, id) },
      { event: '攻撃した時', fire: (state, id) => triggerAttack(state, id, '相手') },
      { event: 'バトルに勝った時', fire: (state, id) => triggerBattleWin(state, id) },
    ]

    // 総合ルール 第4部 第7章 8（ADR-0006）
    it.each(cases)('「$event」', ({ event, fire }) => {
      const card = defineUnit({
        name: 'テスト・敵がいるなら',
        level: 1,
        colors: ['赤'],
        bp: 1000,
        sp: 1000,
        abilities: [triggeredAbility(event, nothing, { condition: (duel) => duel.enemies().length >= 1 })],
      })
      const alone = boardOf([a, instantiate({ id: '能力持ち', card, owner: '先攻' })])
      const withEnemy = putOnSquare(alone, enemySquare, instantiate({ id: '相手', card: vanilla, owner: '後攻' }))

      expect(fire(alone, '能力持ち').triggered).toEqual([])
      expect(sourcesOf(fire(withEnemy, '能力持ち'))).toEqual(['能力持ち'])
    })
  })

  describe('自分自身を、誘発する時も解決する時も duel.self() から読む', () => {
    // 総合ルール 第4部 第7章 8、第8章 2-5（ADR-0006）
    it('誘発した後に別のスクエアへ動き、条件が自分のスクエアを読むなら、解決する時は動いた先を読む', () => {
      const state = boardOf([a, instantiate({ id: '能力持ち', card: leftColumnWatcher, owner: '先攻' })])
      const triggered = trigger(state, 'エネルギーフェイズの始め')
      expect(sourcesOf(triggered)).toEqual(['能力持ち'])

      const moved = moveToSquare(triggered, '能力持ち', c, { controller: '先攻', orientation: 'リリース' })
      const resolved = resolveAll(moved)

      expect(executedInstructions(resolved)).toBe(0)
      expect(invalidations(resolved)).toBe(1)
    })

    // 総合ルール 第4部 第7章 8、第8章 2-5（ADR-0006）
    it('誘発した後に動いても、動いた先で条件を満たすなら、効果が実行される', () => {
      const state = boardOf([c, instantiate({ id: '能力持ち', card: leftColumnWatcher, owner: '先攻' })])
      expect(trigger(state, 'エネルギーフェイズの始め').triggered).toEqual([])

      const left = boardOf([a, instantiate({ id: '能力持ち', card: leftColumnWatcher, owner: '先攻' })])
      const triggered = trigger(left, 'エネルギーフェイズの始め')
      const moved = moveToSquare(triggered, '能力持ち', { row: 1, column: 0 }, { controller: '先攻', orientation: 'リリース' })
      const resolved = resolveAll(moved)

      expect(executedInstructions(resolved)).toBe(1)
    })

    // 総合ルール 第4部 第8章 2-5（ADR-0006）
    it('解決する時に発生源がスクエアを離れていても、誘発した時点の写しを読める', () => {
      const state = boardOf([a, instantiate({ id: '能力持ち', card: leftColumnWatcher, owner: '先攻' })])
      const triggered = trigger(state, 'エネルギーフェイズの始め')

      const left = discardFromSquares(triggered, ['能力持ち'])
      const resolved = resolveAll(left)

      expect(executedInstructions(resolved)).toBe(1)
      expect(invalidations(resolved)).toBe(0)
    })

    // 総合ルール 第4部 第7章 8、第12章 2（ADR-0006）
    it('継続効果で変わった自分のデータを、誘発する時も解決する時も読む', () => {
      const withAura = boardOf(
        [a, instantiate({ id: '能力持ち', card: strongWatcher, owner: '先攻' })],
        [b, instantiate({ id: '強くする', card: aura, owner: '先攻' })],
      )
      const withoutAura = boardOf([a, instantiate({ id: '能力持ち', card: strongWatcher, owner: '先攻' })])

      // 誘発する時: 書かれたＢＰは 1000 だが、継続効果で 1500 になっている。
      expect(trigger(withoutAura, 'エネルギーフェイズの始め').triggered).toEqual([])
      const triggered = trigger(withAura, 'エネルギーフェイズの始め')
      expect(sourcesOf(triggered)).toEqual(['能力持ち'])

      // 解決する時: 継続効果の発生源がいなくなって、ＢＰは 1000 に戻っている。
      const resolved = resolveAll(discardFromSquares(triggered, ['強くする']))

      expect(executedInstructions(resolved)).toBe(0)
      expect(invalidations(resolved)).toBe(1)
    })
  })

  describe('誘発条件が盤面を読んでも、効果の対象は増えない', () => {
    // 総合ルール 第4部 第7章 8（ADR-0006）、ADR-0002
    it('誘発条件が手札や捨札を読んで持ち出したカードを、効果は対象にできない', () => {
      let leaked: CardInZone | undefined
      const card = defineUnit({
        name: 'テスト・読んだカードを持ち出す',
        level: 1,
        colors: ['赤'],
        bp: 1000,
        sp: 1000,
        abilities: [
          triggeredAbility(
            'エネルギーフェイズの始め',
            function* () {
              if (leaked !== undefined) yield* placeInZone(leaked, '捨札', 'リリース')
            },
            {
              condition: (duel) => {
                leaked = duel.hand()[0]
                duel.discardPile()
                return true
              },
            },
          ),
        ],
      })
      const withHand = putInZone(
        boardOf([a, instantiate({ id: '能力持ち', card, owner: '先攻' })]),
        '先攻',
        '手札',
        [instantiate({ id: '手札のカード', card: vanilla, owner: '先攻' })],
      )

      const triggered = trigger(withHand, 'エネルギーフェイズの始め')
      expect(leaked?.id).toBe('手札のカード')

      expect(() => resolveAll(triggered)).toThrow('効果に見せていないカードが対象にされた')
    })
  })
})

describe('無効化のあとの流れ', () => {
  /** 山札を積んだ盤面（山札が尽きると敗北する。総合ルール 第3部 第3章 2）。 */
  function stocked(...placements: readonly (readonly [Square, CardInstance])[]): DuelState {
    const library = PLAYERS.reduce(
      (state, player) =>
        putInZone(
          state,
          player,
          '山札',
          Array.from({ length: 10 }, (_, index) =>
            instantiate({ id: `${player}の山札${index}`, card: vanilla, owner: player }),
          ),
        ),
      emptyDuelState(),
    )
    return placements.reduce((state, [square, card]) => putOnSquare(state, square, card), library)
  }

  const crowdedByThree = defineUnit({
    name: 'テスト・味方が 3 体以上ならダメージ',
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
        { condition: (duel) => duel.allies().length >= 3 },
      ),
    ],
  })
  const unconditional = defineUnit({
    name: 'テスト・エネルギーフェイズの始めに何もしない',
    level: 1,
    colors: ['赤'],
    bp: 1000,
    sp: 1000,
    abilities: [triggeredAbility('エネルギーフェイズの始め', nothing)],
  })

  const pass = (state: DuelState): DuelState => passPriority(state, chooseFirst)

  // 総合ルール 第4部 第5章 2、第7章 8、第9章 1・2（ADR-0006）
  it('無効化された能力は解決されずに消滅し、ほかの能力はバンクに残り、優先権は非アクティブプレイヤーに渡る', () => {
    const board = stocked(
      [a, instantiate({ id: '条件付', card: crowdedByThree, owner: '先攻' })],
      [b, instantiate({ id: '無条件', card: unconditional, owner: '先攻' })],
      [c, instantiate({ id: '味方', card: vanilla, owner: '先攻' })],
    )
    // 先攻の第 1 ターンはリリースフェイズから始まるので、2 回の放棄でエネルギーフェイズに入る。
    const energyPhase = pass(pass(board))
    expect(energyPhase.turn.phase).toBe('エネルギーフェイズ')
    expect(energyPhase.bank.map((banked) => banked.source)).toEqual(['条件付', '無条件'])

    // 能力がバンクに入っている間に、条件を満たさなくなる。
    const emptied = discardFromSquares(energyPhase, ['味方'])
    const waiting = pass(emptied)
    expect(waiting.turn.priority).toBe('先攻')

    // 両方のプレイヤーが連続して優先権を放棄すると、アクティブプレイヤーが先に解決する。
    const after = pass(waiting)

    expect(after.log.slice(waiting.log.length).map((recorded) => recorded.event)).toEqual([
      { kind: '能力が無効化された', controller: '先攻', source: '条件付' },
    ])
    expect(after.bank.map((banked) => banked.source)).toEqual(['無条件'])
    expect(after.turn.priority).toBe('後攻')
    expect(after.turn.active).toBe('先攻')
  })
})
