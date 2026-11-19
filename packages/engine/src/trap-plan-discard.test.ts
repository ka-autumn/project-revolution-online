import { describe, expect, it } from 'vitest'
// 山札・手札・ゾーンを組み立てるためだけに `putInZone` を使う。engine の中からゾーンを差し替える
// ための関数であり、公開する API ではない（`trap-attack-smash.test.ts` と同じ）。
import { putInZone } from './duel.js'
import { trapRightsOf } from './trap.js'
import {
  PLAYERS,
  activateTrap,
  cardsIn,
  choose,
  damagePlayer,
  defineStrategy,
  defineTrap,
  defineUnit,
  destroy,
  discardOpponentHand,
  emptyDuelState,
  instantiate,
  legalActions,
  passPriority,
  perspectiveOf,
  plan,
  placeTopOfLibrary,
  planReplacing,
  playCard,
  putOnSquare,
  triggeredAbility,
} from './index.js'
import type {
  ActionOutcome,
  CardInstance,
  Chooser,
  DuelState,
  Player,
  Square,
  TrapCard,
  TrapConditionMet,
  UnitCard,
} from './index.js'

/**
 * プランのトラップと捨札のトラップの発動条件と権利。
 *
 * 総合ルール 第4部 第6章 1-4・1-5（プランの行動の直後に非アクティブプレイヤーが優先権を得る）、
 * 第3部 第8章 2-3（プランの処理）、第4部 第14章 4（ルールエフェクトで捨札に置く）、
 * 第2部 第20章 3-8（発動する権利）、ADR-0072（ADR-0006）。この 2 つの発動条件がいつ満たされるかを
 * 定めた条は無いので、ADR-0072 を併記する。カードはどれも架空のものである。
 */

const chooseFirst: Chooser = (candidates) => candidates[0]

const vanilla = defineUnit({ name: 'テスト・バニラ', level: 1, colors: ['赤'], bp: 3000, sp: 1000 })
/** プランでめくれた時のレベルを確認するためのユニット。 */
const level4 = defineUnit({ name: 'テスト・レベル4', level: 4, colors: ['赤'], bp: 3000, sp: 1000 })
/** バトルに負ける、ＢＰの低いユニット。 */
const weak = defineUnit({ name: 'テスト・ＢＰ1000', level: 3, colors: ['赤'], bp: 1000, sp: 1000 })
const strategy = defineStrategy({ name: 'テスト・ストラテジー', level: 1, colors: ['赤'] })
/** 「かわりに『目印』を持つカードが出るまでめくってよい」という置換効果を持つユニット。 */
const replacing = defineUnit({
  name: 'テスト・プランの置換',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [planReplacing((each) => each.attributes.includes('目印'))],
})
const marked = defineUnit({ name: 'テスト・目印つき', level: 2, colors: ['赤'], bp: 1000, sp: 1000, attributes: ['目印'] })

/** 登場した時に、スクエアにいる敵全員を捨札に置くユニット。 */
const destroyingEnemies = defineUnit({
  name: 'テスト・敵全員を破壊',
  level: 1,
  colors: ['赤'],
  bp: 3000,
  sp: 1000,
  abilities: [
    triggeredAbility('登場した時', function* (duel) {
      for (const enemy of duel.enemies()) yield* destroy(enemy)
    }),
  ],
})
/** 登場した時に、スクエアにいる味方全員（自分を含む）を捨札に置くユニット。 */
const destroyingAllies = defineUnit({
  name: 'テスト・味方全員を破壊',
  level: 1,
  colors: ['赤'],
  bp: 3000,
  sp: 1000,
  abilities: [
    triggeredAbility('登場した時', function* (duel) {
      for (const ally of duel.allies()) yield* destroy(ally)
    }),
  ],
})
/** 登場した時に、相手の手札を 1 枚捨てさせるユニット。 */
const discardingHand = defineUnit({
  name: 'テスト・手札を捨てさせる',
  level: 1,
  colors: ['赤'],
  bp: 3000,
  sp: 1000,
  abilities: [
    triggeredAbility('登場した時', function* () {
      yield* discardOpponentHand(1)
    }),
  ],
})

