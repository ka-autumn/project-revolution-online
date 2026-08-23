import { describe, expect, it } from 'vitest'
import { activateCourage, checkCourageCondition, courageRightsOf, loseCourageRightOnPass } from './courage.js'
// 手札とエネルギーゾーンを組み立てるためだけに `putInZone` を使う。engine の中からゾーンを
// 差し替えるための関数であり、公開する API ではない。
import { putInZone } from './duel.js'
import {
  PLAYERS,
  activatedAbilitiesOf,
  cardsIn,
  cardsOn,
  courage,
  courageOf,
  defineUnit,
  emptyDuelState,
  instantiate,
  putOnSquare,
} from './index.js'
import type {
  ActionOutcome,
  Battle,
  Chooser,
  DuelState,
  Player,
  SmashJudgment,
  Square,
  UnitCard,
  UnitOnSquare,
} from './index.js'

/** 選択を求められたら常に最初の候補を選ぶ。どれを選ぶかを問わないテストで使う。 */
const chooseFirst: Chooser = (candidates) => candidates[0]

/** 先攻から見た味方エリア・中央エリア・敵エリアのスクエア（`board.ts` の `areaOf`）。 */
const homeSquare: Square = { row: 0, column: 1 }
const centerSquare: Square = { row: 1, column: 1 }
const enemySquare: Square = { row: 2, column: 1 }

/** レベル 1 の赤い「勇気4000」。ここで見るルールに、Ｘの値そのものは関わらない。 */
const courageCard = defineUnit({
  name: 'テスト・勇気',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [courage(4000)],
})

/** レベル 3 の赤い「勇気6000」。エネルギーの枚数が効くところで使う。 */
const bigCourageCard = defineUnit({
  name: 'テスト・レベル3の勇気',
  level: 3,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [courage(6000)],
})

/** レベル 1 の青い「勇気4000」。色が効くところで使う。 */
const blueCourageCard = defineUnit({
  name: 'テスト・青い勇気',
  level: 1,
  colors: ['青'],
  bp: 1000,
  sp: 1000,
  abilities: [courage(4000)],
})

/** 「勇気」を持たないカード。置かれるユニットとエネルギーの両方に使う。 */
const plainCard = defineUnit({ name: 'テスト・能力なし', level: 1, colors: ['赤'], bp: 6000, sp: 1000 })

/** 青いカード。青のエネルギーとして置く。 */
const blueCard = defineUnit({ name: 'テスト・青', level: 1, colors: ['青'], bp: 1000, sp: 1000 })

/** そのプレイヤーがそのスクエアに置いたユニット。 */
function placedUnit(controller: Player, square: Square): UnitOnSquare {
  return { id: '置かれたユニット', square, card: plainCard, controller }
}

/** 起動条件が満たされているプレイヤー。並びの中身そのものを見ないところで使う。 */
function playersMet(state: DuelState): readonly Player[] {
  return state.courageConditionsMet.map((met) => met.player)
}

/** 起動条件を満たした「勇気」の id。 */
function satisfiedCards(state: DuelState): readonly string[] {
  return state.courageConditionsMet.flatMap((met) => met.satisfied)
}

/**
 * 山札を積んだ盤面。山札が 0 枚以下のプレイヤーは次に優先権が発生した時に敗北する
 * （総合ルール 第3部 第3章 2）ので、優先権が動くテストでは積んでおく。
 */
function stocked(): DuelState {
  return PLAYERS.reduce(
    (state, player) =>
      putInZone(
        state,
        player,
        '山札',
        Array.from({ length: 10 }, (_, index) =>
          instantiate({ id: `${player}の山札${index}`, card: plainCard, owner: player }),
        ),
      ),
    emptyDuelState(),
  )
}

/** そのプレイヤーの手札とエネルギーゾーンを整えた盤面。カードの名前をそのまま id にする。 */
function holding(
  player: Player,
  hand: readonly UnitCard[],
  energies: number,
  color: '赤' | '青' = '赤',
  state: DuelState = stocked(),
): DuelState {
  const withHand = putInZone(
    state,
    player,
    '手札',
    hand.map((card) => instantiate({ id: card.name, card, owner: player })),
  )
  return putInZone(
    withHand,
    player,
    'エネルギーゾーン',
    Array.from({ length: energies }, (_, index) =>
      instantiate({ id: `${player}のエネルギー${index}`, card: color === '赤' ? plainCard : blueCard, owner: player }),
    ),
  )
}

