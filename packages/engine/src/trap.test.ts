import { describe, expect, it } from 'vitest'
import type { TrapConditionMet } from './duel.js'
import { putInZone } from './duel.js'
import { checkAttack, checkIntrusion, checkSmash, loseTrapRightOnPass, trapRightsOf } from './trap.js'
import {
  alsoTreatedAs,
  attributeAdding,
  defineTrap,
  defineUnit,
  emptyDuelState,
  instantiate,
  putOnSquare,
} from './index.js'
import type {
  Battle,
  DuelState,
  Player,
  SmashJudgment,
  Square,
  TrapCard,
  TriggerFilter,
  UnitOnSquare,
} from './index.js'

const targetSquare: Square = { row: 0, column: 1 }
const otherSquare: Square = { row: 2, column: 2 }
/** `targetSquare` の反対側のスクエア（行・列とも折り返した位置）。 */
const mirroredSquare: Square = { row: 2, column: 1 }

/** トリガーアイコンに `targetSquare` を持つトラップ。 */
const trapWithIcon = defineTrap({
  name: 'テスト・トリガーアイコン持ち',
  level: 1,
  triggerIcon: { kind: '侵入', squares: [targetSquare] },
})

/**
 * 侵入のトリガーアイコンに、スクエアが書かれていないトラップ。侵入は「置かれたスクエアが
 * 赤く塗られていること」を求める（総合ルール 第2部 第20章 3-6）ので、どこでも満たされない（ADR-0039）。
 */
const trapWithoutSquares = defineTrap({
  name: 'テスト・スクエア指定無し',
  level: 1,
  triggerIcon: { kind: '侵入', squares: [] },
})

/** 攻撃のトリガーアイコンを持つトラップ。絞り込みは無い。 */
const attackTrap = defineTrap({ name: 'テスト・攻撃トラップ', level: 1, triggerIcon: { kind: '攻撃' } })

/** 絞り込みつきの攻撃のトリガーアイコンを持つトラップ。 */
const filteredAttackTrap = defineTrap({
  name: 'テスト・絞り込み攻撃トラップ',
  level: 1,
  triggerIcon: { kind: '攻撃', filter: { axis: '色', value: '赤' } },
})

/** スマッシュのトリガーアイコンを持つトラップ。 */
const smashTrap = defineTrap({ name: 'テスト・スマッシュトラップ', level: 1, triggerIcon: { kind: 'スマッシュ' } })

const unitCard = defineUnit({ name: 'テスト・侵入するユニット', level: 1, bp: 1000, sp: 1000 })

/** そのプレイヤーがそのスクエアに置いたユニット。侵入させる側になる。 */
function intruder(controller: Player, square: Square): UnitOnSquare {
  return { id: '侵入したユニット', square, card: unitCard, controller }
}

/** 満たされた発動条件。きっかけの中身が関わらないところでは、これを置く。 */
function conditionMet(invader = intruder('後攻', targetSquare)): TrapConditionMet {
  return { trap: 'トラップ', occasion: { kind: '侵入', invader }, metAt: 0 }
}

/** 発動条件が満たされているトラップの id。並びの中身そのものを見ないところで使う。 */
function trapsMet(state: DuelState): readonly string[] {
  return state.trapConditionsMet.map((met) => met.trap)
}

/** そのトラップが、指定したプレイヤー（省略時は先攻）のトラップゾーンにある盤面。 */
function withTrap(card: TrapCard = trapWithIcon, owner: Player = '先攻'): DuelState {
  const trap = instantiate({ id: 'トラップ', card, owner })
  return putInZone(emptyDuelState(), owner, 'トラップゾーン', [trap])
}