/** 先攻に、めくれたユニットのレベル × 100 のダメージを与える、後攻のプランのトラップ。きっかけが手渡されたことを確認する。 */
const damagingByLevelTrap = defineTrap({
  name: 'テスト・めくれたレベルのダメージ',
  level: 1,
  colors: ['赤'],
  triggerIcon: { kind: 'プラン' },
  effect: function* (_duel, occasion) {
    yield* damagePlayer('先攻', occasion.card.level * 100)
  },
})
/** 先攻に、捨札に置かれたユニットのレベル × 100 のダメージを与える、後攻の捨札のトラップ。 */
const damagingByDiscardedTrap = defineTrap({
  name: 'テスト・置かれたレベルのダメージ',
  level: 1,
  colors: ['赤'],
  triggerIcon: { kind: '捨札' },
  effect: function* (_duel, occasion) {
    yield* damagePlayer('先攻', occasion.card.level * 100)
  },
})

const battleSquare: Square = { row: 0, column: 1 }
const secondSquare: Square = { row: 0, column: 2 }
const enemySquare: Square = { row: 2, column: 1 }
const secondEnemySquare: Square = { row: 2, column: 2 }

function pass(state: DuelState): DuelState {
  return passPriority(state, chooseFirst)
}

function stateOf(outcome: ActionOutcome): DuelState {
  if (outcome.kind !== '行った') throw new Error(`行えなかった: ${outcome.violation}`)
  return outcome.state
}

function unitOf(id: string, card: UnitCard, owner: Player): CardInstance {
  return instantiate({ id, card, owner })
}

const kindsOf = (state: DuelState) => legalActions(state).map((action) => action.kind)
const mayActivate = (state: DuelState): boolean =>
  kindsOf(state).includes('トラップを発動する') && state.turn.priority === '後攻'

/** 山札を積んだ盤面。山札が 0 枚以下のプレイヤーは次に優先権が発生した時に敗北する。 */
function stocked(): DuelState {
  return PLAYERS.reduce(
    (state, player) =>
      putInZone(
        state,
        player,
        '山札',
        Array.from({ length: 10 }, (_, index) => unitOf(`${player}の山札${index}`, vanilla, player)),
      ),
    emptyDuelState(),
  )
}

/** 後攻のトラップゾーンにトラップを置き、後攻にエネルギーを持たせる（発動のコストを払える）。 */
function armed(state: DuelState, trap: TrapCard): DuelState {
  return putInZone(
    putInZone(state, '後攻', 'トラップゾーン', [instantiate({ id: 'トラップ', card: trap, owner: '後攻' })]),
    '後攻',
    'エネルギーゾーン',
    [unitOf('後攻のエネ', vanilla, '後攻')],
  )
}

/** 先攻のメインフェイズ。先攻が行動できる。 */
function mainPhase(): DuelState {
  let current = stocked()
  while (current.turn.phase !== 'メインフェイズ') current = pass(current)
  return pass(current)
}

/** 先攻のエネルギーゾーンにエネルギーを 1 枚置く（プランのコスト）。 */
function withPlanCost(state: DuelState): DuelState {
  return putInZone(state, '先攻', 'エネルギーゾーン', [unitOf('先攻のエネ', vanilla, '先攻')])
}

/** 先攻の山札を、上からこの順に積み直す。 */
function withLibrary(state: DuelState, library: readonly CardInstance[]): DuelState {
  return putInZone(state, '先攻', '山札', library)
}

const aMet = (state: DuelState): readonly TrapConditionMet[] => state.trapConditionsMet

