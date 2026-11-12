import { describe, expect, it } from 'vitest'
// 盤面を組み立てるためだけに `putInZone` を使う。engine の中からゾーンを差し替えるための
// 関数であり、公開する API ではない。
import { putInZone } from './duel.js'
import {
  PLAYERS,
  abilityGranting,
  bpPlus,
  cardsIn,
  cardsOn,
  defineUnit,
  dream,
  emptyDuelState,
  granting,
  instantiate,
  legalActions,
  modifying,
  passPriority,
  perspectiveOf,
  plan,
  playCard,
  putOnSquare,
} from './index.js'
import type { ActionOutcome, CardInstance, Chooser, CreatedContinuousEffect, DuelState, Square } from './index.js'

// 総合ルール 第4部 第12章 4-1・5-2 の(2)、第4章 1（ADR-0070）。能力を与える常在型能力は、発生源が
// スクエアにいる間だけ、与える先のカードに「夢」を与える。カードはすべてテスト用の架空のもの。

const chooseFirst: Chooser = (candidates) => candidates[0]

const homeSquare: Square = { row: 0, column: 1 }
const otherHomeSquare: Square = { row: 0, column: 0 }

/** 「機械」の、レベル 2 の赤いユニット。プランゾーンに置いて試される側。 */
const machineUnit = defineUnit({
  name: 'テスト・機械ユニット',
  level: 2,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  attributes: ['機械'],
})

/** 「機械」ではない、レベル 2 の赤いユニット。 */
const plainUnit = defineUnit({
  name: 'テスト・ただのユニット',
  level: 2,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  attributes: ['テスト属性'],
})

/** 支配者のプランゾーンにある「機械」のカードへ「夢」を与える常在型能力を持つユニット。 */
const planGranter = defineUnit({
  name: 'テスト・プランへ夢を与えるユニット',
  level: 2,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [
    abilityGranting((duel) =>
      duel
        .planZone()
        .filter((card) => card.card.attributes.includes('機械'))
        .map((card) => granting(card, dream)),
    ),
  ],
})

/** スクエアの味方へ「夢」を与える常在型能力を持つユニット。 */
const allyGranter = defineUnit({
  name: 'テスト・味方へ夢を与えるユニット',
  level: 2,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [abilityGranting((duel) => duel.allies().map((ally) => granting(ally, dream)))],
})

/** 「夢」を持つ味方のＢＰを +300 する常在型能力を持つユニット。ビューが「夢」を含むかを、ＢＰで見分ける。 */
const dreamWatcher = defineUnit({
  name: 'テスト・夢を参照するユニット',
  level: 2,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [
    modifying((duel) =>
      duel
        .allies()
        .filter((ally) => duel.hasKeyword(ally, '夢'))
        .map((ally) => bpPlus(ally, 300)),
    ),
  ],
})

function energy(id: string, color: '赤' | '青'): CardInstance {
  return instantiate({
    id,
    card: defineUnit({ name: `テスト・${color}`, level: 1, colors: [color], bp: 1000, sp: 1000 }),
    owner: '先攻',
  })
}

/** 山札を積んだ、第 1 ターンのメインフェイズで先攻が行動できる盤面。 */
function mainPhase(): DuelState {
  let state = PLAYERS.reduce(
    (current, player) =>
      putInZone(
        current,
        player,
        '山札',
        Array.from({ length: 10 }, (_, index) =>
          instantiate({ id: `${player}の山札${index}`, card: plainUnit, owner: player }),
        ),
      ),
    emptyDuelState(),
  )
  while (state.turn.phase !== 'メインフェイズ') state = passPriority(state, chooseFirst)
  return passPriority(state, chooseFirst)
}

/** 赤 1 枚を含む 2 枚のエネルギーがある、メインフェイズの盤面。 */
function ready(): DuelState {
  return putInZone(mainPhase(), '先攻', 'エネルギーゾーン', [energy('赤エネ', '赤'), energy('青エネ', '青')])
}