// 総合ルール 第2部 第20章 3-6・3-8・3-8-a（ADR-0006）
describe('侵入', () => {
  it('相手のユニットがトリガーアイコンのスクエアに置かれると、発動条件が満たされる', () => {
    const after = checkIntrusion(withTrap(), intruder('後攻', targetSquare))

    expect(trapsMet(after)).toEqual(['トラップ'])
  })

  it('トリガーアイコンに描かれていないスクエアに置かれても発動条件は満たされない', () => {
    const after = checkIntrusion(withTrap(), intruder('後攻', otherSquare))

    expect(trapsMet(after)).toEqual([])
  })

  // 「相手のユニットが」なので、置いた本人が支配するトラップは対象にならない。
  it('自分のユニットがそのスクエアに置かれても発動条件は満たされない', () => {
    const after = checkIntrusion(withTrap(), intruder('先攻', targetSquare))

    expect(trapsMet(after)).toEqual([])
  })

  it('スクエアが書かれていない侵入のトリガーアイコンは、どのスクエアでも発動条件が満たされない', () => {
    const after = checkIntrusion(withTrap(trapWithoutSquares), intruder('後攻', targetSquare))

    expect(trapsMet(after)).toEqual([])
  })

  // 攻撃・スマッシュの発動条件は、侵入では満たされない。攻撃はバトルで（`checkAttack`）、
  // スマッシュはスマッシュの行動で（`checkSmash`）、別に判定する（ADR-0039）。
  it.each([
    ['攻撃', attackTrap],
    ['絞り込みつきの攻撃', filteredAttackTrap],
    ['スマッシュ', smashTrap],
  ])('%sのトリガーアイコンは、侵入が起きても発動条件が満たされない', (_kind, card) => {
    const after = checkIntrusion(withTrap(card), intruder('後攻', targetSquare))

    expect(trapsMet(after)).toEqual([])
  })

  // きっかけごとに 1 件ずつ持つ（ADR-0039）。最初のきっかけを持ち続ける暫定の扱い（単位 2）は
  // これに置き換わった。
  it('すでに発動条件が満たされていても、満たされるたびに 1 件ずつ足す', () => {
    const first = intruder('後攻', targetSquare)
    const second = { ...intruder('後攻', targetSquare), id: '2 体目のユニット' }
    const already: DuelState = { ...withTrap(), trapConditionsMet: [conditionMet(first)] }

    const after = checkIntrusion(already, second)

    expect(after.trapConditionsMet.map((met) => met.occasion)).toEqual([
      { kind: '侵入', invader: first },
      { kind: '侵入', invader: second },
    ])
  })

  // バトルとスマッシュ判定が始まった時のログの長さと比べる（`priority.ts` の `deferringRights`）。
  it('満たされた時のログの長さを、満たされた発動条件に持つ', () => {
    const state: DuelState = { ...withTrap(), log: [{} as DuelState['log'][number], {} as DuelState['log'][number]] }

    const after = checkIntrusion(state, intruder('後攻', targetSquare))

    expect(after.trapConditionsMet.map((met) => met.metAt)).toEqual([2])
  })

  // 侵入してきたユニットも、侵入されたスクエアも、発動する時の盤面からは引けない
  // （`ability.ts` の `IntrusionOccasion`）。満たされた発動条件と一緒に写して持つ。
  it('満たされた発動条件は、侵入してきたユニットをその瞬間の姿で持つ', () => {
    const invader = intruder('後攻', targetSquare)

    const after = checkIntrusion(withTrap(), invader)

    expect(after.trapConditionsMet).toEqual([{ trap: 'トラップ', occasion: { kind: '侵入', invader }, metAt: 0 }])
  })
})

// トリガーアイコンはムーブアイコンの矢印の向きと同じ理由で、支配者から見た向きで印刷されて
// いる（`board.ts` の `squareFromView`）（ADR-0006）。
describe('トリガーアイコンは支配者から見た向きで解釈される', () => {
  it('後攻のトラップでは、印刷されたスクエアが反対側の絶対スクエアに対応する', () => {
    const after = checkIntrusion(withTrap(trapWithIcon, '後攻'), intruder('先攻', mirroredSquare))

    expect(trapsMet(after)).toEqual(['トラップ'])
  })

  it('印刷されたスクエアそのものの絶対位置に置かれても、後攻のトラップでは反応しない', () => {
    const after = checkIntrusion(withTrap(trapWithIcon, '後攻'), intruder('先攻', targetSquare))

    expect(trapsMet(after)).toEqual([])
  })
})