/** 優先権を渡し続けて、後攻がトラップを発動できる盤面まで進める。進まなければ例外。 */
function untilMayActivate(state: DuelState): DuelState {
  let current = state
  for (let i = 0; i < 40 && !mayActivate(current); i += 1) current = pass(current)
  if (!mayActivate(current)) throw new Error('後攻が発動できる盤面にならなかった')
  return current
}

describe('プランのトラップ', () => {
  /** 後攻が `trap` を持ち、先攻が山札の上から `library` の順でプランした盤面。 */
  function planned(library: readonly CardInstance[], trap: TrapCard = damagingByLevelTrap): DuelState {
    const base = withLibrary(withPlanCost(armed(mainPhase(), trap)), library)
    return stateOf(plan(base, chooseFirst))
  }

  // 総合ルール 第4部 第6章 1-4・1-5。プランの行動の直後に、非アクティブプレイヤーが優先権を得る。
  it('相手がプランしてユニットがめくれると、プランの直後に発動できる', () => {
    const state = planned([unitOf('めくれた', level4, '先攻')])

    expect(state.turn.priority).toBe('後攻')
    expect(mayActivate(state)).toBe(true)
  })

  it('きっかけは、めくれたユニットの、めくれた時点のデータの写しで持つ', () => {
    const [met] = aMet(planned([unitOf('めくれた', level4, '先攻')]))
    const occasion = met?.occasion

    expect(occasion?.kind === 'プラン' && occasion.id).toBe('めくれた')
    expect(occasion?.kind === 'プラン' && occasion.card.level).toBe(4)
  })

  it('発動すると、効果はめくれたユニットのレベルを取得できる', () => {
    const state = planned([unitOf('めくれた', level4, '先攻')])

    const after = stateOf(activateTrap(state, 'トラップ', chooseFirst))

    expect(after.damage.先攻).toBe(400)
  })

  it('ユニット以外のカードがめくれた時は、発動条件が満たされない', () => {
    const state = planned([instantiate({ id: 'ストラテジー', card: strategy, owner: '先攻' })])

    expect(aMet(state)).toEqual([])
    expect(mayActivate(state)).toBe(false)
  })

  it('山札が空で何もめくれない時は、発動条件が満たされない', () => {
    const state = planned([])

    expect(aMet(state)).toEqual([])
  })

  it('自分がプランしても、自分のプランのトラップは発動できない', () => {
    // 先攻が、自分のトラップゾーンに置いたトラップで自分のプランに備える。
    const own = putInZone(mainPhase(), '先攻', 'トラップゾーン', [
      instantiate({ id: 'トラップ', card: damagingByLevelTrap, owner: '先攻' }),
    ])
    const state = stateOf(plan(withLibrary(withPlanCost(own), [unitOf('めくれた', level4, '先攻')]), chooseFirst))

    expect(aMet(state)).toEqual([])
  })

  it('優先権をパスすると、そのきっかけでは発動できなくなる', () => {
    const state = pass(planned([unitOf('めくれた', level4, '先攻')]))

    expect(aMet(state)).toEqual([])
    expect(kindsOf(state)).not.toContain('トラップを発動する')
  })

  it('プランのトラップが無ければ、プランで発動条件は何も追加されない', () => {
    const base = withLibrary(withPlanCost(mainPhase()), [unitOf('めくれた', level4, '先攻')])
    const without = stateOf(plan(base, chooseFirst))

    expect(aMet(without)).toEqual([])
  })

  it.each([
    ['攻撃', defineTrap({ name: 'テスト・攻撃', level: 1, colors: ['赤'], triggerIcon: { kind: '攻撃' } })],
    ['スマッシュ', defineTrap({ name: 'テスト・スマッシュ', level: 1, colors: ['赤'], triggerIcon: { kind: 'スマッシュ' } })],
    ['侵入', defineTrap({ name: 'テスト・侵入', level: 1, colors: ['赤'], triggerIcon: { kind: '侵入', squares: [{ row: 0, column: 1 }] } })],
    ['捨札', defineTrap({ name: 'テスト・捨札', level: 1, colors: ['赤'], triggerIcon: { kind: '捨札' } })],
  ])('%sのトラップを持っていても、プランでは満たされない', (_kind, trap) => {
    const state = planned([unitOf('めくれた', level4, '先攻')], trap)

    expect(aMet(state)).toEqual([])
  })

  // 完了条件: 効果で山札の 1 番上が表向きになっても満たされない。プランの行動を通らないため。
  it('効果で山札の 1 番上が表向きになっても、発動条件は満たされない', () => {
    const revealing = defineUnit({
      name: 'テスト・山札の上を表向きにする',
      level: 1,
      colors: ['赤'],
      bp: 3000,
      sp: 1000,
      abilities: [
        triggeredAbility('登場した時', function* () {
          yield* placeTopOfLibrary('山札の1番上に表向きで置く')
        }),
      ],
    })
    const board = putInZone(withPlanCost(armed(mainPhase(), damagingByLevelTrap)), '先攻', '手札', [unitOf('表向きにする役', revealing, '先攻')])
    let state = stateOf(playCard(board, { card: '表向きにする役', square: battleSquare }, chooseFirst))
    for (let i = 0; i < 10; i += 1) state = pass(state)

    // 前提: 山札の 1 番上が、プランゾーンに表向きで置かれている。
    expect(cardsIn(state, '先攻', 'プランゾーン')).toHaveLength(1)
    expect(aMet(state)).toEqual([])
    expect(kindsOf(state)).not.toContain('トラップを発動する')
  })

  describe('置換で複数のユニットがめくれた時', () => {
    /** 先攻が置換効果を持つユニットをスクエアに置き、「目印」を持つカードが出るまでめくる盤面。 */
    function replaced(): DuelState {
      const base = putOnSquare(armed(mainPhase(), damagingByLevelTrap), battleSquare, unitOf('置換する', replacing, '先攻'))
      const library = [unitOf('1 枚目', vanilla, '先攻'), unitOf('2 枚目', level4, '先攻'), unitOf('目印つき', marked, '先攻')]
      return stateOf(plan(withLibrary(withPlanCost(base), library), chooseFirst))
    }

    it('めくれたユニット 1 枚ごとに満たされる。途中でめくれて捨札に置かれたユニットも含む', () => {
      const state = replaced()

      expect(cardsIn(state, '先攻', 'プランゾーン').map((each) => each.id)).toEqual(['目印つき'])
      expect(cardsIn(state, '先攻', '捨札').map((each) => each.id)).toEqual(['2 枚目', '1 枚目'])
      expect(aMet(state).map(({ occasion }) => occasion.kind === 'プラン' && occasion.id)).toEqual([
        '1 枚目',
        '2 枚目',
        '目印つき',
      ])
    })

    it('発動する時にきっかけを選べ、選んだユニットのレベルで効果が決まる', () => {
      const state = replaced()
      const asked: { readonly purpose: string; readonly count: number }[] = []
      const choosing: Chooser = (candidates, _player, purpose) => {
        asked.push({ purpose, count: candidates.length })
        // 捨札に置かれた 2 枚目（レベル 4）を選ぶ。
        return purpose === 'トラップのきっかけ'
          ? (candidates as readonly TrapConditionMet[]).find(
              ({ occasion }) => occasion.kind === 'プラン' && occasion.id === '2 枚目',
            )
          : candidates[0]
      }

      const after = stateOf(activateTrap(state, 'トラップ', choosing))

      expect(asked).toContainEqual({ purpose: 'トラップのきっかけ', count: 3 })
      expect(after.damage.先攻).toBe(400)
    })
  })
})

