import { describe, expect, it } from 'vitest'
// ダメージを与えたり山札を積んだりするためだけに `dealDamage` と `putInZone` を使う。
// engine の中から盤面を組み替えるための関数であり、公開する API ではない。
import { dealDamage, putInZone } from './duel.js'
import {
  PLAYERS,
  cardsIn,
  choose,
  defineUnit,
  destroy,
  emptyDuelState,
  instantiate,
  passPriority,
  putOnSquare,
  triggeredAbility,
} from './index.js'
import type { CardInstance, Chooser, DuelState, Player, Square } from './index.js'

/**
 * 「エネルギーフェイズの始め」に敵を 1 枚選んで破壊するテストカード（ADR-0002）。
 *
 * どの能力がいつ解決されたかを、破壊された敵から読み取るために使う。
 */
const striker = defineUnit({
  name: 'テスト・エネルギーフェイズ破壊',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [
    triggeredAbility('エネルギーフェイズの始め', function* (duel) {
      const enemy = yield* choose(duel.enemies())
      yield* destroy(enemy)
    }),
  ],
})

/** 味方がスクエアから捨札に置かれるたびに誘発するテストカード。効果は何もしない。 */
const discardWatcher = defineUnit({
  name: 'テスト・味方の捨札監視',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [
    triggeredAbility('あなたのユニットがスクエアから捨札に置かれた時', function* () {}),
  ],
})

const vanilla = defineUnit({ name: 'テスト・バニラ', level: 1, colors: ['赤'], bp: 1000, sp: 1000 })

// 先攻・後攻それぞれの 2 枚を、重ならない別々のスクエアに置く。同じプレイヤーのユニットを
// 重ねるとルールエフェクトで捨札に置かれてしまう（総合ルール 第4部 第14章 4-7）ため。
const firstStrikerSquare: Square = { row: 2, column: 0 }
const firstVanillaSquare: Square = { row: 2, column: 2 }
const secondStrikerSquare: Square = { row: 0, column: 0 }
const secondVanillaSquare: Square = { row: 0, column: 2 }

type Placement = readonly [Square, CardInstance]

/**
 * 第 1 ターンのエネルギーフェイズが始まった盤面。
 *
 * デュエルの準備を通さず、検証したいカードだけを置いた盤面から始める。空の盤面は先攻の
 * 第 1 ターンのリリースフェイズから始まり（総合ルール 第3部 第4章 1）、先攻の第 1 ターン
 * はドローフェイズをとばす（同 第2章 2）ので、リリースフェイズを終わらせるとエネルギー
 * フェイズに入る。したがってアクティブプレイヤーは常に先攻である。
 */
function energyPhase(...placements: readonly Placement[]): DuelState {
  const board = placements.reduce(
    (state, [square, card]) => putOnSquare(state, square, card),
    stockedDuelState(),
  )
  return pass(pass(board))
}

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

const chooseFirst: Chooser = (candidates) => candidates[0]

function pass(state: DuelState): DuelState {
  return passPriority(state, chooseFirst)
}

/** 誰が選ばされたかを記録する `Chooser`。選ぶのは常に最初の候補。 */
function recordingChooser(asked: Player[]): Chooser {
  return (candidates, player) => {
    asked.push(player)
    return candidates[0]
  }
}

const strikerOf = (id: string, owner: Player, controller?: Player): CardInstance =>
  instantiate({ id, card: striker, owner, controller })

const vanillaOf = (id: string, owner: Player): CardInstance =>
  instantiate({ id, card: vanilla, owner })

const idsOf = (cards: readonly CardInstance[]) => cards.map((card) => card.id)

/** 両方のプレイヤーが能力を 1 つずつ持っている、第 1 ターンのエネルギーフェイズ。 */
function bothHaveAbility(): DuelState {
  return energyPhase(
    [firstStrikerSquare, strikerOf('先攻の能力持ち', '先攻')],
    [firstVanillaSquare, vanillaOf('先攻のバニラ', '先攻')],
    [secondStrikerSquare, strikerOf('後攻の能力持ち', '後攻')],
    [secondVanillaSquare, vanillaOf('後攻のバニラ', '後攻')],
  )
}

