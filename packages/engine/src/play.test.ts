import { describe, expect, it } from 'vitest'
// 手札やエネルギーゾーンを組み立てるためだけに `putInZone` を使う。engine の中から
// ゾーンを差し替えるための関数であり、公開する API ではない。
import { putInZone } from './duel.js'
import {
  PLAYERS,
  activateTrap,
  areaOf,
  cardsIn,
  cardsInResolveZone,
  cardsOn,
  choose,
  defineStrategy,
  defineTrap,
  defineUnit,
  destroy,
  dream,
  emptyDuelState,
  guts,
  instantiate,
  passPriority,
  playAsTrap,
  playCard,
  putOnSquare,
  spirit,
  triggeredAbility,
  trust,
} from './index.js'
import type { ActionOutcome, CardInstance, Chooser, DuelState, Phase, PlayDeclaration, Square } from './index.js'

/** 選択を求められたら常に最初の候補を選ぶ。どれを選ぶかを問わないテストで使う。 */
const chooseFirst: Chooser = (candidates) => candidates[0]

/** レベル 2 の赤いユニット。 */
const redUnit = defineUnit({ name: 'テスト・赤ユニット', level: 2, colors: ['赤'], bp: 1000, sp: 1000 })

/** 「夢」を持つレベル 2 の赤いユニット（総合ルール 第5部 第1章）。 */
const dreamingUnit = defineUnit({
  name: 'テスト・夢ユニット',
  level: 2,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [dream],
})

/** 「根性」を持つレベル 2 の赤いユニット（総合ルール 第5部 第6章）。 */
const gutsyUnit = defineUnit({
  name: 'テスト・根性ユニット',
  level: 2,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [guts],
})

/** 「登場した時」に誘発する能力を持つレベル 2 の赤いユニット。 */
const appearingUnit = defineUnit({
  name: 'テスト・登場ユニット',
  level: 2,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [triggeredAbility('登場した時', function* () {})],
})

/**
 * 「プランゾーンから登場した時」に誘発する能力を持つ、「夢」も持つレベル 2 の赤いユニット。
 *
 * 絞り込みは誘発イベントの値ではなく述語で表す（`ability.ts` の `TriggeredAbility.when`）。
 */
const fromPlanUnit = defineUnit({
  name: 'テスト・プランから登場ユニット',
  level: 2,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [
    dream,
    triggeredAbility('登場した時', function* () {}, (occasion) => occasion.from === 'プランゾーン'),
  ],
})

/** 「味方エリアに登場した時」に誘発する能力を持つレベル 2 の赤いユニット。 */
const inHomeAreaUnit = defineUnit({
  name: 'テスト・味方エリア登場ユニット',
  level: 2,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [
    triggeredAbility(
      '登場した時',
      function* () {},
      (occasion, controller) => areaOf(controller, occasion.square) === '味方エリア',
    ),
  ],
})

/** 敵を 1 枚選んで破壊するレベル 2 の赤いストラテジー。 */
const redStrategy = defineStrategy({
  name: 'テスト・赤ストラテジー',
  level: 2,
  colors: ['赤'],
  effect: function* (duel) {
    const enemy = yield* choose(duel.enemies())
    if (enemy !== undefined) yield* destroy(enemy)
  },
})

/** 敵を 1 枚選んで破壊するレベル 2 の赤いトラップ。 */
const redTrap = defineTrap({
  name: 'テスト・赤トラップ',
  level: 2,
  colors: ['赤'],
  effect: function* (duel) {
    const enemy = yield* choose(duel.enemies())
    if (enemy !== undefined) yield* destroy(enemy)
  },
})

/** 先攻から見た味方エリア・中央エリア・敵エリアのスクエア（`areaOf` の決めた向き）。 */
const homeSquare: Square = { row: 0, column: 1 }
const centerSquare: Square = { row: 1, column: 1 }
const enemySquare: Square = { row: 2, column: 1 }

/** エネルギーに使う、その色のカード 1 枚。 */
function energy(id: string, color: '赤' | '青'): CardInstance {
  return instantiate({
    id,
    card: defineUnit({ name: `テスト・${color}`, level: 1, colors: [color], bp: 1000, sp: 1000 }),
    owner: '先攻',
  })
}

/**
 * そのフェイズが始まったところの、第 1 ターンの盤面。
 *
 * フェイズの始めには非アクティブプレイヤーに優先権が発生している（総合ルール 第3部
 * 第7章 1・第8章 1）。
 */
function phaseBegun(phase: Phase): DuelState {
  let current = stockedDuelState()
  while (current.turn.phase !== phase) current = passPriority(current, chooseFirst)
  return current
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
          instantiate({ id: `${player}の山札${index}`, card: redUnit, owner: player }),
        ),
      ),
    emptyDuelState(),
  )
}

/** そのフェイズで、アクティブプレイヤー（先攻）に優先権が移ったところの盤面。 */
function phaseReadyToAct(phase: Phase): DuelState {
  return passPriority(phaseBegun(phase), chooseFirst)
}