/** バトルが起きるスクエア（絶対位置）。 */
const battleSquare: Square = { row: 0, column: 1 }

/** 絞り込みの 3 つの軸のどれでも確かめられるよう、記号・色・属性を 1 つずつ持つユニット。 */
const marked = defineUnit({
  name: 'テスト・印つき',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  makerSymbols: ['テスト記号'],
  attributes: ['テスト属性'],
})

/** 何も持たないユニット。 */
const plainUnit = defineUnit({ name: 'テスト・何も無し', level: 1, bp: 1000, sp: 1000 })

/** 「すべての味方は『テスト属性』としても扱う」。属性を継続効果で加える。 */
const attributeGranter = defineUnit({
  name: 'テスト・属性を加える',
  level: 1,
  bp: 1000,
  sp: 1000,
  abilities: [attributeAdding((duel) => duel.allies().map((ally) => alsoTreatedAs(ally, 'テスト属性')))],
})

function attackTrapWith(filter: TriggerFilter | undefined): TrapCard {
  return defineTrap({
    name: 'テスト・絞り込みを試す攻撃トラップ',
    level: 1,
    triggerIcon: filter === undefined ? { kind: '攻撃' } : { kind: '攻撃', filter },
  })
}

/** 攻撃したユニット（先攻）と攻撃されたユニット（後攻）。同じスクエアで重なっている。 */
function battlers(attackedCard = unitCard): { readonly attacker: UnitOnSquare; readonly attacked: UnitOnSquare } {
  return {
    attacker: { id: '攻撃したユニット', square: battleSquare, card: unitCard, controller: '先攻' },
    attacked: { id: '攻撃されたユニット', square: battleSquare, card: attackedCard, controller: '後攻' },
  }
}

