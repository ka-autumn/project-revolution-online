import { describe, expect, it } from 'vitest'
// 山札とエネルギーゾーンを組み立てるためだけに `putInZone` を使う。engine の中からゾーンを
// 差し替えるための関数であり、公開する API ではない。
import { putInZone } from './duel.js'
import {
  PLAYERS,
  activateAbility,
  activatedAbility,
  cardsIn,
  cardsOn,
  defineUnit,
  drawCards,
  emptyDuelState,
  instantiate,
  legalActions,
  passPriority,
  putOnSquare,
  triggeredAbility,
} from './index.js'
import type {
  ActionOutcome,
  CardInstance,
  Chooser,
  DuelState,
  Phase,
  Player,
  Square,
  UnitCard,
  UnitOnSquare,
} from './index.js'

/** 選択を求められたら常に最初の候補を選ぶ。どれを選ぶかを問わないテストで使う。 */
const chooseFirst: Chooser = (candidates) => candidates[0]

/**
 * 検証したいルールだけを持つ架空のテストカード（ADR-0002）。
 *
 * 効果はどれもカードを 1 枚引くだけにしてある。ここで見るのは効果の中身ではなく、起動が
 * 行える時・行えない時と、コストの支払いだからである。
 */
const drawer = defineUnit({
  name: 'テスト・起動ドロー',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [
    activatedAbility({ energiesOfOwnColor: 1, discardsSelf: false }, function* (duel) {
      yield* drawCards(duel.controller, 1)
    }),
  ],
})

/** コストとして自身を捨札に置く起動型能力を持つユニット。 */
const sacrificer = defineUnit({
  name: 'テスト・起動生贄',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [
    activatedAbility({ energiesOfOwnColor: 1, discardsSelf: true }, function* (duel) {
      yield* drawCards(duel.controller, 1)
    }),
  ],
})

/** エネルギーを 2 枚要求する起動型能力を持つユニット。支払いかけを見るために使う。 */
const expensive = defineUnit({
  name: 'テスト・起動高コスト',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [
    activatedAbility({ energiesOfOwnColor: 2, discardsSelf: false }, function* (duel) {
      yield* drawCards(duel.controller, 1)
    }),
  ],
})

/** 起動型能力を持たないユニット。 */
const plain = defineUnit({ name: 'テスト・起動なし', level: 1, colors: ['赤'], bp: 1000, sp: 1000 })

const homeSquare: Square = { row: 0, column: 1 }
const enemySquare: Square = { row: 2, column: 1 }

function unit(id: string, card: UnitCard = drawer, owner: Player = '先攻'): CardInstance {
  return instantiate({ id, card, owner })
}

/** その色のエネルギーをその枚数置いた盤面。どれもリリース状態で置かれる。 */
function withEnergies(state: DuelState, player: Player, color: '赤' | '青', count: number): DuelState {
  const card = defineUnit({ name: `テスト・${color}のエネルギー`, level: 1, colors: [color], bp: 1000, sp: 1000 })
  return putInZone(
    state,
    player,
    'エネルギーゾーン',
    Array.from({ length: count }, (_, index) => instantiate({ id: `${player}の${color}${index}`, card, owner: player })),
  )
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
        Array.from({ length: 10 }, (_, index) => unit(`${player}の山札${index}`, plain, player)),
      ),
    emptyDuelState(),
  )
}

/**
 * アクティブプレイヤー（先攻）が行動できる、そのフェイズの盤面。
 *
 * フェイズの始めには非アクティブプレイヤーに優先権が発生する（総合ルール 第3部
 * 第7章 1・第8章 1）ので、そこから 1 度放棄させてアクティブプレイヤーに優先権を移す。
 */
function phaseReadyToAct(phase: Phase): DuelState {
  let current = stockedDuelState()
  while (current.turn.phase !== phase) current = passPriority(current, chooseFirst)
  return passPriority(current, chooseFirst)
}

