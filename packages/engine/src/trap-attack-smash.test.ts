import { describe, expect, it } from 'vitest'
// 山札・手札・ゾーンを組み立てるためだけに `putInZone` を使う。engine の中からゾーンを差し替える
// ための関数であり、公開する API ではない（`trap-rights.test.ts` と同じ）。
import { putInZone } from './duel.js'
import { trapRightsOf } from './trap.js'
import {
  PLAYERS,
  activateTrap,
  cardsOn,
  damagePlayer,
  defineTrap,
  defineUnit,
  destroy,
  emptyDuelState,
  instantiate,
  legalActions,
  passPriority,
  playCard,
  putOnSquare,
  smash,
  triggeredAbility,
} from './index.js'
import type { ActionOutcome, Chooser, DuelState, Player, Square, TrapCard, UnitCard } from './index.js'

/**
 * 攻撃・スマッシュのトラップの発動条件と権利。
 *
 * 総合ルール 第3部 第11章 1-1・2-1・4・5、第12章 1、第9章 1、第17章 4、第2部 第20章 3-8、ADR-0039
 * （ADR-0006）。「攻撃された」がいつ満たされるか、「スマッシュされた」に効果ダメージを含めない
 * ことは条文に明示が無い読みなので、ADR-0039 を併記する。カードはどれも架空のものである。
 */

const chooseFirst: Chooser = (candidates) => candidates[0]

const vanilla = defineUnit({ name: 'テスト・バニラ', level: 1, colors: ['赤'], bp: 3000, sp: 1000 })
/** ＢＰが 0 のユニット。置かれた時点でルールエフェクトによって捨札に置かれる（バトルが発生しない）。 */
const zeroBp = defineUnit({ name: 'テスト・ＢＰ0', level: 1, colors: ['赤'], bp: 0, sp: 1000 })
/** ＳＰ 0 のユニット。敵エリアからのスマッシュで 500 のダメージを与える（判定は発生しない）。 */
const sp0 = defineUnit({ name: 'テスト・ＳＰ0', level: 1, colors: ['赤'], bp: 3000, sp: 0 })
/** ＳＰ 1500 のユニット。敵エリアからのスマッシュで 2000 のダメージを与える（判定が発生する）。 */
const sp1500 = defineUnit({ name: 'テスト・ＳＰ1500', level: 1, colors: ['赤'], bp: 3000, sp: 1500 })
/** 「登場した時」に後攻へ 1000 のダメージを与えるユニット（効果によるダメージ）。 */
const damaging = defineUnit({
  name: 'テスト・ダメージを与える',
  level: 1,
  colors: ['赤'],
  bp: 3000,
  sp: 1000,
  abilities: [
    triggeredAbility('登場した時', function* () {
      yield* damagePlayer('後攻', 1000)
    }),
  ],
})

/** 攻撃したユニットを破壊する、後攻の攻撃のトラップ。破壊できたかで、きっかけが手渡されたことを見る。 */
const destroyAttackerTrap = defineTrap({
  name: 'テスト・攻撃者を破壊',
  level: 1,
  colors: ['赤'],
  triggerIcon: { kind: '攻撃' },
  effect: function* (_duel, occasion) {
    yield* destroy(occasion.attacker)
  },
})

/** スマッシュしたユニットを破壊する、後攻のスマッシュのトラップ。 */
const destroySmasherTrap = defineTrap({
  name: 'テスト・スマッシュした者を破壊',
  level: 1,
  colors: ['赤'],
  triggerIcon: { kind: 'スマッシュ' },
  effect: function* (_duel, occasion) {
    yield* destroy(occasion.smasher)
  },
})

/** 先攻から見た味方エリアの、バトルが起きるスクエア。 */
const battleSquare: Square = { row: 0, column: 1 }
const secondBattleSquare: Square = { row: 0, column: 2 }
const enemySquare: Square = { row: 2, column: 1 }

function pass(state: DuelState): DuelState {
  return passPriority(state, chooseFirst)
}