// 総合ルール 第3部 第11章 1-1・4、第12章 1（ADR-0039、ADR-0006）。「攻撃された」がいつ満たされるかを
// 定めた条は無く、第１バトルステップで確かめるのは ADR-0039 の読みである。
describe('攻撃された', () => {
  it('攻撃されたユニットの支配者の攻撃のトラップは、発動条件が満たされる', () => {
    const { attacker, attacked } = battlers()

    const after = checkAttack(withTrap(attackTrap, '後攻'), attacker, attacked)

    expect(trapsMet(after)).toEqual(['トラップ'])
    expect(after.trapConditionsMet.map((met) => met.occasion)).toEqual([{ kind: '攻撃', attacker, attacked }])
  })

  it('攻撃したユニットの支配者のトラップは、発動条件が満たされない', () => {
    const { attacker, attacked } = battlers()

    expect(trapsMet(checkAttack(withTrap(attackTrap, '先攻'), attacker, attacked))).toEqual([])
  })

  it.each([
    ['侵入', defineTrap({ name: 'テスト・侵入', level: 1, triggerIcon: { kind: '侵入', squares: [battleSquare] } })],
    ['スマッシュ', smashTrap],
  ])('%sのトラップは、攻撃されても発動条件が満たされない', (_kind, card) => {
    const { attacker, attacked } = battlers()

    expect(trapsMet(checkAttack(withTrap(card, '後攻'), attacker, attacked))).toEqual([])
  })

  // トラップを持たない対戦では、盤面にも、ログにも、何も足さない。
  it('攻撃のトラップが無ければ、盤面をそのまま返す', () => {
    const { attacker, attacked } = battlers()
    const state = emptyDuelState()

    expect(checkAttack(state, attacker, attacked)).toBe(state)
  })

  it('満たされた時のログの長さを、満たされた発動条件に持つ', () => {
    const { attacker, attacked } = battlers()
    const state: DuelState = {
      ...withTrap(attackTrap, '後攻'),
      log: [{} as DuelState['log'][number], {} as DuelState['log'][number]],
    }

    expect(checkAttack(state, attacker, attacked).trapConditionsMet.map((met) => met.metAt)).toEqual([2])
  })

  // 絞り込みは、攻撃されたユニットがその軸でその値を持つ時だけ満たされる。
  it.each([
    ['メーカーシンボル', { axis: 'メーカーシンボル', value: 'テスト記号' }, { axis: 'メーカーシンボル', value: '別の記号' }],
    ['色', { axis: '色', value: '赤' }, { axis: '色', value: '青' }],
    ['属性', { axis: '属性', value: 'テスト属性' }, { axis: '属性', value: '別の属性' }],
  ] as const)('%sで絞り込んだ攻撃のトラップは、その値を持つユニットが攻撃された時だけ満たされる', (_axis, held, notHeld) => {
    const { attacker, attacked } = battlers(marked)

    expect(trapsMet(checkAttack(withTrap(attackTrapWith(held), '後攻'), attacker, attacked))).toEqual(['トラップ'])
    expect(trapsMet(checkAttack(withTrap(attackTrapWith(notHeld), '後攻'), attacker, attacked))).toEqual([])
  })

  it('絞り込みの無い攻撃のトラップは、どのユニットが攻撃されても満たされる', () => {
    const { attacker, attacked } = battlers(plainUnit)

    expect(trapsMet(checkAttack(withTrap(attackTrapWith(undefined), '後攻'), attacker, attacked))).toEqual(['トラップ'])
  })

  // 総合ルール 第4部 第12章 5-2 の(3)、ADR-0036。色を変える継続効果はまだ無いので、色は書かれている
  // 色のまま確かめる。属性を加える継続効果は、適用した後の姿で確かめる。
  describe('継続効果を適用した後の姿で確かめる', () => {
    const attributed = attackTrapWith({ axis: '属性', value: 'テスト属性' })
    /** 後攻のトラップと、後攻の「属性を加える」ユニットのいる盤面。攻撃されたユニットも同じ後攻。 */
    function withGranter(): DuelState {
      const granter = instantiate({ id: '属性を加えるユニット', card: attributeGranter, owner: '後攻' })
      const defender = instantiate({ id: '攻撃されたユニット', card: plainUnit, owner: '後攻' })
      return putOnSquare(putOnSquare(withTrap(attributed, '後攻'), { row: 0, column: 2 }, granter), battleSquare, defender)
    }

    it('継続効果で加わった属性を持つユニットが攻撃されると、その属性の絞り込みは満たされる', () => {
      const { attacker, attacked } = battlers(plainUnit)

      expect(trapsMet(checkAttack(withGranter(), attacker, attacked))).toEqual(['トラップ'])
    })

    it('継続効果が無ければ、書かれていない属性の絞り込みは満たされない', () => {
      const { attacker, attacked } = battlers(plainUnit)

      expect(trapsMet(checkAttack(withTrap(attributed, '後攻'), attacker, attacked))).toEqual([])
    })

    // 侵入の写し方（印刷された姿）と混ぜない。適用後の姿は判定にだけ使う。
    it('きっかけに写すのは、適用後の姿ではなく印刷された姿である', () => {
      const { attacker, attacked } = battlers(plainUnit)

      const after = checkAttack(withGranter(), attacker, attacked)
      const [met] = after.trapConditionsMet

      expect(met?.occasion.kind === '攻撃' && met.occasion.attacked.card).toBe(plainUnit)
    })
  })
})

