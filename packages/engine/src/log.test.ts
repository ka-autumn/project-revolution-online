import { describe, expect, it } from 'vitest'
// 山札やゾーンを組み立てるためだけに `putInZone` を使う。engine の中からゾーンを差し替える
// ための関数であり、公開する API ではない（`rule-effect.test.ts` と同じ）。
import { putInZone } from './duel.js'
import { activateCourage, checkCourageCondition } from './courage.js'
import {
  PLAYERS,
  activatedAbility,
  activateAbility,
  activateTrap,
  applyLegalAction,
  applyWithAnswers,
  choose,
  courage,
  defineStrategy,
  defineTrap,
  defineUnit,
  destroy,
  drawCards,
  emptyDuelState,
  freeze,
  hope,
  instantiate,
  passPriority,
  perspectiveOf,
  playCard,
  putOnSquare,
  resolveEffect,
  smash,
  triggeredAbility,
} from './index.js'
import type {
  ActionOutcome,
  Card,
  CardInstance,
  Chooser,
  DuelEvent,
  DuelState,
  LegalAction,
  Phase,
  Player,
  PlayerZone,
  ResolutionVia,
  Square,
  UnitOnSquare,
} from './index.js'

/**
 * 起きたできごとの記録（#95、`log.ts`）。
 *
 * 盤面は「その時点の姿」しか持たないので、そこへ至る道筋は盤面を見比べても分からない。
 * ここで見るのは**何が残るか**と、**視点ごとに何が落ちるか**である。
 */

// 検証したいところだけを持つ架空のテストカード（ADR-0002）。
const vanilla = defineUnit({ name: 'テスト・バニラ', level: 1, colors: ['赤'], bp: 1000, sp: 500 })

/** 敵を 1 枚選んで破壊する。選ぶことと、その結果の 2 つが並ぶ。 */
const chooseAndDestroy = defineStrategy({
  name: 'テスト・選んで破壊',
  level: 0,
  colors: ['赤'],
  effect: function* (duel) {
    const enemy = yield* choose(duel.enemies())
    if (enemy !== undefined) yield* destroy(enemy)
  },
})

/** すでにフリーズ状態のユニットをフリーズしようとする。実行できない行動になる。 */
const freezeEnemies = defineStrategy({
  name: 'テスト・敵をフリーズ',
  level: 0,
  colors: ['赤'],
  effect: function* (duel) {
    for (const enemy of duel.enemies()) yield* freeze(enemy)
  },
})

/** エネルギーフェイズの始めに、敵を 1 枚選んで破壊する能力を持つユニット。 */
const beginningChooser = defineUnit({
  name: 'テスト・フェイズの始めに選ぶ',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 500,
  abilities: [
    triggeredAbility('エネルギーフェイズの始め', function* (duel) {
      const enemy = yield* choose(duel.enemies())
      if (enemy !== undefined) yield* destroy(enemy)
    }),
  ],
})

/** 引くだけの能力を持つユニット。どの能力から出た命令かを見るのに使う。 */
const beginningDrawer = defineUnit({
  name: 'テスト・フェイズの始めに引く',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 500,
  abilities: [
    triggeredAbility('エネルギーフェイズの始め', function* (duel) {
      yield* drawCards(duel.controller, 1)
    }),
  ],
})

const mySquare: Square = { row: 2, column: 1 }
const centerSquare: Square = { row: 1, column: 1 }
const enemySquare: Square = { row: 0, column: 1 }
const anotherEnemySquare: Square = { row: 0, column: 2 }

const PASS: LegalAction = { kind: '優先権を放棄する' }

const chooseFirst: Chooser = (candidates) => candidates[0]

/**
 * `resolveEffect` を直に呼ぶテストのうち、経路を見ていないものが使い回す（#104）。
 * 経路そのものを見るテストは `describe('解決の入口ごとの言葉')` に置く。
 */
const VIA: ResolutionVia = '誘発'

