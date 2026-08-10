import { describe, expect, it } from 'vitest'
// 手札やエネルギーゾーンを組み立てるためだけに `putInZone` を使う。engine の中から
// ゾーンを差し替えるための関数であり、公開する API ではない（`play.test.ts` と同じ）。
import { putInZone } from './duel.js'
import {
  cardsIn,
  cardsOn,
  defineTrap,
  defineUnit,
  emptyDuelState,
  genki,
  instantiate,
  passPriority,
  playAsTrap,
  playCard,
  putOnSquare,
  triggeredAbility,
} from './index.js'
import type {
  ActionOutcome,
  Battle,
  BattleStep,
  CardInstance,
  Chooser,
  DuelState,
  Player,
  Square,
  UnitCard,
} from './index.js'

/** 選択を求められたら常に最初の候補を選ぶ。どれを選ぶかを問わないテストで使う。 */
const chooseFirst: Chooser = (candidates) => candidates[0]

// 検証したいルールだけを持つ架空のテストカード（ADR-0002）。
const vanilla = defineUnit({ name: 'テスト・バニラ', level: 1, colors: ['赤'], bp: 3000, sp: 1000 })

/** ＢＰが小さいユニット。バトルダメージで先に捨札に置かれる側になる。 */
const weak = defineUnit({ name: 'テスト・小ＢＰ', level: 1, colors: ['赤'], bp: 1000, sp: 1000 })

/** 「元気」を持つ、ＢＰが小さいユニット（総合ルール 第5部 第8章）。 */
const genkiWeak = defineUnit({
  name: 'テスト・元気',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [genki],
})

/** ＢＰが 0 のユニット。置かれた時点でルールエフェクトによって捨札に置かれる。 */
const zeroBp = defineUnit({ name: 'テスト・ＢＰ0', level: 1, colors: ['赤'], bp: 0, sp: 1000 })

/** バトルの始めに誘発する 4 つのできごとをすべて持つユニット（総合ルール 第3部 第12章 1）。 */
const watcher = defineUnit({
  name: 'テスト・バトル見物',
  level: 1,
  colors: ['赤'],
  bp: 3000,
  sp: 1000,
  abilities: [
    triggeredAbility('バトルの始め', function* () {}),
    triggeredAbility('第１バトルステップの始め', function* () {}),
    triggeredAbility('攻撃した時', function* () {}),
    triggeredAbility('攻撃された時', function* () {}),
  ],
})

/** 「バトルに勝った時」に誘発する能力を持つ、ＢＰの大きいユニット。 */
const winnerUnit = defineUnit({
  name: 'テスト・勝った時',
  level: 1,
  colors: ['赤'],
  bp: 3000,
  sp: 1000,
  abilities: [triggeredAbility('バトルに勝った時', function* () {})],
})

/** 「バトルの終わりに」に誘発する能力を持つユニット。 */
const closer = defineUnit({
  name: 'テスト・バトルの終わりに',
  level: 1,
  colors: ['赤'],
  bp: 3000,
  sp: 1000,
  abilities: [triggeredAbility('バトルの終わりに', function* () {})],
})

/** 「登場した時」に誘発する能力を持つ、レベル 2 の赤いユニット。 */
const appearing = defineUnit({
  name: 'テスト・登場ユニット',
  level: 2,
  colors: ['赤'],
  bp: 3000,
  sp: 1000,
  abilities: [triggeredAbility('登場した時', function* () {})],
})

/** 先攻から見た味方エリア・中央エリアのスクエアと、バトルに関わらないスクエア。 */
const homeSquare: Square = { row: 0, column: 1 }
const centerSquare: Square = { row: 1, column: 1 }
const otherSquare: Square = { row: 0, column: 2 }

function pass(state: DuelState): DuelState {
  return passPriority(state, chooseFirst)
}

function unitOf(id: string, card: UnitCard, owner: Player): CardInstance {
  return instantiate({ id, card, owner })
}

/**
 * 後攻のユニットが先に置かれ、先攻のユニットが後から置かれたスクエアを持つ盤面。
 *
 * 後から置かれたほうが「攻撃したユニット」になる（総合ルール 第3部 第11章 4）。
 */