/** アクティブプレイヤー（先攻）が行動できる、第 1 ターンのメインフェイズの盤面。 */
function mainPhase(): DuelState {
  return phaseReadyToAct('メインフェイズ')
}

/** 起動できる盤面。先攻のユニットがスクエアにいて、赤いエネルギーがその枚数ある。 */
function readyToActivate(card: UnitCard = drawer, energies = 1): DuelState {
  return putOnSquare(withEnergies(mainPhase(), '先攻', '赤', energies), homeSquare, unit('ユニット', card))
}

/** 行えたはずの行動の結果の盤面。 */
function stateOf(outcome: ActionOutcome): DuelState {
  if (outcome.kind !== '行った') throw new Error(`行えなかった: ${outcome.violation}`)
  return outcome.state
}

/** 行えなかったはずの行動の理由。 */
function violationOf(outcome: ActionOutcome): string {
  if (outcome.kind !== '行えない') throw new Error('行えてしまった')
  return outcome.violation
}

/** そのプレイヤーのエネルギーゾーンにある、フリーズ状態のカードの枚数。 */
const frozenEnergies = (state: DuelState, player: Player): number =>
  cardsIn(state, player, 'エネルギーゾーン').filter((card) => card.orientation === 'フリーズ').length

// 総合ルール 第4部 第2章（ADR-0006）
describe('カードが持つ起動型能力を起動する', () => {
  // 同 1
  it('コストとしてエネルギーがフリーズされる', () => {
    const after = stateOf(activateAbility(readyToActivate(), 'ユニット', 0, chooseFirst))

    expect(frozenEnergies(after, '先攻')).toBe(1)
  })

  it('効果が解決される', () => {
    const state = readyToActivate()

    const after = stateOf(activateAbility(state, 'ユニット', 0, chooseFirst))

    expect(cardsIn(after, '先攻', '手札')).toHaveLength(cardsIn(state, '先攻', '手札').length + 1)
  })

  // 同 第1部 第3章 1-1、第2部 第20章 1-3 と同じ色の読み方をする。
  it('そのカードと同じ色のエネルギーでなければ支払えない', () => {
    const state = putOnSquare(withEnergies(mainPhase(), '先攻', '青', 3), homeSquare, unit('ユニット'))

    expect(violationOf(activateAbility(state, 'ユニット', 0, chooseFirst))).toBe('コストを支払えない')
  })

  it('コストとして自身が捨札に置かれる', () => {
    const state = readyToActivate(sacrificer)

    const after = stateOf(activateAbility(state, 'ユニット', 0, chooseFirst))

    expect(cardsOn(after, homeSquare)).toEqual([])
    expect(cardsIn(after, '先攻', '捨札').map((card) => card.id)).toEqual(['ユニット'])
  })

  // 総合ルール 第1部 第1章 3。1 枚でも足りなければ、行動そのものが行えない。
  it('コストの一部しか支払えなければ行えず、支払いかけた分も残らない', () => {
    const state = readyToActivate(expensive, 1)

    expect(violationOf(activateAbility(state, 'ユニット', 0, chooseFirst))).toBe('コストを支払えない')
    expect(frozenEnergies(state, '先攻')).toBe(0)
  })

  // 同 第4部 第2章 2
  it('起動できるのは支配者だけである', () => {
    const state = putOnSquare(
      withEnergies(mainPhase(), '後攻', '赤', 1),
      enemySquare,
      unit('相手のユニット', drawer, '後攻'),
    )

    expect(violationOf(activateAbility(state, '相手のユニット', 0, chooseFirst))).toBe('行える時ではない')
  })

  // 同 4
  it('自分のメインフェイズでなければ行えない', () => {
    const state = putOnSquare(
      withEnergies(phaseReadyToAct('エネルギーフェイズ'), '先攻', '赤', 1),
      homeSquare,
      unit('ユニット'),
    )

    expect(violationOf(activateAbility(state, 'ユニット', 0, chooseFirst))).toBe('行える時ではない')
  })

  // 同 4
  it('優先権を持っていなければ行えない', () => {
    const state = passPriority(readyToActivate(), chooseFirst)

    expect(violationOf(activateAbility(state, 'ユニット', 0, chooseFirst))).toBe('行える時ではない')
  })

  // 同 4
  it('バンクに解決を待っている能力があれば行えない', () => {
    const waiting = triggeredAbility('ターンの終わり', function* () {})
    const self: UnitOnSquare = { id: 'ユニット', square: homeSquare, card: drawer, controller: '先攻' }
    const state = readyToActivate()
    const banked: DuelState = {
      ...state,
      bank: [{ ability: waiting, source: 'ユニット', controller: '先攻', self }],
    }

    expect(violationOf(activateAbility(banked, 'ユニット', 0, chooseFirst))).toBe('行える時ではない')
  })

  // 同 5。誘発型能力と違い、バンクに積まれずにその場で解決される。
  it('バンクを使用しない', () => {
    const after = stateOf(activateAbility(readyToActivate(), 'ユニット', 0, chooseFirst))

    expect(after.bank).toEqual([])
    expect(after.triggered).toEqual([])
  })

  // 総合ルール 第4部 第5章 2
  it('行った後、非アクティブプレイヤーが優先権を獲得する', () => {
    expect(stateOf(activateAbility(readyToActivate(), 'ユニット', 0, chooseFirst)).turn.priority).toBe('後攻')
  })

  /**
   * 総合ルール 第4部 第8章 2-5（ADR-0006）。
   *
   * 自身を捨札に置くコストを支払うと、効果が解決される時にはもうスクエアにいない。ゾーン移動を
   * していた場合は移動する直前の情報を使用するので、効果からは置かれていたスクエアが見える。
   */
  it('自身を捨札に置いても、効果は捨札に置く前の位置を見られる', () => {
    const seen: (UnitOnSquare | undefined)[] = []
    const watcher = defineUnit({
      name: 'テスト・起動自己参照',
      level: 1,
      colors: ['赤'],
      bp: 1000,
      sp: 1000,
      abilities: [
        activatedAbility({ energiesOfOwnColor: 1, discardsSelf: true }, function* (duel) {
          seen.push(duel.self())
        }),
      ],
    })

    activateAbility(readyToActivate(watcher), 'ユニット', 0, chooseFirst)

    expect(seen).toHaveLength(1)
    expect(seen[0]?.square).toEqual(homeSquare)
  })

  it('起動型能力を持たないユニットでは行えない', () => {
    expect(violationOf(activateAbility(readyToActivate(plain), 'ユニット', 0, chooseFirst))).toBe('起動できる能力がない')
  })

  // ユニットのテキストはスクエアに置かれている間だけ有効である（総合ルール 第4部 第7章 10）。
  it('スクエアにいないカードの能力は起動できない', () => {
    const state = putInZone(withEnergies(mainPhase(), '先攻', '赤', 1), '先攻', '手札', [unit('手札のユニット')])

    expect(violationOf(activateAbility(state, '手札のユニット', 0, chooseFirst))).toBe('そのゾーンにない')
  })
})

// ADR-0005: 合法手の列挙はエンジンの必須機能である
describe('合法手としての起動型能力', () => {
  /** その盤面で起動できる能力を指す合法手すべて。 */
  const activations = (state: DuelState) =>
    legalActions(state).filter((action) => action.kind === '起動型能力を起動する')

  it('起動できる能力が候補に出る', () => {
    expect(activations(readyToActivate())).toEqual([{ kind: '起動型能力を起動する', unit: 'ユニット', ability: 0 }])
  })

  it('コストを支払えなければ候補に出ない', () => {
    expect(activations(readyToActivate(drawer, 0))).toEqual([])
  })

  it('起動型能力を持たないユニットは候補に出ない', () => {
    expect(activations(readyToActivate(plain))).toEqual([])
  })
})