function stateOf(outcome: ActionOutcome): DuelState {
  if (outcome.kind !== '行った') throw new Error(`行えなかった: ${outcome.violation}`)
  return outcome.state
}

function unitOf(id: string, card: UnitCard, owner: Player) {
  return instantiate({ id, card, owner })
}

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

const kindsOf = (state: DuelState) => legalActions(state).map((action) => action.kind)
const mayActivate = (state: DuelState): boolean =>
  kindsOf(state).includes('トラップを発動する') && state.turn.priority === '後攻'

/** 先攻のメインフェイズ。手札に攻撃するユニットを持ち、エネルギーを払える。 */
function mainPhase(): DuelState {
  let current = stocked()
  while (current.turn.phase !== 'メインフェイズ') current = pass(current)
  return putInZone(
    putInZone(pass(current), '先攻', '手札', [unitOf('攻撃した', vanilla, '先攻')]),
    '先攻',
    'エネルギーゾーン',
    [unitOf('先攻のエネ', vanilla, '先攻')],
  )
}

/**
 * 後攻の「攻撃された」ユニットのいるスクエアへ、先攻が `attacker` をプレイした盤面。後攻の
 * トラップゾーンには `trap` がある。バトルが発生していれば、第１バトルステップで後攻が
 * 優先権を持っている。
 */
function attackedAt(trap: TrapCard, attacker: UnitCard = vanilla, extra?: (state: DuelState) => DuelState): DuelState {
  const withAttacker = putInZone(mainPhase(), '先攻', '手札', [unitOf('攻撃した', attacker, '先攻')])
  const board = putOnSquare(armed(withAttacker, trap), battleSquare, unitOf('攻撃された', vanilla, '後攻'))
  return stateOf(playCard(extra === undefined ? board : extra(board), { card: '攻撃した', square: battleSquare }, chooseFirst))
}