// 効果の途中の選択で、CPU が発動に使ったきっかけを効果に渡せるようにする（`play.ts` の `resolveInResolveZone`）。
describe('発動したトラップの解決中', () => {
  /** 効果の途中で敵を 1 体選ばせる、後攻のプランのトラップ。 */
  const choosingTrap = defineTrap({
    name: 'テスト・途中で選ばせる',
    level: 1,
    colors: ['赤'],
    triggerIcon: { kind: 'プラン' },
    effect: function* (duel, occasion) {
      void occasion
      yield* choose(duel.enemies())
    },
  })

  it('選んだきっかけだけが盤面に残り、後攻の視点からも見え、先攻の視点には届かない。解決が終わると取り除かれる', () => {
    const base = putOnSquare(armed(mainPhase(), choosingTrap), battleSquare, unitOf('先攻のユニット', vanilla, '先攻'))
    const planned = stateOf(plan(withLibrary(withPlanCost(base), [unitOf('めくれた', level4, '先攻')]), chooseFirst))
    // 満たされた発動条件をもう 1 件（別のめくれたカード）持たせる。
    const two: DuelState = {
      ...planned,
      trapConditionsMet: [
        ...planned.trapConditionsMet,
        { trap: 'トラップ', occasion: { kind: 'プラン', id: '別のめくれた', card: vanilla }, metAt: planned.log.length },
      ],
    }
    const seen: { readonly own: readonly string[]; readonly opponent: readonly string[]; readonly raw: readonly string[] }[] = []
    const choosing: Chooser = (candidates, _player, purpose, board) => {
      if (purpose === 'トラップのきっかけ') {
        return (candidates as readonly TrapConditionMet[]).find(({ occasion }) => occasion.kind === 'プラン' && occasion.id === 'めくれた')
      }
      // コストの支払いは、トラップがトラップゾーンにある間に聞かれる。効果の途中の選択だけを確認する。
      if (purpose !== '効果の対象') return candidates[0]
      const ids = (state: DuelState) => state.trapConditionsMet.map(({ occasion }) => (occasion.kind === 'プラン' ? occasion.id : occasion.kind))
      seen.push({
        own: ids({ ...board, trapConditionsMet: perspectiveOf(board, '後攻').trapConditionsMet }),
        opponent: ids({ ...board, trapConditionsMet: perspectiveOf(board, '先攻').trapConditionsMet }),
        raw: ids(board),
      })
      return candidates[0]
    }

    const after = stateOf(activateTrap(two, 'トラップ', choosing))

    expect(seen).toEqual([{ own: ['めくれた'], opponent: [], raw: ['めくれた'] }])
    // 解決が終わってトラップが捨札に置かれると、残した発動条件も取り除かれる。
    expect(cardsIn(after, '後攻', '捨札').map((each) => each.id)).toContain('トラップ')
    expect(after.trapConditionsMet.filter(({ trap }) => trap === 'トラップ')).toEqual([])
  })
})

