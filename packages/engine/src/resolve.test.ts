import { describe, expect, it } from 'vitest'
import {
  cardsIn,
  cardsOn,
  choose,
  chooseAtMostOne,
  defineUnit,
  destroy,
  emptyDuelState,
  instantiate,
  putOnSquare,
  resolveEffect,
  triggeredAbility,
} from './index.js'
import type { CardInstance, Chooser, DuelState, Square, UnitOnSquare } from './index.js'

/**
 * 検証したいルールだけを持つ架空のテストカード（ADR-0002）。
 *
 * カードの実装が engine の公開 API だけで書けていることが、このカードそのもので示される。
 * 盤面に触れているところはひとつもない。
 */
const enterAndDestroy = defineUnit({
  name: 'テスト・登場破壊',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [
    triggeredAbility('登場した時', function* (duel) {
      const enemy = yield* choose(duel.enemies())
      yield* destroy(enemy)
    }),
  ],
})

const vanilla = defineUnit({ name: 'テスト・バニラ', level: 1, colors: ['赤'], bp: 1000, sp: 1000 })

/** あなたのユニットがスクエアから捨札に置かれるたびに誘発する能力を持つユニット。 */
const discardWatcher = defineUnit({
  name: 'テスト・あなたのユニットの捨札',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [
    triggeredAbility('あなたのユニットがスクエアから捨札に置かれた時', function* () {}),
  ],
})

const [enterAbility] = enterAndDestroy.abilities
if (enterAbility === undefined || enterAbility.kind !== '誘発型能力') {
  throw new Error('テストカードに誘発型能力が定義されていない')
}

/** 「1 枚まで選び」を持つテストカード。上のカードとの違いは、選ばないことも選べる点だけ。 */
const enterAndMaybeDestroy = defineUnit({
  name: 'テスト・登場任意破壊',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [
    triggeredAbility('登場した時', function* (duel) {
      const enemy = yield* chooseAtMostOne(duel.enemies())
      // 選ばれなかった時に何もしないのは、カードの側が決める。
      if (enemy !== undefined) yield* destroy(enemy)
    }),
  ],
})

const [maybeAbility] = enterAndMaybeDestroy.abilities
if (maybeAbility === undefined || maybeAbility.kind !== '誘発型能力') {
  throw new Error('テストカードに誘発型能力が定義されていない')
}

const mySquare: Square = { row: 2, column: 1 }
const enemySquare: Square = { row: 0, column: 1 }
const nextEnemySquare: Square = { row: 0, column: 2 }

const chooseFirst: Chooser = (candidates) => candidates[0]

function boardOf(...placements: readonly (readonly [Square, CardInstance])[]): DuelState {
  return placements.reduce((state, [square, card]) => putOnSquare(state, square, card), emptyDuelState())
}

const mine = () => instantiate({ id: '味方', card: enterAndDestroy, owner: '先攻' })
const maybeMine = () => instantiate({ id: '味方', card: enterAndMaybeDestroy, owner: '先攻' })
const theirs = (id: string) => instantiate({ id, card: vanilla, owner: '後攻' })

const idsOf = (cards: readonly CardInstance[]) => cards.map((card) => card.id)

