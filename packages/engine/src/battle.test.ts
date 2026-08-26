import { describe, expect, it } from 'vitest'
// 手札やエネルギーゾーンを組み立てるためだけに `putInZone` を使う。engine の中から
// ゾーンを差し替えるための関数であり、公開する API ではない（`play.test.ts` と同じ）。
import { putInZone } from './duel.js'
import {
  PLAYERS,
  cardsIn,
  cardsOn,
  defineTrap,
  defineUnit,
  emptyDuelState,
  instantiate,
  passOutcome,
  passPriority,
  pep,
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

/** ＢＰが大きいユニット。バトルダメージでは捨札に置かれない側になる。 */
const strong = defineUnit({ name: 'テスト・大ＢＰ', level: 1, colors: ['赤'], bp: 5000, sp: 1000 })

/** 「元気」を持つ、ＢＰが小さいユニット（総合ルール 第5部 第8章）。 */
const pepWeak = defineUnit({
  name: 'テスト・元気',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [pep],
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

/** あなたのユニットがスクエアから捨札に置かれるたびに誘発する能力を持つユニット。 */
const discardWatcher = defineUnit({
  name: 'テスト・あなたのユニットの捨札',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [
    triggeredAbility('あなたのユニットがスクエアから捨札に置かれた時', function* () {}),
  ],
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
  const board = putOnSquare(stockedDuelState(), square, unitOf('攻撃された', attacked, '後攻'))
  return putOnSquare(board, square, unitOf('攻撃した', attacker, '先攻'))
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
        Array.from({ length: 10 }, (_, index) => unitOf(`${player}の山札${index}`, vanilla, player)),
      ),
    emptyDuelState(),
  )
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

/** 処理中のバトル（並びの最後）。無ければ `undefined`。 */
function currentBattle(state: DuelState): Battle | undefined {
  return state.battles.at(-1)
}

/** 進行中のステップ。バトルが終わっていれば `undefined`。 */
function stepOf(state: DuelState): BattleStep | undefined {
  return currentBattle(state)?.step
}

/**
 * バトル終了ステップのどこまで進んでいるか。
 *
 * バトル終了ステップだけは連続放棄を 2 度必要とする（総合ルール 第3部 第16章 2-1〜3）
 * ので、ステップ名だけでは進んだかどうかが分からない。
 */
function progressOf(state: DuelState): string {
  const battle = currentBattle(state)
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
  while (currentBattle(current) !== undefined && currentBattle(current)?.step !== step) current = endStep(current)
  return current
}

/** バトルが終わるまで進めた盤面。 */
function afterBattle(state: DuelState): DuelState {
  let current = state
  while (currentBattle(current) !== undefined) current = endStep(current)
  return current
}

/** バトル終了ステップに直接置いた盤面。実際のステップ進行では作れない盤面の検証に使う。 */
function atEndStepDirectly(state: DuelState): DuelState {
  const battle = currentBattle(state)
  if (battle === undefined) throw new Error('バトルが発生しているはずだった')

  const decided: Battle = { ...battle, step: 'バトル終了ステップ' }
  return { ...state, battles: [...state.battles.slice(0, -1), decided] }
}

/** バンクにある能力を、発生源と誘発イベントの組で並べたもの。並びに意味はないので整列する。 */
function banked(state: DuelState): readonly string[] {
  return state.bank
    .map((each) =>
      each.ability.kind === '誘発型能力'
        ? `${each.source}／${each.ability.event}`
        : `作成された能力／${each.ability.trigger}`,
    )
    .sort()
}

const idsOf = (cards: readonly CardInstance[]) => cards.map((card) => card.id)

/**
 * ルールエフェクトで捨札に置かれたことの記録を、積まれた順に並べたもの。
 *
 * ログはできごとと、その時の見え方の組で積まれている（`log.ts` の `RecordedEvent`）。
 * ここで見たいのは起きたことだけなので、できごとの側だけを取り出す。
 */
function discardedByRule(state: DuelState): readonly (readonly string[])[] {
  return state.log.flatMap(({ event }) => (event.kind === 'ルールで捨札に置かれた' ? [event.cards] : []))
}

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
  let current = stockedDuelState()
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
    expect(currentBattle(battling(vanilla, vanilla))?.square).toEqual(homeSquare)
  })

  it('カードが置かれた時点ではまだ発生しない', () => {
    // ルールエフェクトが解決されるのは、プレイヤーが優先権を獲得する時である。
    expect(currentBattle(facing(vanilla, vanilla))).toBeUndefined()
  })

  // 総合ルール 第3部 第11章 4
  it('後から置かれたユニットが攻撃したユニット、先に置かれていたユニットが攻撃されたユニットになる', () => {
    const battle = currentBattle(battling(vanilla, vanilla))

    expect(battle?.attacker).toBe('攻撃した')
    expect(battle?.attacked).toBe('攻撃された')
  })

  it('支配者が同じユニットが重なってもバトルは発生しない', () => {
    const board = putOnSquare(stockedDuelState(), homeSquare, unitOf('先客', vanilla, '先攻'))
    const stacked = putOnSquare(board, homeSquare, unitOf('新入り', vanilla, '先攻'))

    expect(currentBattle(pass(stacked))).toBeUndefined()
  })

  // 総合ルール 第3部 第11章 1-1、第4部 第14章 4-4-1・4-4-2
  it('他のルールエフェクトで一方のユニットが捨札に置かれる場合、バトルは発生しない', () => {
    // ＢＰが 0 以下のユニットは捨札に置かれる（同 4-5）。バトル発生のルールエフェクトは
    // それより後に処理されるため、重なりは解消済みになっている。
    const checked = pass(facing(zeroBp, vanilla))

    expect(currentBattle(checked)).toBeUndefined()
    expect(idsOf(cardsOn(checked, homeSquare))).toEqual(['攻撃した'])
  })
})