// 総合ルール 第5部 第2章 2（ADR-0006）
describe('「勇気」の起動条件', () => {
  /** 先攻が「勇気」を 1 枚持ち、エネルギーの条件も満たしている盤面。 */
  const ready = () => holding('先攻', [courageCard], 1)

  it('相手のユニットが味方エリアに置かれると、起動条件が満たされる', () => {
    const after = checkCourageCondition(ready(), placedUnit('後攻', homeSquare))

    expect(playersMet(after)).toEqual(['先攻'])
  })

  it('相手のユニットが中央エリアに置かれても、起動条件が満たされる', () => {
    const after = checkCourageCondition(ready(), placedUnit('後攻', centerSquare))

    expect(playersMet(after)).toEqual(['先攻'])
  })

  it('相手のユニットが敵エリアに置かれても、起動条件は満たされない', () => {
    const after = checkCourageCondition(ready(), placedUnit('後攻', enemySquare))

    expect(playersMet(after)).toEqual([])
  })

  // 「相手のユニットが」なので、置いた本人の起動条件は満たされない。
  it('自分のユニットを置いても、自分の起動条件は満たされない', () => {
    const after = checkCourageCondition(ready(), placedUnit('先攻', homeSquare))

    expect(playersMet(after)).toEqual([])
  })

  /**
   * エリアの呼び名は見るプレイヤーによって入れ替わる（総合ルール 第2部 第22章 6）。ルールが
   * エリアを指定する場合は、そのルールに従って行動するプレイヤーから見て判断する（同 6-1）。
   */
  it('エリアは、権利を得るプレイヤーから見て判定される', () => {
    // 先攻から見た敵エリアは、後攻から見れば味方エリアである。
    const after = checkCourageCondition(holding('後攻', [courageCard], 1), placedUnit('先攻', enemySquare))

    expect(playersMet(after)).toEqual(['後攻'])
  })

  it('すでに起動条件が満たされているなら重複しない', () => {
    const already = checkCourageCondition(ready(), placedUnit('後攻', homeSquare))

    const after = checkCourageCondition(already, placedUnit('後攻', centerSquare))

    expect(playersMet(after)).toEqual(['先攻'])
  })

  /**
   * 置かれたユニットは、起動する時の盤面からは引けない（`ability.ts` の `IntrusionOccasion`
   * と同じ理由）。効果はこのユニットにダメージを与える（同 第5部 第2章 2）ので、満たされた
   * 起動条件と一緒に写して持つ。
   */
  it('満たされた起動条件は、置かれたユニットをその瞬間の姿で持つ', () => {
    const placed = placedUnit('後攻', homeSquare)

    const after = checkCourageCondition(ready(), placed)

    expect(after.courageConditionsMet[0]?.placed).toEqual(placed)
  })

  it('手札に「勇気」が無ければ、起動条件は満たされない', () => {
    const after = checkCourageCondition(holding('先攻', [plainCard], 1), placedUnit('後攻', homeSquare))

    expect(playersMet(after)).toEqual([])
  })
})

/**
 * 総合ルール 第5部 第2章 2（ADR-0006）。
 *
 * 起動条件には「このカードと同じ色のカードがあなたのエネルギーゾーンにあり、かつこのカードの
 * レベルと同じかそれ以上の枚数のカードがあなたのエネルギーゾーンにあるならば」が含まれる。
 * これは `cost.ts` の `satisfiesLevel`（同 第1部 第2章 3-1）と同じ条件であり、**「このカード」
 * ごとに答えが変わる**ので、満たしたカードを 1 枚ずつ覚えておく。
 */
