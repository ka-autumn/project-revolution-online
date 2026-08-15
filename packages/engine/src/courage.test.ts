import { describe, expect, it } from 'vitest'
import { checkCourageCondition, courageRightsOf, loseCourageRightOnPass } from './courage.js'
import { defineUnit, emptyDuelState } from './index.js'
import type { Battle, DuelState, Player, SmashJudgment, Square, UnitOnSquare } from './index.js'

/** 先攻から見た味方エリア・中央エリア・敵エリアのスクエア（`board.ts` の `areaOf`）。 */
const homeSquare: Square = { row: 0, column: 1 }
const centerSquare: Square = { row: 1, column: 1 }
const enemySquare: Square = { row: 2, column: 1 }

const unitCard = defineUnit({ name: 'テスト・置かれるユニット', level: 1, bp: 1000, sp: 1000 })

/** そのプレイヤーがそのスクエアに置いたユニット。 */
function placedUnit(controller: Player, square: Square): UnitOnSquare {
  return { id: '置かれたユニット', square, card: unitCard, controller }
}

/** 起動条件が満たされているプレイヤー。並びの中身そのものを見ないところで使う。 */
function playersMet(state: DuelState): readonly Player[] {
  return state.courageConditionsMet.map((met) => met.player)
}

// 総合ルール 第5部 第2章 2（ADR-0006）
describe('「勇気」の起動条件', () => {
  it('相手のユニットが味方エリアに置かれると、起動条件が満たされる', () => {
    const after = checkCourageCondition(emptyDuelState(), placedUnit('後攻', homeSquare))

    expect(playersMet(after)).toEqual(['先攻'])
  })

  it('相手のユニットが中央エリアに置かれても、起動条件が満たされる', () => {
    const after = checkCourageCondition(emptyDuelState(), placedUnit('後攻', centerSquare))

    expect(playersMet(after)).toEqual(['先攻'])
  })

  it('相手のユニットが敵エリアに置かれても、起動条件は満たされない', () => {
    const after = checkCourageCondition(emptyDuelState(), placedUnit('後攻', enemySquare))

    expect(playersMet(after)).toEqual([])
  })

  // 「相手のユニットが」なので、置いた本人の起動条件は満たされない。
  it('自分のユニットを置いても、自分の起動条件は満たされない', () => {
    const after = checkCourageCondition(emptyDuelState(), placedUnit('先攻', homeSquare))

    expect(playersMet(after)).toEqual([])
  })

  /**
   * エリアの呼び名は見るプレイヤーによって入れ替わる（総合ルール 第2部 第22章 6）。ルールが
   * エリアを指定する場合は、そのルールに従って行動するプレイヤーから見て判断する（同 6-1）。
   */
  it('エリアは、権利を得るプレイヤーから見て判定される', () => {
    // 先攻から見た敵エリアは、後攻から見れば味方エリアである。
    const after = checkCourageCondition(emptyDuelState(), placedUnit('先攻', enemySquare))

    expect(playersMet(after)).toEqual(['後攻'])
  })

  it('すでに起動条件が満たされているなら重複しない', () => {
    const already = checkCourageCondition(emptyDuelState(), placedUnit('後攻', homeSquare))

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

    const after = checkCourageCondition(emptyDuelState(), placed)

    expect(after.courageConditionsMet).toEqual([{ player: '先攻', placed }])
  })
})

// 総合ルール 第5部 第2章 2「１度でも優先権をパスすると……起動する権利を失います」（ADR-0006）
describe('優先権のパスによる権利の喪失', () => {
  /** 先攻の起動条件が満たされている盤面。 */
  function rightHeld(): DuelState {
    return checkCourageCondition(emptyDuelState(), placedUnit('後攻', homeSquare))
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
}

// 総合ルール 第5部 第2章 2 ただし書き、第3部 第11章 5・第17章 4（ADR-0006）
describe('バトル・スマッシュ判定中は権利が発生しない', () => {
  function rightHeld(): DuelState {
    return checkCourageCondition(emptyDuelState(), placedUnit('後攻', homeSquare))
  }

  it('バトルもスマッシュ判定も無ければ、起動条件が満たされた時点で権利が発生している', () => {
    expect(courageRightsOf(rightHeld(), '先攻')).toHaveLength(1)
  })

  it('起動条件が満たされていなければ権利は発生しない', () => {
    expect(courageRightsOf(emptyDuelState(), '先攻')).toEqual([])
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