// 総合ルール 第4部 第7章 2（ADR-0006）
describe('誘発型能力がバンクに入る', () => {
  // 総合ルール 第3部 第7章 1
  it('フェイズの始めに誘発した能力は、そのフェイズが始まった時点でバンクにある', () => {
    const state = energyPhase([firstStrikerSquare, strikerOf('能力持ち', '先攻')])

    expect(state.turn.phase).toBe('エネルギーフェイズ')
    expect(state.bank.map((banked) => banked.source)).toEqual(['能力持ち'])
    expect(state.triggered).toEqual([])
  })

  // 総合ルール 第4部 第7章 3
  it('複数の誘発型能力は同時にバンクに入る', () => {
    const state = bothHaveAbility()

    expect(state.bank.map((banked) => banked.source).sort()).toEqual(['先攻の能力持ち', '後攻の能力持ち'])
  })

  // 総合ルール 第4部 第7章 6
  it('味方のユニット2枚が同時に破壊された時、能力は2回誘発する', () => {
    const placed = [
      [firstStrikerSquare, instantiate({ id: 'ユニットＡ', card: discardWatcher, owner: '先攻' })],
      [firstVanillaSquare, vanillaOf('別のユニット1', '先攻')],
      [secondVanillaSquare, vanillaOf('別のユニット2', '先攻')],
    ] as const
    const board = placed.reduce(
      (state, [square, card]) => putOnSquare(state, square, card),
      stockedDuelState(),
    )
    const damaged = dealDamage(dealDamage(board, '別のユニット1', 1000), '別のユニット2', 1000)

    const checked = pass(damaged)

    expect(checked.bank.map((banked) => banked.source)).toEqual(['ユニットＡ', 'ユニットＡ'])
  })

  // 総合ルール 第4部 第7章 1
  it('誘発型能力の支配者は、発生源の支配者である', () => {
    // 持ち主は後攻だが、支配しているのは先攻であるユニット。
    const state = energyPhase([secondStrikerSquare, strikerOf('奪われた能力持ち', '後攻', '先攻')])

    expect(state.bank.map((banked) => banked.controller)).toEqual(['先攻'])
  })
})

// 総合ルール 第4部 第8章 1-1、第2部 第21章 11-3（ADR-0006）
describe('バンクにある能力の解決', () => {
  it('アクティブプレイヤーの支配する能力を、アクティブプレイヤーが選んで解決する', () => {
    const asked: Player[] = []
    const chooser = recordingChooser(asked)
    const resolved = passPriority(passPriority(bothHaveAbility(), chooser), chooser)

    // バンクから 1 つ選ぶのはアクティブプレイヤーである先攻。その後に続く選択は、
    // 解決している能力の効果によるもの（総合ルール 第4部 第8章 2-3）。
    expect(asked[0]).toBe('先攻')
    // 解決されたのは先攻の能力なので、破壊されたのは先攻から見た敵である。
    expect(idsOf(cardsIn(resolved, '後攻', '捨札'))).toEqual(['後攻の能力持ち'])
    expect(cardsIn(resolved, '先攻', '捨札')).toEqual([])
  })

  it('アクティブプレイヤーの支配する能力が無ければ、非アクティブプレイヤーが選んで解決する', () => {
    const state = energyPhase(
      [secondStrikerSquare, strikerOf('後攻の能力持ち', '後攻')],
      [firstVanillaSquare, vanillaOf('先攻のバニラ', '先攻')],
    )
    const asked: Player[] = []
    const chooser = recordingChooser(asked)
    const resolved = passPriority(passPriority(state, chooser), chooser)

    expect(asked[0]).toBe('後攻')
    expect(idsOf(cardsIn(resolved, '先攻', '捨札'))).toEqual(['先攻のバニラ'])
  })

  it('1 回の連続放棄で解決されるのは 1 つだけで、残りはバンクに残る', () => {
    const resolved = pass(pass(bothHaveAbility()))

    expect(resolved.bank.map((banked) => banked.source)).toEqual(['後攻の能力持ち'])
  })

  // 総合ルール 第4部 第8章 2-7
  it('解決した能力はバンクから取り除かれる', () => {
    const state = energyPhase(
      [firstStrikerSquare, strikerOf('能力持ち', '先攻')],
      [secondVanillaSquare, vanillaOf('後攻のバニラ', '後攻')],
    )

    expect(pass(pass(state)).bank).toEqual([])
  })

  // 総合ルール 第2部 第1章 5-1、第4部 第8章 2-7
  it('発生源がスクエアを離れても、バンクにある能力は残って解決される', () => {
    // 先攻の能力が後攻の能力持ちを破壊する。破壊された側の能力はすでにバンクにあり、
    // その支配者は誘発した時点で決まっている（総合ルール 第2部 第1章 5-1）ので、
    // 発生源を失ってもそのまま解決され、先攻のユニットを破壊する。
    const first = pass(pass(bothHaveAbility()))
    const second = pass(pass(first))

    expect(idsOf(cardsIn(second, '先攻', '捨札'))).toEqual(['先攻の能力持ち'])
    expect(second.bank).toEqual([])
  })

  // 総合ルール 第4部 第5章 2
  it('能力を解決した後、非アクティブプレイヤーが優先権を獲得する', () => {
    const resolved = pass(pass(bothHaveAbility()))

    expect(resolved.turn.priority).toBe('後攻')
    // 連続した放棄はここで途切れる。次に 1 人が放棄しただけでは何も解決されない。
    expect(resolved.turn.passedBy).toBeUndefined()
  })

  // 総合ルール 第3部 第4章 4
  it('バンクが空でなければ、連続して放棄してもフェイズは終了しない', () => {
    const state = bothHaveAbility()

    expect(pass(pass(state)).turn.phase).toBe('エネルギーフェイズ')
    expect(pass(pass(pass(pass(state)))).turn.phase).toBe('エネルギーフェイズ')
  })

  it('バンクが空になってから、連続放棄でフェイズが終了する', () => {
    const emptied = pass(pass(pass(pass(bothHaveAbility()))))

    expect(emptied.bank).toEqual([])
    expect(pass(pass(emptied)).turn.phase).toBe('メインフェイズ')
  })
})