describe('起動条件のエネルギーの部分', () => {
  const placed = placedUnit('後攻', homeSquare)

  it('エネルギーの条件を満たした「勇気」だけが記録される', () => {
    // レベル 1 は満たすが、レベル 3 は満たさない枚数。
    const state = holding('先攻', [courageCard, bigCourageCard], 1)

    expect(satisfiedCards(checkCourageCondition(state, placed))).toEqual(['テスト・勇気'])
  })

  it('レベルの枚数を満たしていれば、どちらも記録される', () => {
    const state = holding('先攻', [courageCard, bigCourageCard], 3)

    expect(satisfiedCards(checkCourageCondition(state, placed))).toEqual(['テスト・勇気', 'テスト・レベル3の勇気'])
  })

  it('同じ色のカードがエネルギーゾーンに無ければ満たさない', () => {
    const state = holding('先攻', [courageCard], 1, '青')

    expect(playersMet(checkCourageCondition(state, placed))).toEqual([])
  })

  it('1 枚も満たさなければ、起動条件そのものが満たされない', () => {
    const state = holding('先攻', [bigCourageCard], 1)

    expect(playersMet(checkCourageCondition(state, placed))).toEqual([])
  })

  // 向きは見ない（総合ルール 第1部 第2章 3-1）。向きが関わるのは実際に支払う時（同 3-2）である。
  it('フリーズしているエネルギーも枚数に数える', () => {
    const frozen = putInZone(stocked(), '先攻', 'エネルギーゾーン', [
      instantiate({ id: '先攻のエネルギー0', card: plainCard, owner: '先攻', orientation: 'フリーズ' }),
    ])
    const state = putInZone(frozen, '先攻', '手札', [
      instantiate({ id: courageCard.name, card: courageCard, owner: '先攻' }),
    ])

    expect(satisfiedCards(checkCourageCondition(state, placed))).toEqual(['テスト・勇気'])
  })
})

// 総合ルール 第5部 第2章 2「１度でも優先権をパスすると……起動する権利を失います」（ADR-0006）
describe('優先権のパスによる権利の喪失', () => {
  /** 先攻の起動条件が満たされている盤面。 */
  function rightHeld(): DuelState {
    return checkCourageCondition(holding('先攻', [courageCard], 1), placedUnit('後攻', homeSquare))
  }

  it('権利を得ているプレイヤーが優先権をパスすると、権利を失う', () => {
    expect(playersMet(loseCourageRightOnPass(rightHeld(), '先攻'))).toEqual([])
  })

  it('相手が優先権をパスしても、自分の権利は失われない', () => {
    expect(playersMet(loseCourageRightOnPass(rightHeld(), '後攻'))).toEqual(['先攻'])
  })
})

/** 進行中のバトル。権利が発生するかどうかに中身は関わらないので、最小限の値で作る。 */
const battleInProgress: Battle = {
  square: centerSquare,
  attacker: '攻撃したユニット',
  attacked: '攻撃されたユニット',
  step: '第１バトルステップ',
  dealtDamage: [],
  endOfBattleTriggered: false,
  heldBank: [],
  heldTriggered: [],
}

/** 進行中のスマッシュ判定。同じく最小限の値で作る。 */
const judgmentInProgress: SmashJudgment = {
  player: '後攻',
  step: '回復ステップ',
  repeats: 1,
  round: 0,
  faceUp: undefined,
  heldBank: [],
  heldTriggered: [],
}

// 総合ルール 第5部 第2章 2 ただし書き、第3部 第11章 5・第17章 4（ADR-0006）
describe('バトル・スマッシュ判定中は権利が発生しない', () => {
  function rightHeld(): DuelState {
    return checkCourageCondition(holding('先攻', [courageCard], 1), placedUnit('後攻', homeSquare))
  }

  it('バトルもスマッシュ判定も無ければ、起動条件が満たされた時点で権利が発生している', () => {
    expect(courageRightsOf(rightHeld(), '先攻')).toHaveLength(1)
  })

  it('起動条件が満たされていなければ権利は発生しない', () => {
    expect(courageRightsOf(stocked(), '先攻')).toEqual([])
  })

  it('相手の起動条件では権利を得ない', () => {
    expect(courageRightsOf(rightHeld(), '後攻')).toEqual([])
  })

  it('バトルが進行中の間は、起動条件が満たされていても権利が発生しない', () => {
    expect(courageRightsOf({ ...rightHeld(), battle: battleInProgress }, '先攻')).toEqual([])
  })

  it('スマッシュ判定が進行中の間は、起動条件が満たされていても権利が発生しない', () => {
    expect(courageRightsOf({ ...rightHeld(), smashJudgments: [judgmentInProgress] }, '先攻')).toEqual([])
  })

  // 権利の発生が遅れている間は、優先権をパスしても失わない。失っていたら、終了まで遅らせる
  // 意味が無くなる（`trap.ts` の `loseTrapRightOnPass` と同じ読み方）。
  it('バトルが進行中の間は、優先権をパスしても権利を失わない', () => {
    const inBattle: DuelState = { ...rightHeld(), battle: battleInProgress }

    expect(playersMet(loseCourageRightOnPass(inBattle, '先攻'))).toEqual(['先攻'])
  })
})

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