describe('攻撃のトラップ', () => {
  it('自分のユニットがバトルの攻撃されたユニットになると、第１バトルステップで優先権を得た時に発動できる', () => {
    const state = attackedAt(destroyAttackerTrap)

    expect(state.battles).toHaveLength(1)
    expect(state.battles[0]?.step).toBe('第１バトルステップ')
    expect(state.trapConditionsMet.map((met) => met.occasion.kind)).toEqual(['攻撃'])
    expect(mayActivate(state)).toBe(true)
  })

  it('きっかけは、攻撃したユニットと攻撃されたユニットを、バトルが発生したスクエアの写しで持つ', () => {
    const [met] = attackedAt(destroyAttackerTrap).trapConditionsMet
    const occasion = met?.occasion

    expect(occasion?.kind === '攻撃' && [occasion.attacker.id, occasion.attacked.id]).toEqual(['攻撃した', '攻撃された'])
    expect(occasion?.kind === '攻撃' && [occasion.attacker.square, occasion.attacked.square]).toEqual([
      battleSquare,
      battleSquare,
    ])
  })

  it('発動すると、ダメージの応酬の前に効果が解決され、効果はきっかけのユニットを対象にできる', () => {
    const activated = stateOf(activateTrap(attackedAt(destroyAttackerTrap), 'トラップ', chooseFirst))

    // 攻撃したユニットが破壊され、バトルダメージはまだ与えられていない。
    expect(cardsOn(activated, battleSquare).map((card) => card.id)).toEqual(['攻撃された'])
    expect(cardsOn(activated, battleSquare)[0]?.damage).toBe(0)
    expect(activated.battles[0]?.step).toBe('第１バトルステップ')
  })

  // 総合ルール 第2部 第20章 3-8。第１バトルステップで発動せずにパスすると、権利を失う。第２バトル
  // ステップ以降には持ち越されない。
  it('第１バトルステップで発動せずにパスすれば権利を失い、第２バトルステップ以降に持ち越されない', () => {
    let current = pass(attackedAt(destroyAttackerTrap))

    expect(current.trapConditionsMet).toEqual([])
    const steps = new Set<string>()
    while (current.battles.length > 0) {
      current = pass(current)
      expect(mayActivate(current)).toBe(false)
      const step = current.battles.at(-1)?.step
      if (step !== undefined) steps.add(step)
    }
    expect(steps.has('第２バトルステップ')).toBe(true)
  })

  // 総合ルール 第3部 第11章 1-1 の例。相手のユニットが置かれただけでは、攻撃されたことにならない。
  it('相手のユニットが置かれても、バトルが発生しなければ発動条件は満たされない', () => {
    const state = attackedAt(destroyAttackerTrap, zeroBp)

    expect(state.battles).toEqual([])
    expect(cardsOn(state, battleSquare).map((card) => card.id)).toEqual(['攻撃された'])
    expect(state.trapConditionsMet).toEqual([])
    expect(mayActivate(state)).toBe(false)
  })

  it('トラップが無ければ、バトルの進行で何も足されない', () => {
    const noTrap = putOnSquare(mainPhase(), battleSquare, unitOf('攻撃された', vanilla, '後攻'))
    const state = stateOf(playCard(noTrap, { card: '攻撃した', square: battleSquare }, chooseFirst))

    expect(state.battles).toHaveLength(1)
    expect(state.trapConditionsMet).toEqual([])
  })

  // 総合ルール 第3部 第11章 1-3・2-1・5、ADR-0039。2 つのスクエアで同時にバトルが発生する盤面である
  // （1-3）。条文は同時にステップが進行すると定めるが、エンジンは 1 つずつ始めて先のバトルを待機中に
  // する（2-1 のバトル中のバトルと同じ扱い）。ADR-0039 は、これを読みとして受け入れている。先のバトルが
  // 始まった直後、優先権を得る前に後のバトルが始まるので、後攻はどちらの権利も、パスする前に得る。
  // 後のバトルは先のきっかけの後に始まるので、後のバトルの間は先のきっかけの権利が止まる。
  describe('同時に発生した 2 つのバトル', () => {
    /** 2 つのスクエアで、先攻のユニットが後攻のユニットと重なっている盤面。 */
    function twoBattles(): DuelState {
      return attackedAt(destroyAttackerTrap, vanilla, (board) =>
        putOnSquare(putOnSquare(board, secondBattleSquare, unitOf('2 つ目の攻撃された', vanilla, '後攻')), secondBattleSquare, unitOf('2 つ目の攻撃した', vanilla, '先攻')),
      )
    }

    const attackedIds = (state: DuelState) =>
      trapRightsOf(state, 'トラップ').map((met) => (met.occasion.kind === '攻撃' ? met.occasion.attacked.id : undefined))

    it('後のバトルの間に権利が発生しているのは後の攻撃のきっかけだけで、先のきっかけは止まっている', () => {
      const state = twoBattles()

      expect(state.battles).toHaveLength(2)
      expect(state.trapConditionsMet).toHaveLength(2)
      expect(attackedIds(state)).toEqual([state.battles[1]?.attacked])
    })

    it('後のバトルが終わると、止まっていた先の攻撃のきっかけの権利が発生する。その間のパスでは失わない', () => {
      let current = twoBattles()
      const firstAttacked = current.battles[0]?.attacked
      let guard = 0

      // 後攻は後のバトルの間にパスして、後のきっかけの権利を失う。先のきっかけは止まっているので残る。
      while (current.battles.length > 1) {
        current = pass(current)
        expect(current.trapConditionsMet.some((met) => met.occasion.kind === '攻撃' && met.occasion.attacked.id === firstAttacked)).toBe(true)
        guard += 1
        if (guard > 40) throw new Error('後のバトルが終わらなかった')
      }

      // 後のバトルが終わった。先のバトルは第１バトルステップのまま戻り、その権利が発生している。
      expect(current.battles).toHaveLength(1)
      expect(current.battles[0]?.step).toBe('第１バトルステップ')
      expect(attackedIds(current)).toEqual([firstAttacked])
    })

    it('先のバトルの第１バトルステップで後攻が優先権を得た時に、発動できる', () => {
      let current = twoBattles()
      while (current.battles.length > 1) current = pass(current)
      // 後攻のトラップの権利には、先攻のパスは影響しない。後攻に優先権が回るまで進める。
      while (current.turn.priority !== '後攻') current = pass(current)

      expect(current.battles[0]?.step).toBe('第１バトルステップ')
      expect(mayActivate(current)).toBe(true)
    })
  })
})