function facing(attacked: UnitCard, attacker: UnitCard, square: Square = homeSquare): DuelState {
  const board = putOnSquare(emptyDuelState(), square, unitOf('攻撃された', attacked, '後攻'))
  return putOnSquare(board, square, unitOf('攻撃した', attacker, '先攻'))
}

/**
 * バトルが発生したところの盤面。
 *
 * ルールエフェクトが解決されるのはプレイヤーが優先権を獲得する時（総合ルール 第4部
 * 第14章 2）なので、優先権を 1 度放棄させてそこまで進める。
 */
function battling(attacked: UnitCard, attacker: UnitCard, square: Square = homeSquare): DuelState {
  return pass(facing(attacked, attacker, square))
}

/** 進行中のステップ。バトルが終わっていれば `undefined`。 */
function stepOf(state: DuelState): BattleStep | undefined {
  return state.battle?.step
}

/**
 * バトル終了ステップのどこまで進んでいるか。
 *
 * バトル終了ステップだけは連続放棄を 2 度必要とする（総合ルール 第3部 第16章 2-1〜3）
 * ので、ステップ名だけでは進んだかどうかが分からない。
 */
function progressOf(state: DuelState): string {
  const { battle } = state
  if (battle === undefined) return 'バトルの終了後'
  return `${battle.step}${battle.endOfBattleTriggered ? '（勝敗の決定後）' : ''}`
}

/** 進行中のステップが終わるまで、両方のプレイヤーが優先権を放棄し続けた盤面。 */
function endStep(state: DuelState): DuelState {
  let current = state
  while (progressOf(current) === progressOf(state)) current = pass(current)
  return current
}

/** そのステップが始まったところまで進めた盤面。 */
function atStep(state: DuelState, step: BattleStep): DuelState {
  let current = state
  while (current.battle !== undefined && current.battle.step !== step) current = endStep(current)
  return current
}

/** バトルが終わるまで進めた盤面。 */
function afterBattle(state: DuelState): DuelState {
  let current = state
  while (current.battle !== undefined) current = endStep(current)
  return current
}

/** バンクにある能力を、発生源と誘発イベントの組で並べたもの。並びに意味はないので整列する。 */
function banked(state: DuelState): readonly string[] {
  return state.bank.map((each) => `${each.source}／${each.ability.event}`).sort()
}

const idsOf = (cards: readonly CardInstance[]) => cards.map((card) => card.id)

/** そのユニットが受けているダメージ。スクエアになければ `undefined`。 */
function damageOn(state: DuelState, square: Square, id: string): number | undefined {
  return cardsOn(state, square).find((card) => card.id === id)?.damage
}

/** 青いカード。レベルの枚数を満たすためだけのエネルギーに使う。 */
const blueCard = defineUnit({ name: 'テスト・青', level: 1, colors: ['青'], bp: 3000, sp: 1000 })

/** 発動しても何も起こらないトラップ。 */
const someTrap = defineTrap({ name: 'テスト・トラップ', level: 1, colors: ['赤'] })

/** 行えたはずの行動の結果の盤面。 */
function stateOf(outcome: ActionOutcome): DuelState {
  if (outcome.kind !== '行った') throw new Error(`行えなかった: ${outcome.violation}`)
  return outcome.state
}

/**
 * 敵のいるスクエアを指定して先攻がユニットをプレイし、バトルが発生したメインフェイズの盤面。
 *
 * バトルを起こす実際の行動はユニットのプレイである。盤面を直接組むかわりにプレイを通す
 * ことで、フェイズや優先権、待機中のバンクが実際の進行どおりになる。手札にはトラップも
 * 1 枚あり、バトル中に行動できるかどうかを試せるようにしてある。
 */
function battleByPlaying(square: Square, played: UnitCard = vanilla): DuelState {
  let current = emptyDuelState()
  while (current.turn.phase !== 'メインフェイズ') current = pass(current)

  const hand = [unitOf('攻撃した', played, '先攻'), instantiate({ id: 'トラップ', card: someTrap, owner: '先攻' })]
  const energies = [unitOf('赤エネ', vanilla, '先攻'), unitOf('青エネ', blueCard, '先攻')]
  const ready = putInZone(putInZone(pass(current), '先攻', '手札', hand), '先攻', 'エネルギーゾーン', energies)
  const board = putOnSquare(ready, square, unitOf('攻撃された', vanilla, '後攻'))

  return stateOf(playCard(board, { card: '攻撃した', square }, chooseFirst))
}

