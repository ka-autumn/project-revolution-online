import { describe, expect, it } from 'vitest'
// ダメージを与えたり山札を積んだりするためだけに `dealDamage` と `putInZone` を使う。
// engine の中から盤面を組み替えるための関数であり、公開する API ではない。
import { dealDamage, putInZone } from './duel.js'
import {
  PLAYERS,
  cardsIn,
  cardsOn,
  defineStrategy,
  defineUnit,
  emptyDuelState,
  instantiate,
  passPriority,
  prepareDuel,
  putOnSquare,
  triggeredAbility,
} from './index.js'
import type { CardInstance, Chooser, Deck, DuelState, Player, Square } from './index.js'

// 検証したいルールだけを持つ架空のテストカード（ADR-0002）。
const vanilla = defineUnit({ name: 'テスト・バニラ', level: 1, colors: ['赤'], bp: 1000, sp: 1000 })

const strategy = defineStrategy({ name: 'テスト・ストラテジー', level: 1, colors: ['赤'] })

/** 「エネルギーフェイズの始め」に誘発する能力を持つテストカード。効果は何もしない。 */
const beginner = defineUnit({
  name: 'テスト・エネルギーフェイズの始め',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [triggeredAbility('エネルギーフェイズの始め', function* () {})],
})

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

const someSquare: Square = { row: 2, column: 1 }
const anotherSquare: Square = { row: 0, column: 1 }
const centerSquare: Square = { row: 1, column: 1 }

const chooseFirst: Chooser = (candidates) => candidates[0]

function pass(state: DuelState): DuelState {
  return passPriority(state, chooseFirst)
}

type Placement = readonly [Square, CardInstance]

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
          instantiate({ id: `${player}の山札${index}`, card: vanilla, owner: player }),
        ),
      ),
    emptyDuelState(),
  )
}

function boardOf(...placements: readonly Placement[]): DuelState {
  return placements.reduce((state, [square, card]) => putOnSquare(state, square, card), stockedDuelState())
}

const idsOf = (cards: readonly CardInstance[]) => cards.map((card) => card.id)

// 総合ルール 第4部 第14章 2（ADR-0006）
describe('ルールエフェクトを解決する時', () => {
  const placed = boardOf([someSquare, instantiate({ id: 'ストラテジー', card: strategy, owner: '先攻' })])

  it('カードが置かれた時点では、まだ解決されない', () => {
    expect(idsOf(cardsOn(placed, someSquare))).toEqual(['ストラテジー'])
  })

  it('プレイヤーが優先権を獲得する時に解決される', () => {
    // 放棄すると、もう一方のプレイヤーが優先権を獲得する。
    expect(cardsOn(pass(placed), someSquare)).toEqual([])
  })
})

// 総合ルール 第4部 第14章 4-3（ADR-0006）
describe('ユニット以外のカードがスクエアにある', () => {
  it('持ち主の捨札に置かれる', () => {
    // 持ち主は後攻だが、支配しているのは先攻であるカード。
    const stolen = instantiate({ id: '奪われたストラテジー', card: strategy, owner: '後攻', controller: '先攻' })
    const checked = pass(boardOf([someSquare, stolen]))

    expect(idsOf(cardsIn(checked, '後攻', '捨札'))).toEqual(['奪われたストラテジー'])
    expect(cardsIn(checked, '先攻', '捨札')).toEqual([])
  })

  it('同じスクエアにいるユニットはそのまま残る', () => {
    const checked = pass(
      boardOf(
        [someSquare, instantiate({ id: 'ユニット', card: vanilla, owner: '先攻' })],
        [someSquare, instantiate({ id: 'ストラテジー', card: strategy, owner: '先攻' })],
      ),
    )

    expect(idsOf(cardsOn(checked, someSquare))).toEqual(['ユニット'])
  })
})