// 総合ルール 第3部 第11章 3（ADR-0006）
describe('バトルのステップ', () => {
  /** バトルが終わるまでに通ったステップを、通った順に並べたもの。 */
  function stepsOf(state: DuelState): readonly BattleStep[] {
    const steps: BattleStep[] = []
    for (let current = state; currentBattle(current) !== undefined; current = endStep(current)) {
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

    expect(currentBattle(ended)).toBeUndefined()
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

  /**
   * 総合ルール 第3部 第11章 3: それぞれのステップは、何も起こらない場合でも存在する。
   *
   * #133。**始まりだけを積む。** ステップは一直線に置き換わるので、次の始まりが前の終わりを
   * 兼ねる。どのステップのダメージだったのかは、この区切りが無いとログから読めない。
   */
  it('ステップの区切りが、通った順にログへ積まれる', () => {
    const ended = afterBattle(battling(vanilla, vanilla))
    const steps = ended.log
      .map(({ event }) => event)
      .flatMap((event) => (event.kind === 'バトルのステップが変わった' ? [event.step] : []))

    expect(steps).toEqual([
      '第１バトルステップ',
      '第１ダメージステップ',
      '第２バトルステップ',
      '第２ダメージステップ',
      'バトル終了ステップ',
    ])
  })

  /**
   * #133。手順の見出しは、その手順の外側に立つ（`log.ts` の `LoggedEvent.during`）。
   * バトルの始まりと終わりが同じ深さに並び、その間のできごとが 1 つ深くなる。
   */
  it('バトルの始まりと終わりは、その中のできごとより浅いところに積まれる', () => {
    const ended = afterBattle(battling(vanilla, vanilla))
    const depths = new Map(
      ended.log.map(({ event, during }): readonly [string, number] => [event.kind, during.length]),
    )

    expect(depths.get('バトルが始まった')).toBe(0)
    expect(depths.get('バトルが終わった')).toBe(0)
    expect(depths.get('バトルのステップが変わった')).toBe(1)
    expect(depths.get('バトルダメージを与えた')).toBe(1)
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
    const damaged = atStep(battling(vanilla, pepWeak), '第１ダメージステップ')

    expect(damageOn(damaged, homeSquare, '攻撃された')).toBe(1000)
    expect(damageOn(damaged, homeSquare, '攻撃した')).toBe(0)
  })

  it('「元気」を持たないユニットは第２ダメージステップにダメージを与える', () => {
    const first = atStep(battling(vanilla, pepWeak), '第１ダメージステップ')
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
    const first = atStep(battling(pepWeak, pepWeak), '第１ダメージステップ')

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
    const first = atStep(battling(weak, pepWeak), '第１ダメージステップ')

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
   * カードに書かれているＢＰだけではこの形にならない。バトルダメージの応酬は必ず一方をＢＰと同じか
   * それ以上のダメージに追い込む（`exchangeBattleDamage`）ためで、スクエアを離れたユニットを
   * 戻す効果やＢＰの修整が書けるようになるまで、実際のバトルからは再現できない。ルール
   * エフェクト自体は総合ルールにあるので、盤面を直接組んで検証する。
   */
  function bothRemaining(): DuelState {
    return atEndStepDirectly(battling(vanilla, vanilla))
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

    expect(currentBattle(endStep(end))?.endOfBattleTriggered).toBe(true)
    expect(currentBattle(endStep(endStep(end)))).toBeUndefined()
  })
})

// 総合ルール 第2部 第20章 3-1「バトル中以外の自分のメインフェイズの間」（ADR-0006）
describe('バトル中の行動', () => {
  it('アクティブプレイヤーは、自分のメインフェイズに優先権を持っていても行動できない', () => {
    // バトルの始めには非アクティブプレイヤーに優先権が発生するので、放棄させて戻す。
    const inBattle = pass(battleByPlaying(homeSquare))

    expect(currentBattle(inBattle)).toBeDefined()
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
    expect(currentBattle(battle)?.heldTriggered.map((each) => each.source)).toEqual(['攻撃した'])
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

/**
 * #130。バトルの最中に終わるのはフェイズではなくステップである（総合ルール 第3部 第4章 4）。
 * 押す前に何が起きるかを言う側も、そこを取り違えない。
 */
describe('バトル中に放棄したら何が起きるか', () => {
  it('進むのはステップだと言う', () => {
    const battle = pass(battling(vanilla, vanilla))

    expect(currentBattle(battle)).toBeDefined()
    expect(passOutcome(battle)).toEqual({ kind: 'ステップが進む' })
  })
})

// 総合ルール 第4部 第14章 4-10、第3部 第16章 2-2（ADR-0006）
describe('中央エリアを指定してプレイされたユニット', () => {
  it('バトルが発生したなら、バトル中は捨札に置かれない', () => {
    const battle = battleByPlaying(centerSquare)

    expect(currentBattle(battle)).toBeDefined()
    expect(idsOf(cardsOn(battle, centerSquare))).toEqual(['攻撃された', '攻撃した'])
  })

  it('バトル終了時に、ルールエフェクトによって持ち主の捨札に置かれる', () => {
    const ended = afterBattle(battleByPlaying(centerSquare))

    expect(cardsOn(ended, centerSquare)).toEqual([])
    expect(idsOf(cardsIn(ended, '先攻', '捨札'))).toEqual(['攻撃した'])
  })

  // 総合ルール 第4部 第14章 4-6・4-10（ADR-0006）
  it('バトルに負けて先に捨札へ置かれたなら、バトル終了時にもう一度は記録されない', () => {
    const ended = afterBattle(battleByPlaying(centerSquare, weak))

    // バトルダメージで捨札に置かれる（同 4-6）のは 1 度きりで、その後のバトル終了時に
    // 中央エリア指定（同 4-10）で置き直されることはない。もう一度置かれるものは無いので、
    // できごとも積まれない。
    expect(idsOf(cardsIn(ended, '先攻', '捨札'))).toEqual(['攻撃した'])
    expect(discardedByRule(ended)).toEqual([['攻撃した']])
  })

  // 総合ルール 第4部 第14章 4-6・4-10（ADR-0006）
  it('バトルに勝ったなら、負けた相手とは別に、バトル終了時に捨札へ置かれる', () => {
    const ended = afterBattle(battleByPlaying(centerSquare, strong))

    // 2 回積まれるが、別のカードである。負けた相手（同 4-6）と、中央エリアを指定して
    // プレイされたユニット（同 4-10）が、それぞれ捨札に置かれる。
    expect(idsOf(cardsIn(ended, '後攻', '捨札'))).toEqual(['攻撃された'])
    expect(idsOf(cardsIn(ended, '先攻', '捨札'))).toEqual(['攻撃した'])
    expect(discardedByRule(ended)).toEqual([['攻撃された'], ['攻撃した']])
  })

  /**
   * #160。勝敗はバトル終了ステップの**開始時**に判定される（総合ルール 第3部 第16章 1-1）。
   * 中央エリアを指定してプレイされたユニットが捨札に置かれるのはその後（同 2-2）なので、
   * **勝った結果として置かれた**ことが並びから読める。
   */
  it('勝敗が決まった行は、中央エリア指定で捨札に置かれた行より前に出る', () => {
    const ended = afterBattle(battleByPlaying(centerSquare, strong))
    const kinds = ended.log
      .map(({ event }) => event.kind)
      .filter(
        (kind) =>
          kind === 'バトルの勝敗が決まった' || kind === 'ルールで捨札に置かれた' || kind === 'バトルが終わった',
      )

    expect(kinds).toEqual([
      // バトルダメージで負けた相手（同 第4部 第14章 4-6）。ダメージステップで置かれる。
      'ルールで捨札に置かれた',
      'バトルの勝敗が決まった',
      // 中央エリアを指定してプレイされたユニット（同 4-10）。
      'ルールで捨札に置かれた',
      'バトルが終わった',
    ])
  })

  // 総合ルール 第4部 第7章 6、第14章 4-10・4-11（ADR-0006）
  it(
    '攻撃側と中央エリア指定の両方に該当しても、1 回の捨札への移動につき能力は 1 回だけ誘発する',
    () => {
      const watching = putOnSquare(
        battleByPlaying(centerSquare),
        otherSquare,
        unitOf('見届け役', discardWatcher, '先攻'),
      )
      const atEnd = atEndStepDirectly(watching)
      const resolved = endStep(atEnd)

      expect(banked(resolved)).toEqual([
        '見届け役／あなたのユニットがスクエアから捨札に置かれた時',
      ])
      // 移動が 1 回なら、記録も 1 回である。
      expect(discardedByRule(resolved)).toEqual([['攻撃した']])
    },
  )
})