describe('捨札のトラップ', () => {
  /**
   * 先攻のメインフェイズ。後攻の `weakUnits` が敵エリアにいて、後攻が `trap` を持ち、先攻が
   * `played` を手札から味方エリアにプレイできる。
   */
  function beforePlay(played: CardInstance, trap: TrapCard = damagingByDiscardedTrap): DuelState {
    const board = putOnSquare(armed(mainPhase(), trap), enemySquare, unitOf('後攻のユニット', weak, '後攻'))
    return putInZone(withPlanCost(board), '先攻', '手札', [played])
  }

  /** `played` を先攻が味方エリアにプレイして、そのできごとを処理させた盤面。 */
  function afterPlay(played: CardInstance, trap?: TrapCard, board: (state: DuelState) => DuelState = (state) => state): DuelState {
    return stateOf(playCard(board(beforePlay(played, trap)), { card: played.id, square: battleSquare }, chooseFirst))
  }

  /** 「登場した時」の能力をバンクから解決させ、判定が満たされるまで優先権を渡す。 */
  function resolvedUntilMet(state: DuelState): DuelState {
    let current = state
    for (let i = 0; i < 20 && aMet(current).length === 0; i += 1) current = pass(current)
    return current
  }

  it('相手のターンに自分のユニットが効果で捨札に置かれると、発動できる', () => {
    const state = resolvedUntilMet(afterPlay(unitOf('破壊役', destroyingEnemies, '先攻')))

    expect(aMet(state)).toHaveLength(1)
    expect(untilMayActivate(state).turn.priority).toBe('後攻')
  })

  it('きっかけは、置かれる直前のデータと、いたスクエアの写しで持つ', () => {
    const [met] = aMet(resolvedUntilMet(afterPlay(unitOf('破壊役', destroyingEnemies, '先攻'))))
    const occasion = met?.occasion

    expect(occasion?.kind === '捨札' && occasion.id).toBe('後攻のユニット')
    expect(occasion?.kind === '捨札' && occasion.square).toEqual(enemySquare)
    expect(occasion?.kind === '捨札' && occasion.card.level).toBe(3)
    expect(occasion?.kind === '捨札' && occasion.controller).toBe('後攻')
  })

  it('発動すると、効果は捨札に置かれたユニットのレベルを取得できる', () => {
    const state = untilMayActivate(resolvedUntilMet(afterPlay(unitOf('破壊役', destroyingEnemies, '先攻'))))

    const after = stateOf(activateTrap(state, 'トラップ', chooseFirst))

    expect(after.damage.先攻).toBe(300)
  })

  it('ルールエフェクトで捨札に置かれた時も、発動条件が満たされる', () => {
    // ダメージを受けたユニットが、ＢＰ以上のダメージを負ってルールエフェクトで捨札に置かれる
    // （総合ルール 第4部 第14章）。
    const damaged = { ...unitOf('後攻のユニット', weak, '後攻'), damage: 1000 }
    const board = putOnSquare(armed(mainPhase(), damagingByDiscardedTrap), enemySquare, damaged)
    const ready = putInZone(withPlanCost(board), '先攻', '手札', [unitOf('先攻のユニット', vanilla, '先攻')])
    const state = resolvedUntilMet(stateOf(playCard(ready, { card: '先攻のユニット', square: secondSquare }, chooseFirst)))

    expect(cardsIn(state, '後攻', '捨札').map((each) => each.id)).toContain('後攻のユニット')
    expect(aMet(state).map(({ occasion }) => occasion.kind)).toEqual(['捨札'])
  })

  it('バトルダメージで捨札に置かれた時も、発動条件が満たされ、そのバトルは権利を止めない', () => {
    // 先攻が、後攻のユニットのいるスクエアに、ＢＰの高いユニットを置いてバトルを起こす。
    const board = putOnSquare(armed(mainPhase(), damagingByDiscardedTrap), battleSquare, unitOf('後攻のユニット', weak, '後攻'))
    let state = stateOf(
      playCard(putInZone(withPlanCost(board), '先攻', '手札', [unitOf('攻撃役', vanilla, '先攻')]), { card: '攻撃役', square: battleSquare }, chooseFirst),
    )
    for (let i = 0; i < 40 && aMet(state).length === 0; i += 1) state = pass(state)

    expect(aMet(state).map(({ occasion }) => occasion.kind)).toEqual(['捨札'])
    // 前提: 条件が満たされた時点で、そのバトルは進行中である。
    expect(state.battles.length).toBeGreaterThan(0)
    // バトルは条件より前から進行中だったので、権利は止まらない。
    expect(trapRightsOf(state, 'トラップ')).toHaveLength(1)
  })

  it('自分のターンに自分のユニットが捨札に置かれても、発動できない', () => {
    // 先攻が、先攻自身のトラップと先攻のユニットで、自分のターンに自分のユニットを捨札に置く。
    const own = putInZone(mainPhase(), '先攻', 'トラップゾーン', [
      instantiate({ id: 'トラップ', card: damagingByDiscardedTrap, owner: '先攻' }),
    ])
    const board = putInZone(withPlanCost(own), '先攻', '手札', [unitOf('破壊役', destroyingAllies, '先攻')])
    let state = stateOf(playCard(board, { card: '破壊役', square: battleSquare }, chooseFirst))
    for (let i = 0; i < 10; i += 1) state = pass(state)

    expect(cardsIn(state, '先攻', '捨札').map((each) => each.id)).toContain('破壊役')
    expect(aMet(state)).toEqual([])
  })

  it('相手のユニットが捨札に置かれても、自分のトラップは発動できない', () => {
    // 後攻のトラップがあり、先攻のユニットが先攻自身の効果で捨札に置かれる。
    const board = armed(mainPhase(), damagingByDiscardedTrap)
    const state0 = putInZone(withPlanCost(board), '先攻', '手札', [unitOf('破壊役', destroyingAllies, '先攻')])
    let state = stateOf(playCard(state0, { card: '破壊役', square: battleSquare }, chooseFirst))
    for (let i = 0; i < 10; i += 1) state = pass(state)

    expect(cardsIn(state, '先攻', '捨札').map((each) => each.id)).toContain('破壊役')
    expect(aMet(state)).toEqual([])
  })

  it('スクエア以外から捨札に置かれても、発動条件は満たされない', () => {
    // 先攻の効果で、後攻の手札が捨てられる。
    const board = putInZone(beforePlay(unitOf('手札を捨てさせる役', discardingHand, '先攻')), '後攻', '手札', [unitOf('後攻の手札', vanilla, '後攻')])
    let state = stateOf(playCard(board, { card: '手札を捨てさせる役', square: battleSquare }, chooseFirst))
    for (let i = 0; i < 10; i += 1) state = pass(state)

    expect(cardsIn(state, '後攻', '捨札').map((each) => each.id)).toContain('後攻の手札')
    expect(aMet(state)).toEqual([])
  })

  it('同時に複数の自分のユニットが捨札に置かれると、ユニット 1 枚ごとに満たされ、発動する時にきっかけを選べる', () => {
    const second = (state: DuelState): DuelState => putOnSquare(state, secondEnemySquare, unitOf('後攻の 2 枚目', level4, '後攻'))
    const state = untilMayActivate(resolvedUntilMet(afterPlay(unitOf('破壊役', destroyingEnemies, '先攻'), damagingByDiscardedTrap, second)))
    const asked: number[] = []
    const choosing: Chooser = (candidates, _player, purpose) => {
      if (purpose === 'トラップのきっかけ') {
        asked.push(candidates.length)
        // 後攻の 2 枚目（レベル 4）を選ぶ。
        return (candidates as readonly TrapConditionMet[]).find(({ occasion }) => occasion.kind === '捨札' && occasion.id === '後攻の 2 枚目')
      }
      return candidates[0]
    }

    expect(aMet(state)).toHaveLength(2)
    const after = stateOf(activateTrap(state, 'トラップ', choosing))

    expect(asked).toEqual([2])
    expect(after.damage.先攻).toBe(400)
  })

  it('優先権をパスすると、そのきっかけでは発動できなくなる', () => {
    const state = untilMayActivate(resolvedUntilMet(afterPlay(unitOf('破壊役', destroyingEnemies, '先攻'))))

    const passed = pass(state)

    expect(aMet(passed)).toEqual([])
  })

  it('捨札のトラップが無ければ、ユニットが捨札に置かれても発動条件は何も追加されない', () => {
    const noTrap = putOnSquare(mainPhase(), enemySquare, unitOf('後攻のユニット', weak, '後攻'))
    const board = putInZone(withPlanCost(noTrap), '先攻', '手札', [unitOf('破壊役', destroyingEnemies, '先攻')])
    let state = stateOf(playCard(board, { card: '破壊役', square: battleSquare }, chooseFirst))
    for (let i = 0; i < 10; i += 1) state = pass(state)

    expect(cardsIn(state, '後攻', '捨札').map((each) => each.id)).toContain('後攻のユニット')
    expect(aMet(state)).toEqual([])
  })
})