describe('テストカードの能力を解決する', () => {
  // 総合ルール 第2部 第21章 1-5・5-1（ADR-0006）
  it('選ばれた敵はスクエアから持ち主の捨札の一番上に置かれる', () => {
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵')])

    const resolved = resolveEffect(state, enterAbility.effect, { controller: '先攻', chooser: chooseFirst })

    expect(cardsOn(resolved, enemySquare)).toEqual([])
    expect(idsOf(cardsIn(resolved, '後攻', '捨札'))).toEqual(['敵'])
    expect(cardsIn(resolved, '先攻', '捨札')).toEqual([])
  })

  // 総合ルール 第2部 第21章 5-1、第4部 第7章 6（ADR-0006）
  it('効果によってあなたのユニットが破壊された時も、捨札への移動で能力が誘発する', () => {
    const watching = instantiate({ id: '見届け役', card: discardWatcher, owner: '後攻' })
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵')], [nextEnemySquare, watching])

    const resolved = resolveEffect(state, enterAbility.effect, { controller: '先攻', chooser: chooseFirst })

    expect(resolved.triggered.map((each) => each.source)).toEqual(['見届け役'])
  })

  // 総合ルール 第2部 第21章 1-2
  it('捨札に置かれるのは支配者ではなく持ち主のほうである', () => {
    const stolen = instantiate({ id: '奪われた味方', card: vanilla, owner: '後攻', controller: '先攻' })
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵')], [nextEnemySquare, stolen])

    const resolved = resolveEffect(state, enterAbility.effect, { controller: '後攻', chooser: chooseFirst })

    // 「後攻」から見ると、先攻が支配しているこの 2 枚がどちらも敵にあたる。
    expect(idsOf(cardsIn(resolved, '後攻', '捨札'))).toEqual(['奪われた味方'])
  })

  // 総合ルール 第2部 第21章 1-4
  it('スクエアを離れたカードの支配者は持ち主に戻る', () => {
    const stolen = instantiate({ id: '奪われた敵', card: vanilla, owner: '後攻', controller: '先攻' })
    const state = boardOf([mySquare, mine()], [enemySquare, stolen])

    const resolved = resolveEffect(state, enterAbility.effect, { controller: '後攻', chooser: chooseFirst })

    expect(cardsIn(resolved, '後攻', '捨札')[0]?.controller).toBe('後攻')
  })

  // 総合ルール 第2部 第21章 8-2
  it('敵として選べるのは相手のユニットだけで、味方は候補に入らない', () => {
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵')])

    const offered: UnitOnSquare[][] = []
    const recordThenChoose: Chooser = (candidates) => {
      offered.push(candidates as readonly UnitOnSquare[] as UnitOnSquare[])
      return candidates[0]
    }
    resolveEffect(state, enterAbility.effect, { controller: '先攻', chooser: recordThenChoose })

    expect(offered).toHaveLength(1)
    expect(offered[0]?.map((unit) => unit.id)).toEqual(['敵'])
  })

  // 総合ルール 第1部 第1章 3
  it('敵が 1 枚もいなければ、要求された行動は実行されない', () => {
    const state = boardOf([mySquare, mine()])

    const resolved = resolveEffect(state, enterAbility.effect, { controller: '先攻', chooser: chooseFirst })

    expect(resolved).toEqual(state)
  })

  // 総合ルール 第4部 第8章 2-3
  it('どの敵を選ぶかは能力の支配者が決める', () => {
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵1')], [nextEnemySquare, theirs('敵2')])

    const chooseSecond: Chooser = (candidates) => candidates[1]
    const resolved = resolveEffect(state, enterAbility.effect, { controller: '先攻', chooser: chooseSecond })

    expect(idsOf(cardsIn(resolved, '後攻', '捨札'))).toEqual(['敵2'])
    expect(idsOf(cardsOn(resolved, enemySquare))).toEqual(['敵1'])
  })

  // ADR-0001: エンジンは「盤面 ＋ 行動 → 次の盤面」の純粋関数である
  it('元の盤面は変わらない', () => {
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵')])

    resolveEffect(state, enterAbility.effect, { controller: '先攻', chooser: chooseFirst })

    expect(idsOf(cardsOn(state, enemySquare))).toEqual(['敵'])
    expect(cardsIn(state, '後攻', '捨札')).toEqual([])
  })
})

describe('実行できない行動', () => {
  // 総合ルール 第1部 第1章 3
  it('すでにスクエアを離れたカードは破壊されないが、効果はそのまま続く', () => {
    const destroyTwice = triggeredAbility('登場した時', function* (duel) {
      const [first, second] = duel.enemies()
      if (first === undefined || second === undefined) throw new Error('敵が 2 枚いる盤面で試すこと')
      yield* destroy(first)
      // 1 枚目はもうスクエアにいない。この行動は実行されないだけで、効果は終わらない。
      yield* destroy(first)
      yield* destroy(second)
    })
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵1')], [nextEnemySquare, theirs('敵2')])

    const resolved = resolveEffect(state, destroyTwice.effect, { controller: '先攻', chooser: chooseFirst })

    expect(idsOf(cardsIn(resolved, '後攻', '捨札'))).toEqual(['敵2', '敵1'])
  })
})