// 総合ルール 第1部 第1章 3、ADR-0039。きっかけはできごとが起きた時点の写しで、発動までにそのユニットが
// スクエアを離れていれば、効果は対象を失う（その対象への命令は実行されないだけである）。
describe('きっかけのユニットを対象にする効果', () => {
  /** 攻撃したユニットと攻撃されたユニットの両方を破壊する、後攻の攻撃のトラップ。 */
  const destroyBothTrap = defineTrap({
    name: 'テスト・両方を破壊',
    level: 1,
    colors: ['赤'],
    triggerIcon: { kind: '攻撃' },
    effect: function* (_duel, occasion) {
      yield* destroy(occasion.attacker)
      yield* destroy(occasion.attacked)
    },
  })

  const attackerOnSquare = { id: '攻撃した', square: battleSquare, card: vanilla, controller: '先攻' as const }
  const attackedOnSquare = { id: '攻撃された', square: battleSquare, card: vanilla, controller: '後攻' as const }
  const smasherOnSquare = { id: 'スマッシュ役', square: enemySquare, card: vanilla, controller: '先攻' as const }

  /** 後攻が優先権を持ち、そのきっかけで発動条件が満たされている盤面。ユニットは `onSquares` だけがいる。 */
  function withCondition(
    trap: TrapCard,
    occasion: NonNullable<DuelState['trapConditionsMet'][number]>['occasion'],
    onSquares: readonly { id: string; square: Square; card: UnitCard; controller: Player }[],
  ): DuelState {
    const base = onSquares.reduce(
      (state, unit) => putOnSquare(state, unit.square, unitOf(unit.id, unit.card, unit.controller)),
      armed(mainPhase(), trap),
    )
    return { ...base, turn: { ...base.turn, priority: '後攻' }, trapConditionsMet: [{ trap: 'トラップ', occasion, metAt: 0 }] }
  }

  const attack = { kind: '攻撃' as const, attacker: attackerOnSquare, attacked: attackedOnSquare }

  it('攻撃したユニットと攻撃されたユニットがスクエアにいれば、どちらも対象にできる', () => {
    const state = withCondition(destroyBothTrap, attack, [attackerOnSquare, attackedOnSquare])

    const activated = stateOf(activateTrap(state, 'トラップ', chooseFirst))

    expect(cardsOn(activated, battleSquare)).toEqual([])
  })

  it('攻撃したユニットがスクエアを離れていれば、そのユニットへの命令は実行されず、残りの対象には効く', () => {
    const state = withCondition(destroyBothTrap, attack, [attackedOnSquare])

    const activated = stateOf(activateTrap(state, 'トラップ', chooseFirst))

    expect(cardsOn(activated, battleSquare)).toEqual([])
  })

  it('両方がスクエアを離れていれば、何も起こらずに解決される', () => {
    const state = withCondition(destroyBothTrap, attack, [])

    expect(stateOf(activateTrap(state, 'トラップ', chooseFirst)).trapConditionsMet).toEqual([])
  })

  // 満たされた発動条件は、アイコンの種類ごとの判定だけが足す。種類が食い違う状態は、起こらないはず
  // だが、起これば効果が別の種類のきっかけを受け取るので、発動の入口で止める。
  it('トラップの種類と、満たされたきっかけの種類が食い違っていれば、例外で止める', () => {
    const state = withCondition(destroyBothTrap, { kind: 'スマッシュ', smasher: smasherOnSquare }, [])

    expect(() => activateTrap(state, 'トラップ', chooseFirst)).toThrow('食い違っている')
  })

  it('スマッシュしたユニットがスクエアを離れていれば、効果は対象を失い、何も起こらずに解決される', () => {
    const state = withCondition(destroySmasherTrap, { kind: 'スマッシュ', smasher: smasherOnSquare }, [])

    expect(stateOf(activateTrap(state, 'トラップ', chooseFirst)).trapConditionsMet).toEqual([])
  })
})