// 総合ルール 第4部 第14章 4-7（ADR-0006）
describe('同じプレイヤーが支配するユニットが同じスクエアに重なる', () => {
  const stacked = boardOf(
    [someSquare, instantiate({ id: '先にいたユニット', card: vanilla, owner: '先攻' })],
    [someSquare, instantiate({ id: '後から置かれたユニット', card: vanilla, owner: '先攻' })],
  )

  it('後から置かれたユニットが持ち主の捨札に置かれる', () => {
    expect(idsOf(cardsIn(pass(stacked), '先攻', '捨札'))).toEqual(['後から置かれたユニット'])
  })

  it('先に置かれていたユニットはスクエアに残る', () => {
    expect(idsOf(cardsOn(pass(stacked), someSquare))).toEqual(['先にいたユニット'])
  })

  // 支配者が違うユニットが重なった場合に起きるのはバトルの発生（同 4-4）であって、
  // このルールエフェクトではない。バトルの側は `battle.test.ts` で見るので、ここでは
  // 捨札に置かれないことだけを見る。
  it('支配者が違うユニットが重なっても、捨札には置かれない', () => {
    const opposed = boardOf(
      [anotherSquare, instantiate({ id: '先攻のユニット', card: vanilla, owner: '先攻' })],
      [anotherSquare, instantiate({ id: '後攻のユニット', card: vanilla, owner: '後攻' })],
    )

    expect(idsOf(cardsOn(pass(opposed), anotherSquare))).toEqual(['先攻のユニット', '後攻のユニット'])
  })
})

// 総合ルール 第4部 第14章 4-5（ADR-0006）
describe('ＢＰが 0 以下のユニットがスクエアにある', () => {
  // ここではＢＰが 0 と書かれているカードで見る。修整によって 0 以下になる場合は
  // `continuous.test.ts` が見る。
  const zeroBp = defineUnit({ name: 'テスト・ＢＰ0', level: 1, colors: ['赤'], bp: 0, sp: 1000 })

  it('持ち主の捨札に置かれる', () => {
    const placed = boardOf([someSquare, instantiate({ id: 'ＢＰ0のユニット', card: zeroBp, owner: '先攻' })])

    expect(idsOf(cardsIn(pass(placed), '先攻', '捨札'))).toEqual(['ＢＰ0のユニット'])
  })
})

// 総合ルール 第4部 第14章 4-6（ADR-0006）
describe('ＢＰと同じかそれ以上のダメージを受けたユニットがスクエアにある', () => {
  /** ＢＰ1000 のユニットがそのダメージを受けている盤面。 */
  function damaged(amount: number): DuelState {
    const unit = defineUnit({ name: 'テスト・ＢＰ1000', level: 1, colors: ['赤'], bp: 1000, sp: 1000 })
    const placed = boardOf([someSquare, instantiate({ id: '傷ついたユニット', card: unit, owner: '先攻' })])
    return dealDamage(placed, '傷ついたユニット', amount)
  }

  it('持ち主の捨札に置かれる', () => {
    expect(idsOf(cardsIn(pass(damaged(1000)), '先攻', '捨札'))).toEqual(['傷ついたユニット'])
  })

  it('ＢＰより小さいダメージでは捨札に置かれない', () => {
    expect(idsOf(cardsOn(pass(damaged(999)), someSquare))).toEqual(['傷ついたユニット'])
  })
})

// 総合ルール 第4部 第7章 6、第14章 4-6・4-9（ADR-0006）
describe('複数のルールエフェクトで同じカードが捨札に置かれる', () => {
  it('ダメージ超過と中央エリア指定の両方に該当しても、能力は 1 回だけ誘発する', () => {
    const board = boardOf(
      [someSquare, instantiate({ id: '能力持ち', card: discardWatcher, owner: '先攻' })],
      [centerSquare, instantiate({ id: '中央のユニット', card: vanilla, owner: '先攻' })],
    )
    const damaged = dealDamage(board, '中央のユニット', 1000)
    // 中央エリアを指定した実際のプレイでこの記録が作られることは `battle.test.ts` で検証する。
    // ここではバトルを経ず、2 つのルールエフェクトが同じ id を返す連結だけを直接試す。
    const playedIntoCenter = { ...damaged, playedIntoCenter: ['中央のユニット'] }

    const checked = pass(playedIntoCenter)

    expect(checked.bank.map((each) => each.source)).toEqual(['能力持ち'])
  })
})

