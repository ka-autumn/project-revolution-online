import { describe, expect, it } from 'vitest'
import { putTriggeredIntoBank, resolveFromBank } from './bank.js'
// 盤面を組み立てるためだけに `putInZone` と `moveToResolveZone` を使う。engine の中から
// ゾーンを差し替えるための関数であり、公開する API ではない。
import { moveToResolveZone, putInZone } from './duel.js'
import {
  PLAYERS,
  bpPlus,
  modifying,
  perspectiveOf,
  activateAbility,
  activatedAbility,
  cardsIn,
  choose,
  defineStrategy,
  defineUnit,
  destroy,
  discardOpponentHand,
  discardTrap,
  emptyDuelState,
  instantiate,
  passPriority,
  placeInZone,
  placeTopOfLibrary,
  plan,
  putOnSquare,
  resolveEffect,
  triggeredAbility,
} from './index.js'
import type {
  ActionOutcome,
  Card,
  CardInDiscardPile,
  CardInstance,
  Chooser,
  DuelState,
  OwnDiscardOccasion,
  Phase,
  Player,
  Square,
} from './index.js'
import { checkRuleEffects } from './rule-effect.js'
import { moveToZone } from './zone-move.js'

// 「このカードが捨札に置かれた時」（ADR-0059）。検証したいルールだけを持つ架空のカードで調べる
// （ADR-0002）。

const chooseFirst: Chooser = (candidates) => candidates[0]
const VIA = '誘発' as const

/** 置かれた時の、きっかけと渡されたカードを覚えておく。効果は何もしない。 */
const occasions: OwnDiscardOccasion[] = []
const placedCards: CardInDiscardPile[] = []

const ownWatcher = defineUnit({
  name: 'テスト・自分が捨札に置かれた時',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [
    triggeredAbility(
      'このカードが捨札に置かれた時',
      function* (_duel, placed) {
        placedCards.push(placed)
      },
      (occasion) => {
        occasions.push(occasion)
        return true
      },
    ),
  ],
})

/** 「手札かスクエアから」置かれた時だけ誘発する。 */
const fromHandOrSquare = defineUnit({
  name: 'テスト・手札かスクエアから',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [
    triggeredAbility(
      'このカードが捨札に置かれた時',
      function* () {},
      (occasion) => occasion.from === '手札' || occasion.from === 'スクエア',
    ),
  ],
})

/** スクエアのユニットが置かれた時に誘発する、既存の誘発イベントの能力を持つ。 */
const squareWatcher = defineUnit({
  name: 'テスト・スクエアのユニットの捨札',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [triggeredAbility('あなたのユニットがスクエアから捨札に置かれた時', function* () {})],
})

/** 味方のＢＰを 500 上げる常在型能力を持つユニット。 */
const booster = defineUnit({
  name: 'テスト・味方を強くする',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [modifying((duel) => duel.allies().map((ally) => bpPlus(ally, 500)))],
})

const vanilla = defineUnit({ name: 'テスト・バニラ', level: 1, colors: ['赤'], bp: 1000, sp: 1000 })
const strategyWithOwnDiscard = defineStrategy({
  name: 'テスト・ストラテジー',
  level: 1,
  colors: ['赤'],
  abilities: [triggeredAbility('このカードが捨札に置かれた時', function* () {})],
})

const home: Square = { row: 0, column: 1 }
const other: Square = { row: 0, column: 2 }

function instance(id: string, card: Card = ownWatcher, owner: Player = '先攻'): CardInstance {
  return instantiate({ id, card, owner })
}

function triggeredSources(state: DuelState): readonly string[] {
  return state.triggered.flatMap((each) => (each.source === undefined ? [] : [each.source]))
}

/** 誘発していたものも、バンクに入ったものも含めた、能力の発生源。 */
function pendingSources(state: DuelState): readonly string[] {
  return [...state.triggered, ...state.bank].flatMap((each) => ('source' in each && each.source !== undefined ? [each.source] : []))
}