// 総合ルール 第3部 第11章 1、第4部 第14章 4-4（ADR-0006）
describe('バトルの発生', () => {
  it('支配者の異なる 2 つのユニットが同一のスクエアに置かれると発生する', () => {
    expect(battling(vanilla, vanilla).battle?.square).toEqual(homeSquare)
  })

  it('カードが置かれた時点ではまだ発生しない', () => {
    // ルールエフェクトが解決されるのは、プレイヤーが優先権を獲得する時である。
    expect(facing(vanilla, vanilla).battle).toBeUndefined()
  })

  // 総合ルール 第3部 第11章 4
  it('後から置かれたユニットが攻撃したユニット、先に置かれていたユニットが攻撃されたユニットになる', () => {
    const { battle } = battling(vanilla, vanilla)

    expect(battle?.attacker).toBe('攻撃した')
    expect(battle?.attacked).toBe('攻撃された')
  })

  it('支配者が同じユニットが重なってもバトルは発生しない', () => {
    const board = putOnSquare(emptyDuelState(), homeSquare, unitOf('先客', vanilla, '先攻'))
    const stacked = putOnSquare(board, homeSquare, unitOf('新入り', vanilla, '先攻'))

    expect(pass(stacked).battle).toBeUndefined()
  })

  // 総合ルール 第3部 第11章 1-1、第4部 第14章 4-4-1・4-4-2
  it('他のルールエフェクトで一方のユニットが捨札に置かれる場合、バトルは発生しない', () => {
    // ＢＰが 0 以下のユニットは捨札に置かれる（同 4-5）。バトル発生のルールエフェクトは
    // それより後に処理されるため、重なりは解消済みになっている。
    const checked = pass(facing(zeroBp, vanilla))

    expect(checked.battle).toBeUndefined()
    expect(idsOf(cardsOn(checked, homeSquare))).toEqual(['攻撃した'])
  })
})

// 総合ルール 第3部 第11章 3（ADR-0006）
describe('バトルのステップ', () => {
  /** バトルが終わるまでに通ったステップを、通った順に並べたもの。 */
  function stepsOf(state: DuelState): readonly BattleStep[] {
    const steps: BattleStep[] = []
    for (let current = state; current.battle !== undefined; current = endStep(current)) {
      const step = stepOf(current)
      if (step !== undefined && step !== steps.at(-1)) steps.push(step)
    }
    return steps
  }

  it('5 つのステップを総合ルールの順に行う', () => {
    expect(stepsOf(battling(vanilla, vanilla))).toEqual([
      '第１バトルステップ',
      '第１ダメージステップ',
      '第２バトルステップ',
      '第２ダメージステップ',
      'バトル終了ステップ',
    ])
  })

  // 総合ルール 第3部 第4章 4: バトル中に連続して優先権が放棄されると、終了するのは
  // フェイズではなくステップである。
  it('連続放棄で終わるのはステップであって、フェイズではない', () => {
    const battle = battling(vanilla, vanilla)
    const next = endStep(battle)

    expect(next.turn.phase).toBe(battle.turn.phase)
    expect(stepOf(next)).toBe('第１ダメージステップ')
  })

  it('バトルが終わると、フェイズの進行に戻る', () => {
    const battle = battling(vanilla, vanilla)
    const ended = afterBattle(battle)

    expect(ended.battle).toBeUndefined()
    expect(ended.turn.phase).toBe(battle.turn.phase)
    // フェイズの連続放棄で次のフェイズに進む。
    expect(pass(pass(ended)).turn.phase).not.toBe(battle.turn.phase)
  })

  // 総合ルール 第3部 第12章 1 ほか、各ステップの 1
  it('ステップが進むたびに、非アクティブプレイヤーが優先権を獲得する', () => {
    const battle = battling(vanilla, vanilla)

    expect(battle.turn.priority).toBe('後攻')
    expect(endStep(battle).turn.priority).toBe('後攻')
  })
})