/** アクティブプレイヤー（先攻）が行動できる、第 1 ターンのメインフェイズの盤面。 */
function mainPhase(): DuelState {
  return phaseReadyToAct('メインフェイズ')
}

/** 先攻の手札とエネルギーゾーンを整えた、メインフェイズの盤面。 */
function readyToPlay(hand: readonly CardInstance[], energies: readonly CardInstance[] = []): DuelState {
  return putInZone(putInZone(mainPhase(), '先攻', '手札', hand), '先攻', 'エネルギーゾーン', energies)
}

/** 赤 1 枚を含む 2 枚のエネルギー。レベル 2 の赤いカードのレベルを満たす。 */
function twoEnergies(): readonly CardInstance[] {
  return [energy('赤エネ', '赤'), energy('青エネ', '青')]
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

function play(state: DuelState, declaration: PlayDeclaration): ActionOutcome {
  return playCard(state, declaration, chooseFirst)
}

const idsOf = (cards: readonly CardInstance[]) => cards.map((card) => card.id)

// 総合ルール 第2部 第20章 1（ADR-0006）
describe('ユニットのプレイ', () => {
  const unit = () => instantiate({ id: 'ユニット', card: redUnit, owner: '先攻' })

  /** レベルを満たしたうえで、そのスクエアを指定してユニットをプレイした盤面。 */
  function played(square: Square): ActionOutcome {
    return play(readyToPlay([unit()], twoEnergies()), { card: 'ユニット', square })
  }

  // 総合ルール 第2部 第20章 1-4、第21章 8-3
  it('指定した味方エリアのスクエアにフリーズ状態で置かれる', () => {
    const [placed] = cardsOn(stateOf(played(homeSquare)), homeSquare)

    expect(placed?.id).toBe('ユニット')
    expect(placed?.orientation).toBe('フリーズ')
  })

  /**
   * 総合ルール 第5部 第6章 2。
   *
   * 3 の「効果によってスクエアに置かれる時には働かない」は、効果がユニットをスクエアに
   * 置く手段をまだ持っていないため試せない。その区別は、この判定をプレイの経路
   * （`placePlayedUnit`）にだけ置いてあることで保たれている。
   */
  it('「根性」を持つユニットは、フリーズ状態のかわりにリリース状態で置かれる', () => {
    const state = readyToPlay([instantiate({ id: '根性ユニット', card: gutsyUnit, owner: '先攻' })], twoEnergies())

    const after = stateOf(play(state, { card: '根性ユニット', square: homeSquare }))

    expect(cardsOn(after, homeSquare)[0]?.orientation).toBe('リリース')
  })

  it('プレイしたプレイヤーの支配下で置かれる', () => {
    expect(cardsOn(stateOf(played(homeSquare)), homeSquare)[0]?.controller).toBe('先攻')
  })

  it('プレイされたカードは手札を離れる', () => {
    expect(cardsIn(stateOf(played(homeSquare)), '先攻', '手札')).toEqual([])
  })

  // 総合ルール 第1部 第2章 3-2、第2部 第20章 1-3
  it('コストとして同じ色のエネルギーが 1 枚フリーズされる', () => {
    const energies = cardsIn(stateOf(played(homeSquare)), '先攻', 'エネルギーゾーン')

    expect(energies.find((each) => each.id === '赤エネ')?.orientation).toBe('フリーズ')
    expect(energies.find((each) => each.id === '青エネ')?.orientation).toBe('リリース')
  })

  // 総合ルール 第4部 第6章 1-5
  it('解決した後、非アクティブプレイヤーが優先権を獲得する', () => {
    const after = stateOf(played(homeSquare))

    expect(after.turn.priority).toBe('後攻')
    // 行動が行われたので、連続した放棄はそこで途切れる。
    expect(after.turn.passedBy).toBeUndefined()
  })

  // 総合ルール 第2部 第20章 1-3
  it('敵エリアのスクエアは指定できない', () => {
    expect(violationOf(played(enemySquare))).toBe('指定できないスクエア')
  })

  it('スクエアを指定しなければプレイできない', () => {
    const state = readyToPlay([unit()], twoEnergies())

    expect(violationOf(play(state, { card: 'ユニット' }))).toBe('指定できないスクエア')
  })

  it('自分のユニットがいるスクエアは指定できない', () => {
    const occupied = putOnSquare(
      readyToPlay([unit()], twoEnergies()),
      homeSquare,
      instantiate({ id: '先客', card: redUnit, owner: '先攻' }),
    )

    expect(violationOf(play(occupied, { card: 'ユニット', square: homeSquare }))).toBe('指定できないスクエア')
  })

  // 総合ルール 第5部 第4章 3。「信頼」が制限するのは移動だけである（`move.ts`）。
  it('相手の「信頼」の左右に接するスクエアでも、プレイなら指定できる', () => {
    const trusted = defineUnit({
      name: 'テスト・信頼ユニット',
      level: 1,
      colors: ['赤'],
      bp: 1000,
      sp: 1000,
      abilities: [trust],
    })
    const beside = putOnSquare(
      readyToPlay([unit()], twoEnergies()),
      // `homeSquare` の左に接するスクエア。
      { row: 0, column: 0 },
      instantiate({ id: '信頼持ち', card: trusted, owner: '後攻' }),
    )

    const after = stateOf(play(beside, { card: 'ユニット', square: homeSquare }))

    expect(cardsOn(after, homeSquare)[0]?.id).toBe('ユニット')
  })

  // 総合ルール 第1部 第2章 3-1
  it('レベルを満たしていなければプレイできない', () => {
    const state = readyToPlay([unit()], [energy('赤エネ', '赤')])

    expect(violationOf(play(state, { card: 'ユニット', square: homeSquare }))).toBe('レベルを満たしていない')
  })

  // 総合ルール 第2部 第24章 1-1: フリーズ状態のカードをフリーズすることはできない。
  it('リリース状態の同じ色のエネルギーが無ければプレイできない', () => {
    const frozen = twoEnergies().map((each) => ({ ...each, orientation: 'フリーズ' }) as const)
    const state = readyToPlay([unit()], frozen)

    expect(violationOf(play(state, { card: 'ユニット', square: homeSquare }))).toBe('コストを支払えない')
  })

  // 総合ルール 第4部 第14章 4-9
  it('中央エリアを指定してプレイされたユニットは、ルールエフェクトで持ち主の捨札に置かれる', () => {
    const after = stateOf(played(centerSquare))

    expect(cardsOn(after, centerSquare)).toEqual([])
    expect(idsOf(cardsIn(after, '先攻', '捨札'))).toEqual(['ユニット'])
  })
})

// 総合ルール 第2部 第20章 1-4-a（ADR-0006）
describe('登場', () => {
  it('プレイされたユニットが置かれると、そのユニット自身の「登場した時」の能力が誘発する', () => {
    const unit = instantiate({ id: 'ユニット', card: appearingUnit, owner: '先攻' })
    const after = stateOf(play(readyToPlay([unit], twoEnergies()), { card: 'ユニット', square: homeSquare }))

    expect(after.bank.map((banked) => banked.source)).toEqual(['ユニット'])
  })

  it('他のユニットの「登場した時」の能力は誘発しない', () => {
    const newUnit = instantiate({ id: '新入り', card: appearingUnit, owner: '先攻' })
    const already = instantiate({ id: '先客', card: appearingUnit, owner: '先攻' })
    const state = putOnSquare(readyToPlay([newUnit], twoEnergies()), centerSquare, already)

    const after = stateOf(play(state, { card: '新入り', square: homeSquare }))

    expect(after.bank.map((banked) => banked.source)).toEqual(['新入り'])
  })

  // CONTEXT.md「登場」: 「置かれる」の一部でしかない――効果によってスクエアに置かれる場合と
  // 区別する。効果によるスクエアへの配置は `putOnSquare` を直接使う（`duel.ts` 参照）。
  // `putOnSquare` はどこからも「登場した時」を誘発させないことそのものを保証する
  // （`bank.ts` の `triggerAppearance` を呼ぶのは `play.ts` だけ）。将来、効果の実装時に
  // 誰かが誤って `putOnSquare` の側に誘発を足してしまわないよう、その境目をここで固定する。
  it('効果でスクエアに置かれた場合は誘発しない', () => {
    const unit = instantiate({ id: 'ユニット', card: appearingUnit, owner: '先攻' })
    const state = putOnSquare(emptyDuelState(), homeSquare, unit)

    expect(state.triggered).toEqual([])
    expect(state.bank).toEqual([])
  })
})

// 総合ルール 第2部 第20章 1-1（ADR-0006）
describe('カードをプレイできる時', () => {
  const unit = () => instantiate({ id: 'ユニット', card: redUnit, owner: '先攻' })
  const declaration: PlayDeclaration = { card: 'ユニット', square: homeSquare }

  /** 先攻の手札にユニット 1 枚とエネルギー 2 枚を置いた盤面。 */
  function ready(state: DuelState): DuelState {
    return putInZone(putInZone(state, '先攻', '手札', [unit()]), '先攻', 'エネルギーゾーン', twoEnergies())
  }

  it('メインフェイズでなければプレイできない', () => {
    expect(violationOf(play(ready(phaseReadyToAct('エネルギーフェイズ')), declaration))).toBe('行える時ではない')
  })

  it('優先権を持っていなければプレイできない', () => {
    // メインフェイズの始めには非アクティブプレイヤーに優先権が発生している。
    expect(violationOf(play(ready(phaseBegun('メインフェイズ')), declaration))).toBe('行える時ではない')
  })

  // 総合ルール 第3部 第8章 2: バンクが空の時にだけ行える。
  it('バンクに能力があればプレイできない', () => {
    const state = readyToPlay([unit()], twoEnergies())
    const banked: DuelState = {
      ...state,
      bank: [
        {
          ability: { kind: '誘発型能力', event: 'ターンの終わり', effect: function* () {} },
          source: 'x',
          controller: '先攻',
          self: { id: 'x', square: homeSquare, card: redUnit, controller: '先攻' },
        },
      ],
    }

    expect(violationOf(play(banked, declaration))).toBe('行える時ではない')
  })

  it('手札にもプランゾーンにもないカードはプレイできない', () => {
    expect(violationOf(play(readyToPlay([], twoEnergies()), declaration))).toBe('そのゾーンにない')
  })
})

// 総合ルール 第2部 第20章 2（ADR-0006）
describe('ストラテジーのプレイ', () => {
  /** 敵が 1 枚いる盤面で、ストラテジーをプレイした結果。 */
  function played(): ActionOutcome {
    const strategy = instantiate({ id: 'ストラテジー', card: redStrategy, owner: '先攻' })
    const enemy = instantiate({ id: '敵', card: redUnit, owner: '後攻' })
    const state = putOnSquare(readyToPlay([strategy], twoEnergies()), enemySquare, enemy)

    return play(state, { card: 'ストラテジー' })
  }

  // 総合ルール 第2部 第20章 2-4
  it('リゾルブゾーンで解決され、テキストの効果が実行される', () => {
    const after = stateOf(played())

    expect(cardsOn(after, enemySquare)).toEqual([])
    expect(idsOf(cardsIn(after, '後攻', '捨札'))).toEqual(['敵'])
  })

  // 総合ルール 第4部 第8章 2-7、第2部 第21章 12-3
  it('解決の最後にリゾルブゾーンから持ち主の捨札に置かれる', () => {
    const after = stateOf(played())

    expect(cardsInResolveZone(after)).toEqual([])
    expect(idsOf(cardsIn(after, '先攻', '捨札'))).toEqual(['ストラテジー'])
  })

  // 総合ルール 第1部 第2章 3-2
  it('コストとしてエネルギーが 1 枚フリーズされる', () => {
    const energies = cardsIn(stateOf(played()), '先攻', 'エネルギーゾーン')

    expect(energies.filter((each) => each.orientation === 'フリーズ')).toHaveLength(1)
  })
})

// 総合ルール 第2部 第20章 3-1〜3-4（ADR-0006）
describe('トラップとしてのプレイ', () => {
  const trap = () => instantiate({ id: 'トラップ', card: redTrap, owner: '先攻' })

  // 総合ルール 第2部 第20章 3-2: レベルを満たす必要も、コストを支払う必要もない。
  it('エネルギーが 1 枚も無くてもプレイできる', () => {
    const after = stateOf(playAsTrap(readyToPlay([trap()]), 'トラップ'))

    expect(idsOf(cardsIn(after, '先攻', 'トラップゾーン'))).toEqual(['トラップ'])
    expect(cardsIn(after, '先攻', 'エネルギーゾーン')).toEqual([])
  })

  // 総合ルール 第2部 第20章 3-4
  it('自分のトラップゾーンにリリース状態で置かれる', () => {
    const after = stateOf(playAsTrap(readyToPlay([trap()]), 'トラップ'))

    expect(cardsIn(after, '先攻', 'トラップゾーン')[0]?.orientation).toBe('リリース')
  })

  // 総合ルール 第2部 第20章 3-1: トラップ以外のカードもトラップとしてプレイできる。
  it('ユニットもトラップとしてプレイできる', () => {
    const unit = instantiate({ id: 'ユニット', card: redUnit, owner: '先攻' })

    const after = stateOf(playAsTrap(readyToPlay([unit]), 'ユニット'))

    expect(idsOf(cardsIn(after, '先攻', 'トラップゾーン'))).toEqual(['ユニット'])
  })

  // 総合ルール 第2部 第20章 3-1: 自分のトラップゾーンにカードがなければプレイできる。
  it('トラップゾーンにすでにカードがあればプレイできない', () => {
    const set = stateOf(playAsTrap(readyToPlay([trap()]), 'トラップ'))
    const another = instantiate({ id: '2 枚目', card: redTrap, owner: '先攻' })
    // 1 枚目をプレイした時点で優先権が非アクティブプレイヤーに移っているので戻す。
    const ready = putInZone(passPriority(set, chooseFirst), '先攻', '手札', [another])

    expect(violationOf(playAsTrap(ready, '2 枚目'))).toBe('トラップゾーンが空ではない')
  })

  // 総合ルール 第2部 第20章 3-1: 夢のあるカードであっても、プランゾーンからプレイして
  // トラップゾーンに置くことはできない。
  it('プランゾーンからはプレイできない', () => {
    const dreaming = instantiate({ id: '夢', card: dreamingUnit, owner: '先攻' })
    const state = putInZone(readyToPlay([]), '先攻', 'プランゾーン', [dreaming])

    expect(violationOf(playAsTrap(state, '夢'))).toBe('そのゾーンにない')
  })

  it('トラップは種別のままではプレイできない', () => {
    expect(violationOf(play(readyToPlay([trap()], twoEnergies()), { card: 'トラップ' }))).toBe(
      'トラップとしてしかプレイできない',
    )
  })
})

// 総合ルール 第2部 第20章 3-8〜3-11（ADR-0006）
describe('トラップの発動', () => {
  /**
   * トラップゾーンに、発動する権利を得ているトラップがあり、敵が 1 枚いる盤面。
   *
   * 権利をどう得るか（侵入、総合ルール 3-6・3-8）はここでは検証しない。コスト・レベル・
   * 優先権の挙動を見るテストなので、`trapConditionsMet` に直接足して権利がある前提にする。
   */
  function armed(energies: readonly CardInstance[] = twoEnergies()): DuelState {
    const trap = instantiate({ id: 'トラップ', card: redTrap, owner: '先攻' })
    const enemy = instantiate({ id: '敵', card: redUnit, owner: '後攻' })
    const state = putInZone(putInZone(mainPhase(), '先攻', 'トラップゾーン', [trap]), '先攻', 'エネルギーゾーン', energies)
    return { ...putOnSquare(state, enemySquare, enemy), trapConditionsMet: ['トラップ'] }
  }

  // 総合ルール 第2部 第20章 3-11
  it('リゾルブゾーンで解決され、持ち主の捨札に置かれる', () => {
    const after = stateOf(activateTrap(armed(), 'トラップ', chooseFirst))

    expect(cardsIn(after, '先攻', 'トラップゾーン')).toEqual([])
    expect(cardsInResolveZone(after)).toEqual([])
    expect(idsOf(cardsIn(after, '先攻', '捨札'))).toEqual(['トラップ'])
  })

  it('テキストの効果が実行される', () => {
    expect(cardsOn(stateOf(activateTrap(armed(), 'トラップ', chooseFirst)), enemySquare)).toEqual([])
  })

  // 総合ルール 第2部 第20章 3-10
  it('コストとしてエネルギーが 1 枚フリーズされる', () => {
    const energies = cardsIn(stateOf(activateTrap(armed(), 'トラップ', chooseFirst)), '先攻', 'エネルギーゾーン')

    expect(energies.filter((each) => each.orientation === 'フリーズ')).toHaveLength(1)
  })

  // 総合ルール 第2部 第20章 3-9
  it('レベルを満たしていなければ発動できない', () => {
    expect(violationOf(activateTrap(armed([energy('赤エネ', '赤')]), 'トラップ', chooseFirst))).toBe(
      'レベルを満たしていない',
    )
  })

  // 総合ルール 第2部 第20章 3-8: 自分のメインフェイズ中に限らず、優先権を持った時に
  // 発動できる。
  it('優先権を持っていれば、自分のメインフェイズでなくても発動できる', () => {
    // メインフェイズの始めは非アクティブプレイヤーである後攻に優先権がある。
    const trap = instantiate({ id: 'トラップ', card: redTrap, owner: '後攻' })
    const state = putInZone(
      putInZone(phaseBegun('メインフェイズ'), '後攻', 'トラップゾーン', [trap]),
      '後攻',
      'エネルギーゾーン',
      [energy('赤エネ', '赤'), energy('青エネ', '青')].map((each) => ({ ...each, owner: '後攻' }) as const),
    )

    expect(
      stateOf(activateTrap({ ...state, trapConditionsMet: ['トラップ'] }, 'トラップ', chooseFirst)).turn.priority,
    ).toBe('後攻')
  })

  it('優先権を持っていないプレイヤーのトラップは発動されない', () => {
    // 先攻に優先権がある盤面で、後攻のトラップゾーンにあるトラップを発動しようとする。
    const trap = instantiate({ id: '相手のトラップ', card: redTrap, owner: '後攻' })
    const state = putInZone(mainPhase(), '後攻', 'トラップゾーン', [trap])

    expect(violationOf(activateTrap(state, '相手のトラップ', chooseFirst))).toBe('そのゾーンにない')
  })

  // 総合ルール 第2部 第20章 3-6: 発動条件が有効になるのはトラップだけである。
  it('トラップ以外のカードは、トラップゾーンにあっても発動できない', () => {
    const unit = instantiate({ id: 'ユニット', card: redUnit, owner: '先攻' })
    const state = putInZone(
      putInZone(mainPhase(), '先攻', 'トラップゾーン', [unit]),
      '先攻',
      'エネルギーゾーン',
      twoEnergies(),
    )

    expect(violationOf(activateTrap(state, 'ユニット', chooseFirst))).toBe('発動できるカードではない')
  })
})

// 総合ルール 第2部 第20章 3-6・3-8（ADR-0006）
describe('トラップの発動条件（侵入）', () => {
  // 中央エリアのスクエアは先攻・後攻どちらから見ても同じ位置なので、トリガーアイコンが
  // 支配者から見た向きで解釈されること（`board.ts` の `squareFromView`）に関わらず、
  // ここでは絶対のスクエアとして中央エリアのスクエアを使う。
  const intrusionTrap = defineTrap({ name: 'テスト・侵入トラップ', level: 1, triggerIcon: [centerSquare] })

  /** 後攻のトラップゾーンに侵入トラップがある、先攻が行動できるメインフェイズの盤面。 */
  function readyWithOpponentTrap(): DuelState {
    const trap = instantiate({ id: 'トラップ', card: intrusionTrap, owner: '後攻' })
    return putInZone(
      putInZone(putInZone(mainPhase(), '後攻', 'トラップゾーン', [trap]), '先攻', '手札', [
        instantiate({ id: 'ユニット', card: redUnit, owner: '先攻' }),
      ]),
      '先攻',
      'エネルギーゾーン',
      twoEnergies(),
    )
  }

  it('相手のユニットがトリガーアイコンのスクエアに登場すると、発動する権利を得る', () => {
    const after = stateOf(play(readyWithOpponentTrap(), { card: 'ユニット', square: centerSquare }))

    expect(after.trapConditionsMet).toEqual(['トラップ'])
  })

  it('トリガーアイコンに描かれていないスクエアに登場しても権利を得ない', () => {
    const after = stateOf(play(readyWithOpponentTrap(), { card: 'ユニット', square: homeSquare }))

    expect(after.trapConditionsMet).toEqual([])
  })

  // 「相手のユニットが」なので、トラップの支配者自身が自分のユニットをそのスクエアに
  // 置いても侵入にならない。
  it('自分のユニットが同じスクエアに登場しても権利を得ない', () => {
    const trap = instantiate({ id: 'トラップ', card: intrusionTrap, owner: '先攻' })
    const state = putInZone(
      putInZone(putInZone(mainPhase(), '先攻', 'トラップゾーン', [trap]), '先攻', '手札', [
        instantiate({ id: 'ユニット', card: redUnit, owner: '先攻' }),
      ]),
      '先攻',
      'エネルギーゾーン',
      twoEnergies(),
    )

    const after = stateOf(play(state, { card: 'ユニット', square: centerSquare }))

    expect(after.trapConditionsMet).toEqual([])
  })

  // 総合ルール 第4部 第6章 1-5: 解決の後、非アクティブプレイヤーが優先権を獲得する。
  // 権利を得たのはそのトラップの支配者である後攻なので、そのまま発動できる。
  it('権利を得た直後、優先権を得た支配者はそのトラップを発動できる', () => {
    const played = stateOf(play(readyWithOpponentTrap(), { card: 'ユニット', square: centerSquare }))
    const state = putInZone(played, '後攻', 'エネルギーゾーン', [
      { ...energy('後攻エネ', '赤'), owner: '後攻', controller: '後攻' },
    ])

    expect(state.turn.priority).toBe('後攻')
    // 発動の後も、このターンの非アクティブプレイヤーである後攻に優先権が戻る
    // （総合ルール 第4部 第5章 2）。
    expect(stateOf(activateTrap(state, 'トラップ', chooseFirst)).turn.priority).toBe('後攻')
  })

  // 総合ルール 第2部 第20章 3-8「１度でも優先権をパスすると...権利を失います」
  it('権利を得たプレイヤーが優先権をパスすると、権利を失って発動できなくなる', () => {
    const played = stateOf(play(readyWithOpponentTrap(), { card: 'ユニット', square: centerSquare }))
    // 後攻がパスし、続けて先攻もパスして、後攻に優先権が戻ってくる（次のフェイズの始め）。
    const passedTwice = passPriority(passPriority(played, chooseFirst), chooseFirst)

    expect(passedTwice.turn.priority).toBe('後攻')
    expect(violationOf(activateTrap(passedTwice, 'トラップ', chooseFirst))).toBe('発動する権利がない')
  })
})

// 総合ルール 第2部 第20章 3-8 ただし書き、第3部 第11章 5（ADR-0006）
describe('侵入と同時にバトルが発生した場合の権利', () => {
  /** 中央エリアのスクエアにトリガーアイコンを持つ、効果を持たない赤いレベル 1 のトラップ。 */
  const redIntrusionTrap = defineTrap({
    name: 'テスト・侵入トラップ（赤）',
    level: 1,
    colors: ['赤'],
    triggerIcon: [centerSquare],
  })

  /**
   * 後攻のトラップゾーンに侵入トラップがあり、中央エリアのそのスクエアに後攻のユニットが
   * いる、先攻が行動できるメインフェイズの盤面。
   *
   * 先攻がそのスクエアにユニットをプレイすると、侵入によってトラップの発動条件が満たされる
   * のと同時に、支配者の異なるユニットが重なってバトルが発生する。
   */
  function readyToIntrudeIntoBattle(): DuelState {
    const trap = instantiate({ id: 'トラップ', card: redIntrusionTrap, owner: '後攻' })
    const defender = instantiate({ id: '守るユニット', card: redUnit, owner: '後攻' })
    const state = putInZone(
      putInZone(putInZone(mainPhase(), '後攻', 'トラップゾーン', [trap]), '先攻', '手札', [
        instantiate({ id: 'ユニット', card: redUnit, owner: '先攻' }),
      ]),
      '先攻',
      'エネルギーゾーン',
      twoEnergies(),
    )
    // トラップを発動するのは後攻なので、後攻にもコストにするエネルギーを持たせておく。
    const energized = putInZone(state, '後攻', 'エネルギーゾーン', [
      { ...energy('後攻エネ', '赤'), owner: '後攻', controller: '後攻' },
    ])
    return putOnSquare(energized, centerSquare, defender)
  }

  /** バトルが終了するまで、両方のプレイヤーが優先権を放棄し続けた盤面。 */
  function passUntilBattleEnds(state: DuelState): DuelState {
    let current = state
    while (current.battle !== undefined) current = passPriority(current, chooseFirst)
    return current
  }

  it('侵入と同時にバトルが発生する', () => {
    const played = stateOf(play(readyToIntrudeIntoBattle(), { card: 'ユニット', square: centerSquare }))

    expect(played.trapConditionsMet).toEqual(['トラップ'])
    expect(played.battle).not.toBeUndefined()
  })

  it('バトル中は、発動条件が満たされていても発動できない', () => {
    const played = stateOf(play(readyToIntrudeIntoBattle(), { card: 'ユニット', square: centerSquare }))

    // バトルの始めには非アクティブプレイヤーである後攻に優先権が発生する
    // （総合ルール 第3部 第12章 1）ので、発動を妨げているのは優先権ではない。
    expect(played.turn.priority).toBe('後攻')
    expect(violationOf(activateTrap(played, 'トラップ', chooseFirst))).toBe('発動する権利がない')
  })

  it('バトルが終了すると権利が発生し、発動できる', () => {
    const played = stateOf(play(readyToIntrudeIntoBattle(), { card: 'ユニット', square: centerSquare }))
    // バトル中の放棄では権利を失わない。失うなら、バトルの終了まで遅らせる意味が無くなる。
    const ended = passUntilBattleEnds(played)

    expect(ended.battle).toBeUndefined()
    expect(ended.turn.priority).toBe('後攻')
    expect(cardsIn(stateOf(activateTrap(ended, 'トラップ', chooseFirst)), '後攻', 'トラップゾーン')).toEqual([])
  })
})

/**
 * 総合ルール 第4部 第7章 8 の裏返し（ADR-0006）。
 *
 * 「プランゾーンから登場した時」「味方エリアに登場した時」は、「～した時、～ならば」と
 * 書かれた条件付誘発型能力ではなく、**誘発イベントそのものに絞り込みが付いたもの**として
 * 扱う。誘発する時に 1 度だけ判定し、解決する時には確かめ直さない。
 */
describe('誘発イベントの絞り込み', () => {
  function planned(card: CardInstance): DuelState {
    return putInZone(readyToPlay([], twoEnergies()), '先攻', 'プランゾーン', [card])
  }

  const sourcesOf = (state: DuelState) => state.bank.map((banked) => banked.source)

  it('プランゾーンからプレイされたなら誘発する', () => {
    const state = planned(instantiate({ id: 'プランの主', card: fromPlanUnit, owner: '先攻' }))

    const after = stateOf(play(state, { card: 'プランの主', square: homeSquare }))

    expect(sourcesOf(after)).toEqual(['プランの主'])
  })

  /**
   * **プレイされたゾーンは登場した後には分からない。** プランゾーンにあったカードが動くと
   * そのプランゾーンは無くなる（総合ルール 第2部 第21章 3-3）ので、置かれた後の盤面を見て
   * 判定することはできない。出来事の瞬間に捕まえていることが、この 2 つのテストで分かる。
   */
  it('手札からプレイされたなら誘発しない', () => {
    const unit = instantiate({ id: '手札の主', card: fromPlanUnit, owner: '先攻' })
    const state = readyToPlay([unit], twoEnergies())

    const after = stateOf(play(state, { card: '手札の主', square: homeSquare }))

    expect(sourcesOf(after)).toEqual([])
  })

  // 総合ルール 第2部 第22章 6-1。エリアは支配者から見て判断する。
  it('味方エリアに置かれたなら誘発する', () => {
    const unit = instantiate({ id: 'ユニット', card: inHomeAreaUnit, owner: '先攻' })
    const state = readyToPlay([unit], twoEnergies())

    const after = stateOf(play(state, { card: 'ユニット', square: homeSquare }))

    expect(sourcesOf(after)).toEqual(['ユニット'])
  })

  it('味方エリア以外に置かれたなら誘発しない', () => {
    const unit = instantiate({ id: 'ユニット', card: inHomeAreaUnit, owner: '先攻' })
    const state = readyToPlay([unit], twoEnergies())

    const after = stateOf(play(state, { card: 'ユニット', square: centerSquare }))

    expect(sourcesOf(after)).toEqual([])
  })

  /**
   * きっかけを持つ誘発イベントは限られている（`ability.ts` の `Occasion`）。それ以外の
   * イベントに絞り込みを付けても確かめようがないので、黙って誘発させたり誘発させなかったり
   * せずに投げる。盤面から起こり得る状態ではなく、カードの書き間違いである。
   */
  it('きっかけを持たない誘発イベントに絞り込みが付いていれば、投げる', () => {
    const broken = defineUnit({
      name: 'テスト・きっかけの無いイベントに絞り込み',
      level: 1,
      colors: ['赤'],
      bp: 1000,
      sp: 1000,
      abilities: [triggeredAbility('スマッシュフェイズの始め', function* () {}, () => true)],
    })
    const state = putOnSquare(mainPhase(), homeSquare, instantiate({ id: '壊れた', card: broken, owner: '先攻' }))

    expect(() => passPriority(passPriority(state, chooseFirst), chooseFirst)).toThrowError(
      'きっかけを持たない誘発イベントに絞り込みが付いている',
    )
  })

  it('絞り込みを持たない能力は、これまで通り誘発する', () => {
    const unit = instantiate({ id: 'ユニット', card: appearingUnit, owner: '先攻' })
    const state = readyToPlay([unit], twoEnergies())

    const after = stateOf(play(state, { card: 'ユニット', square: homeSquare }))

    expect(sourcesOf(after)).toEqual(['ユニット'])
  })
})

// 総合ルール 第5部 第1章 2（ADR-0006）
describe('プランゾーンからのプレイ', () => {
  /** そのカードがプランゾーンにある、メインフェイズの盤面。 */
  function planned(card: CardInstance): DuelState {
    return putInZone(readyToPlay([], twoEnergies()), '先攻', 'プランゾーン', [card])
  }

  it('「夢」を持つカードはプランゾーンからプレイできる', () => {
    const state = planned(instantiate({ id: '夢', card: dreamingUnit, owner: '先攻' }))

    const after = stateOf(play(state, { card: '夢', square: homeSquare }))

    expect(idsOf(cardsOn(after, homeSquare))).toEqual(['夢'])
    // プランゾーンにあるカードが他のゾーンに動いたので、プランゾーンはなくなる
    // （総合ルール 第2部 第21章 3-3）。
    expect(cardsIn(after, '先攻', 'プランゾーン')).toEqual([])
  })

  it('「夢」を持たないカードはプランゾーンからプレイできない', () => {
    const state = planned(instantiate({ id: '夢なし', card: redUnit, owner: '先攻' }))

    expect(violationOf(play(state, { card: '夢なし', square: homeSquare }))).toBe(
      'プランゾーンからプレイできない',
    )
  })
})

// 総合ルール 第5部 第9章（ADR-0006）
describe('「気合」', () => {
  const spiritedUnit = defineUnit({
    name: 'テスト・気合ユニット',
    level: 2,
    colors: ['赤'],
    bp: 1000,
    sp: 1000,
    abilities: [spirit],
  })

  /**
   * 「気合」を持つユニットをプレイし、両者が優先権を放棄して能力を解決したところの盤面。
   *
   * 誘発した能力はすぐには解決されず、バンクに入る（総合ルール 第4部 第7章 2）。
   * 連続して優先権が放棄されて初めて解決される（同 第8章 1-1）。
   */
  function afterResolved(): DuelState {
    const state = readyToPlay([instantiate({ id: '気合ユニット', card: spiritedUnit, owner: '先攻' })], twoEnergies())
    const played = stateOf(play(state, { card: '気合ユニット', square: homeSquare }))
    return passPriority(passPriority(played, chooseFirst), chooseFirst)
  }

  /**
   * 総合ルール 第5部 第9章 3。
   *
   * ここでダメージそのものを見ないのは、スマッシュ判定が始まると回復ステップで 1000
   * 回復する（同 第3部 第18章 1）ため、能力が解決された後の盤面ではダメージが残って
   * いないからである。1000 のダメージを与えていること自体は `resolve.test.ts` で見る。
   */
  it('登場した時、そのダメージによってスマッシュ判定が発生する', () => {
    expect(afterResolved().smashJudgments).toHaveLength(1)
  })

  // 総合ルール 第5部 第9章 2。ダメージを受けるのは「あなた」＝能力の支配者。
  it('スマッシュ判定を受けるのは能力の支配者であって、相手ではない', () => {
    expect(afterResolved().smashJudgments[0]?.player).toBe('先攻')
  })
})