describe('置かれるカード自身の誘発', () => {
  // ADR-0059: 捨札以外のどのゾーンから置かれても誘発する。裏向きのゾーンも含む。
  // 総合ルール 第2部 第21章 1-2: 持ち主のゾーンにあるカードの支配者は持ち主である。
  it.each(['手札', '山札', 'プランゾーン', 'トラップゾーン', 'エネルギーゾーン', 'スマッシュゾーン'] as const)('%s から捨札に置かれると誘発する', (zone) => {
    occasions.length = 0
    const state = putInZone(emptyDuelState(), '先攻', zone, [instance('自分')])

    const moved = moveToZone(state, ['自分'], '捨札')

    expect(triggeredSources(moved)).toEqual(['自分'])
    expect(cardsIn(moved, '先攻', '捨札').map((each) => each.id)).toEqual(['自分'])
    expect(occasions).toMatchObject([{ kind: '自身の捨札', from: zone, id: '自分', controller: '先攻' }])
  })

  // 総合ルール 第2部 第21章 12-1: 解決が終わったストラテジー・トラップはリゾルブゾーンから置かれる。
  it('リゾルブゾーンから捨札に置かれると誘発する', () => {
    occasions.length = 0
    const inHand = putInZone(emptyDuelState(), '先攻', '手札', [instance('自分', strategyWithOwnDiscard)])

    const moved = moveToZone(moveToResolveZone(inHand, '自分'), ['自分'], '捨札')

    expect(triggeredSources(moved)).toEqual(['自分'])
  })

  // 総合ルール 第4部 第12章 2: スクエアから置かれる時のきっかけは、継続効果を適用した後のデータを持つ。
  it('スクエアから置かれる時のきっかけは、継続効果を適用した後のデータを持つ', () => {
    occasions.length = 0
    const state = putOnSquare(
      putOnSquare(emptyDuelState(), home, instance('自分')),
      other,
      instance('強くする役', booster),
    )

    moveToZone(state, ['自分'], '捨札')

    expect(occasions).toMatchObject([{ from: 'スクエア', card: { bp: 1500 } }])
  })

  it('スクエアから捨札に置かれると、置かれたスクエアをきっかけに持って誘発する', () => {
    occasions.length = 0
    const state = putOnSquare(emptyDuelState(), home, instance('自分'))

    const moved = moveToZone(state, ['自分'], '捨札')

    expect(triggeredSources(moved)).toEqual(['自分'])
    expect(occasions).toMatchObject([{ kind: '自身の捨札', from: 'スクエア', id: '自分', square: home, controller: '先攻' }])
  })

  // 総合ルール 第2部 第21章 1-2: スクエアの外にあるカードの支配者は持ち主である。
  it('相手の手札にあるカードが置かれたら、能力の支配者は持ち主になる', () => {
    const state = putInZone(emptyDuelState(), '後攻', '手札', [instance('相手のカード', ownWatcher, '後攻')])

    const moved = moveToZone(state, ['相手のカード'], '捨札')

    expect(moved.triggered.map((each) => each.controller)).toEqual(['後攻'])
  })

  // ADR-0059: 置かれたカードは効果へ手渡され、命令の対象にできる。
  it('置かれたカードを、効果へ手渡す', () => {
    placedCards.length = 0
    const state = putInZone(emptyDuelState(), '先攻', '手札', [instance('自分')])

    const bank = putTriggeredIntoBank(moveToZone(state, ['自分'], '捨札'))
    resolveFromBank(bank, chooseFirst)

    expect(placedCards).toEqual([{ id: '自分', zone: '捨札', card: ownWatcher }])
  })

  // ADR-0004: 相手の手札にあった時は名指しされないが、捨札に置かれた後は公開されたカードである。
  it('手札から置かれて誘発した能力を解決する行が、相手の視点でもそのカードを名指しする', () => {
    const state = putInZone(emptyDuelState(), '先攻', '手札', [instance('自分')])

    const resolved = resolveFromBank(putTriggeredIntoBank(moveToZone(state, ['自分'], '捨札')), chooseFirst)

    const sources = perspectiveOf(resolved, '後攻').log.flatMap(({ event }) =>
      event.kind === '能力を解決した' ? [event.source] : [],
    )
    expect(sources).toEqual(['自分'])
  })

  // 総合ルール 第4部 第7章 6・10
  it('同時に 2 枚が置かれたら、カードごとに 1 度ずつ誘発する', () => {
    const state = putInZone(emptyDuelState(), '先攻', '手札', [instance('一枚目'), instance('二枚目')])

    const moved = moveToZone(state, ['一枚目', '二枚目', '一枚目'], '捨札')

    expect(triggeredSources(moved)).toEqual(['一枚目', '二枚目'])
  })

  // ADR-0059: 手札とスクエアのように、元のゾーンが別々のカードも同時に置ける。
  it('手札とスクエアから同時に置かれても、それぞれの元のゾーンで誘発する', () => {
    occasions.length = 0
    const state = putOnSquare(putInZone(emptyDuelState(), '先攻', '手札', [instance('手札から')]), home, instance('スクエアから'))

    const moved = moveToZone(state, ['手札から', 'スクエアから'], '捨札')

    expect(triggeredSources(moved)).toEqual(['手札から', 'スクエアから'])
    expect(occasions.map((each) => each.from)).toEqual(['手札', 'スクエア'])
  })

  // ADR-0059: スクエアにいるユニットの誘発を先に、置かれるカード自身の誘発を後に積む。
  it('スクエアにいるユニットの誘発を先に、置かれるカード自身の誘発を後に積む', () => {
    const state = putOnSquare(
      putOnSquare(emptyDuelState(), home, instance('自分')),
      other,
      instance('見ているユニット', squareWatcher),
    )

    const moved = moveToZone(state, ['自分'], '捨札')

    expect(triggeredSources(moved)).toEqual(['見ているユニット', '自分'])
  })

  it('「手札かスクエアから」と絞った能力は、山札から置かれても誘発しない', () => {
    const fromLibrary = putInZone(emptyDuelState(), '先攻', '山札', [instance('山札から', fromHandOrSquare)])
    const fromHand = putInZone(emptyDuelState(), '先攻', '手札', [instance('手札から', fromHandOrSquare)])
    const fromSquare = putOnSquare(emptyDuelState(), home, instance('スクエアから', fromHandOrSquare))

    expect(triggeredSources(moveToZone(fromLibrary, ['山札から'], '捨札'))).toEqual([])
    expect(triggeredSources(moveToZone(fromHand, ['手札から'], '捨札'))).toEqual(['手札から'])
    expect(triggeredSources(moveToZone(fromSquare, ['スクエアから'], '捨札'))).toEqual(['スクエアから'])
  })

  // ADR-0059: 今回、誘発を探すのは行き先が捨札の時だけである。
  it('捨札以外のゾーンへ動かしても誘発しない', () => {
    const state = putInZone(emptyDuelState(), '先攻', '山札', [instance('自分')])

    expect(triggeredSources(moveToZone(state, ['自分'], '手札'))).toEqual([])
  })

  // ADR-0059: 捨札以外のゾーンから置かれた時に誘発する。
  // ADR-0059 の「実装」の節: スクエアにあるユニット以外のカードの自身の誘発は、運用が確認できるまで
  // 誘発させない。置かれること自体は行われる。
  it('スクエアにあるユニット以外のカードが置かれても、自身の誘発は起こさない', () => {
    const state = putOnSquare(emptyDuelState(), home, instance('自分', strategyWithOwnDiscard))

    const moved = moveToZone(state, ['自分'], '捨札')

    expect(triggeredSources(moved)).toEqual([])
    expect(cardsIn(moved, '先攻', '捨札').map((each) => each.id)).toEqual(['自分'])
  })

  it('すでに捨札にあるカードは、捨札から置かれたことにならない', () => {
    const state = putInZone(emptyDuelState(), '先攻', '捨札', [instance('自分')])

    expect(triggeredSources(moveToZone(state, ['自分'], '捨札'))).toEqual([])
  })

  it('どこにも無いカードは誘発しない', () => {
    expect(triggeredSources(moveToZone(emptyDuelState(), ['無い'], '捨札'))).toEqual([])
  })

  // 総合ルール 第4部 第7章 6: スクエアにいるユニットの「あなたのユニットがスクエアから捨札に置かれた時」は、
  // スクエアの外から置かれたカードでは誘発しない（動きを変更しない）。
  it('スクエアの外から置かれても、スクエアにいるユニットの「スクエアから」の能力は誘発しない', () => {
    const state = putOnSquare(
      putInZone(emptyDuelState(), '先攻', '手札', [instance('手札のカード', vanilla)]),
      home,
      instance('見ているユニット', squareWatcher),
    )

    expect(triggeredSources(moveToZone(state, ['手札のカード'], '捨札'))).toEqual([])
  })
})