// 総合ルール 第3部 第12章 1（ADR-0006）
describe('第１バトルステップ', () => {
  it('「バトルの始め」「第１バトルステップの始め」「攻撃した時」「攻撃された時」がバンクに入る', () => {
    expect(banked(battling(watcher, watcher))).toEqual(
      [
        '攻撃した／バトルの始め',
        '攻撃された／バトルの始め',
        '攻撃した／第１バトルステップの始め',
        '攻撃された／第１バトルステップの始め',
        '攻撃した／攻撃した時',
        '攻撃された／攻撃された時',
      ].sort(),
    )
  })

  // 総合ルール 第3部 第11章 4: 攻撃したのは後から置かれたユニットだけである。
  it('「攻撃した時」は攻撃したユニットだけ、「攻撃された時」は攻撃されたユニットだけが誘発する', () => {
    const banks = banked(battling(watcher, watcher))

    expect(banks).not.toContain('攻撃された／攻撃した時')
    expect(banks).not.toContain('攻撃した／攻撃された時')
  })
})

// 総合ルール 第3部 第13章 1・第15章 1（ADR-0006）
describe('バトルダメージの応酬', () => {
  // 総合ルール 第5部 第8章 2
  it('「元気」を持つユニットは第１ダメージステップにダメージを与える', () => {
    const damaged = atStep(battling(vanilla, genkiWeak), '第１ダメージステップ')

    expect(damageOn(damaged, homeSquare, '攻撃された')).toBe(1000)
    expect(damageOn(damaged, homeSquare, '攻撃した')).toBe(0)
  })

  it('「元気」を持たないユニットは第２ダメージステップにダメージを与える', () => {
    const first = atStep(battling(vanilla, genkiWeak), '第１ダメージステップ')
    const second = atStep(first, '第２ダメージステップ')

    // 攻撃したユニットは第１ダメージステップで与えているので、ここでは与えない。
    expect(damageOn(second, homeSquare, '攻撃された')).toBe(1000)
    // 攻撃されたユニット（ＢＰ3000）が、ＢＰ1000 の攻撃したユニットにダメージを与える。
    expect(damageOn(second, homeSquare, '攻撃した')).toBeUndefined()
    expect(idsOf(cardsIn(second, '先攻', '捨札'))).toEqual(['攻撃した'])
  })

  // 総合ルール 第3部 第13章 2: 両方のユニットが「元気」を持っている場合、両方のダメージが
  // 同時に与えられる。
  it('どちらも「元気」を持てば、第１ダメージステップに両方が同時に与える', () => {
    const first = atStep(battling(genkiWeak, genkiWeak), '第１ダメージステップ')

    // 同じＢＰどうしなので、両方がＢＰと同じダメージを受けて捨札に置かれる。
    expect(cardsOn(first, homeSquare)).toEqual([])
    expect(idsOf(cardsIn(first, '先攻', '捨札'))).toEqual(['攻撃した'])
    expect(idsOf(cardsIn(first, '後攻', '捨札'))).toEqual(['攻撃された'])
  })

  // 総合ルール 第3部 第15章 2: ひとかたまりの効果として同時に解決される。
  it('どちらも「元気」を持たなければ、第２ダメージステップに両方が同時に与える', () => {
    const first = atStep(battling(vanilla, vanilla), '第１ダメージステップ')

    expect(damageOn(first, homeSquare, '攻撃された')).toBe(0)
    expect(damageOn(first, homeSquare, '攻撃した')).toBe(0)

    // 同じＢＰどうしなので、両方がＢＰと同じダメージを受けて捨札に置かれる。
    const second = atStep(first, '第２ダメージステップ')

    expect(cardsOn(second, homeSquare)).toEqual([])
    expect(idsOf(cardsIn(second, '先攻', '捨札'))).toEqual(['攻撃した'])
    expect(idsOf(cardsIn(second, '後攻', '捨札'))).toEqual(['攻撃された'])
  })

  it('バトルを発生させたユニットの一方がスクエアを離れていれば、バトルダメージは発生しない', () => {
    // ＢＰ1000 の「元気」持ちが第１ダメージステップでＢＰ1000 の相手を捨札に送るので、
    // 第２ダメージステップにはもう一方がいない。
    const first = atStep(battling(weak, genkiWeak), '第１ダメージステップ')

    expect(cardsOn(first, homeSquare).map((card) => card.id)).toEqual(['攻撃した'])

    const second = atStep(first, '第２ダメージステップ')

    expect(damageOn(second, homeSquare, '攻撃した')).toBe(0)
  })
})