/**
 * 山札を積んだ、カードの置かれていない盤面。
 *
 * 山札が 0 枚以下のプレイヤーは次に優先権が発生した時に敗北する（総合ルール 第3部 第3章 2）
 * ので、優先権を動かすテストでは積んでおく。
 */
function stocked(): DuelState {
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

/**
 * アクティブプレイヤー（先攻）が行動できる、そのフェイズの盤面。
 *
 * フェイズの始めには非アクティブプレイヤーに優先権が発生する（総合ルール 第3部 第7章 1・
 * 第8章 1）ので、そこから 1 度放棄させてアクティブプレイヤーに優先権を移す。
 */
function readyToAct(phase: Phase, state: DuelState = stocked()): DuelState {
  let current = state
  while (current.turn.phase !== phase) current = passPriority(current, chooseFirst)
  return passPriority(current, chooseFirst)
}

/** カード 1 枚を、そのプレイヤーのそのゾーンに置く。 */
function inZone(state: DuelState, owner: Player, zone: PlayerZone, card: CardInstance): DuelState {
  return putInZone(state, owner, zone, [...state.zones[owner][zone], card])
}

/** 後攻のユニット 1 枚。効果の対象になる。 */
function enemy(id: string): CardInstance {
  return instantiate({ id, card: vanilla, owner: '後攻' })
}

/** その種類のできごとだけを取り出す。ほかのできごとが増えても、見たいところがぶれないように。 */
function only<K extends DuelEvent['kind']>(state: DuelState, kind: K): readonly Extract<DuelEvent, { kind: K }>[] {
  return state.log.filter((event): event is Extract<DuelEvent, { kind: K }> => event.kind === kind)
}

/** 実行された命令だけを、順に取り出す。 */
function instructions(state: DuelState): readonly unknown[] {
  return only(state, '命令を実行した').map((event) => event.instruction)
}

describe('行った手の記録', () => {
  it('行われた順に残る', () => {
    const once = applyLegalAction(stocked(), PASS, chooseFirst)
    const twice = applyLegalAction(once, PASS, chooseFirst)

    expect(only(twice, '行動した').map((event) => event.action)).toEqual(['優先権を放棄する', '優先権を放棄する'])
  })

  // フェイズの始めに優先権を持つのは非アクティブプレイヤー（総合ルール 第3部 第5章 1）。
  it('行ったプレイヤーが残る', () => {
    const passed = applyLegalAction(stocked(), PASS, chooseFirst)

    expect(only(passed, '行動した')[0]?.player).toBe('後攻')
  })

  it('指したカードが残る', () => {
    const energy = instantiate({ id: '置くカード', card: vanilla, owner: '先攻' })
    const state = readyToAct('エネルギーフェイズ', inZone(stocked(), '先攻', '手札', energy))

    const placed = applyLegalAction(state, { kind: 'エネルギーを置く', card: energy.id }, chooseFirst)

    expect(only(placed, '行動した').at(-1)).toEqual({
      kind: '行動した',
      player: '先攻',
      action: 'エネルギーを置く',
      card: energy.id,
      square: undefined,
    })
  })
})

describe('効果の記録', () => {
  const board = putOnSquare(putOnSquare(stocked(), enemySquare, enemy('敵')), mySquare, instantiate({ id: '味方', card: vanilla, owner: '先攻' }))

  it('選んだものと、その結果が並んで残る', () => {
    const resolved = resolveEffect(board, chooseAndDestroy.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(instructions(resolved)).toEqual([
      { kind: '選ぶ', card: '敵' },
      { kind: '破壊する', card: '敵' },
    ])
  })

  /** 実行できない行動は実行されない（総合ルール 第1部 第1章 3）ので、何も起きていない。 */
  it('実行されなかった命令は残らない', () => {
    const frozen = putOnSquare(stocked(), enemySquare, { ...enemy('敵'), orientation: 'フリーズ' })

    const resolved = resolveEffect(frozen, freezeEnemies.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(instructions(resolved)).toEqual([])
  })

  /**
   * どの能力から出た命令かは、並びで分かる。解決を始めたことが先に残る
   * （総合ルール 第2部 第21章 11-3）。
   */
  it('能力の解決が、その命令より先に残る', () => {
    const drawer = instantiate({ id: '引く役', card: beginningDrawer, owner: '先攻' })
    const placed = putOnSquare(stocked(), mySquare, drawer)

    const resolved = resolveBank(readyToAct('エネルギーフェイズ', placed))

    expect(resolved.log.filter((event) => event.kind !== '行動した')).toEqual([
      { kind: '能力を解決した', controller: '先攻', via: '誘発', source: drawer.id },
      { kind: '命令を実行した', controller: '先攻', instruction: { kind: 'カードを引く', player: '先攻', count: 1 } },
    ])
  })
})

/**
 * 「発動」はトラップの言葉である（総合ルール 第2部 第20章 3-10）。起動型能力の「起動」
 * （同 第4部 第2章 1）や誘発型能力の「誘発」（同 第3章 2）と取り違えると別のことを指す
 * （`log.ts` の `ResolutionVia`）。**どれであるかは画面の側に推測させず、解決の入口 5 つの
 * どれを通ったかで決める。**
 */
describe('解決の入口ごとの言葉', () => {
  /** 行えたはずの行動の結果の盤面。 */
  function stateOf(outcome: ActionOutcome): DuelState {
    if (outcome.kind !== '行った') throw new Error(`行えなかった: ${outcome.violation}`)
    return outcome.state
  }

  /** その解決で残った、最後の `能力を解決した` の経路。 */
  function lastVia(state: DuelState): ResolutionVia | undefined {
    return only(state, '能力を解決した').at(-1)?.via
  }

  // 総合ルール 第4部 第3章 2、第2部 第21章 11-3
  it('誘発型能力がバンクから解決されると「誘発」になる', () => {
    const drawer = instantiate({ id: '引く役', card: beginningDrawer, owner: '先攻' })
    const placed = putOnSquare(stocked(), mySquare, drawer)

    const resolved = resolveBank(readyToAct('エネルギーフェイズ', placed))

    expect(lastVia(resolved)).toBe('誘発')
  })

  // 総合ルール 第2部 第20章 3-10
  it('トラップが発動されると「発動」になる', () => {
    const activatingTrap = defineTrap({
      name: 'テスト・発動トラップ',
      level: 1,
      colors: ['赤'],
      effect: function* (duel) {
        const target = yield* choose(duel.enemies())
        if (target !== undefined) yield* destroy(target)
      },
    })
    const trap = instantiate({ id: 'トラップ', card: activatingTrap, owner: '先攻' })
    const invader: UnitOnSquare = { id: '敵', square: enemySquare, card: vanilla, controller: '後攻' }
    const state: DuelState = {
      ...putOnSquare(
        inZone(inZone(readyToAct('メインフェイズ'), '先攻', 'トラップゾーン', trap), '先攻', 'エネルギーゾーン', enemy('エネルギー')),
        enemySquare,
        enemy('敵'),
      ),
      trapConditionsMet: [{ trap: 'トラップ', occasion: { kind: '侵入', invader } }],
    }

    const resolved = stateOf(activateTrap(state, 'トラップ', chooseFirst))

    expect(lastVia(resolved)).toBe('発動')
  })

  // 総合ルール 第4部 第2章 1
  it('起動型能力が起動されると「起動」になる', () => {
    const activatingUnit = defineUnit({
      name: 'テスト・起動ユニット',
      level: 1,
      colors: ['赤'],
      bp: 1000,
      sp: 500,
      abilities: [
        activatedAbility({ energiesOfOwnColor: 1, discardsSelf: false }, function* (duel) {
          yield* drawCards(duel.controller, 1)
        }),
      ],
    })
    const unit = instantiate({ id: '起動役', card: activatingUnit, owner: '先攻' })
    const state = putOnSquare(
      inZone(readyToAct('メインフェイズ'), '先攻', 'エネルギーゾーン', instantiate({ id: 'エネルギー', card: vanilla, owner: '先攻' })),
      mySquare,
      unit,
    )

    const resolved = stateOf(activateAbility(state, '起動役', 0, chooseFirst))

    expect(lastVia(resolved)).toBe('起動')
  })

  // 総合ルール 第5部 第2章 1。「勇気」も起動型能力である。
  it('「勇気」が起動されると「起動」になる', () => {
    const courageCard = defineUnit({
      name: 'テスト・勇気',
      level: 1,
      colors: ['赤'],
      bp: 1000,
      sp: 1000,
      abilities: [courage(1000)],
    })
    const holding = inZone(
      inZone(stocked(), '後攻', '手札', instantiate({ id: 'テスト・勇気', card: courageCard, owner: '後攻' })),
      '後攻',
      'エネルギーゾーン',
      instantiate({ id: 'エネルギー', card: vanilla, owner: '後攻' }),
    )
    // 先攻のユニットが、後攻から見た味方エリア（`mySquare`、row 2）に置かれる
    // （総合ルール 第5部 第2章 2、`areaOf` の HOME_ROW_OF_FIRST は row 0 なので、
    // 後攻の味方エリアは反対側の row 2 になる）。
    const placed: UnitOnSquare = { id: '置かれたユニット', square: mySquare, card: vanilla, controller: '先攻' }
    const state = checkCourageCondition(putOnSquare(holding, mySquare, instantiate({ id: '置かれたユニット', card: vanilla, owner: '先攻' })), placed)

    const resolved = stateOf(activateCourage(state, 'テスト・勇気', chooseFirst))

    expect(lastVia(resolved)).toBe('起動')
  })

  // 総合ルール 第2部 第20章 2-3
  it('ストラテジーがプレイされて解決されると「プレイ」になる', () => {
    const strategy = defineStrategy({
      name: 'テスト・プレイストラテジー',
      level: 1,
      colors: ['赤'],
      effect: function* (duel) {
        const target = yield* choose(duel.enemies())
        if (target !== undefined) yield* destroy(target)
      },
    })
    const inHand = instantiate({ id: 'ストラテジー', card: strategy, owner: '先攻' })
    const state = putOnSquare(
      inZone(readyToAct('メインフェイズ'), '先攻', '手札', inHand),
      enemySquare,
      enemy('敵'),
    )

    const resolved = stateOf(playCard(inZone(state, '先攻', 'エネルギーゾーン', enemy('エネルギー')), { card: 'ストラテジー' }, chooseFirst))

    expect(lastVia(resolved)).toBe('プレイ')
  })

  // 総合ルール 第5部 第3章 1
  describe('「希望」の解決', () => {
    // ＳＰ 1000 のユニット。中央エリアからのスマッシュでちょうど 1000 のダメージ、つまり
    // 判定 1 回分になる（`vanilla` はＳＰ 500 なので、これとは別に持つ）。
    const smasher = defineUnit({ name: 'テスト・スマッシュ役', level: 1, colors: ['赤'], bp: 1000, sp: 1000 })

    const hopeful = defineUnit({
      name: 'テスト・希望',
      level: 1,
      colors: ['赤'],
      bp: 1000,
      sp: 1000,
      abilities: [
        hope(function* (duel) {
          const target = yield* choose(duel.enemies())
          if (target !== undefined) yield* destroy(target)
        }),
      ],
    })

    /** 先攻が中央エリアのユニットでスマッシュし、後攻の山札の 1 番上に `library` を積んだ盤面。 */
    function smashedFromCenter(library: readonly Card[]): DuelState {
      const stockedLibrary = [...library, ...Array.from({ length: 10 }, () => vanilla)]
      const withLibrary = putInZone(
        stocked(),
        '後攻',
        '山札',
        stockedLibrary.map((card, index) => instantiate({ id: `後攻の山札${index}`, card, owner: '後攻' })),
      )
      const board = putOnSquare(withLibrary, centerSquare, instantiate({ id: 'スマッシュ役', card: smasher, owner: '先攻' }))
      const ready = readyToAct('スマッシュフェイズ', board)
      return stateOf(smash(ready, 'スマッシュ役'))
    }

    /** 進行中のスマッシュ判定のステップが終わるまで、両方が優先権を放棄し続けた盤面。 */
    function endStep(state: DuelState): DuelState {
      const progress = (each: DuelState) => {
        const judgment = each.smashJudgments.at(-1)
        return judgment === undefined ? undefined : `${each.smashJudgments.length}／${judgment.step}`
      }
      const before = progress(state)
      let current = state
      while (current.result === undefined && progress(current) === before) current = passPriority(current, chooseFirst)
      return current
    }

    it('エネルギーの条件を満たしていれば「希望」になる', () => {
      const withEnergy = inZone(
        smashedFromCenter([hopeful]),
        '後攻',
        'エネルギーゾーン',
        instantiate({ id: '後攻のエネルギー', card: vanilla, owner: '後攻' }),
      )

      expect(lastVia(endStep(withEnergy))).toBe('希望')
    })

    /** レベルを満たさなければ解決しない（総合ルール 第5部 第3章 2）ので、能力を解決したが出ない。 */
    it('エネルギーの条件を満たしていなければ `能力を解決した` が出ない', () => {
      const resolved = endStep(smashedFromCenter([hopeful]))

      expect(only(resolved, '能力を解決した')).toEqual([])
    })

    /** 「希望」を持たないカードでは、そもそも解決が始まらない。 */
    it('「希望」を持たないカードでは `能力を解決した` が出ない', () => {
      const resolved = endStep(smashedFromCenter([vanilla]))

      expect(only(resolved, '能力を解決した')).toEqual([])
    })
  })
})

describe('ルールエフェクトの記録', () => {
  /** ユニット以外のカードがスクエアにある（総合ルール 第4部 第14章 4-3）。 */
  it('ルールで捨札に置かれたことが残る', () => {
    const stray = instantiate({ id: 'ユニットでないカード', card: chooseAndDestroy, owner: '先攻' })
    const board = putOnSquare(stocked(), centerSquare, stray)

    const settled = passPriority(board, chooseFirst)

    expect(only(settled, 'ルールで捨札に置かれた')).toEqual([{ kind: 'ルールで捨札に置かれた', cards: [stray.id] }])
  })

  /**
   * 山札が 0 枚以下のプレイヤーが敗北する（総合ルール 第3部 第3章 2、第4部 第14章 4-2）。
   * 両方が同時に敗北すれば引き分けになる（同 第3章 4）。
   */
  it('決着したことが残る', () => {
    const settled = passPriority(emptyDuelState(), chooseFirst)

    expect(only(settled, '決着した')).toEqual([{ kind: '決着した', result: { kind: '引き分け' } }])
  })
})

/**
 * 総合ルール 第3部 第9章 1。
 *
 * 与える量はユニットのＳＰと置かれているエリアで決まるので、盤面を見比べても「なぜその
 * ダメージなのか」は分からない。量そのものを残す。
 */
describe('スマッシュの記録', () => {
  it('与えたダメージの量が残る', () => {
    const unit = instantiate({ id: 'スマッシュ役', card: vanilla, owner: '先攻' })
    const state = readyToAct('スマッシュフェイズ', putOnSquare(stocked(), centerSquare, unit))

    const smashed = applyLegalAction(state, { kind: 'スマッシュする', unit: unit.id }, chooseFirst)

    expect(only(smashed, 'ダメージを受けた')).toEqual([{ kind: 'ダメージを受けた', player: '後攻', amount: vanilla.sp }])
  })
})

/**
 * ADR-0004。**見え方の決まりは射影ひとつしか無い**（`perspective.ts` の `seesFace`）ので、
 * ログもそこから落ちる。
 */
describe('視点ごとの落とし方', () => {
  const hidden = instantiate({ id: '相手の手札', card: vanilla, owner: '後攻' })
  const shown = instantiate({ id: '捨札のカード', card: vanilla, owner: '後攻' })

  /** できごとを直接置いた盤面。落とし方だけを見たいので、どう起きたかは問わない。 */
  function logged(...events: readonly DuelEvent[]): DuelState {
    const board = inZone(inZone(stocked(), '後攻', '手札', hidden), '後攻', '捨札', shown)
    return { ...board, log: events }
  }

  function played(card: string): DuelEvent {
    return { kind: '行動した', player: '後攻', action: 'カードをプレイする', card, square: undefined }
  }

  it('相手の手札にあるカードは名指しされない', () => {
    const state = logged(played(hidden.id))

    expect(perspectiveOf(state, '先攻').log).toEqual([{ ...played(hidden.id), card: undefined }])
  })

  it('持ち主からは名指しされる', () => {
    const state = logged(played(hidden.id))

    expect(perspectiveOf(state, '後攻').log).toEqual([played(hidden.id)])
  })

  // 捨札はすべてのカードをいつでも見られる（総合ルール 第2部 第21章 5-2）。
  it('捨札にあるカードは、どちらからも名指しされる', () => {
    const state = logged(played(shown.id))

    expect(perspectiveOf(state, '先攻').log).toEqual([played(shown.id)])
  })

  /** 名指しは落ちても、できごとそのものは残る。何かを行ったことは相手にも見えている。 */
  it('名指しが落ちても、できごとは残る', () => {
    const state = logged(played(hidden.id))

    expect(perspectiveOf(state, '先攻').log).toHaveLength(1)
  })

  it('命令の中のカードも落ちる', () => {
    const event: DuelEvent = {
      kind: '命令を実行した',
      controller: '後攻',
      instruction: { kind: 'ゾーンへ置く', card: hidden.id, to: '手札' },
    }

    const state = logged(event)

    expect(perspectiveOf(state, '先攻').log).toEqual([
      { ...event, instruction: { kind: 'ゾーンへ置く', card: undefined, to: '手札' } },
    ])
  })
})

/**
 * ADR-0008。答えを 1 つずつ足しては**同じ盤面に対して適用をやり直す**ので、途中まで積んだ
 * 記録が重なる余地は無い。
 */
describe('やり直しても二重にならない', () => {
  /** 敵が 2 枚あるので、能力の解決には答えが 1 つ要る（`protocol.ts` の `applyWithAnswers`）。 */
  function waitingForAnswer(): DuelState {
    const chooser = instantiate({ id: '選ぶ役', card: beginningChooser, owner: '先攻' })
    const placed = [
      [enemySquare, enemy('敵')],
      [anotherEnemySquare, enemy('もう 1 枚の敵')],
      [mySquare, chooser],
    ].reduce<DuelState>((state, [square, card]) => putOnSquare(state, square as Square, card as CardInstance), stocked())

    // すでに 1 度放棄されている（`readyToAct`）ので、次の放棄でバンクから 1 つ解決される
    // （総合ルール 第3部 第4章 4）。
    return readyToAct('エネルギーフェイズ', placed)
  }

  it('答えを待っている間は、まだ何も積まれない', () => {
    const state = waitingForAnswer()

    const asked = applyWithAnswers(state, PASS, [])

    expect(asked.kind).toBe('選んでほしい')
    expect(instructions(state)).toEqual([])
  })

  it('答えを足して適用し直しても、記録は 1 回分', () => {
    const state = waitingForAnswer()
    applyWithAnswers(state, PASS, [])

    const progress = applyWithAnswers(state, PASS, [0])

    if (progress.kind !== '進んだ') throw new Error('進んだはずだった')
    expect(instructions(progress.state)).toEqual([
      { kind: '選ぶ', card: '敵' },
      { kind: '破壊する', card: '敵' },
    ])
  })
})

/** バンクにある能力を 1 つ解決するところまで、連続して放棄する。 */
function resolveBank(state: DuelState): DuelState {
  return applyLegalAction(applyLegalAction(state, PASS, chooseFirst), PASS, chooseFirst)
}
