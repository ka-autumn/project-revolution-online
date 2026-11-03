import { describe, expect, it } from 'vitest'
import {
  applyWithAnswers,
  choose,
  damageUnit,
  defineStrategy,
  defineUnit,
  destroy,
  emptyDuelState,
  hope,
  instantiate,
  legalActions,
  putOnSquare,
  randomFromSeed,
} from '@revolution/engine'
import type { Card, CardInstance, DuelState, LegalAction, Phase, Player, PlayerZone, Square } from '@revolution/engine'
import { actionViewOf, choiceViewOf } from './player.js'
import { energyTargetOf, scoredCpu } from './scored-cpu.js'

/**
 * 場面ごとに手へ点数を付けて選ぶ CPU が、特定の場面で期待した手を選ぶか（ADR-0060 の段階 2、#366）。
 *
 * 盤面は架空のカードで組み立てる（ADR-0002）。CPU に渡すのは、組み立てた完全な盤面から
 * `actionViewOf`・`choiceViewOf` を通した射影だけである（ADR-0060）。
 */

const PASS = { kind: '優先権を放棄する' } as const

/** 先攻から見た、行（row）の呼び名。先攻の味方エリアは 0 行、敵エリアは 2 行である（`board.ts` の `areaOf`）。 */
const OWN_AREA = 0
const CENTER = 1
const ENEMY_AREA = 2

function unit(name: string, bp: number, sp: number, level = 0): Card {
  return defineUnit({ name: `テスト・${name}`, level, bp, sp, moveIcon: ['上'] })
}

function at(row: number, column: number): Square {
  return { row, column } as Square
}

/** そのプレイヤーのそのゾーンにカードを置いた盤面。 */
function withZone(state: DuelState, player: Player, zone: PlayerZone, cards: readonly CardInstance[]): DuelState {
  return {
    ...state,
    zones: { ...state.zones, [player]: { ...state.zones[player], [zone]: [...state.zones[player][zone], ...cards] } },
  }
}

/**
 * 先攻のターンの、そのフェイズで先攻が優先権を持っている盤面。
 *
 * 山札が 0 枚だと、次に優先権が発生した時に敗北する（総合ルール 第3部 第3章 2）ので、両方の山札に
 * カードを置いておく。
 */
function sceneAt(phase: Phase): DuelState {
  const empty = emptyDuelState()
  const library = (player: Player): readonly CardInstance[] =>
    Array.from({ length: 10 }, (_, index) => instantiate({ id: `${player}-山札${index}`, card: unit('山札', 0, 0), owner: player }))
  const state = withZone(withZone(empty, '先攻', '山札', library('先攻')), '後攻', '山札', library('後攻'))
  return { ...state, turn: { ...state.turn, number: 3, active: '先攻', priority: '先攻', phase, passedBy: undefined } }
}

function onSquare(state: DuelState, square: Square, id: string, card: Card, owner: Player): DuelState {
  return putOnSquare(state, square, instantiate({ id, card, owner }))
}

function picked(state: DuelState): LegalAction | undefined {
  return scoredCpu.pickAction(actionViewOf(state, state.turn.priority), randomFromSeed(1))?.action
}

describe('スマッシュフェイズ', () => {
  /** 総合ルール 第3部 第9章 1。中央エリアの自分のユニットでスマッシュできる。 */
  it('スマッシュできるユニットがいれば、優先権を放棄しない', () => {
    const state = onSquare(sceneAt('スマッシュフェイズ'), at(CENTER, 0), 'a', unit('中央', 1000, 1000), '先攻')

    expect(legalActions(state)).toContainEqual({ kind: 'スマッシュする', unit: 'a' })
    expect(picked(state)).toEqual({ kind: 'スマッシュする', unit: 'a' })
  })

  /**
   * 総合ルール 第3部 第17章 3、第19章 1、第20章 1、第3部 第3章 1、第5部 第3章 2。
   *
   * 相手のスマッシュが 5 枚で、相手のプランが「敵を 1 枚選んで破壊する」希望を持っている。SP 1500 の
   * ユニットで先にスマッシュすると、その時点でスマッシュ判定になり、希望でもう 1 枚が破壊されて
   * スマッシュが 6 枚で止まる。SP 500 のユニットで先にスマッシュすれば、判定の前に合計 2000 の
   * ダメージになり、相手のスマッシュは 7 枚になる。
   */
  it('相手の希望が発動する前に、相手のスマッシュを 7 枚にできる順にスマッシュする', () => {
    const hoping = defineUnit({
      name: 'テスト・希望で破壊する',
      level: 1,
      colors: ['赤'],
      bp: 1000,
      sp: 0,
      abilities: [
        hope(function* (duel) {
          const target = yield* choose(duel.enemies())
          if (target !== undefined) yield* destroy(target)
        }),
      ],
    })
    const energy = defineUnit({ name: 'テスト・赤のエネルギー', level: 0, colors: ['赤'], bp: 0, sp: 0 })
    const smashes = Array.from({ length: 5 }, (_, index) =>
      instantiate({ id: `s${index}`, card: unit('スマッシュ', 0, 0), owner: '後攻' }),
    )

    let state = sceneAt('スマッシュフェイズ')
    // 小さい SP のユニットは BP が高く、希望で破壊する相手に選ばれる。
    state = onSquare(state, at(CENTER, 0), 'small', unit('SP500', 5000, 500), '先攻')
    state = onSquare(state, at(CENTER, 2), 'large', unit('SP1500', 1000, 1500), '先攻')
    state = withZone(state, '後攻', 'スマッシュゾーン', smashes)
    state = withZone(state, '後攻', 'プランゾーン', [instantiate({ id: 'plan', card: hoping, owner: '後攻' })])
    state = withZone(state, '後攻', 'エネルギーゾーン', [instantiate({ id: 'e', card: energy, owner: '後攻' })])

    expect(picked(state)).toEqual({ kind: 'スマッシュする', unit: 'small' })
  })
})