// 総合ルール 第3部 第14章 1・第16章 1（ADR-0006）
describe('ステップの始めに誘発する能力', () => {
  /** そのできごとに誘発する能力だけを持つユニットが、バトルの外のスクエアにいる盤面。 */
  function watching(event: '第２バトルステップの始め' | 'バトル終了ステップの始め'): DuelState {
    const card = defineUnit({
      name: `テスト・${event}`,
      level: 1,
      colors: ['赤'],
      bp: 3000,
      sp: 1000,
      abilities: [triggeredAbility(event, function* () {})],
    })
    return putOnSquare(battling(vanilla, vanilla), otherSquare, unitOf('見物人', card, '先攻'))
  }

  it('第２バトルステップが始まると「第２バトルステップの始め」がバンクに入る', () => {
    const step = atStep(watching('第２バトルステップの始め'), '第２バトルステップ')

    expect(banked(step)).toEqual(['見物人／第２バトルステップの始め'])
  })

  it('バトル終了ステップが始まると「バトル終了ステップの始め」がバンクに入る', () => {
    const step = atStep(watching('バトル終了ステップの始め'), 'バトル終了ステップ')

    expect(banked(step)).toEqual(['見物人／バトル終了ステップの始め'])
  })
})

// 総合ルール 第3部 第16章 1・1-1（ADR-0006）
describe('バトルの勝敗', () => {
  it('いずれかひとつのユニットだけが残っていれば、そのユニットが勝者になる', () => {
    // ＢＰ1000 の攻撃したユニットが、ＢＰ3000 の攻撃されたユニットのダメージで捨札に置かれる。
    const end = atStep(battling(winnerUnit, weak), 'バトル終了ステップ')

    expect(banked(end)).toEqual(['攻撃された／バトルに勝った時'])
  })

  it('両方のユニットが残っていなければ引き分けになる', () => {
    // 同じＢＰどうしなので、第２ダメージステップで両方が捨札に置かれる。
    const end = atStep(battling(winnerUnit, vanilla), 'バトル終了ステップ')

    expect(cardsOn(end, homeSquare)).toEqual([])
    expect(banked(end)).toEqual([])
  })
})

// 総合ルール 第3部 第16章 2-1〜3、第4部 第14章 4-11（ADR-0006）
describe('バトル終了ステップの終わり', () => {
  /**
   * 両方のユニットがスクエアに残ったまま勝敗が決定した、バトル終了ステップの盤面。
   *
   * 印刷されたＢＰだけではこの形にならない。バトルダメージの応酬は必ず一方をＢＰと同じか
   * それ以上のダメージに追い込む（`exchangeBattleDamage`）ためで、スクエアを離れたユニットを
   * 戻す効果やＢＰの修整が書けるようになるまで、実際のバトルからは再現できない。ルール
   * エフェクト自体は総合ルールにあるので、盤面を直接組んで検証する。
   */
  function bothRemaining(): DuelState {
    const state = battling(vanilla, vanilla)
    const battle = state.battle
    if (battle === undefined) throw new Error('バトルが発生しているはずだった')

    const decided: Battle = { ...battle, step: 'バトル終了ステップ' }
    return { ...state, battle: decided }
  }

  it('両方のユニットが残っていれば、攻撃側のユニットが持ち主の捨札に置かれる', () => {
    const resolved = endStep(bothRemaining())

    expect(idsOf(cardsOn(resolved, homeSquare))).toEqual(['攻撃された'])
    expect(idsOf(cardsIn(resolved, '先攻', '捨札'))).toEqual(['攻撃した'])
  })

  // 総合ルール 第3部 第16章 2-3
  it('ルールエフェクトを解決した後、「バトルの終わりに」の能力が誘発する', () => {
    const withCloser = putOnSquare(battling(vanilla, vanilla), otherSquare, unitOf('見届け役', closer, '先攻'))
    const end = atStep(withCloser, 'バトル終了ステップ')

    expect(banked(end)).toEqual([])
    expect(banked(endStep(end))).toEqual(['見届け役／バトルの終わりに'])
  })

  // 総合ルール 第3部 第16章 3
  it('その後の連続放棄でバトル終了ステップが終わり、バトルが終了する', () => {
    const end = atStep(battling(vanilla, vanilla), 'バトル終了ステップ')

    expect(endStep(end).battle?.endOfBattleTriggered).toBe(true)
    expect(endStep(endStep(end)).battle).toBeUndefined()
  })
})