const machine = (id: string, owner: '先攻' | '後攻' = '先攻') => instantiate({ id, card: machineUnit, owner })
const plain = (id: string) => instantiate({ id, card: plainUnit, owner: '先攻' })
const granter = (id: string, owner: '先攻' | '後攻' = '先攻') => instantiate({ id, card: planGranter, owner })

function stateOf(outcome: ActionOutcome): DuelState {
  if (outcome.kind !== '行った') throw new Error(`行えなかった: ${outcome.violation}`)
  return outcome.state
}

const playFromPlan = (state: DuelState, id: string): ActionOutcome =>
  playCard(state, { card: id, square: homeSquare }, chooseFirst)

const canPlay = (state: DuelState, id: string): boolean => playFromPlan(state, id).kind === '行った'

const offersPlay = (state: DuelState, id: string): boolean =>
  legalActions(state).some((action) => action.kind === 'カードをプレイする' && action.declaration.card === id)

const keywordsOf = (state: DuelState, viewer: '先攻' | '後攻', id: string) =>
  perspectiveOf(state, viewer).effectiveKeywords.find((each) => each.card === id)?.keywords

describe('プランゾーンのカードへ「夢」を与える常在型能力', () => {
  const withPlan = (planned: CardInstance, source?: CardInstance): DuelState => {
    const state = putInZone(ready(), '先攻', 'プランゾーン', [planned])
    return source === undefined ? state : putOnSquare(state, otherHomeSquare, source)
  }

  it('発生源がスクエアにいれば、条件に合うカードが「夢」を持たなくてもプランゾーンからプレイできる', () => {
    const state = withPlan(machine('機械'), granter('源'))

    expect(canPlay(state, '機械')).toBe(true)
    expect(offersPlay(state, '機械')).toBe(true)
    const after = stateOf(playFromPlan(state, '機械'))
    expect(cardsOn(after, homeSquare).map((card) => card.id)).toEqual(['機械'])
    expect(cardsIn(after, '先攻', 'プランゾーン')).toEqual([])
  })

  it('条件に合わない属性のカードはプレイできない', () => {
    const state = withPlan(plain('ただの'), granter('源'))

    expect(canPlay(state, 'ただの')).toBe(false)
    expect(offersPlay(state, 'ただの')).toBe(false)
  })

  it('発生源がスクエアにいなければ、プレイできない', () => {
    const planned = machine('機械')
    const base = withPlan(planned)

    expect(canPlay(base, '機械')).toBe(false)
    for (const zone of ['手札', '捨札'] as const) {
      const inZone = putInZone(putInZone(ready(), '先攻', 'プランゾーン', [planned]), '先攻', zone, [granter('源')])
      expect(canPlay(inZone, '機械')).toBe(false)
    }
  })

  // 発生源がプランゾーンにいる場合。プランゾーンには 1 枚しか置けないので、与える先と同居できない代わりに、
  // 発生源自身が与える先の条件に合う場合を試す。スクエアにいない発生源は、自分自身にも与えない。
  it('発生源自身がプランゾーンにいても、自分自身に与えない', () => {
    const selfGranting = defineUnit({
      name: 'テスト・自分も機械の発生源',
      level: 2,
      colors: ['赤'],
      bp: 1000,
      sp: 1000,
      attributes: ['機械'],
      abilities: [
        abilityGranting((duel) =>
          duel
            .planZone()
            .filter((card) => card.card.attributes.includes('機械'))
            .map((card) => granting(card, dream)),
        ),
      ],
    })
    const state = withPlan(instantiate({ id: '自分', card: selfGranting, owner: '先攻' }))

    expect(canPlay(state, '自分')).toBe(false)
    expect(keywordsOf(state, '先攻', '自分')).toBeUndefined()
  })

  it('発生源がスクエアを離れると、与えられなくなる', () => {
    const state = withPlan(machine('機械'), granter('源'))
    expect(canPlay(state, '機械')).toBe(true)

    const left: DuelState = {
      ...state,
      squares: state.squares.map((cards) => cards.filter((card) => card.id !== '源')),
    }

    expect(canPlay(left, '機械')).toBe(false)
    expect(keywordsOf(left, '先攻', '機械')).toBeUndefined()
  })

  it('相手のプランゾーンのカードには与えられない', () => {
    const foreign = putInZone(ready(), '後攻', 'プランゾーン', [machine('相手の機械', '後攻')])
    const state = putOnSquare(foreign, otherHomeSquare, granter('源'))

    expect(keywordsOf(state, '先攻', '相手の機械')).toBeUndefined()
    expect(keywordsOf(state, '後攻', '相手の機械')).toBeUndefined()
  })

  it('相手の発生源は、こちらのプランゾーンのカードに与えない', () => {
    const state = putOnSquare(withPlan(machine('機械')), otherHomeSquare, granter('相手の源', '後攻'))

    expect(canPlay(state, '機械')).toBe(false)
  })

  it('2 人の画面のどちらにも、プランゾーンのカードの「夢」が表示される', () => {
    const state = withPlan(machine('機械'), granter('源'))

    expect(keywordsOf(state, '先攻', '機械')).toEqual(['夢'])
    expect(keywordsOf(state, '後攻', '機械')).toEqual(['夢'])
  })

  // 総合ルール 第4部 第12章 2。プランゾーンに置かれるカードは、置かれた時点で能力を与えられている。
  it('プランした直後のカードにも、置かれた時点から与えられている', () => {
    const source = granter('源')
    const top = machine('機械')
    // プランはエネルギーを 1 枚フリーズするので、レベル 2 を支払うために 1 枚多く置いておく。
    const withExtraEnergy = putInZone(ready(), '先攻', 'エネルギーゾーン', [
      ...cardsIn(ready(), '先攻', 'エネルギーゾーン'),
      energy('赤エネ2', '赤'),
    ])
    const base = putOnSquare(
      putInZone(withExtraEnergy, '先攻', '山札', [top, ...cardsIn(withExtraEnergy, '先攻', '山札')]),
      otherHomeSquare,
      source,
    )

    const planned = stateOf(plan(base, chooseFirst))
    expect(keywordsOf(planned, '後攻', '機械')).toEqual(['夢'])

    const mine = passPriority(planned, chooseFirst)
    expect(canPlay(mine, '機械')).toBe(true)
  })

  it('作成された継続効果が与えた「夢」と重なっても、判定も表示も変化しない', () => {
    const created: CreatedContinuousEffect = {
      target: '機械',
      change: { kind: '能力の付与', ability: dream },
      until: 'ターンの終わりまで',
      controller: '先攻',
      createdIn: 1,
    }
    const state: DuelState = { ...withPlan(machine('機械'), granter('源')), createdContinuousEffects: [created] }

    expect(canPlay(state, '機械')).toBe(true)
    expect(keywordsOf(state, '先攻', '機械')).toEqual(['夢'])
  })
})

describe('スクエアの味方へ「夢」を与える常在型能力', () => {
  it('与えられた「夢」を、効果に見せるビューの `hasKeyword` が含む', () => {
    const base = putOnSquare(mainPhase(), homeSquare, instantiate({ id: '源', card: allyGranter, owner: '先攻' }))
    const state = putOnSquare(base, otherHomeSquare, instantiate({ id: '見張り', card: dreamWatcher, owner: '先攻' }))

    const bps = new Map(perspectiveOf(state, '先攻').effective.map((each) => [each.card, each.bp]))

    // 発生源自身も味方なので、「夢」を持つ。見張りも与えられて、自分のＢＰを +300 する。
    expect(bps.get('源')).toBe(1300)
    expect(bps.get('見張り')).toBe(1300)
  })

  it('発生源がいなければ、「夢」は与えられず、ＢＰも変化しない', () => {
    const state = putOnSquare(mainPhase(), otherHomeSquare, instantiate({ id: '見張り', card: dreamWatcher, owner: '先攻' }))

    expect(perspectiveOf(state, '先攻').effective.find((each) => each.card === '見張り')?.bp).toBe(1000)
  })
})