describe('スマッシュのトラップ', () => {
  /** 先攻が `card` のユニットを敵エリアに置いて、スマッシュフェイズでスマッシュした盤面。 */
  function smashedWith(card: UnitCard, trap: TrapCard = destroySmasherTrap): DuelState {
    const withUnit = putOnSquare(armed(stocked(), trap), enemySquare, unitOf('スマッシュ役', card, '先攻'))
    let current = withUnit
    while (current.turn.phase !== 'スマッシュフェイズ') current = pass(current)
    return stateOf(smash(pass(current), 'スマッシュ役'))
  }

  it('きっかけは、スマッシュしたユニットのスマッシュした時点の写しで持つ', () => {
    const [met] = smashedWith(sp1500).trapConditionsMet
    const occasion = met?.occasion

    expect(occasion?.kind === 'スマッシュ' && occasion.smasher.id).toBe('スマッシュ役')
    expect(occasion?.kind === 'スマッシュ' && occasion.smasher.square).toEqual(enemySquare)
  })

  describe('スマッシュ判定が発生する時', () => {
    it('判定の間は権利が止まり、パスしても失わない。判定が終わると発生する', () => {
      let current = smashedWith(sp1500)
      let guard = 0

      expect(current.smashJudgments).toHaveLength(1)
      expect(trapRightsOf(current, 'トラップ')).toEqual([])
      expect(mayActivate(current)).toBe(false)
      while (current.smashJudgments.length > 0) {
        current = pass(current)
        expect(current.trapConditionsMet).toHaveLength(1)
        guard += 1
        if (guard > 40) throw new Error('スマッシュ判定が終わらなかった')
      }

      expect(trapRightsOf(current, 'トラップ')).toHaveLength(1)
    })
  })

  describe('ダメージが 1000 未満で判定が発生しない時', () => {
    it('スマッシュの行動の直後に権利が発生し、発動できる', () => {
      const state = smashedWith(sp0)

      expect(state.smashJudgments).toEqual([])
      expect(state.trapConditionsMet).toHaveLength(1)
      expect(mayActivate(state)).toBe(true)
    })

    it('発動すると、きっかけのスマッシュしたユニットを対象にできる', () => {
      const activated = stateOf(activateTrap(smashedWith(sp0), 'トラップ', chooseFirst))

      expect(cardsOn(activated, enemySquare)).toEqual([])
    })
  })

  // 総合ルール 第3部 第9章 1。効果によるダメージはスマッシュの行動ではない（ADR-0039）。
  it('効果によるダメージを受けても、発動条件は満たされない', () => {
    const base = putInZone(armed(mainPhase(), destroySmasherTrap), '先攻', '手札', [unitOf('ダメージ役', damaging, '先攻')])
    let current = stateOf(playCard(base, { card: 'ダメージ役', square: { row: 0, column: 0 } }, chooseFirst))
    let sawJudgment = false

    for (let i = 0; i < 30 && !sawJudgment; i += 1) {
      current = pass(current)
      sawJudgment = current.smashJudgments.length > 0
      expect(current.trapConditionsMet).toEqual([])
    }

    // 効果のダメージで判定まで起きている。それでも満たされていない。
    expect(sawJudgment).toBe(true)
  })

  it('トラップが無ければ、スマッシュの進行で何も足されない', () => {
    const withUnit = putOnSquare(stocked(), enemySquare, unitOf('スマッシュ役', sp1500, '先攻'))
    let current = withUnit
    while (current.turn.phase !== 'スマッシュフェイズ') current = pass(current)
    const state = stateOf(smash(pass(current), 'スマッシュ役'))

    expect(state.smashJudgments).toHaveLength(1)
    expect(state.trapConditionsMet).toEqual([])
  })
})