// 総合ルール 第4部 第14章 2、第7章 2（ADR-0006）
describe('ルールエフェクトと誘発型能力の順序', () => {
  it('優先権を獲得する時、ルールエフェクトが解決された後に誘発型能力がバンクに入る', () => {
    const board = boardOf(
      [someSquare, instantiate({ id: '能力持ち', card: beginner, owner: '先攻' })],
      [anotherSquare, instantiate({ id: 'ストラテジー', card: strategy, owner: '後攻' })],
    )
    // リリースフェイズを終わらせるとエネルギーフェイズに入り、その始めに能力が誘発する。
    const energyPhase = pass(pass(board))

    expect(energyPhase.turn.phase).toBe('エネルギーフェイズ')
    // 優先権が発生した時点で、ルールエフェクトは解決済みで、能力はバンクに入っている。
    expect(cardsOn(energyPhase, anotherSquare)).toEqual([])
    expect(energyPhase.bank.map((banked) => banked.source)).toEqual(['能力持ち'])
    expect(energyPhase.triggered).toEqual([])
  })
})

// 総合ルール 第3部 第3章 1・2、第4部 第14章 4-1・4-2（ADR-0006）
describe('デュエルの終了', () => {
  /** そのプレイヤーのスマッシュゾーンにカードを `count` 枚置いた盤面。 */
  function withSmashes(state: DuelState, player: Player, count: number): DuelState {
    return putInZone(
      state,
      player,
      'スマッシュゾーン',
      Array.from({ length: count }, (_, index) =>
        instantiate({ id: `${player}のスマッシュ${index}`, card: vanilla, owner: player }),
      ),
    )
  }

  /** そのプレイヤーの山札を空にした盤面。 */
  function withEmptyLibrary(state: DuelState, player: Player): DuelState {
    return putInZone(state, player, '山札', [])
  }

  it('スマッシュが 7 枚以上のプレイヤーは、次に優先権が発生した時に敗北する', () => {
    const state = withSmashes(stockedDuelState(), '後攻', 7)

    expect(state.result).toBeUndefined()
    expect(pass(state).result).toEqual({ kind: '勝利', winner: '先攻' })
  })

  it('スマッシュが 6 枚なら敗北しない', () => {
    expect(pass(withSmashes(stockedDuelState(), '後攻', 6)).result).toBeUndefined()
  })

  it('山札が 0 枚のプレイヤーは、次に優先権が発生した時に敗北する', () => {
    const state = withEmptyLibrary(stockedDuelState(), '先攻')

    expect(state.result).toBeUndefined()
    expect(pass(state).result).toEqual({ kind: '勝利', winner: '後攻' })
  })

  // 総合ルール 第3部 第3章 4
  it('両方のプレイヤーが同時に敗北した場合、引き分けになる', () => {
    const state = withEmptyLibrary(withEmptyLibrary(stockedDuelState(), '先攻'), '後攻')

    expect(pass(state).result).toEqual({ kind: '引き分け' })
  })

  // 総合ルール 第3部 第3章 3: 勝敗が決まった場合、そのデュエルは即座に終了する。
  it('勝敗が決まったデュエルでは、それ以上進行しない', () => {
    const ended = pass(withSmashes(stockedDuelState(), '後攻', 7))

    expect(pass(ended)).toBe(ended)
  })

  // 完走の確認。デュエルは放っておいても山札が尽きて必ず終わる（総合ルール 第3部 第3章 2）。
  it('準備から優先権を放棄し続けるだけで、いつか勝敗が決まる', () => {
    const deck: Deck = Array.from({ length: 60 }, (_, index) =>
      defineUnit({ name: `テスト${index}`, level: 1, bp: 1000, sp: 1000 }),
    )
    const preparation = prepareDuel({ decks: [deck, deck], seed: 20260810 })
    if (preparation.kind !== '準備完了') throw new Error('準備できるデッキのはずだった')

    let current = preparation.state
    // 1 ターンに引くのは 1 枚で、山札は 55 枚。放棄だけで進む分には充分に余裕を持たせる。
    for (let step = 0; step < 10_000 && current.result === undefined; step += 1) current = pass(current)

    // 引けなくなった側が敗北する。どちらが先に尽きるかは先攻・後攻の決まり方による。
    expect(current.result?.kind).toBe('勝利')
  })
})