// 総合ルール 第2部 第20章 3-1「バトル中以外の自分のメインフェイズの間」（ADR-0006）
describe('バトル中の行動', () => {
  it('アクティブプレイヤーは、自分のメインフェイズに優先権を持っていても行動できない', () => {
    // バトルの始めには非アクティブプレイヤーに優先権が発生するので、放棄させて戻す。
    const inBattle = pass(battleByPlaying(homeSquare))

    expect(inBattle.battle).toBeDefined()
    expect(inBattle.turn.phase).toBe('メインフェイズ')
    expect(inBattle.turn.priority).toBe('先攻')
    expect(playAsTrap(inBattle, 'トラップ')).toEqual({ kind: '行えない', violation: '行える時ではない' })
  })

  it('バトルが終われば、同じフェイズで行動できるようになる', () => {
    const ended = afterBattle(battleByPlaying(homeSquare))

    expect(ended.turn.phase).toBe('メインフェイズ')
    expect(idsOf(cardsIn(stateOf(playAsTrap(pass(ended), 'トラップ')), '先攻', 'トラップゾーン'))).toEqual([
      'トラップ',
    ])
  })
})

// 総合ルール 第3部 第11章 2（ADR-0006）
describe('バトルによって待機中のバンク', () => {
  it('バトルが発生した時に予約されていた能力は、バトルが終わってから解決される', () => {
    const battle = battleByPlaying(homeSquare, appearing)

    // 「登場した時」の能力はバンクに入ることが予約された状態で待機中のバンクになり、
    // バトル中は存在しないものとして扱われる。
    expect(battle.battle?.heldTriggered.map((each) => each.source)).toEqual(['攻撃した'])
    expect(battle.bank).toEqual([])
    expect(battle.triggered).toEqual([])

    // バトルが終了すると、通常のバンクに戻って処理される（同 4）。
    expect(banked(afterBattle(battle))).toEqual(['攻撃した／登場した時'])
  })

  it('バトル中に誘発した能力は、待機中のバンクとは別に解決される', () => {
    const withCloser = putOnSquare(battleByPlaying(homeSquare, appearing), otherSquare, unitOf('見届け役', closer, '先攻'))
    const end = endStep(atStep(withCloser, 'バトル終了ステップ'))

    // 「バトルの終わりに」はバトル中の新しいバンクに入り、待機中の「登場した時」はまだ入らない。
    expect(banked(end)).toEqual(['見届け役／バトルの終わりに'])
  })
})

// 総合ルール 第4部 第14章 4-10、第3部 第16章 2-2（ADR-0006）
describe('中央エリアを指定してプレイされたユニット', () => {
  it('バトルが発生したなら、バトル中は捨札に置かれない', () => {
    const battle = battleByPlaying(centerSquare)

    expect(battle.battle).toBeDefined()
    expect(idsOf(cardsOn(battle, centerSquare))).toEqual(['攻撃された', '攻撃した'])
  })

  it('バトル終了時に、ルールエフェクトによって持ち主の捨札に置かれる', () => {
    const ended = afterBattle(battleByPlaying(centerSquare))

    expect(cardsOn(ended, centerSquare)).toEqual([])
    expect(idsOf(cardsIn(ended, '先攻', '捨札'))).toEqual(['攻撃した'])
  })
})