describe('メインフェイズ', () => {
  /** 総合ルール 第1部 第2章 3-1、第3部 第8章 2-1。 */
  it('レベルを満たすカードが手札にあれば、優先権を放棄しない', () => {
    const state = withZone(sceneAt('メインフェイズ'), '先攻', '手札', [
      instantiate({ id: 'h', card: unit('手札', 3000, 1000), owner: '先攻' }),
    ])

    expect(picked(state)).not.toEqual(PASS)
    expect(picked(state)?.kind).toBe('カードをプレイする')
  })

  /** 総合ルール 第3部 第13章 1、第15章 1、第4部 第14章 4-6。 */
  it('BP で負けるユニットのいるスクエアには、ユニットを出さない', () => {
    let state = withZone(sceneAt('メインフェイズ'), '先攻', '手札', [
      instantiate({ id: 'h', card: unit('弱い', 1000, 1000), owner: '先攻' }),
    ])
    state = onSquare(state, at(OWN_AREA, 0), 'e1', unit('強い敵', 5000, 0), '後攻')
    state = onSquare(state, at(CENTER, 1), 'e2', unit('強い敵', 5000, 0), '後攻')

    const action = picked(state)
    expect(action?.kind).toBe('カードをプレイする')
    if (action?.kind !== 'カードをプレイする') return
    expect(action.declaration.square).not.toEqual(at(OWN_AREA, 0))
    expect(action.declaration.square).not.toEqual(at(CENTER, 1))
  })

  /** 総合ルール 第3部 第13章 1、第15章 1。勝てるなら、空いたスクエアより敵のいるスクエアへ出す。 */
  it('味方エリアにいる敵に勝てるなら、そのスクエアへ出す', () => {
    let state = withZone(sceneAt('メインフェイズ'), '先攻', '手札', [
      instantiate({ id: 'h', card: unit('強い', 5000, 1000), owner: '先攻' }),
    ])
    state = onSquare(state, at(OWN_AREA, 0), 'e', unit('弱い敵', 1000, 1000), '後攻')

    expect(picked(state)).toEqual({ kind: 'カードをプレイする', declaration: { card: 'h', square: at(OWN_AREA, 0) } })
  })

  /** 総合ルール 第2部 第20章 1-5。中央エリアにプレイしたユニットは、バトルが発生しなければ捨札に置かれる。 */
  it('空いている中央エリアには、ユニットを出さない', () => {
    const state = withZone(sceneAt('メインフェイズ'), '先攻', '手札', [
      instantiate({ id: 'h', card: unit('手札', 3000, 1000), owner: '先攻' }),
    ])

    const action = picked(state)
    expect(action?.kind).toBe('カードをプレイする')
    if (action?.kind !== 'カードをプレイする') return
    expect(action.declaration.square?.row).toBe(OWN_AREA)
  })

  /** 総合ルール 第3部 第9章 1。敵エリアからスマッシュすると＋500 になるので、空いた敵エリアへ進む。 */
  it('ユニットを、空いている敵エリアへ移動する', () => {
    const state = onSquare(sceneAt('メインフェイズ'), at(CENTER, 0), 'a', unit('進む', 3000, 1000), '先攻')

    expect(picked(state)).toEqual({ kind: 'ユニットを移動する', unit: 'a', destination: at(ENEMY_AREA, 0) })
  })

  /** 総合ルール 第3部 第8章 2-5。点数の差が小さい場所どうしを、行ったり来たりしない。 */
  it('同じメインフェイズに、同じユニットを空いたスクエアへ 2 回は移動しない', () => {
    // 敵エリアへ進んだ後も、中央のラインから端のラインへ動けば、少しだけ点数が上がる（`positionWorth`）。
    const wandering = defineUnit({ name: 'テスト・上と右に動ける', level: 0, bp: 3000, sp: 1000, moveIcon: ['上', '右'] })
    const state = onSquare(sceneAt('メインフェイズ'), at(CENTER, 1), 'a', wandering, '先攻')

    const first = picked(state)
    expect(first).toEqual({ kind: 'ユニットを移動する', unit: 'a', destination: at(ENEMY_AREA, 1) })
    if (first === undefined) return
    const progress = applyWithAnswers(state, first, [])
    if (progress.kind !== '進んだ') throw new Error('移動は選ばせない')
    // 移動すると相手に優先権が移る（総合ルール 第4部 第6章 2-5）。相手が放棄して戻ってきた所を参照する。
    const back = { ...progress.state, turn: { ...progress.state.turn, priority: '先攻' as const } }

    expect(picked(back)).toEqual(PASS)
  })
})