/**
 * 総合ルール 第5部 第2章 2（ADR-0006）。
 *
 * 起動するのは優先権を持っているプレイヤーである。第 1 ターンの始めに優先権を持つのは非
 * アクティブプレイヤー（後攻）なので、「勇気」を持つのは後攻の側にする。先攻のユニットが
 * 後攻から見た味方エリア（`enemySquare`）に置かれると、後攻の起動条件が満たされる。
 */
describe('「勇気」の起動', () => {
  /** 後攻が「勇気」を持ち、先攻のユニットがその味方エリアに置かれた盤面。 */
  function readyToActivate(hand: readonly UnitCard[] = [courageCard], energies = 1): DuelState {
    const board = putOnSquare(
      holding('後攻', hand, energies),
      enemySquare,
      instantiate({ id: '置かれたユニット', card: plainCard, owner: '先攻' }),
    )
    return checkCourageCondition(board, placedUnit('先攻', enemySquare))
  }

  it('置かれた相手のユニットにＸダメージを与える', () => {
    const after = stateOf(activateCourage(readyToActivate(), 'テスト・勇気', chooseFirst))

    expect(cardsOn(after, enemySquare)[0]?.damage).toBe(4000)
  })

  // 「コストとしてこのカードと同じ色のエネルギーを１支払い、このカードを捨札にする」。
  it('コストとしてエネルギーを 1 枚フリーズし、そのカードを捨札に置く', () => {
    const after = stateOf(activateCourage(readyToActivate(), 'テスト・勇気', chooseFirst))

    expect(cardsIn(after, '後攻', 'エネルギーゾーン')[0]?.orientation).toBe('フリーズ')
    expect(cardsIn(after, '後攻', '捨札').map((card) => card.id)).toEqual(['テスト・勇気'])
    expect(cardsIn(after, '後攻', '手札')).toEqual([])
  })

  // 総合ルール 第4部 第5章 2。権利を持つのは非アクティブプレイヤーなので、行動の後も
  // 優先権はその側に戻る。だからパスを挟まずに続けて起動できる（同 第5部 第2章 3）。
  it('行った後、非アクティブプレイヤーが優先権を獲得する', () => {
    const after = stateOf(activateCourage(readyToActivate(), 'テスト・勇気', chooseFirst))

    expect(after.turn.priority).toBe('後攻')
  })

  it('起動条件が満たされていなければ起動できない', () => {
    const state = putOnSquare(
      holding('後攻', [courageCard], 1),
      enemySquare,
      instantiate({ id: '置かれたユニット', card: plainCard, owner: '先攻' }),
    )

    expect(violationOf(activateCourage(state, 'テスト・勇気', chooseFirst))).toBe('起動する権利がない')
  })

  // 権利がまだ発生していないのであって、行動そのものが禁じられているわけではない。
  it('バトルが進行中の間は起動できない', () => {
    const inBattle: DuelState = { ...readyToActivate(), battle: battleInProgress }

    expect(violationOf(activateCourage(inBattle, 'テスト・勇気', chooseFirst))).toBe('起動する権利がない')
  })

  it('エネルギーの条件を満たしていなかった「勇気」は起動できない', () => {
    // レベル 1 のほうだけが起動条件を満たす枚数。レベル 3 のほうは記録されない。
    const state = readyToActivate([courageCard, bigCourageCard], 1)

    expect(violationOf(activateCourage(state, 'テスト・レベル3の勇気', chooseFirst))).toBe('起動する権利がない')
  })

  /**
   * 総合ルール 第5部 第2章 2（ADR-0006）。
   *
   * エネルギーの条件は起動条件が満たされたその瞬間に判定される。権利を失うのは優先権を
   * パスした時だけなので、**その後にエネルギーが減っても起動できる。**
   *
   * この並びは実際に起こる。同じできごとでトラップを発動し、そのトラップがエネルギーゾーンに
   * あるカードをスクエアへ出す場合である。両方を使うならトラップが先しかない（同 4）ので、
   * エネルギーが減った後に起動することになる。ここではエネルギーを直接取り除いて、その時に
   * 権利が残っていることだけを見る。
   */
  it('起動条件が満たされた後にエネルギーが減っても起動できる', () => {
    const ready = readyToActivate([bigCourageCard], 3)
    // エネルギーゾーンから 1 枚取り除く。レベル 3 を満たさなくなるが、権利は残る。
    const reduced: DuelState = putInZone(
      ready,
      '後攻',
      'エネルギーゾーン',
      cardsIn(ready, '後攻', 'エネルギーゾーン').slice(1),
    )

    const after = stateOf(activateCourage(reduced, 'テスト・レベル3の勇気', chooseFirst))

    // 6000 ダメージはこのユニットのＢＰと同じなので、ルールエフェクトで捨札に置かれる
    // （総合ルール 第4部 第14章 4-1）。ダメージが通ったことがここに出る。
    expect(cardsOn(after, enemySquare)).toEqual([])
    expect(cardsIn(after, '先攻', '捨札').map((card) => card.id)).toEqual(['置かれたユニット'])
  })

  // 総合ルール 第5部 第2章 3
  it('起動しても起動条件は残り、同じできごとでもう 1 枚起動できる', () => {
    const first = stateOf(activateCourage(readyToActivate([courageCard, blueCourageCard], 2), 'テスト・勇気', chooseFirst))

    expect(first.courageConditionsMet).toHaveLength(1)
    // 青い「勇気」を起動するには青のエネルギーが要る。ここでは残っている権利だけを見る。
    expect(first.courageConditionsMet[0]?.satisfied).toContain('テスト・勇気')
  })

  it('コストを支払えなければ起動できない', () => {
    // 起動条件は満たすが、支払えるリリース状態のエネルギーが無い盤面。
    const ready = readyToActivate()
    const frozen: DuelState = putInZone(
      ready,
      '後攻',
      'エネルギーゾーン',
      cardsIn(ready, '後攻', 'エネルギーゾーン').map((card) => ({ ...card, orientation: 'フリーズ' as const })),
    )

    expect(violationOf(activateCourage(frozen, 'テスト・勇気', chooseFirst))).toBe('コストを支払えない')
  })

  it('「勇気」を持たないカードは起動できない', () => {
    const state = readyToActivate([courageCard, plainCard], 1)

    expect(violationOf(activateCourage(state, 'テスト・能力なし', chooseFirst))).toBe('起動できる能力がない')
  })

  it('手札に無いカードは起動できない', () => {
    expect(violationOf(activateCourage(readyToActivate(), 'よそのカード', chooseFirst))).toBe('そのゾーンにない')
  })

  // 総合ルール 第3部 第3章 3。デュエルは即座に終了するので、そこから先に優先権は発生しない
  // （`activate.ts` の `mayActivate`）。
  it('勝敗が決まったデュエルでは起動できない', () => {
    const ended: DuelState = { ...readyToActivate(), result: { kind: '勝利', winner: '先攻' } }

    expect(violationOf(activateCourage(ended, 'テスト・勇気', chooseFirst))).toBe('行える時ではない')
  })
})

/**
 * 「勇気」は手札にある時に効果を発揮する（総合ルール 第5部 第2章 1）。ユニットのテキストが
 * スクエアにある間だけ有効になる一般則（同 第4部 第7章 10）の例外なので、スクエアにいる
 * ユニットの起動型能力を走査する経路（`activate.ts`）からは見えてはならない。
 */
describe('「勇気」は起動型能力の一般の経路に出ない', () => {
  it('スクエアにいるユニットの起動型能力としては数えられない', () => {
    expect(activatedAbilitiesOf(courageCard)).toEqual([])
  })

  it('「勇気」としては引ける', () => {
    expect(courageOf(courageCard)?.amount).toBe(4000)
  })

  it('「勇気」を持たないカードからは引けない', () => {
    expect(courageOf(plainCard)).toBeUndefined()
  })
})