// 総合ルール 第3部 第9章 1（ADR-0039、ADR-0006）。効果によるダメージを含めないのは、同条が
// この行動を「スマッシュする」と名づけていることによる読みで、条文に明示は無い。
describe('スマッシュされた', () => {
  const smasher: UnitOnSquare = { id: 'スマッシュしたユニット', square: mirroredSquare, card: unitCard, controller: '先攻' }

  it('相手のスマッシュのトラップは、発動条件が満たされる', () => {
    const after = checkSmash(withTrap(smashTrap, '後攻'), smasher)

    expect(trapsMet(after)).toEqual(['トラップ'])
    expect(after.trapConditionsMet.map((met) => met.occasion)).toEqual([{ kind: 'スマッシュ', smasher }])
  })

  it('スマッシュした本人のトラップは、発動条件が満たされない', () => {
    expect(trapsMet(checkSmash(withTrap(smashTrap, '先攻'), smasher))).toEqual([])
  })

  it.each([
    ['侵入', defineTrap({ name: 'テスト・侵入', level: 1, triggerIcon: { kind: '侵入', squares: [mirroredSquare] } })],
    ['攻撃', attackTrap],
  ])('%sのトラップは、スマッシュされても発動条件が満たされない', (_kind, card) => {
    expect(trapsMet(checkSmash(withTrap(card, '後攻'), smasher))).toEqual([])
  })

  it('スマッシュのトラップが無ければ、盤面をそのまま返す', () => {
    const state = emptyDuelState()

    expect(checkSmash(state, smasher)).toBe(state)
  })
})

