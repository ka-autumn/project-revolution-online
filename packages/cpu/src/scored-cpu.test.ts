import { describe, expect, it } from 'vitest'
import {
  abilityGranting,
  applyWithAnswers,
  choose,
  createTriggeredAbilityForDiscardedCard,
  damageUnit,
  defineStrategy,
  defineUnit,
  destroy,
  dream,
  emptyDuelState,
  granting,
  hope,
  instantiate,
  placeInZone,
  legalActions,
  lookAtOpponentHandAndDiscard,
  mayDo,
  movePreventing,
  placeTopOfLibrary,
  putOnSquare,
  randomFromSeed,
  squaresAdjacent,
  triggeredAbility,
  trust,
} from '@revolution/engine'
import type {
  Card,
  CardInstance,
  ChoiceAnswer,
  DuelState,
  HandCondition,
  LegalAction,
  Phase,
  Player,
  PlayerZone,
  RecordedEvent,
  Square,
  WireChoice,
} from '@revolution/engine'
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
    Array.from({ length: 20 }, (_, index) => instantiate({ id: `${player}-山札${index}`, card: unit('山札', 0, 0), owner: player }))
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

  /**
   * 相手のスマッシュを `smashes` 枚にし、相手のプランに、発動できる希望を持つカードを置いた盤面。
   * 希望の効果を渡さなければ、プランを置かない。
   */
  function withOpponentHope(state: DuelState, smashes: number, effect?: Parameters<typeof hope>[0]): DuelState {
    const energy = defineUnit({ name: 'テスト・赤のエネルギー', level: 0, colors: ['赤'], bp: 0, sp: 0 })
    const cards = Array.from({ length: smashes }, (_, index) =>
      instantiate({ id: `s${index}`, card: unit('スマッシュ', 0, 0), owner: '後攻' }),
    )
    let next = withZone(state, '後攻', 'スマッシュゾーン', cards)
    next = withZone(next, '後攻', 'エネルギーゾーン', [instantiate({ id: 'e', card: energy, owner: '後攻' })])
    if (effect === undefined) return next

    const hoping = defineUnit({
      name: 'テスト・希望',
      level: 1,
      colors: ['赤'],
      bp: 1000,
      sp: 0,
      abilities: [hope(effect)],
    })
    return withZone(next, '後攻', 'プランゾーン', [instantiate({ id: 'plan', card: hoping, owner: '後攻' })])
  }

  /**
   * 総合ルール 第3部 第19章 1、第20章 1、第5部 第3章 2。
   *
   * 相手の希望が「自分のスマッシュを 1 枚捨札に置く」なら、スマッシュしても相手のスマッシュの枚数は
   * 変化しない。スマッシュを取り除く損は 1 回だけ差し引く。損得が釣り合うなら、相手に希望のカードを
   * 使わせるためにスマッシュする。
   */
  it('相手の希望がスマッシュを 1 枚取り除くだけなら、スマッシュする', () => {
    let state = onSquare(sceneAt('スマッシュフェイズ'), at(CENTER, 0), 'a', unit('中央', 1000, 1000), '先攻')
    state = withOpponentHope(state, 3, function* (duel) {
      const [smash] = duel.smashZone()
      if (smash !== undefined) yield* placeInZone(smash, '捨札', 'リリース')
    })

    expect(picked(state)).toEqual({ kind: 'スマッシュする', unit: 'a' })
  })

  /**
   * 総合ルール 第3部 第17章 1、第19章 1、第5部 第3章 2。
   *
   * 相手のプランに、発動できて味方エリアのユニットを破壊する希望がある。スマッシュしてスマッシュ判定に
   * なると、スマッシュ 1 枚より大きい損になるので、スマッシュできるユニットがいても放棄する。#366 の
   * 完了条件「スマッシュフェイズに、スマッシュできるユニットがいれば、優先権を放棄しない」の例外として、
   * 開発者と決定した。
   */
  describe('相手の希望で大きな損をする時は、スマッシュを見送る', () => {
    function scene(withHope: boolean): DuelState {
      let state = onSquare(sceneAt('スマッシュフェイズ'), at(CENTER, 0), 'a', unit('中央', 1000, 1000), '先攻')
      state = onSquare(state, at(OWN_AREA, 1), 'big', unit('守り', 9000, 2000), '先攻')
      return withOpponentHope(
        state,
        3,
        withHope
          ? function* (duel) {
              const target = yield* choose(duel.enemies())
              if (target !== undefined) yield* destroy(target)
            }
          : undefined,
      )
    }

    it('希望があれば、放棄する', () => {
      expect(picked(scene(true))).toEqual(PASS)
    })

    it('希望が無ければ、スマッシュする', () => {
      expect(picked(scene(false))).toEqual({ kind: 'スマッシュする', unit: 'a' })
    })
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

  /**
   * 総合ルール 第3部 第15章 1、第4部 第14章 4-6、第1部 第2章 3-4。
   *
   * 負けるバトルでも、同じターンのうちに続けて倒しきれるなら攻め込む。#366 の完了条件「BP で負ける
   * ユニットのいるスクエアには、ユニットを出さない」の例外として、開発者と決定した。レベル 0 の
   * カードは、エネルギーが無くても続けてプレイできる。
   */
  it('負けるバトルでも、続けて倒しきれるなら攻め込む', () => {
    let state = withZone(sceneAt('メインフェイズ'), '先攻', '手札', [
      instantiate({ id: 'first', card: unit('先に攻める', 2000, 0), owner: '先攻' }),
      instantiate({ id: 'second', card: unit('続けて攻める', 2500, 0), owner: '先攻' }),
    ])
    state = onSquare(state, at(OWN_AREA, 0), 'e', unit('強い敵', 4000, 1000), '後攻')

    const action = picked(state)
    expect(action?.kind).toBe('カードをプレイする')
    if (action?.kind !== 'カードをプレイする') return
    expect(action.declaration.square).toEqual(at(OWN_AREA, 0))
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

})

describe('ユニットの移動', () => {
  /** 移動した後、相手が放棄して優先権が戻ってきた盤面。移動すると相手に優先権が移る（総合ルール 第4部 第6章 2-5）。 */
  function afterMove(state: DuelState, action: LegalAction): DuelState {
    const progress = applyWithAnswers(state, action, [])
    if (progress.kind !== '進んだ') throw new Error('移動は選ばせない')
    return { ...progress.state, turn: { ...progress.state.turn, priority: '先攻' } }
  }

  /** 総合ルール 第3部 第8章 2-5、第3部 第9章 1。前へ進む移動は、同じメインフェイズに何回でも行う。 */
  it('同じメインフェイズのうちに、味方エリアから敵エリアまで進む', () => {
    const state = onSquare(sceneAt('メインフェイズ'), at(OWN_AREA, 0), 'a', unit('進む', 3000, 1000), '先攻')

    const first = picked(state)
    expect(first).toEqual({ kind: 'ユニットを移動する', unit: 'a', destination: at(CENTER, 0) })
    if (first === undefined) return

    expect(picked(afterMove(state, first))).toEqual({ kind: 'ユニットを移動する', unit: 'a', destination: at(ENEMY_AREA, 0) })
  })

  /** 前へ進んだ後に、目的の無い横の移動はしない。 */
  it('前へ進んだ後に、空いたスクエアへ横に移動しない', () => {
    // 敵エリアへ進んだ後も、中央のラインから端のラインへ動けば、少しだけ点数が上がる（`positionBasePoints`）。
    const wandering = defineUnit({ name: 'テスト・上と右に動ける', level: 0, bp: 3000, sp: 1000, moveIcon: ['上', '右'] })
    const state = onSquare(sceneAt('メインフェイズ'), at(CENTER, 1), 'a', wandering, '先攻')

    const first = picked(state)
    expect(first).toEqual({ kind: 'ユニットを移動する', unit: 'a', destination: at(ENEMY_AREA, 1) })
    if (first === undefined) return

    expect(picked(afterMove(state, first))).toEqual(PASS)
  })

  /**
   * 総合ルール 第5部 第4章 2。信頼を持つユニットは、中央のラインに置くと左右の 2 スクエアを守れる。
   * 中央のラインにいるユニットを横へ動かして、場所を空ける。
   */
  it('信頼を持つユニットをプレイする場所を空けるために、横へ移動する', () => {
    const sliding = defineUnit({ name: 'テスト・左右に動ける', level: 0, bp: 3000, sp: 1000, moveIcon: ['左', '右'] })
    const guarding = defineUnit({ name: 'テスト・信頼', level: 0, bp: 3000, sp: 1000, abilities: [trust] })
    let state = onSquare(sceneAt('メインフェイズ'), at(OWN_AREA, 1), 'a', sliding, '先攻')
    state = withZone(state, '先攻', '手札', [instantiate({ id: 'h', card: guarding, owner: '先攻' })])

    const action = picked(state)
    expect(action?.kind).toBe('ユニットを移動する')
    if (action?.kind !== 'ユニットを移動する') return
    expect(action.destination.row).toBe(OWN_AREA)
  })

  /**
   * 総合ルール 第3部 第9章 1、第3部 第15章 1。BP が高く SP が低いユニットは、中央エリアにいてもスマッシュで
   * 与えるダメージが小さい。味方エリアへ入って来られる敵を倒せるなら、下がって守る。
   */
  it('BP が高く SP が低いユニットは、味方エリアへ入って来る敵を倒すために下がる', () => {
    const retreating = defineUnit({ name: 'テスト・下がれる', level: 0, bp: 5000, sp: 0, moveIcon: ['下'] })
    // 後攻から見た「左」は、先攻から見て列が 1 つ増える向きである（`board.ts` の `squareInDirection`）。
    const invading = defineUnit({ name: 'テスト・横に動ける敵', level: 0, bp: 2000, sp: 1000, moveIcon: ['左'] })
    let state = onSquare(sceneAt('メインフェイズ'), at(CENTER, 2), 'a', retreating, '先攻')
    state = onSquare(state, at(OWN_AREA, 1), 'e', invading, '後攻')

    expect(picked(state)).toEqual({ kind: 'ユニットを移動する', unit: 'a', destination: at(OWN_AREA, 2) })
  })
})

// 総合ルール 第3部 第8章 2-5（ADR-0068）。移動を妨げる常在型能力で動けないユニットは、見積もりにも動けないものとして入る。
describe('移動を妨げる常在型能力', () => {
  /** 「隣にいる敵と味方は移動できない」というテキストの常在型能力を持つ、動かないユニット。 */
  const guard = defineUnit({
    name: 'テスト・隣を止める',
    level: 0,
    bp: 1000,
    sp: 0,
    abilities: [
      movePreventing((duel, occasion) => {
        const self = duel.self()
        if (self === undefined || self.id === occasion.unit.id) return false
        return squaresAdjacent(self.square).some(
          (beside) => beside.row === occasion.unit.square.row && beside.column === occasion.unit.square.column,
        )
      }),
    ],
  })

  /** 下がって守る場面（上の「ユニットの移動」と同じ）。敵のいるスクエアの隣に、敵ごと動きを止めるユニットを置ける。 */
  function retreatScene(withGuard: boolean): DuelState {
    const retreating = defineUnit({ name: 'テスト・下がれる', level: 0, bp: 5000, sp: 0, moveIcon: ['下'] })
    const invading = defineUnit({ name: 'テスト・横に動ける敵', level: 0, bp: 2000, sp: 1000, moveIcon: ['左'] })
    let state = onSquare(sceneAt('メインフェイズ'), at(CENTER, 2), 'a', retreating, '先攻')
    state = onSquare(state, at(OWN_AREA, 1), 'e', invading, '後攻')
    return withGuard ? onSquare(state, at(OWN_AREA, 0), 'g', guard, '後攻') : state
  }

  it('味方エリアへ入って来る敵が動けないなら、下がって守らない', () => {
    const retreat = { kind: 'ユニットを移動する', unit: 'a', destination: at(OWN_AREA, 2) }

    expect(picked(retreatScene(false))).toEqual(retreat)
    expect(picked(retreatScene(true))).not.toEqual(retreat)
  })

  /** 負けるバトルの後の追い打ちを、動けない味方に期待しない。 */
  function followUpScene(withGuard: boolean): DuelState {
    const follower = defineUnit({ name: 'テスト・追い打ちする味方', level: 0, bp: 2500, sp: 0, moveIcon: ['下'] })
    let state = withZone(sceneAt('メインフェイズ'), '先攻', '手札', [
      instantiate({ id: 'first', card: unit('先に攻める', 2000, 0), owner: '先攻' }),
    ])
    state = onSquare(state, at(OWN_AREA, 0), 'e', unit('強い敵', 4000, 1000), '後攻')
    state = onSquare(state, at(CENTER, 0), 'f', follower, '先攻')
    return withGuard ? onSquare(state, at(CENTER, 1), 'g', guard, '後攻') : state
  }

  it('追い打ちできる味方が動けないなら、負けるバトルに攻め込まない', () => {
    const attack = { kind: 'カードをプレイする', declaration: { card: 'first', square: at(OWN_AREA, 0) } }

    expect(picked(followUpScene(false))).toEqual(attack)
    expect(picked(followUpScene(true))).not.toEqual(attack)
  })
})

describe('プラン', () => {
  /** リリース状態のスマッシュ 1 枚。プランのコストに使える（総合ルール 第2部 第21章 7-5）。 */
  const smash = instantiate({ id: 'smash', card: unit('スマッシュ', 0, 0), owner: '先攻' })

  /**
   * 総合ルール 第3部 第8章 2-3。いまのプランが、レベルを満たせず基礎点も低いカードなら、スマッシュで
   * 支払って次のカードを表にする。
   */
  it('残す理由の無いプランは、捨札に置いて次のカードを表にする', () => {
    let state = withZone(sceneAt('メインフェイズ'), '先攻', 'スマッシュゾーン', [smash])
    state = withZone(state, '先攻', 'プランゾーン', [
      instantiate({ id: 'plan', card: unit('重い', 1000, 0, 9), owner: '先攻' }),
    ])

    expect(picked(state)).toEqual({ kind: 'プランする' })
  })

  /** 総合ルール 第5部 第3章 2。相手にスマッシュされうる時は、発動できる希望を持つプランを残す。 */
  it('相手にスマッシュされうる時は、発動できる希望を持つプランを残す', () => {
    const hoping = defineUnit({
      name: 'テスト・希望',
      level: 1,
      colors: ['赤'],
      bp: 1000,
      sp: 0,
      abilities: [hope(function* () {})],
    })
    const energy = defineUnit({ name: 'テスト・赤のエネルギー', level: 0, colors: ['赤'], bp: 0, sp: 0 })
    let state = withZone(sceneAt('メインフェイズ'), '先攻', 'スマッシュゾーン', [smash])
    state = withZone(state, '先攻', 'プランゾーン', [instantiate({ id: 'plan', card: hoping, owner: '先攻' })])
    state = withZone(state, '先攻', 'エネルギーゾーン', [
      instantiate({ id: 'e', card: energy, owner: '先攻', orientation: 'フリーズ' }),
    ])
    // 相手の中央エリアにいるユニットは、次の相手のターンにスマッシュできる（総合ルール 第3部 第9章 1）。
    state = onSquare(state, at(CENTER, 1), 'enemy', unit('敵', 9000, 1000), '後攻')

    expect(picked(state)).not.toEqual({ kind: 'プランする' })
  })
})

describe('プラン（与えられた「夢」）', () => {
  /** リリース状態のスマッシュ 1 枚。プランのコストに使える（総合ルール 第2部 第21章 7-5）。 */
  const smash = instantiate({ id: 'smash', card: unit('スマッシュ', 0, 0), owner: '先攻' })
  /**
   * レベルを満たせる、基礎点の無いプラン。「夢」を持たない。プレイしても得が無いので、プレイする点数より
   * プランする点数が高くなり、プランを残す判定（`keepsPlan`）だけが、プランするかどうかを分ける。
   */
  const lightPlan = defineUnit({ name: 'テスト・軽いプラン', level: 1, colors: ['赤'], bp: 0, sp: 0 })
  const energy = defineUnit({ name: 'テスト・赤のエネルギー', level: 0, colors: ['赤'], bp: 0, sp: 0 })
  /** 自分のプランゾーンのカードに「夢」を与える常在型能力を持つユニット（ADR-0070）。 */
  const planGranter = defineUnit({
    name: 'テスト・プランへ夢を与えるユニット',
    level: 0,
    bp: 1000,
    sp: 0,
    abilities: [abilityGranting((duel) => duel.planZone().map((card) => granting(card, dream)))],
  })

  /** 同じユニットでも、何も与えないもの。与えられた「夢」の有無だけを変更して比べるための対照。 */
  const idleGranter = defineUnit({
    name: 'テスト・何も与えないユニット',
    level: 0,
    bp: 1000,
    sp: 0,
    abilities: [abilityGranting(() => [])],
  })

  function scene(granter?: Card): DuelState {
    let state = withZone(sceneAt('メインフェイズ'), '先攻', 'スマッシュゾーン', [smash])
    state = withZone(state, '先攻', 'プランゾーン', [instantiate({ id: 'plan', card: lightPlan, owner: '先攻' })])
    state = withZone(state, '先攻', 'エネルギーゾーン', [instantiate({ id: 'e', card: energy, owner: '先攻' })])
    return granter === undefined ? state : onSquare(state, at(OWN_AREA, 0), 'granter', granter, '先攻')
  }

  /** 総合ルール 第5部 第1章 2。与えられた「夢」でプランゾーンからプレイできるプランは、捨札に置かずに残す。 */
  it('与えられた「夢」でプレイできるプランは、捨札に置かずにプレイする', () => {
    expect(picked(scene())).toEqual({ kind: 'プランする' })
    expect(picked(scene(idleGranter))).toEqual({ kind: 'プランする' })
    expect(picked(scene(planGranter))).toMatchObject({ kind: 'カードをプレイする', declaration: { card: 'plan' } })
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
   * 目標の枚数を超えた後は、手札に持っておく基礎点が低いカードなら置き、高いカードなら置かない。
   * 盤面のデッキは、置いてあるカードと手札だけである（`ownDeckOf`）。
   */
  it('目標の枚数を超えた後は、手札に持っておく基礎点で置くかを決定する', () => {
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
  /**
   * 効果を空回しできず（ここでは発生源が分からない）、候補が味方だけで、選ばないことも選べる時は、
   * 選ばない。効果の向きが分からない時に、味方を破壊するような外れ方を避ける。
   */
  it('効果の向きが分からず、候補が味方だけなら、選ばない', () => {
    let state = onSquare(sceneAt('メインフェイズ'), at(OWN_AREA, 0), 'own1', unit('味方', 2000, 1000), '先攻')
    state = onSquare(state, at(OWN_AREA, 1), 'own2', unit('味方', 3000, 1000), '先攻')
    const choice = {
      player: '先攻',
      purpose: '効果の対象',
      mayDecline: true,
      answered: 0,
      mayGoBack: false,
      mayCancel: false,
      candidates: [
        { kind: '見えている', card: 'own1' },
        { kind: '見えている', card: 'own2' },
      ],
    } as const

    expect(scoredCpu.answer(choiceViewOf(state, choice), randomFromSeed(1)).answer).toBe('選ばない')
  })

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

/**
 * EB1.0 の 069 と同じ形の能力（捨札に置かれた時、そのターンの終わりに、捨札のこのカードを手札に加えて
 * もよい。そうしたら、手札を 1 枚捨てる）。手札が戻ったこのカードだけなら、捨てる 1 枚もこのカードになり、
 * また誘発する。エンジンはこの繰り返しを止めず、支配者が断れば止まる（ADR-0059）。
 */
describe('同じターンの終わりに手札へ戻る「してもよい」', () => {
  const RETURNING = '戻るユニット'
  const STRATEGY = '山札の上を捨札に置く'

  const returning = defineUnit({
    name: 'テスト・捨札から戻る',
    level: 7,
    bp: 6500,
    sp: 2500,
    abilities: [
      triggeredAbility('このカードが捨札に置かれた時', function* (_duel, placed) {
        yield* createTriggeredAbilityForDiscardedCard(placed, 'ターンの終わり', '手札に加えてもよい。そうしたら、手札を1枚捨てる', function* (duel, affected) {
          const inDiscardPile = duel.discardPile().find((each) => each.id === affected.id)
          const added = yield* mayDo(inDiscardPile === undefined ? [] : [inDiscardPile], '手札に加える')
          if (!added) return

          const discarded = yield* choose(duel.hand())
          if (discarded !== undefined) yield* placeInZone(discarded, '捨札', 'リリース')
        })
      }),
    ],
  })

  const milling = defineStrategy({
    name: 'テスト・山札の上を捨札に置く',
    level: 0,
    effect: function* () {
      yield* placeTopOfLibrary('捨札', 'リリース')
    },
  })

  /** 先攻の手札はストラテジー 1 枚だけで、山札の 1 番上に戻るユニットがある盤面。 */
  function scene(): DuelState {
    const base = sceneAt('メインフェイズ')
    const withStrategy = withZone(base, '先攻', '手札', [instantiate({ id: STRATEGY, card: milling, owner: '先攻' })])
    const library = withStrategy.zones.先攻.山札
    return {
      ...withStrategy,
      zones: {
        ...withStrategy.zones,
        先攻: { ...withStrategy.zones.先攻, 山札: [instantiate({ id: RETURNING, card: returning, owner: '先攻' }), ...library] },
      },
    }
  }

  /** 行動を 1 つ、選択には CPU が答えながら適用する。答えが `limit` 件を超えたら投げる。 */
  function applyAnswering(state: DuelState, action: LegalAction, limit: number): { state: DuelState; answers: number } {
    const answers: ChoiceAnswer[] = []
    for (;;) {
      const progress = applyWithAnswers(state, action, answers)
      if (progress.kind === '進んだ') return { state: progress.state, answers: answers.length }
      if (answers.length >= limit) throw new Error('選択への答えが終わらない')

      answers.push(scoredCpu.answer(choiceViewOf(progress.board, progress.choice), randomFromSeed(answers.length)).answer)
    }
  }

  it('先攻の手札が 0 枚でも、CPU が答えるとそのターンが有限回で終わる', () => {
    const played = applyAnswering(scene(), { kind: 'カードをプレイする', declaration: { card: STRATEGY } }, 20).state
    expect(played.zones.先攻.手札).toEqual([])
    expect(played.zones.先攻.捨札.map((each) => each.id)).toContain(RETURNING)

    let state = played
    let steps = 0
    while (state.turn.number === played.turn.number) {
      if (steps >= 100) throw new Error('ターンが終わらない')
      const action = scoredCpu.pickAction(actionViewOf(state, state.turn.priority), randomFromSeed(steps))?.action
      if (action === undefined) throw new Error('CPU が手を選ばなかった')
      state = applyAnswering(state, action, 20).state
      steps += 1
    }

    expect(state.turn.number).toBe(played.turn.number + 1)
    // 1 回目は手札に加え、戻った自分を捨てて、また聞かれた 2 回目は断る。
    const asked = state.log.flatMap(({ event }) =>
      event.kind === '命令を実行した' && event.instruction.kind === 'してもよいか聞く' ? [event.instruction.answer] : [],
    )
    expect(asked).toEqual(['はい', 'いいえ'])
    expect(state.zones.先攻.捨札.map((each) => each.id)).toContain(RETURNING)
  })

  describe('前に答えた「してもよい」のうち、断る理由にするもの', () => {
    const seenBy = { 先攻: [RETURNING], 後攻: [RETURNING] }
    const choice: WireChoice = {
      player: '先攻',
      purpose: 'してもよい',
      mayDecline: true,
      answered: 0,
      mayGoBack: false,
      mayCancel: false,
      candidates: [{ kind: '確認' }],
      may: { action: '手札に加える', targets: [RETURNING] },
    }

    /** そのターンから次のターンへ進んだ行。`from` と `to` が同じなら、リカバリーフェイズのやり直し。 */
    const progressed = (from: number | undefined, to: number): RecordedEvent => ({
      event: {
        kind: '進行が変わった',
        from: from === undefined ? undefined : { turn: from, active: '先攻', phase: 'リカバリーフェイズ' },
        to: { turn: to, active: '先攻', phase: from === to ? 'リカバリーフェイズ' : 'リリースフェイズ' },
      },
      during: [],
      seenBy,
    })

    const answered = (controller: Player, answer: 'はい' | 'いいえ'): RecordedEvent => ({
      event: {
        kind: '命令を実行した',
        controller,
        instruction: { kind: 'してもよいか聞く', action: '手札に加える', count: 1, cards: [RETURNING], answer },
      },
      during: [],
      seenBy,
    })

    const answerWith = (log: readonly RecordedEvent[]) =>
      scoredCpu.answer(choiceViewOf({ ...emptyDuelState(), log }, choice), randomFromSeed(1)).answer

    it.each([
      ['同じターンに自分が「はい」と答えていれば、断る', [progressed(undefined, 1), answered('先攻', 'はい')], '選ばない'],
      ['リカバリーフェイズがやり直されても、同じターンなので断る', [progressed(undefined, 1), answered('先攻', 'はい'), progressed(1, 1)], '選ばない'],
      ['「はい」が前のターンなら、また「はい」と答える', [progressed(undefined, 1), answered('先攻', 'はい'), progressed(1, 2)], 0],
      ['「はい」と答えたのが相手なら、「はい」と答える', [progressed(undefined, 1), answered('後攻', 'はい')], 0],
      ['自分の前の答えが「いいえ」なら、「はい」と答える', [progressed(undefined, 1), answered('先攻', 'いいえ')], 0],
    ] as const)('%s', (_label, log, expected) => {
      expect(answerWith(log)).toBe(expected)
    })
  })
})

// ADR-0069。相手の手札を見て選ぶ選択では、相手の手札のカードは盤面に載っていない（枚数だけ）ので、
// CPU は選択の要求が見せる一覧から、候補のカードを引いて点数を付ける。
describe('相手の手札を見て選ぶ選択への答え', () => {
  const discarder = (conditions: readonly HandCondition[], upTo: boolean) =>
    defineStrategy({
      name: 'テスト・見て捨てる',
      level: 0,
      effect: function* () {
        yield* lookAtOpponentHandAndDiscard(conditions, { upTo })
      },
    })

  function asked(card: ReturnType<typeof discarder>, opponentHand: readonly CardInstance[]) {
    const state = withZone(withZone(sceneAt('メインフェイズ'), '先攻', '手札', [instantiate({ id: 'play', card, owner: '先攻' })]), '後攻', '手札', opponentHand)
    const play = legalActions(state).find((action) => action.kind === 'カードをプレイする')
    if (play === undefined) throw new Error('ストラテジーをプレイできるはずだった')
    const progress = applyWithAnswers(state, play, [])
    if (progress.kind !== '選んでほしい') throw new Error('選ばせるはずだった')

    return progress
  }

  const hand = [
    instantiate({ id: 'weak', card: unit('弱い', 1000, 500), owner: '後攻' }),
    instantiate({ id: 'strong', card: unit('強い', 6000, 2000), owner: '後攻' }),
    instantiate({ id: 'middle', card: unit('普通', 3000, 1000), owner: '後攻' }),
  ]

  // 点数が同じなら乱数で選ぶので、実装が無ければ seed によって別の答えになる。どの seed でも同じカードになることで確かめる。
  const pickedWith = (upTo: boolean): readonly (string | undefined)[] => {
    const progress = asked(discarder([], upTo), hand)
    return Array.from({ length: 20 }, (_, seed) => {
      const { answer } = scoredCpu.answer(choiceViewOf(progress.board, progress.choice), randomFromSeed(seed))
      const candidate = typeof answer === 'number' ? progress.choice.candidates[answer] : undefined
      return candidate?.kind === '見えている' ? candidate.card : undefined
    })
  }

  it('候補のうち、基礎点が最も高いカードを、どの seed でも選ぶ', () => {
    expect(new Set(pickedWith(false))).toEqual(new Set(['strong']))
  })

  it('1 枚までの形でも、候補があれば選ばないとは答えず、基礎点が最も高いカードを選ぶ', () => {
    expect(new Set(pickedWith(true))).toEqual(new Set(['strong']))
  })

  it('絞り込みに合うカードが無い確認だけの選択には、確認した（0 番）と答える', () => {
    const progress = asked(discarder([{ axis: '種別', value: 'トラップ' }], true), hand)

    expect(progress.choice.candidates).toEqual([{ kind: '確認' }])
    expect(scoredCpu.answer(choiceViewOf(progress.board, progress.choice), randomFromSeed(1)).answer).toBe(0)
  })

  // 同じ問いを繰り返さない: 答えの後、効果は先へ進み、同じ選択は出ない。
  it('答えると効果が進み、同じ問いを繰り返さない', () => {
    const progress = asked(discarder([], false), hand)
    const { answer } = scoredCpu.answer(choiceViewOf(progress.board, progress.choice), randomFromSeed(1))
    const state = withZone(withZone(sceneAt('メインフェイズ'), '先攻', '手札', [instantiate({ id: 'play', card: discarder([], false), owner: '先攻' })]), '後攻', '手札', hand)
    const play = legalActions(state).find((action) => action.kind === 'カードをプレイする')
    if (play === undefined) throw new Error('ストラテジーをプレイできるはずだった')

    const next = applyWithAnswers(state, play, [answer as number])

    expect(next.kind).toBe('進んだ')
  })
})
