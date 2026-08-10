import { describe, expect, it } from 'vitest'
import { putInZone } from './duel.js'
import { checkIntrusion, hasTrapRight, loseTrapRightOnPass } from './trap.js'
import { defineTrap, emptyDuelState, instantiate } from './index.js'
import type { Battle, DuelState, Player, SmashJudgment, Square } from './index.js'

const targetSquare: Square = { row: 0, column: 1 }
const otherSquare: Square = { row: 2, column: 2 }
/** `targetSquare` の反対側のスクエア（行・列とも折り返した位置）。 */
const mirroredSquare: Square = { row: 2, column: 1 }

/** トリガーアイコンに `targetSquare` を持つトラップ。 */
const trapWithIcon = defineTrap({ name: 'テスト・トリガーアイコン持ち', level: 1, triggerIcon: [targetSquare] })

/** トリガーアイコンを持たないトラップ。 */
const trapWithoutIcon = defineTrap({ name: 'テスト・トリガーアイコン無し', level: 1 })

/** そのトラップが、指定したプレイヤー（省略時は先攻）のトラップゾーンにある盤面。 */
function withTrap(card = trapWithIcon, owner: Player = '先攻'): DuelState {
  const trap = instantiate({ id: 'トラップ', card, owner })
  return putInZone(emptyDuelState(), owner, 'トラップゾーン', [trap])
}

// 総合ルール 第2部 第20章 3-6・3-8・3-8-a（ADR-0006）
describe('侵入', () => {
  it('相手のユニットがトリガーアイコンのスクエアに置かれると、発動条件が満たされる', () => {
    const after = checkIntrusion(withTrap(), '後攻', targetSquare)

    expect(after.trapConditionsMet).toEqual(['トラップ'])
  })

  it('トリガーアイコンに描かれていないスクエアに置かれても発動条件は満たされない', () => {
    const after = checkIntrusion(withTrap(), '後攻', otherSquare)

    expect(after.trapConditionsMet).toEqual([])
  })

  // 「相手のユニットが」なので、置いた本人が支配するトラップは対象にならない。
  it('自分のユニットがそのスクエアに置かれても発動条件は満たされない', () => {
    const after = checkIntrusion(withTrap(), '先攻', targetSquare)

    expect(after.trapConditionsMet).toEqual([])
  })

  it('トリガーアイコンを持たないカードは侵入で発動条件が満たされない', () => {
    const after = checkIntrusion(withTrap(trapWithoutIcon), '後攻', targetSquare)

    expect(after.trapConditionsMet).toEqual([])
  })

  it('すでに発動条件が満たされているなら重複しない', () => {
    const already: DuelState = { ...withTrap(), trapConditionsMet: ['トラップ'] }

    const after = checkIntrusion(already, '後攻', targetSquare)

    expect(after.trapConditionsMet).toEqual(['トラップ'])
  })
})

// トリガーアイコンはムーブアイコンの矢印の向きと同じ理由で、支配者から見た向きで印刷されて
// いる（`board.ts` の `squareFromView`）（ADR-0006）。
describe('トリガーアイコンは支配者から見た向きで解釈される', () => {
  it('後攻のトラップでは、印刷されたスクエアが反対側の絶対スクエアに対応する', () => {
    const after = checkIntrusion(withTrap(trapWithIcon, '後攻'), '先攻', mirroredSquare)

    expect(after.trapConditionsMet).toEqual(['トラップ'])
  })

  it('印刷されたスクエアそのものの絶対位置に置かれても、後攻のトラップでは反応しない', () => {
    const after = checkIntrusion(withTrap(trapWithIcon, '後攻'), '先攻', targetSquare)

    expect(after.trapConditionsMet).toEqual([])
  })
})

// 総合ルール 第2部 第20章 3-8「１度でも優先権をパスすると...権利を失います」（ADR-0006）
describe('優先権のパスによる権利の喪失', () => {
  it('権利を得ているプレイヤーが優先権をパスすると、権利を失う', () => {
    const state: DuelState = { ...withTrap(), trapConditionsMet: ['トラップ'] }

    const after = loseTrapRightOnPass(state, '先攻')

    expect(after.trapConditionsMet).toEqual([])
  })

  it('相手が優先権をパスしても、自分のトラップの権利は失われない', () => {
    const state: DuelState = { ...withTrap(), trapConditionsMet: ['トラップ'] }

    const after = loseTrapRightOnPass(state, '後攻')

    expect(after.trapConditionsMet).toEqual(['トラップ'])
  })
})

/** 進行中のバトル。権利が発生するかどうかに中身は関わらないので、最小限の値で作る。 */
const battleInProgress: Battle = {
  square: otherSquare,
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

// 総合ルール 第2部 第20章 3-8 ただし書き、第3部 第11章 5・第17章 4（ADR-0006）
describe('バトル・スマッシュ判定中は権利が発生しない', () => {
  /** 発動条件が満たされたトラップが、先攻のトラップゾーンにある盤面。 */
  function conditionMet(): DuelState {
    return { ...withTrap(), trapConditionsMet: ['トラップ'] }
  }

  it('バトルもスマッシュ判定も無ければ、発動条件が満たされた時点で権利が発生している', () => {
    expect(hasTrapRight(conditionMet(), 'トラップ')).toBe(true)
  })

  it('発動条件が満たされていなければ権利は発生しない', () => {
    expect(hasTrapRight(withTrap(), 'トラップ')).toBe(false)
  })

  it('バトルが進行中の間は、発動条件が満たされていても権利が発生しない', () => {
    expect(hasTrapRight({ ...conditionMet(), battle: battleInProgress }, 'トラップ')).toBe(false)
  })

  it('スマッシュ判定が進行中の間は、発動条件が満たされていても権利が発生しない', () => {
    expect(hasTrapRight({ ...conditionMet(), smashJudgments: [judgmentInProgress] }, 'トラップ')).toBe(false)
  })

  it('バトルが終了すると権利が発生する', () => {
    const during: DuelState = { ...conditionMet(), battle: battleInProgress }

    expect(hasTrapRight({ ...during, battle: undefined }, 'トラップ')).toBe(true)
  })

  // 権利を得ていないのだから、パスで失うこともない（同 3-8 は「権利を獲得した後...１度でも
  // 優先権をパスすると...権利を失います」であり、獲得が先にある）。バトルもスマッシュ判定も
  // ステップが連続した放棄で進む（同 第3部 第4章 4）ので、ここで失うなら終了まで遅らせる
  // 意味が無くなる。
  it('バトル中に優先権をパスしても、発動条件が満たされた状態は残る', () => {
    const after = loseTrapRightOnPass({ ...conditionMet(), battle: battleInProgress }, '先攻')

    expect(after.trapConditionsMet).toEqual(['トラップ'])
  })

  it('スマッシュ判定中に優先権をパスしても、発動条件が満たされた状態は残る', () => {
    const after = loseTrapRightOnPass({ ...conditionMet(), smashJudgments: [judgmentInProgress] }, '先攻')

    expect(after.trapConditionsMet).toEqual(['トラップ'])
  })
})