// 総合ルール 第2部 第20章 3-8「１度でも優先権をパスすると...権利を失います」（ADR-0006）
describe('優先権のパスによる権利の喪失', () => {
  it('権利を得ているプレイヤーが優先権をパスすると、権利を失う', () => {
    const state: DuelState = { ...withTrap(), trapConditionsMet: [conditionMet()] }

    const after = loseTrapRightOnPass(state, '先攻')

    expect(trapsMet(after)).toEqual([])
  })

  it('相手が優先権をパスしても、自分のトラップの権利は失われない', () => {
    const state: DuelState = { ...withTrap(), trapConditionsMet: [conditionMet()] }

    const after = loseTrapRightOnPass(state, '後攻')

    expect(trapsMet(after)).toEqual(['トラップ'])
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
  startedAt: 0,
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
  startedAt: 0,
}

// 総合ルール 第2部 第20章 3-8 ただし書き、第3部 第11章 5・第17章 4、ADR-0039（ADR-0006）
describe('条件が満たされた後に発生したバトル・スマッシュ判定の間は、権利が発生しない', () => {
  /** 発動条件が満たされたトラップが、先攻のトラップゾーンにある盤面。満たされたのはログ長 0 の時点。 */
  function rightHeld(): DuelState {
    return { ...withTrap(), trapConditionsMet: [conditionMet()] }
  }

  /** 条件が満たされた後（ログ長 5）に始まったバトル。 */
  const battleAfter: Battle = { ...battleInProgress, startedAt: 5 }
  /** 条件が満たされる前（ログ長 1）から進行中のバトル。満たされたのはログ長 3。 */
  const battleBefore: Battle = { ...battleInProgress, startedAt: 1 }

  it('バトルもスマッシュ判定も無ければ、発動条件が満たされた時点で権利が発生している', () => {
    expect(trapRightsOf(rightHeld(), 'トラップ')).toHaveLength(1)
  })

  // 発動する効果はきっかけを必要とする（`effect.ts` の `TrapEffect`）ので、権利と一緒に返す。
  it('発生している権利は、発動条件を満たしたできごとを持っている', () => {
    const invader = intruder('後攻', targetSquare)
    const state: DuelState = { ...withTrap(), trapConditionsMet: [conditionMet(invader)] }

    expect(trapRightsOf(state, 'トラップ').map((met) => met.occasion)).toEqual([{ kind: '侵入', invader }])
  })

  it('発動条件が満たされていなければ権利は発生しない', () => {
    expect(trapRightsOf(withTrap(), 'トラップ')).toEqual([])
  })

  it('条件が満たされた後にバトルが始まったなら、その間は権利が発生しない', () => {
    expect(trapRightsOf({ ...rightHeld(), battles: [battleAfter] }, 'トラップ')).toEqual([])
  })

  it('条件が満たされるのと同じ時点で始まったバトルも、権利を止める', () => {
    expect(trapRightsOf({ ...rightHeld(), battles: [battleInProgress] }, 'トラップ')).toEqual([])
  })

  it('条件が満たされた後にスマッシュ判定が始まったなら、その間は権利が発生しない', () => {
    const judgment: SmashJudgment = { ...judgmentInProgress, startedAt: 5 }

    expect(trapRightsOf({ ...rightHeld(), smashJudgments: [judgment] }, 'トラップ')).toEqual([])
  })

  it('バトルが終了すると権利が発生する', () => {
    const during: DuelState = { ...rightHeld(), battles: [battleAfter] }

    expect(trapRightsOf({ ...during, battles: [] }, 'トラップ')).toHaveLength(1)
  })

  // 効果で置かれて侵入が起きた時。バトルは条件より前に発生しているので、権利を止めない
  // （ADR-0039）。
  it('条件より前から進行中のバトルは、権利を止めない', () => {
    const state: DuelState = { ...withTrap(), trapConditionsMet: [{ ...conditionMet(), metAt: 3 }], battles: [battleBefore] }

    expect(trapRightsOf(state, 'トラップ')).toHaveLength(1)
  })

  it('条件より前から進行中のスマッシュ判定は、権利を止めない', () => {
    const judgment: SmashJudgment = { ...judgmentInProgress, startedAt: 1 }
    const state: DuelState = {
      ...withTrap(),
      trapConditionsMet: [{ ...conditionMet(), metAt: 3 }],
      smashJudgments: [judgment],
    }

    expect(trapRightsOf(state, 'トラップ')).toHaveLength(1)
  })

  // バトル中のバトル（総合ルール 第3部 第11章 2-1・4-1）。先の件は先のバトルより後・後のバトルより前。
  it('権利は、止める手順がある件だけが止まる', () => {
    const early = { ...conditionMet(intruder('後攻', targetSquare)), metAt: 3 }
    const late = { ...conditionMet(intruder('後攻', mirroredSquare)), metAt: 8 }
    const state: DuelState = {
      ...withTrap(),
      trapConditionsMet: [early, late],
      battles: [battleBefore, { ...battleInProgress, startedAt: 6 }],
    }

    expect(trapRightsOf(state, 'トラップ')).toEqual([late])
  })

  // 権利を得ていないのだから、パスで失うこともない（同 3-8 は「権利を獲得した後...１度でも
  // 優先権をパスすると...権利を失います」であり、獲得が先にある）。バトルもスマッシュ判定も
  // ステップが連続した放棄で進む（同 第3部 第4章 4）ので、ここで失うなら終了まで遅らせる
  // 意味が無くなる。
  it('止まっている間に優先権をパスしても、発動条件が満たされた状態は残る', () => {
    const after = loseTrapRightOnPass({ ...rightHeld(), battles: [battleAfter] }, '先攻')

    expect(trapsMet(after)).toEqual(['トラップ'])
  })

  it('スマッシュ判定で止まっている間に優先権をパスしても、発動条件が満たされた状態は残る', () => {
    const judgment: SmashJudgment = { ...judgmentInProgress, startedAt: 5 }
    const after = loseTrapRightOnPass({ ...rightHeld(), smashJudgments: [judgment] }, '先攻')

    expect(trapsMet(after)).toEqual(['トラップ'])
  })

  it('条件より前から進行中のバトルの間に優先権をパスすれば、権利を失う', () => {
    const state: DuelState = { ...withTrap(), trapConditionsMet: [{ ...conditionMet(), metAt: 3 }], battles: [battleBefore] }

    expect(trapsMet(loseTrapRightOnPass(state, '先攻'))).toEqual([])
  })

  it('パスで失うのは権利が発生している件だけで、止まっている件は残る', () => {
    const early = { ...conditionMet(intruder('後攻', targetSquare)), metAt: 3 }
    const late = { ...conditionMet(intruder('後攻', mirroredSquare)), metAt: 8 }
    const state: DuelState = {
      ...withTrap(),
      trapConditionsMet: [early, late],
      battles: [battleBefore, { ...battleInProgress, startedAt: 6 }],
    }

    expect(loseTrapRightOnPass(state, '先攻').trapConditionsMet).toEqual([early])
  })
})