describe('エネルギーフェイズ', () => {
  const energy = (id: string): CardInstance => instantiate({ id, card: unit('エネルギー', 0, 0), owner: '先攻' })

  /** 総合ルール 第3部 第7章 1。目標の枚数は、自分のデッキのカードの最大レベルである。 */
  it('目標の枚数は、デッキのカードの最大レベル', () => {
    expect(energyTargetOf([unit('a', 0, 0, 2), unit('b', 0, 0, 6), unit('c', 0, 0, 4)])).toBe(6)
  })

  it('目標の枚数に届くまでは、置く', () => {
    const state = withZone(sceneAt('エネルギーフェイズ'), '先攻', '手札', [
      instantiate({ id: 'h', card: unit('手札', 5000, 2000, 1), owner: '先攻' }),
    ])

    expect(picked(state)).toEqual({ kind: 'エネルギーを置く', card: 'h' })
  })

  /**
   * 目標の枚数を超えた後は、手札に持っておく値打ちが低いカードなら置き、高いカードなら置かない。
   * 盤面のデッキは、置いてあるカードと手札だけである（`ownDeckOf`）。
   */
  it('目標の枚数を超えた後は、手札に持っておく値打ちで置くかを決定する', () => {
    const placed = withZone(sceneAt('エネルギーフェイズ'), '先攻', 'エネルギーゾーン', [energy('e0')])

    const weak = withZone(placed, '先攻', '手札', [instantiate({ id: 'w', card: unit('弱い', 500, 0), owner: '先攻' })])
    expect(picked(weak)).toEqual({ kind: 'エネルギーを置く', card: 'w' })

    const strong = withZone(placed, '先攻', '手札', [
      instantiate({ id: 's', card: unit('強い', 5000, 2000), owner: '先攻' }),
    ])
    expect(picked(strong)).toEqual(PASS)
  })
})

describe('選択への答え', () => {
  /** 効果の損得は、効果を空回しして判定する（ADR-0062）。 */
  it('相手のユニットへのダメージの対象に、自分のユニットを選ばない', () => {
    const burn = defineStrategy({
      name: 'テスト・ユニットに3000ダメージ',
      level: 0,
      effect: function* (duel) {
        const target = yield* choose([...duel.allies(), ...duel.enemies()])
        if (target !== undefined) yield* damageUnit(target, 3000)
      },
    })
    let state = withZone(sceneAt('メインフェイズ'), '先攻', '手札', [
      instantiate({ id: 'burn', card: burn, owner: '先攻' }),
    ])
    state = onSquare(state, at(OWN_AREA, 0), 'own', unit('味方', 2000, 1000), '先攻')
    state = onSquare(state, at(ENEMY_AREA, 0), 'enemy', unit('敵', 2000, 1000), '後攻')

    const play = legalActions(state).find((action) => action.kind === 'カードをプレイする')
    if (play === undefined) throw new Error('ストラテジーをプレイできるはずだった')
    const progress = applyWithAnswers(state, play, [])
    if (progress.kind !== '選んでほしい') throw new Error('対象を選ばせるはずだった')

    const { answer } = scoredCpu.answer(choiceViewOf(progress.board, progress.choice), randomFromSeed(1))
    expect(typeof answer).toBe('number')
    if (typeof answer !== 'number') return
    expect(progress.choice.candidates[answer]).toEqual({ kind: '見えている', card: 'enemy' })
  })
})