describe('「1 枚まで選び」', () => {
  const declineAll: Chooser = () => undefined

  // 総合ルール 第4部 第8章 2-3
  it('候補があっても、選ばないことを選べる', () => {
    const state = boardOf([mySquare, maybeMine()], [enemySquare, theirs('敵')])

    const resolved = resolveEffect(state, maybeAbility.effect, { controller: '先攻', chooser: declineAll })

    expect(idsOf(cardsOn(resolved, enemySquare))).toEqual(['敵'])
    expect(cardsIn(resolved, '後攻', '捨札')).toEqual([])
  })

  // 総合ルール 第4部 第8章 2-3
  it('選んだ場合は、その対象に後ろの指示が行われる', () => {
    const state = boardOf([mySquare, maybeMine()], [enemySquare, theirs('敵')])

    const resolved = resolveEffect(state, maybeAbility.effect, { controller: '先攻', chooser: chooseFirst })

    expect(idsOf(cardsIn(resolved, '後攻', '捨札'))).toEqual(['敵'])
  })

  /**
   * 「1 枚選び」との違い。あちらは選ぶという行動が実行できないので効果を打ち切る
   * （総合ルール 第1部 第1章 3、上の「敵が 1 枚もいなければ」のテスト）が、
   * 「まで」は 0 枚を許しているので、選ばなかった場合と同じ結果になるだけである。
   */
  it('候補が 1 つも無くても、効果は打ち切られない', () => {
    const steps: string[] = []
    const ability = triggeredAbility('登場した時', function* (duel) {
      const enemy = yield* chooseAtMostOne(duel.enemies())
      steps.push(enemy === undefined ? '選ばなかった' : '選んだ')
      steps.push('後ろの指示')
    })
    const state = boardOf([mySquare, maybeMine()])

    resolveEffect(state, ability.effect, { controller: '先攻', chooser: chooseFirst })

    expect(steps).toEqual(['選ばなかった', '後ろの指示'])
  })

  it('選ばないことが認められているかどうかが、選ぶ側に渡る', () => {
    const asked: (boolean | undefined)[] = []
    const record: Chooser = (candidates, _player, mayDecline) => {
      asked.push(mayDecline)
      return candidates[0]
    }
    const state = boardOf([mySquare, maybeMine()], [enemySquare, theirs('敵')])

    resolveEffect(state, maybeAbility.effect, { controller: '先攻', chooser: record })

    expect(asked).toEqual([true])
  })

  // 総合ルール 第4部 第8章 2-3。テキストの指定に合わない選択は選べない。
  it('「1 枚選び」では、選ばないことを選べない', () => {
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵')])

    expect(() =>
      resolveEffect(state, enterAbility.effect, { controller: '先攻', chooser: declineAll }),
    ).toThrowError('候補にないものが選ばれた')
  })
})

// ADR-0002: カードの実装は engine の公開 API だけで書ける
describe('効果に渡されるのは盤面への問い合わせだけである', () => {
  it('盤面そのものも、それを書き換える手段も渡されない', () => {
    const ability = triggeredAbility('登場した時', function* (duel) {
      // @ts-expect-error 効果はスクエアに置かれたカードの並びを直接見られない
      duel.squares
      // @ts-expect-error 効果はゾーンの中身を直接書き換えられない
      duel.zones
      yield* destroy(yield* choose(duel.enemies()))
    })

    expect(ability.kind).toBe('誘発型能力')
  })

  it('見せていないカードを対象にはできない', () => {
    const forge = triggeredAbility('登場した時', function* (duel) {
      const [enemy] = duel.enemies()
      if (enemy === undefined) throw new Error('敵がいる盤面で試すこと')
      yield* destroy({ ...enemy, id: '味方' })
    })
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵')])

    expect(() =>
      resolveEffect(state, forge.effect, { controller: '先攻', chooser: chooseFirst }),
    ).toThrowError('効果に見せていないカードが対象にされた')
  })
})