// 捨札へ置く経路のそれぞれが、置かれるカード自身の誘発を探す（ADR-0059）。
describe('捨札に置く経路', () => {
  const effect = (state: DuelState, steps: Parameters<typeof resolveEffect>[1]): DuelState =>
    resolveEffect(state, steps, { controller: '先攻', via: VIA, chooser: chooseFirst })

  /** 山札を積んだ盤面。山札が尽きるとプレイヤーが敗北するので、優先権を動かすテストで使う。 */
  function stocked(): DuelState {
    return PLAYERS.reduce(
      (state, player) =>
        putInZone(
          state,
          player,
          '山札',
          Array.from({ length: 10 }, (_, index) => instance(`${player}の山札${index}`, vanilla, player)),
        ),
      emptyDuelState(),
    )
  }

  function readyToAct(phase: Phase): DuelState {
    let current = stocked()
    while (current.turn.phase !== phase) current = passPriority(current, chooseFirst)
    return passPriority(current, chooseFirst)
  }

  function outcome(result: ActionOutcome): DuelState {
    if (result.kind !== '行った') throw new Error(`行えなかった: ${result.violation}`)
    return result.state
  }

  // 総合ルール 第4部 第10章 2（ADR-0059）
  it('相手に手札を捨てさせる', () => {
    const state = putInZone(emptyDuelState(), '後攻', '手札', [instance('相手のカード', ownWatcher, '後攻')])

    expect(triggeredSources(effect(state, function* () { yield* discardOpponentHand(1) }))).toEqual(['相手のカード'])
  })

  // ADR-0059: 効果の「ゾーンへ置く」
  it('効果でゾーンへ置く', () => {
    const state = putInZone(emptyDuelState(), '先攻', '手札', [instance('自分')])

    const after = effect(state, function* (duel) {
      const chosen = yield* choose(duel.hand())
      if (chosen !== undefined) yield* placeInZone(chosen, '捨札', 'リリース')
    })

    expect(triggeredSources(after)).toEqual(['自分'])
  })

  // ADR-0059: 効果の「山札の1番上をゾーンへ置く」
  it('効果で山札の 1 番上を捨札に置く', () => {
    const state = putInZone(emptyDuelState(), '先攻', '山札', [instance('自分')])

    expect(triggeredSources(effect(state, function* () { yield* placeTopOfLibrary('捨札', 'リリース') }))).toEqual(['自分'])
  })

  // 総合ルール 第2部 第20章 3-12（ADR-0059）
  it('トラップを廃棄する', () => {
    const state = putInZone(readyToAct('メインフェイズ'), '先攻', 'トラップゾーン', [instance('自分')])

    expect(pendingSources(outcome(discardTrap(state, '自分')))).toEqual(['自分'])
  })

  // 総合ルール 第3部 第8章 2-3（ADR-0059）
  it('プランを置き換える時に、プランゾーンにあったカードを置く', () => {
    const ready = putInZone(readyToAct('メインフェイズ'), '先攻', '山札', [
      instance('次のプラン', vanilla),
      instance('山札の 2 枚目', vanilla),
    ])
    const planned = putInZone(ready, '先攻', 'エネルギーゾーン', [instance('エネ 1', vanilla), instance('エネ 2', vanilla)])
    // 最初のプランに、置かれるカード自身の能力を持つカードを使う。
    const withPlan = putInZone(
      planned,
      '先攻',
      'プランゾーン',
      [instance('自分')],
    )

    expect(pendingSources(outcome(plan(withPlan, chooseFirst)))).toEqual(['自分'])
  })

  // 総合ルール 第4部 第2章 1（ADR-0059）
  it('コストで自分を捨札に置く', () => {
    const discardingSelf = defineUnit({
      name: 'テスト・自分を捨てる起動',
      level: 1,
      colors: ['赤'],
      bp: 1000,
      sp: 1000,
      abilities: [
        activatedAbility({ energiesOfOwnColor: 1, discardsSelf: true }, function* () {}),
        triggeredAbility('このカードが捨札に置かれた時', function* () {}),
      ],
    })
    const state = putOnSquare(
      putInZone(readyToAct('メインフェイズ'), '先攻', 'エネルギーゾーン', [instance('エネ', vanilla)]),
      home,
      instance('自分', discardingSelf),
    )

    expect(pendingSources(outcome(activateAbility(state, '自分', 0, chooseFirst)))).toEqual(['自分'])
  })

  // 総合ルール 第2部 第21章 5-1（ADR-0059）
  it('効果でスクエアのユニットを破壊する', () => {
    const state = putOnSquare(emptyDuelState(), home, instance('自分'))

    const after = effect(state, function* (duel) {
      const [mine] = duel.allies()
      if (mine !== undefined) yield* destroy(mine)
    })

    expect(triggeredSources(after)).toEqual(['自分'])
  })

  // 総合ルール 第4部 第14章 4-5: ＢＰが 0 以下のユニットはルールエフェクトで捨札に置かれる。
  it('ルールエフェクトでスクエアから捨札に置かれる', () => {
    const zeroBp = defineUnit({
      name: 'テスト・ＢＰ0',
      level: 1,
      colors: ['赤'],
      bp: 0,
      sp: 1000,
      abilities: [triggeredAbility('このカードが捨札に置かれた時', function* () {})],
    })
    const state = putOnSquare(readyToAct('メインフェイズ'), home, instance('自分', zeroBp))

    expect(pendingSources(checkRuleEffects(state))).toEqual(['自分'])
  })
})
