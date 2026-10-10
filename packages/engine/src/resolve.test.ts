import { describe, expect, it } from 'vitest'
// 手札を組み立てるためだけに `putInZone` を使う。engine の中からゾーンを
// 差し替えるための関数であり、公開する API ではない。
import { putInZone } from './duel.js'
import {
  AREAS,
  areaOf,
  cardsIn,
  cardsOn,
  choose,
  chooseAtMostOne,
  createTriggeredAbility,
  damagePlayer,
  damageUnit,
  defineUnit,
  destroy,
  drawCards,
  emptyDuelState,
  flipPlan,
  freeze,
  guts,
  instantiate,
  placeInZone,
  placeOnSquare,
  placeTopOfLibrary,
  indexOfSquare,
  putOnSquare,
  release,
  resolveEffect,
  squaresBeside,
  triggeredAbility,
} from './index.js'
import type {
  Area,
  CardInZone,
  CardInstance,
  Chooser,
  DuelState,
  Effect,
  ResolutionVia,
  Square,
  UnitOnSquare,
} from './index.js'

/**
 * このファイルのテストはどの経路で解決されたかを見ていないので、決め打ちで 1 つ使い回す
 * （#104）。経路そのものを見るテストは `log.test.ts` に置く。
 */
const VIA: ResolutionVia = '誘発'

/**
 * 検証したいルールだけを持つ架空のテストカード（ADR-0002）。
 *
 * カードの実装が engine の公開 API だけで書けていることが、このカードそのもので示される。
 * 盤面に触れているところはひとつもない。
 */
const enterAndDestroy = defineUnit({
  name: 'テスト・登場破壊',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [
    triggeredAbility('登場した時', function* (duel) {
      const enemy = yield* choose(duel.enemies())
      if (enemy !== undefined) yield* destroy(enemy)
    }),
  ],
})

const vanilla = defineUnit({ name: 'テスト・バニラ', level: 1, colors: ['赤'], bp: 1000, sp: 1000 })

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

const [enterAbility] = enterAndDestroy.abilities
if (enterAbility === undefined || enterAbility.kind !== '誘発型能力') {
  throw new Error('テストカードに誘発型能力が定義されていない')
}

/** 「1 枚まで選び」を持つテストカード。上のカードとの違いは、選ばないことも選べる点だけ。 */
const enterAndMaybeDestroy = defineUnit({
  name: 'テスト・登場任意破壊',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [
    triggeredAbility('登場した時', function* (duel) {
      const enemy = yield* chooseAtMostOne(duel.enemies())
      // 選ばれなかった時に何もしないのは、カードの側が決める。
      if (enemy !== undefined) yield* destroy(enemy)
    }),
  ],
})

const [maybeAbility] = enterAndMaybeDestroy.abilities
if (maybeAbility === undefined || maybeAbility.kind !== '誘発型能力') {
  throw new Error('テストカードに誘発型能力が定義されていない')
}

const mySquare: Square = { row: 2, column: 1 }
const enemySquare: Square = { row: 0, column: 1 }
const nextEnemySquare: Square = { row: 0, column: 2 }

const chooseFirst: Chooser = (candidates) => candidates[0]

/**
 * できごとの記録を除いた盤面（#95）。
 *
 * 「実行できない行動は実行されず、盤面は変わらない」ことを見るのに使う。**選んだことは
 * 記録に残る**（`log.ts`）ので、記録まで含めると同じにはならない。記録はルールの判断に
 * 使われないので、盤面が変わっていないことはこれで見てよい。
 */
function withoutLog(state: DuelState): Omit<DuelState, 'log'> {
  const { log, ...board } = state
  return board
}

function boardOf(...placements: readonly (readonly [Square, CardInstance])[]): DuelState {
  return placements.reduce((state, [square, card]) => putOnSquare(state, square, card), emptyDuelState())
}

const mine = () => instantiate({ id: '味方', card: enterAndDestroy, owner: '先攻' })
const maybeMine = () => instantiate({ id: '味方', card: enterAndMaybeDestroy, owner: '先攻' })
const theirs = (id: string) => instantiate({ id, card: vanilla, owner: '後攻' })

const idsOf = (cards: readonly CardInstance[]) => cards.map((card) => card.id)

describe('テストカードの能力を解決する', () => {
  // 総合ルール 第2部 第21章 1-5・5-1（ADR-0006）
  it('選ばれた敵はスクエアから持ち主の捨札の一番上に置かれる', () => {
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵')])

    const resolved = resolveEffect(state, enterAbility.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(cardsOn(resolved, enemySquare)).toEqual([])
    expect(idsOf(cardsIn(resolved, '後攻', '捨札'))).toEqual(['敵'])
    expect(cardsIn(resolved, '先攻', '捨札')).toEqual([])
  })

  // 総合ルール 第2部 第21章 5-1、第4部 第7章 6（ADR-0006）
  it('効果によってあなたのユニットが破壊された時も、捨札への移動で能力が誘発する', () => {
    const watching = instantiate({ id: '見届け役', card: discardWatcher, owner: '後攻' })
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵')], [nextEnemySquare, watching])

    const resolved = resolveEffect(state, enterAbility.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(resolved.triggered.map((each) => each.source)).toEqual(['見届け役'])
  })

  // 総合ルール 第2部 第21章 1-2
  it('捨札に置かれるのは支配者ではなく持ち主のほうである', () => {
    const stolen = instantiate({ id: '奪われた味方', card: vanilla, owner: '後攻', controller: '先攻' })
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵')], [nextEnemySquare, stolen])

    const resolved = resolveEffect(state, enterAbility.effect, { controller: '後攻', via: VIA, chooser: chooseFirst })

    // 「後攻」から見ると、先攻が支配しているこの 2 枚がどちらも敵にあたる。
    expect(idsOf(cardsIn(resolved, '後攻', '捨札'))).toEqual(['奪われた味方'])
  })

  // 総合ルール 第2部 第21章 1-4
  it('スクエアを離れたカードの支配者は持ち主に戻る', () => {
    const stolen = instantiate({ id: '奪われた敵', card: vanilla, owner: '後攻', controller: '先攻' })
    const state = boardOf([mySquare, mine()], [enemySquare, stolen])

    const resolved = resolveEffect(state, enterAbility.effect, { controller: '後攻', via: VIA, chooser: chooseFirst })

    expect(cardsIn(resolved, '後攻', '捨札')[0]?.controller).toBe('後攻')
  })

  // 総合ルール 第2部 第21章 8-2
  it('敵として選べるのは相手のユニットだけで、味方は候補に入らない', () => {
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵')])

    const offered: UnitOnSquare[][] = []
    const recordThenChoose: Chooser = (candidates) => {
      offered.push(candidates as readonly UnitOnSquare[] as UnitOnSquare[])
      return candidates[0]
    }
    resolveEffect(state, enterAbility.effect, { controller: '先攻', via: VIA, chooser: recordThenChoose })

    expect(offered).toHaveLength(1)
    expect(offered[0]?.map((unit) => unit.id)).toEqual(['敵'])
  })

  // 総合ルール 第1部 第1章 3
  it('敵が 1 枚もいなければ、要求された行動は実行されない', () => {
    const state = boardOf([mySquare, mine()])

    const resolved = resolveEffect(state, enterAbility.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    // 解決を始めたこと自体は記録される（#104）ので、比べるのはログを除いた盤面にする。
    expect(withoutLog(resolved)).toEqual(withoutLog(state))
  })

  // 総合ルール 第4部 第8章 2-3
  it('どの敵を選ぶかは能力の支配者が決める', () => {
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵1')], [nextEnemySquare, theirs('敵2')])

    const chooseSecond: Chooser = (candidates) => candidates[1]
    const resolved = resolveEffect(state, enterAbility.effect, { controller: '先攻', via: VIA, chooser: chooseSecond })

    expect(idsOf(cardsIn(resolved, '後攻', '捨札'))).toEqual(['敵2'])
    expect(idsOf(cardsOn(resolved, enemySquare))).toEqual(['敵1'])
  })

  // ADR-0001: エンジンは「盤面 ＋ 行動 → 次の盤面」の純粋関数である
  it('元の盤面は変わらない', () => {
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵')])

    resolveEffect(state, enterAbility.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(idsOf(cardsOn(state, enemySquare))).toEqual(['敵'])
    expect(cardsIn(state, '後攻', '捨札')).toEqual([])
  })
})

describe('実行できない行動', () => {
  // 総合ルール 第1部 第1章 3
  it('すでにスクエアを離れたカードは破壊されないが、効果はそのまま続く', () => {
    const destroyTwice = triggeredAbility('登場した時', function* (duel) {
      const [first, second] = duel.enemies()
      if (first === undefined || second === undefined) throw new Error('敵が 2 枚いる盤面で試すこと')
      yield* destroy(first)
      // 1 枚目はもうスクエアにいない。この行動は実行されないだけで、効果は終わらない。
      yield* destroy(first)
      yield* destroy(second)
    })
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵1')], [nextEnemySquare, theirs('敵2')])

    const resolved = resolveEffect(state, destroyTwice.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(idsOf(cardsIn(resolved, '後攻', '捨札'))).toEqual(['敵2', '敵1'])
  })

  /**
   * 総合ルール 第4部 第8章 2-2、第1部 第1章 3（ADR-0006）。
   *
   * 解決はテキストに書かれている順番の通りに指示に従うもので、実行できないのはその行動
   * だけである。選べなかったからといって、選んだものに依存しない後ろの指示まで実行され
   * なくなってはならない。
   */
  it('選べなくても、選んだものに依存しない後ろの指示は実行される', () => {
    const ability = triggeredAbility('登場した時', function* (duel) {
      const enemy = yield* choose(duel.enemies())
      // 選べなければ破壊もできない。それを飛ばすのは効果の側の判断である。
      if (enemy !== undefined) yield* destroy(enemy)
      // こちらは選んだものに依存しないので、選べなくても実行される。
      yield* damagePlayer(duel.controller, 1000)
    })
    // 敵が 1 枚もいない盤面。
    const state = boardOf([mySquare, mine()])

    const resolved = resolveEffect(state, ability.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(resolved.damage).toEqual({ 先攻: 1000, 後攻: 0 })
  })

  // 総合ルール 第4部 第8章 2-2
  it('「1 枚選び」で候補が無くても、効果は最後まで進む', () => {
    const steps: string[] = []
    const ability = triggeredAbility('登場した時', function* (duel) {
      const enemy = yield* choose(duel.enemies())
      steps.push(enemy === undefined ? '選べなかった' : '選んだ')
      steps.push('後ろの指示')
    })
    const state = boardOf([mySquare, mine()])

    resolveEffect(state, ability.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(steps).toEqual(['選べなかった', '後ろの指示'])
  })
})

describe('「1 枚まで選び」', () => {
  const declineAll: Chooser = () => undefined

  // 総合ルール 第4部 第8章 2-3
  it('候補があっても、選ばないことを選べる', () => {
    const state = boardOf([mySquare, maybeMine()], [enemySquare, theirs('敵')])

    const resolved = resolveEffect(state, maybeAbility.effect, { controller: '先攻', via: VIA, chooser: declineAll })

    expect(idsOf(cardsOn(resolved, enemySquare))).toEqual(['敵'])
    expect(cardsIn(resolved, '後攻', '捨札')).toEqual([])
  })

  // 総合ルール 第4部 第8章 2-3
  it('選んだ場合は、その対象に後ろの指示が行われる', () => {
    const state = boardOf([mySquare, maybeMine()], [enemySquare, theirs('敵')])

    const resolved = resolveEffect(state, maybeAbility.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(idsOf(cardsIn(resolved, '後攻', '捨札'))).toEqual(['敵'])
  })

  /**
   * ここは「1 枚選び」と同じである。どちらも候補が無ければ選ばれなかったものとして
   * 効果が続く（総合ルール 第4部 第8章 2-2、上の「敵が 1 枚もいなければ」のテスト）。
   * 2 つの違いは、候補があるときに選ばないことを選べるかどうかだけである（同 2-3）。
   */
  it('候補が 1 つも無くても、効果は打ち切られない', () => {
    const steps: string[] = []
    const ability = triggeredAbility('登場した時', function* (duel) {
      const enemy = yield* chooseAtMostOne(duel.enemies())
      steps.push(enemy === undefined ? '選ばなかった' : '選んだ')
      steps.push('後ろの指示')
    })
    const state = boardOf([mySquare, maybeMine()])

    resolveEffect(state, ability.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(steps).toEqual(['選ばなかった', '後ろの指示'])
  })

  it('選ばないことが認められているかどうかが、選ぶ側に渡る', () => {
    const asked: (boolean | undefined)[] = []
    const record: Chooser = (candidates, _player, _purpose, _board, mayDecline) => {
      asked.push(mayDecline)
      return candidates[0]
    }
    const state = boardOf([mySquare, maybeMine()], [enemySquare, theirs('敵')])

    resolveEffect(state, maybeAbility.effect, { controller: '先攻', via: VIA, chooser: record })

    expect(asked).toEqual([true])
  })

  // 総合ルール 第4部 第8章 2-3。テキストの指定に合わない選択は選べない。
  it('「1 枚選び」では、選ばないことを選べない', () => {
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵')])

    expect(() =>
      resolveEffect(state, enterAbility.effect, { controller: '先攻', via: VIA, chooser: declineAll }),
    ).toThrowError('候補にないものが選ばれた')
  })
})

// 総合ルール 第3部 第9章 1（ADR-0006）
describe('プレイヤーへのダメージ', () => {
  const damaging = triggeredAbility('登場した時', function* (duel) {
    yield* damagePlayer(duel.controller, 1000)
  })

  it('指定したプレイヤーにダメージが蓄積する', () => {
    const resolved = resolveEffect(boardOf([mySquare, mine()]), damaging.effect, {
      controller: '先攻',
      via: VIA,
      chooser: chooseFirst,
    })

    expect(resolved.damage).toEqual({ 先攻: 1000, 後攻: 0 })
  })

  // 総合ルール 第4部 第7章 1。「あなた」は能力の支配者を指す。
  it('支配者が変われば、ダメージを受けるプレイヤーも変わる', () => {
    const resolved = resolveEffect(boardOf([mySquare, mine()]), damaging.effect, {
      controller: '後攻',
      via: VIA,
      chooser: chooseFirst,
    })

    expect(resolved.damage).toEqual({ 先攻: 0, 後攻: 1000 })
  })

  /**
   * 総合ルール 第4部 第8章 4。
   *
   * ダメージが 1000 以上になるとスマッシュ判定が発生する（同 第14章 4-12）が、それは
   * ルールエフェクトの仕事であり、効果の解決中にはチェックされない。始まるのは、次に
   * どちらかのプレイヤーが優先権を獲得する時である。
   */
  it('効果の解決中にスマッシュ判定は始まらない', () => {
    const resolved = resolveEffect(boardOf([mySquare, mine()]), damaging.effect, {
      controller: '先攻',
      via: VIA,
      chooser: chooseFirst,
    })

    expect(resolved.damage['先攻']).toBe(1000)
    expect(resolved.smashJudgments).toEqual([])
  })
})

// 総合ルール 第4部 第14章 4-6（ADR-0006）
describe('ユニットへのダメージ', () => {
  /** 敵 1 枚を選んで、指定した量のダメージを与える能力。 */
  const damaging = (amount: number) =>
    triggeredAbility('登場した時', function* (duel) {
      const target = yield* choose(duel.enemies())
      if (target !== undefined) yield* damageUnit(target, amount)
    })

  const damageOn = (state: DuelState, square: Square) =>
    cardsOn(state, square).map((card) => card.damage)

  it('選ばれたユニットにダメージが載る', () => {
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵')])

    const resolved = resolveEffect(state, damaging(500).effect, {
      controller: '先攻',
      via: VIA,
      chooser: chooseFirst,
    })

    expect(damageOn(resolved, enemySquare)).toEqual([500])
  })

  it('同じユニットに 2 回与えれば蓄積する', () => {
    const twice = triggeredAbility('登場した時', function* (duel) {
      const enemy = yield* choose(duel.enemies())
      if (enemy === undefined) throw new Error('敵がいる盤面で試すこと')
      yield* damageUnit(enemy, 300)
      yield* damageUnit(enemy, 400)
    })
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵')])

    const resolved = resolveEffect(state, twice.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(damageOn(resolved, enemySquare)).toEqual([700])
  })

  /**
   * 総合ルール 第4部 第8章 4。
   *
   * ＢＰと同じかそれ以上のダメージを受けたユニットが捨札に置かれること（同 第14章 4-6）は
   * ルールエフェクトの仕事であり、効果の解決中にはチェックされない。捨札に置かれるのは、
   * 次にどちらかのプレイヤーが優先権を獲得する時である（`rule-effect.test.ts`）。
   * プレイヤーへのダメージとスマッシュ判定の関係（上）と同じ順序になる。
   */
  it('ＢＰ以上のダメージでも、効果の解決中には捨札に置かれない', () => {
    // 敵のＢＰは 1000。
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵')])

    const resolved = resolveEffect(state, damaging(1000).effect, {
      controller: '先攻',
      via: VIA,
      chooser: chooseFirst,
    })

    expect(idsOf(cardsOn(resolved, enemySquare))).toEqual(['敵'])
    expect(damageOn(resolved, enemySquare)).toEqual([1000])
    expect(cardsIn(resolved, '後攻', '捨札')).toEqual([])
  })

  // 総合ルール 第1部 第1章 3
  it('すでにスクエアを離れたユニットには与えられないが、効果はそのまま続く', () => {
    const destroyThenDamage = triggeredAbility('登場した時', function* (duel) {
      const [first, second] = duel.enemies()
      if (first === undefined || second === undefined) throw new Error('敵が 2 枚いる盤面で試すこと')
      yield* destroy(first)
      // 1 枚目はもうスクエアにいない。この行動は実行されないだけで、効果は終わらない。
      yield* damageUnit(first, 500)
      yield* damageUnit(second, 500)
    })
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵1')], [nextEnemySquare, theirs('敵2')])

    const resolved = resolveEffect(state, destroyThenDamage.effect, {
      controller: '先攻',
      via: VIA,
      chooser: chooseFirst,
    })

    expect(damageOn(resolved, nextEnemySquare)).toEqual([500])
    // 捨札に置かれたカードは新しいカードとして扱われる（総合ルール 第2部 第21章 1-4）ので、
    // 後から与えようとしたダメージがそちらに載ることもない。
    expect(cardsIn(resolved, '後攻', '捨札').map((card) => card.damage)).toEqual([0])
  })

  // ADR-0002: 効果が対象にできるのは、engine が見せたカードだけである
  it('見せていないユニットにはダメージを与えられない', () => {
    const forge = triggeredAbility('登場した時', function* (duel) {
      const [enemy] = duel.enemies()
      if (enemy === undefined) throw new Error('敵がいる盤面で試すこと')
      yield* damageUnit({ ...enemy, id: '味方' }, 500)
    })
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵')])

    expect(() =>
      resolveEffect(state, forge.effect, { controller: '先攻', via: VIA, chooser: chooseFirst }),
    ).toThrowError('効果に見せていないカードが対象にされた')
  })
})

// 総合ルール 第4部 第8章 2-5（ADR-0006）
describe('効果から見た発生元', () => {
  /** 発生元とその隣にいる敵を記録する能力。「隣にいる敵」を書けることを見る。 */
  function watching(record: { self?: Square; beside: string[] }) {
    return triggeredAbility('登場した時', function* (duel) {
      const me = duel.self()
      if (me === undefined) return
      record.self = me.square
      const beside = squaresBeside(me.square).map(indexOfSquare)
      record.beside.push(...duel.enemies().filter((enemy) => beside.includes(indexOfSquare(enemy.square))).map((enemy) => enemy.id))
    })
  }

  it('発生元の位置が分かり、隣にいる敵を絞り込める', () => {
    const record: { self?: Square; beside: string[] } = { beside: [] }
    const state = boardOf(
      [enemySquare, mine()],
      [{ row: 0, column: 0 }, theirs('左の敵')],
      [{ row: 0, column: 2 }, theirs('右の敵')],
      [{ row: 2, column: 0 }, theirs('遠い敵')],
    )

    resolveEffect(state, watching(record).effect, {
      controller: '先攻',
      via: VIA,
      chooser: chooseFirst,
      self: { id: '味方', square: enemySquare, card: enterAndDestroy, controller: '先攻' },
    })

    expect(record.self).toEqual(enemySquare)
    expect(record.beside).toEqual(['左の敵', '右の敵'])
  })

  /**
   * 解決する時の位置を返す。誘発してから「スクエアからスクエア」の移動をしていれば、
   * 移動した後の位置になる（総合ルール 第4部 第8章 2-5 が直前の情報を使うと定めているのは
   * ゾーン移動をした場合だけである）。
   */
  it('誘発した時から動いていれば、解決する時の位置を返す', () => {
    const record: { self?: Square; beside: string[] } = { beside: [] }
    // 盤面では中央にいるが、誘発した時点の写しは別のスクエアを指している。
    const state = boardOf([{ row: 1, column: 1 }, mine()])

    resolveEffect(state, watching(record).effect, {
      controller: '先攻',
      via: VIA,
      chooser: chooseFirst,
      self: { id: '味方', square: enemySquare, card: enterAndDestroy, controller: '先攻' },
    })

    expect(record.self).toEqual({ row: 1, column: 1 })
  })

  // 総合ルール 第4部 第8章 2-5。ゾーン移動をしていた場合は移動する直前の情報を使用する。
  it('発生元がスクエアを離れていれば、誘発した時点の位置を返す', () => {
    const record: { self?: Square; beside: string[] } = { beside: [] }
    // 発生元はどのスクエアにもいない。
    const state = boardOf([{ row: 0, column: 0 }, theirs('左の敵')])

    resolveEffect(state, watching(record).effect, {
      controller: '先攻',
      via: VIA,
      chooser: chooseFirst,
      self: { id: '味方', square: enemySquare, card: enterAndDestroy, controller: '先攻' },
    })

    expect(record.self).toEqual(enemySquare)
    expect(record.beside).toEqual(['左の敵'])
  })

  it('発生元がそもそも無ければ undefined を返す', () => {
    const record: { self?: Square; beside: string[] } = { beside: [] }
    const state = boardOf([mySquare, mine()])

    resolveEffect(state, watching(record).effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(record.self).toBeUndefined()
  })

  // ADR-0002: 効果が対象にできるのは、engine が見せたカードだけである
  it('発生元は見せたカードなので、対象にできる', () => {
    const destroySelf = triggeredAbility('登場した時', function* (duel) {
      const me = duel.self()
      if (me !== undefined) yield* destroy(me)
    })
    const state = boardOf([mySquare, mine()])

    const resolved = resolveEffect(state, destroySelf.effect, {
      controller: '先攻',
      via: VIA,
      chooser: chooseFirst,
      self: { id: '味方', square: mySquare, card: enterAndDestroy, controller: '先攻' },
    })

    expect(idsOf(cardsIn(resolved, '先攻', '捨札'))).toEqual(['味方'])
  })
})

// 総合ルール 第2部 第24章 1（ADR-0006）
describe('効果による向きの変更', () => {
  const frozenTheirs = (id: string) =>
    instantiate({ id, card: vanilla, owner: '後攻', orientation: 'フリーズ' })
  const frozenMine = () =>
    instantiate({ id: '味方', card: enterAndDestroy, owner: '先攻', orientation: 'フリーズ' })

  const orientationOn = (state: DuelState, square: Square) =>
    cardsOn(state, square).map((card) => card.orientation)

  const releasing = triggeredAbility('登場した時', function* (duel) {
    const target = yield* choose(duel.enemies())
    if (target !== undefined) yield* release(target)
  })
  const freezing = triggeredAbility('登場した時', function* (duel) {
    const target = yield* choose(duel.enemies())
    if (target !== undefined) yield* freeze(target)
  })

  it('フリーズ状態のユニットをリリースする', () => {
    const state = boardOf([mySquare, mine()], [enemySquare, frozenTheirs('敵')])

    const resolved = resolveEffect(state, releasing.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(orientationOn(resolved, enemySquare)).toEqual(['リリース'])
  })

  it('リリース状態のユニットをフリーズする', () => {
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵')])

    const resolved = resolveEffect(state, freezing.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(orientationOn(resolved, enemySquare)).toEqual(['フリーズ'])
  })

  /**
   * 総合ルール 第2部 第24章 1-1。
   *
   * リリース状態のカードをリリースしたり、フリーズ状態のカードをフリーズしたりすることは
   * できない。実行できない行動は実行されない（同 第1部 第1章 3）ので、盤面は変わらない。
   */
  it('すでにリリース状態なら、リリースできない', () => {
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵')])

    const resolved = resolveEffect(state, releasing.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(withoutLog(resolved)).toEqual(withoutLog(state))
  })

  it('すでにフリーズ状態なら、フリーズできない', () => {
    const state = boardOf([mySquare, mine()], [enemySquare, frozenTheirs('敵')])

    const resolved = resolveEffect(state, freezing.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(withoutLog(resolved)).toEqual(withoutLog(state))
  })

  // 総合ルール 第1部 第1章 3
  it('すでにスクエアを離れたユニットの向きは変わらないが、効果はそのまま続く', () => {
    const ability = triggeredAbility('登場した時', function* (duel) {
      const [first, second] = duel.enemies()
      if (first === undefined || second === undefined) throw new Error('敵が 2 枚いる盤面で試すこと')
      yield* destroy(first)
      // 1 枚目はもうスクエアにいない。この行動は実行されないだけで、効果は終わらない。
      yield* freeze(first)
      yield* freeze(second)
    })
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵1')], [nextEnemySquare, theirs('敵2')])

    const resolved = resolveEffect(state, ability.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(orientationOn(resolved, nextEnemySquare)).toEqual(['フリーズ'])
    // 捨札のカードは常にリリース状態で置かれる（総合ルール 第2部 第21章 5-3）。後から
    // フリーズしようとした分がそちらに効いていないことを見る。
    expect(cardsIn(resolved, '後攻', '捨札').map((card) => card.orientation)).toEqual(['リリース'])
  })

  /**
   * 向きの変更はカードの状態の変更（総合ルール 第2部 第24章 1）であって、ゾーンの移動では
   * ない。スクエアへ置き直す経路で代用すると、そのカードがスクエアに「後から置かれた」
   * ことになり、同じスクエアに支配者の異なるユニットが並んでいる時の順番が入れ替わる。
   * 順番はバトルでどちらが攻撃したユニットかを決める（`battle.ts`）ので、変わってはならない。
   */
  it('向きを変えても、スクエアに置かれた順番は変わらない', () => {
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('先にいる敵')], [enemySquare, frozenMine()])

    const resolved = resolveEffect(state, freezing.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(idsOf(cardsOn(resolved, enemySquare))).toEqual(['先にいる敵', '味方'])
    expect(orientationOn(resolved, enemySquare)).toEqual(['フリーズ', 'フリーズ'])
  })

  // ADR-0002: 効果が対象にできるのは、engine が見せたカードだけである
  it('見せていないユニットの向きは変えられない', () => {
    const forge = triggeredAbility('登場した時', function* (duel) {
      const [enemy] = duel.enemies()
      if (enemy === undefined) throw new Error('敵がいる盤面で試すこと')
      yield* freeze({ ...enemy, id: '味方' })
    })
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵')])

    expect(() =>
      resolveEffect(state, forge.effect, { controller: '先攻', via: VIA, chooser: chooseFirst }),
    ).toThrowError('効果に見せていないカードが対象にされた')
  })
})

// 総合ルール 第2部 第21章 1-2・1-4（ADR-0006）
describe('効果によるゾーン間の移動', () => {
  /** 自分の手札を 1 枚まで選び、エネルギーゾーンにフリーズして置く能力。 */
  const stashing = triggeredAbility('登場した時', function* (duel) {
    const card = yield* chooseAtMostOne(duel.hand())
    if (card !== undefined) yield* placeInZone(card, 'エネルギーゾーン', 'フリーズ')
  })

  /** 先攻と後攻それぞれの手札を整えた、味方が 1 枚いる盤面。 */
  function withHands(): DuelState {
    const board = boardOf([mySquare, mine()])
    const mineInHand = putInZone(board, '先攻', '手札', [instantiate({ id: '自分の手札', card: vanilla, owner: '先攻' })])
    return putInZone(mineInHand, '後攻', '手札', [instantiate({ id: '相手の手札', card: vanilla, owner: '後攻' })])
  }

  it('選んだ手札のカードが、指定した向きでエネルギーゾーンに置かれる', () => {
    const resolved = resolveEffect(withHands(), stashing.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    const [placed] = cardsIn(resolved, '先攻', 'エネルギーゾーン')
    expect(placed?.id).toBe('自分の手札')
    expect(placed?.orientation).toBe('フリーズ')
    expect(cardsIn(resolved, '先攻', '手札')).toEqual([])
  })

  /**
   * ADR-0002・ADR-0004。相手の手札は非公開の情報なので、効果から読めてはならない。
   *
   * 読む手段が `DuelView` に生えていないことがその保証で、下の「盤面への問い合わせだけ」の
   * テストが型として押さえている。ここでは、支配者自身の手札を尋ねた時に相手のカードが
   * 混ざらないことを見る。
   */
  it('手札として見えるのは支配者自身のものだけである', () => {
    const offered: CardInZone[][] = []
    const record: Chooser = (candidates) => {
      offered.push(candidates as readonly CardInZone[] as CardInZone[])
      return candidates[0]
    }

    resolveEffect(withHands(), stashing.effect, { controller: '先攻', via: VIA, chooser: record })

    expect(offered[0]?.map((each) => each.id)).toEqual(['自分の手札'])
  })

  it('見せていないカードはゾーンへ置けない', () => {
    const forge = triggeredAbility('登場した時', function* (duel) {
      const [card] = duel.hand()
      if (card === undefined) throw new Error('手札があるうえで試すこと')
      yield* placeInZone({ ...card, id: '相手の手札' }, 'エネルギーゾーン', 'フリーズ')
    })

    expect(() =>
      resolveEffect(withHands(), forge.effect, { controller: '先攻', via: VIA, chooser: chooseFirst }),
    ).toThrowError('効果に見せていないカードが対象にされた')
  })

  // 総合ルール 第2部 第21章 1-2
  it('スクエアにいるユニットを、持ち主の手札に置ける', () => {
    const takeBack = triggeredAbility('登場した時', function* (duel) {
      const enemy = yield* choose(duel.enemies())
      if (enemy === undefined) throw new Error('敵がいる盤面で試すこと')
      yield* placeInZone(enemy, '手札', 'リリース')
    })
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵')])

    const resolved = resolveEffect(state, takeBack.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(cardsOn(resolved, enemySquare)).toEqual([])
    // 持ち主のゾーンに入る。支配者である「先攻」の手札ではない。
    expect(idsOf(cardsIn(resolved, '後攻', '手札'))).toEqual(['敵'])
    expect(cardsIn(resolved, '先攻', '手札')).toEqual([])
  })

  /**
   * 総合ルール 第2部 第21章 1-5、第4部 第7章 6。
   *
   * スクエアから捨札に置くことは「破壊する」にあたり、それを見て誘発する能力がある。
   * ゾーンへ置く命令で捨札を指定した場合も、破壊と同じ経路を通さないとその誘発が
   * 起こらなくなる。
   */
  it('スクエアから捨札へ置いた時も、それを見る能力が誘発する', () => {
    const toDiscard = triggeredAbility('登場した時', function* (duel) {
      const enemy = yield* choose(duel.enemies())
      if (enemy === undefined) throw new Error('敵がいる盤面で試すこと')
      yield* placeInZone(enemy, '捨札', 'リリース')
    })
    const watching = instantiate({ id: '見届け役', card: discardWatcher, owner: '後攻' })
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵')], [nextEnemySquare, watching])

    const resolved = resolveEffect(state, toDiscard.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(idsOf(cardsIn(resolved, '後攻', '捨札'))).toEqual(['敵'])
    expect(resolved.triggered.map((each) => each.source)).toEqual(['見届け役'])
  })

  // 総合ルール 第2部 第21章 1-3
  it('山札の 1 番下を指定して戻せる', () => {
    const toBottom = triggeredAbility('登場した時', function* (duel) {
      const enemy = yield* choose(duel.enemies())
      if (enemy === undefined) throw new Error('敵がいる盤面で試すこと')
      yield* placeInZone(enemy, '山札', 'リリース', '1番下')
    })
    const board = boardOf([mySquare, mine()], [enemySquare, theirs('敵')])
    const state = putInZone(board, '後攻', '山札', [instantiate({ id: '山札の上', card: vanilla, owner: '後攻' })])

    const resolved = resolveEffect(state, toBottom.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(idsOf(cardsIn(resolved, '後攻', '山札'))).toEqual(['山札の上', '敵'])
  })

  /**
   * 総合ルール 第2部 第21章 3-4。
   *
   * プランゾーンにあるカードは同時に山札の 1 番上のカードでもある（同 3-1）。裏向きに
   * しないまま上に別のカードを置くと、山札の 1 番上が 2 枚あることになってしまう。
   */
  it('山札の 1 番上に置く時、プランがあれば先に裏向きになる', () => {
    const toTop = triggeredAbility('登場した時', function* (duel) {
      const enemy = yield* choose(duel.enemies())
      if (enemy === undefined) throw new Error('敵がいる盤面で試すこと')
      yield* placeInZone(enemy, '山札', 'リリース')
    })
    const board = boardOf([mySquare, mine()], [enemySquare, theirs('敵')])
    const state = putInZone(board, '後攻', 'プランゾーン', [
      instantiate({ id: 'プラン', card: vanilla, owner: '後攻' }),
    ])

    const resolved = resolveEffect(state, toTop.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    // 裏向きになったプランは山札に戻り、置かれたカードがその上に来る。
    expect(cardsIn(resolved, '後攻', 'プランゾーン')).toEqual([])
    expect(idsOf(cardsIn(resolved, '後攻', '山札'))).toEqual(['敵', 'プラン'])
  })

  it('山札の 1 番下に置く時は、プランはそのままである', () => {
    const toBottom = triggeredAbility('登場した時', function* (duel) {
      const enemy = yield* choose(duel.enemies())
      if (enemy === undefined) throw new Error('敵がいる盤面で試すこと')
      yield* placeInZone(enemy, '山札', 'リリース', '1番下')
    })
    const board = boardOf([mySquare, mine()], [enemySquare, theirs('敵')])
    const state = putInZone(board, '後攻', 'プランゾーン', [
      instantiate({ id: 'プラン', card: vanilla, owner: '後攻' }),
    ])

    const resolved = resolveEffect(state, toBottom.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(idsOf(cardsIn(resolved, '後攻', 'プランゾーン'))).toEqual(['プラン'])
    expect(idsOf(cardsIn(resolved, '後攻', '山札'))).toEqual(['敵'])
  })

  /** 相手のプランを裏返す能力。 */
  const flipping = triggeredAbility('登場した時', function* (duel) {
    yield* flipPlan(duel.opponent)
  })

  /** 両方のプレイヤーにプランと山札を用意した盤面。 */
  function withPlans(): DuelState {
    let state = boardOf([mySquare, mine()])
    for (const player of ['先攻', '後攻'] as const) {
      state = putInZone(state, player, '山札', [instantiate({ id: `${player}の山札`, card: vanilla, owner: player })])
      state = putInZone(state, player, 'プランゾーン', [
        instantiate({ id: `${player}のプラン`, card: vanilla, owner: player }),
      ])
    }
    return state
  }

  // 総合ルール 第2部 第21章 3-4
  it('プランを裏返すと、そのカードは裏向きの山札の 1 番上に戻る', () => {
    const resolved = resolveEffect(withPlans(), flipping.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(cardsIn(resolved, '後攻', 'プランゾーン')).toEqual([])
    expect(idsOf(cardsIn(resolved, '後攻', '山札'))).toEqual(['後攻のプラン', '後攻の山札'])
  })

  it('裏返るのは指定したプレイヤーのプランだけである', () => {
    const resolved = resolveEffect(withPlans(), flipping.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(idsOf(cardsIn(resolved, '先攻', 'プランゾーン'))).toEqual(['先攻のプラン'])
  })

  // 総合ルール 第1部 第1章 3
  it('プランが無ければ、要求された行動は実行されない', () => {
    const steps: string[] = []
    const ability = triggeredAbility('登場した時', function* (duel) {
      yield* flipPlan(duel.opponent)
      steps.push('後ろの指示')
    })
    const state = boardOf([mySquare, mine()])

    const resolved = resolveEffect(state, ability.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(cardsIn(resolved, '後攻', '山札')).toEqual([])
    expect(steps).toEqual(['後ろの指示'])
  })

  /** 自分の山札の 1 番上のカードを、エネルギーゾーンにフリーズして置く能力。 */
  const stacking = triggeredAbility('登場した時', function* () {
    yield* placeTopOfLibrary('エネルギーゾーン', 'フリーズ')
  })

  it('山札の 1 番上のカードを、選ばずに指定した向きで置ける', () => {
    const board = boardOf([mySquare, mine()])
    const state = putInZone(board, '先攻', '山札', [
      instantiate({ id: '山札の上', card: vanilla, owner: '先攻' }),
      instantiate({ id: '山札の下', card: vanilla, owner: '先攻' }),
    ])

    const resolved = resolveEffect(state, stacking.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    const [placed] = cardsIn(resolved, '先攻', 'エネルギーゾーン')
    expect(placed?.id).toBe('山札の上')
    expect(placed?.orientation).toBe('フリーズ')
    expect(idsOf(cardsIn(resolved, '先攻', '山札'))).toEqual(['山札の下'])
  })

  // 総合ルール 第2部 第21章 3-1
  it('プランゾーンにカードがあれば、それが山札の 1 番上として動く', () => {
    const board = boardOf([mySquare, mine()])
    const stocked = putInZone(board, '先攻', '山札', [instantiate({ id: '山札の上', card: vanilla, owner: '先攻' })])
    const state = putInZone(stocked, '先攻', 'プランゾーン', [
      instantiate({ id: 'プラン', card: vanilla, owner: '先攻' }),
    ])

    const resolved = resolveEffect(state, stacking.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(cardsIn(resolved, '先攻', 'エネルギーゾーン')[0]?.id).toBe('プラン')
    expect(idsOf(cardsIn(resolved, '先攻', '山札'))).toEqual(['山札の上'])
  })

  // 総合ルール 第1部 第1章 3
  it('山札が空なら、要求された行動は実行されない', () => {
    const steps: string[] = []
    const ability = triggeredAbility('登場した時', function* () {
      yield* placeTopOfLibrary('エネルギーゾーン', 'フリーズ')
      steps.push('後ろの指示')
    })
    const state = boardOf([mySquare, mine()])

    const resolved = resolveEffect(state, ability.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(cardsIn(resolved, '先攻', 'エネルギーゾーン')).toEqual([])
    // 実行できない行動があっても、効果はそのまま続く。
    expect(steps).toEqual(['後ろの指示'])
  })

  // 総合ルール 第2部 第21章 1-5
  it('カードを引くと、山札の 1 番上が手札に入る', () => {
    const drawing = triggeredAbility('登場した時', function* (duel) {
      yield* drawCards(duel.controller, 1)
    })
    const board = boardOf([mySquare, mine()])
    const state = putInZone(board, '先攻', '山札', [
      instantiate({ id: '山札の上', card: vanilla, owner: '先攻' }),
      instantiate({ id: '山札の下', card: vanilla, owner: '先攻' }),
    ])

    const resolved = resolveEffect(state, drawing.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(idsOf(cardsIn(resolved, '先攻', '手札'))).toEqual(['山札の上'])
    expect(idsOf(cardsIn(resolved, '先攻', '山札'))).toEqual(['山札の下'])
  })

  // 総合ルール 第1部 第1章 3
  it('山札が空でも、引けないだけで効果は続く', () => {
    const steps: string[] = []
    const drawing = triggeredAbility('登場した時', function* (duel) {
      yield* drawCards(duel.controller, 1)
      steps.push('後ろの指示')
    })
    const state = boardOf([mySquare, mine()])

    const resolved = resolveEffect(state, drawing.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(cardsIn(resolved, '先攻', '手札')).toEqual([])
    expect(steps).toEqual(['後ろの指示'])
  })

  // 総合ルール 第1部 第1章 3
  it('手札が 1 枚も無ければ、要求された行動は実行されない', () => {
    const state = boardOf([mySquare, mine()])

    const resolved = resolveEffect(state, stashing.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(cardsIn(resolved, '先攻', 'エネルギーゾーン')).toEqual([])
  })
})

/**
 * 総合ルール 第2部 第20章 1-4-a（ADR-0006）。
 *
 * プレイされたユニットがスクエアに置かれることだけを「登場」と呼ぶ。効果によって置かれる
 * のは登場ではない。この 2 つは `play.ts` の `placePlayedUnit` を通るかどうかで分かれて
 * いて、そこが分かれたままであることをここで押さえる。
 */
describe('効果によってスクエアに置くことは「登場」ではない', () => {
  /** 「登場した時」に誘発する能力を持つユニット。誘発したかどうかを見るために使う。 */
  const appearing = defineUnit({
    name: 'テスト・登場誘発',
    level: 1,
    colors: ['赤'],
    bp: 1000,
    sp: 1000,
    abilities: [triggeredAbility('登場した時', function* () {})],
  })

  /** 「根性」を持つユニット。置かれる時の向きが置換されるかどうかを見るために使う。 */
  const gutsy = defineUnit({
    name: 'テスト・根性',
    level: 1,
    colors: ['赤'],
    bp: 1000,
    sp: 1000,
    abilities: [guts],
  })

  /** 自分の捨札にあるカードを 1 枚選び、指定のスクエアにフリーズして置く能力。 */
  const reviving = triggeredAbility('登場した時', function* (duel) {
    const card = yield* choose(duel.discardPile())
    if (card === undefined) throw new Error('捨札にカードがある盤面で試すこと')
    yield* placeOnSquare(card, enemySquare, 'フリーズ')
  })

  /** 先攻の捨札にそのカードを 1 枚置いた盤面。 */
  function withInDiscard(instance: CardInstance): DuelState {
    return putInZone(boardOf([mySquare, mine()]), '先攻', '捨札', [instance])
  }

  it('置かれること自体は行われる', () => {
    const state = withInDiscard(instantiate({ id: '戻るカード', card: vanilla, owner: '先攻' }))

    const resolved = resolveEffect(state, reviving.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    const [placed] = cardsOn(resolved, enemySquare)
    expect(placed?.id).toBe('戻るカード')
    // 能力の支配者の支配下で置かれる。
    expect(placed?.controller).toBe('先攻')
    expect(cardsIn(resolved, '先攻', '捨札')).toEqual([])
  })

  it('「登場した時」に誘発する能力は誘発しない', () => {
    const state = withInDiscard(instantiate({ id: '登場誘発持ち', card: appearing, owner: '先攻' }))

    const resolved = resolveEffect(state, reviving.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(cardsOn(resolved, enemySquare)[0]?.id).toBe('登場誘発持ち')
    expect(resolved.triggered).toEqual([])
  })

  // 総合ルール 第5部 第6章 3
  it('「根性」は働かず、指定した向きのまま置かれる', () => {
    const state = withInDiscard(instantiate({ id: '根性持ち', card: gutsy, owner: '先攻' }))

    const resolved = resolveEffect(state, reviving.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    // プレイされていればリリース状態になるが、これは登場ではないので置換は起こらない。
    expect(cardsOn(resolved, enemySquare)[0]?.orientation).toBe('フリーズ')
  })
})

// ADR-0002: カードの実装は engine の公開 API だけで書ける
describe('効果に渡されるのは盤面への問い合わせだけである', () => {
  it('盤面そのものも、それを書き換える手段も渡されない', () => {
    const ability = triggeredAbility('登場した時', function* (duel) {
      // @ts-expect-error 効果はスクエアに置かれたカードの並びを直接見られない
      duel.squares
      // @ts-expect-error 効果はゾーンの中身を直接書き換えられない
      duel.zones
      // @ts-expect-error 相手の手札は非公開の情報なので、読む手段が無い（ADR-0004）
      duel.opponentHand
      // @ts-expect-error 山札の中身も読めない。「1 番上」は位置の指定であって選択ではない
      duel.library
      const enemy = yield* choose(duel.enemies())
      if (enemy !== undefined) yield* destroy(enemy)
    })

    expect(ability.kind).toBe('誘発型能力')
  })

  it('見せていないカードを対象にはできない', () => {
    const forge = triggeredAbility('登場した時', function* (duel) {
      const [enemy] = duel.enemies()
      if (enemy === undefined) throw new Error('敵がいる盤面で試すこと')
      yield* destroy({ ...enemy, id: '味方' })
    })
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵')])

    expect(() =>
      resolveEffect(state, forge.effect, { controller: '先攻', via: VIA, chooser: chooseFirst }),
    ).toThrowError('効果に見せていないカードが対象にされた')
  })
})

// 総合ルール 第2部 第21章 6-2・6-3、第23章 1-1（ADR-0006）
describe('効果から見えるエネルギーゾーン', () => {
  /** それぞれのプレイヤーのエネルギーゾーンに、その枚数のカードを置いた盤面。 */
  function withEnergies(mineCount: number, theirsCount: number): DuelState {
    const energies = (player: '先攻' | '後攻', count: number) =>
      Array.from({ length: count }, (_, index) =>
        instantiate({ id: `${player}のエネルギー${index}`, card: vanilla, owner: player }),
      )
    const board = putInZone(emptyDuelState(), '先攻', 'エネルギーゾーン', energies('先攻', mineCount))
    return putInZone(board, '後攻', 'エネルギーゾーン', energies('後攻', theirsCount))
  }

  /** 効果が数えた、両方のプレイヤーのエネルギーの枚数。 */
  function counted(state: DuelState): readonly number[] {
    const seen: number[] = []
    resolveEffect(
      state,
      function* (duel) {
        seen.push(duel.energyCount(duel.controller), duel.energyCount(duel.opponent))
      },
      { controller: '先攻', via: VIA, chooser: chooseFirst },
    )
    return seen
  }

  // エネルギーゾーンにあるカードをエネルギーと呼ぶ（同 6-2）。
  it('エネルギーゾーンにあるカードの枚数を数えられる', () => {
    expect(counted(withEnergies(3, 1))).toEqual([3, 1])
  })

  // 両方のエネルギーゾーンにあるカードは全てのプレイヤーが見られる（同 6-3）。
  it('相手のエネルギーゾーンも数えられる', () => {
    expect(counted(withEnergies(0, 2))).toEqual([0, 2])
  })

  /** 効果が見た、支配者自身のエネルギーゾーンの中身。 */
  function listed(state: DuelState): readonly CardInZone[] {
    let seen: readonly CardInZone[] = []
    resolveEffect(
      state,
      function* (duel) {
        seen = duel.energyZone()
      },
      { controller: '先攻', via: VIA, chooser: chooseFirst },
    )
    return seen
  }

  it('エネルギーゾーンにあるカードを 1 枚ずつ見られる', () => {
    const seen = listed(withEnergies(2, 0))

    expect(seen.map((card) => card.id)).toEqual(['先攻のエネルギー0', '先攻のエネルギー1'])
    expect(seen.map((card) => card.zone)).toEqual(['エネルギーゾーン', 'エネルギーゾーン'])
  })

  // 中身を返すのは支配者自身のぶんだけである。相手のエネルギーゾーンも公開されている
  // （同 6-3）が、そこから選ぶテキストが無いうちは見せる手段を持たせない。
  it('相手のエネルギーゾーンの中身は返らない', () => {
    expect(listed(withEnergies(0, 2))).toEqual([])
  })

  // 数えることと見ることは別である。数えただけのカードは engine が見せたことにならない
  // ので、対象にはできない（`resolve.ts` の `shown`）。
  it('見たカードは対象にできる', () => {
    const state = withEnergies(1, 0)

    const resolved = resolveEffect(
      state,
      function* (duel) {
        const energy = yield* choose(duel.energyZone())
        if (energy === undefined) throw new Error('エネルギーがある盤面で試すこと')
        yield* placeOnSquare(energy, mySquare, 'リリース')
      },
      { controller: '先攻', via: VIA, chooser: chooseFirst },
    )

    expect(idsOf(cardsOn(resolved, mySquare))).toEqual(['先攻のエネルギー0'])
    expect(cardsIn(resolved, '先攻', 'エネルギーゾーン')).toEqual([])
  })
})

// 総合ルール 第2部 第24章 1・1-1（ADR-0006）
describe('効果によるエネルギーの向きの変更', () => {
  /** 先攻のエネルギーゾーンに、指定した向きのカードを置いた盤面。後攻にもリリース状態を 1 枚置く。 */
  function withEnergies(...orientations: readonly ('リリース' | 'フリーズ')[]): DuelState {
    const board = putInZone(
      emptyDuelState(),
      '先攻',
      'エネルギーゾーン',
      orientations.map((orientation, index) =>
        instantiate({ id: `先攻のエネルギー${index}`, card: vanilla, owner: '先攻', orientation }),
      ),
    )
    return putInZone(board, '後攻', 'エネルギーゾーン', [
      instantiate({ id: '後攻のエネルギー', card: vanilla, owner: '後攻' }),
    ])
  }

  const orientationsOf = (state: DuelState, player: '先攻' | '後攻' = '先攻') =>
    cardsIn(state, player, 'エネルギーゾーン').map((card) => card.orientation)

  /**
   * 「あなたのエネルギーを 1 枚まで選び、フリーズしてよい。そうしたら、ダメージを受ける」。
   * 選べるのはリリース状態のエネルギーだけで、選んだ時にだけ続きが起こる。
   */
  const freezeAnEnergy: Effect = function* (duel) {
    const energy = yield* chooseAtMostOne(duel.energyZone().filter((each) => each.orientation === 'リリース'))
    if (energy === undefined) return
    yield* freeze(energy)
    yield* damagePlayer(duel.controller, 500)
  }

  const resolve = (state: DuelState, effect: Effect, chooser: Chooser = chooseFirst) =>
    resolveEffect(state, effect, { controller: '先攻', via: VIA, chooser })

  /** ログに残った、実行された命令。 */
  const executedInstructions = (state: DuelState) =>
    state.log.flatMap((recorded) => (recorded.event.kind === '命令を実行した' ? [recorded.event.instruction] : []))

  it('効果から見たエネルギーは、いまの向きを持つ', () => {
    let seen: readonly (string | undefined)[] = []
    resolve(withEnergies('リリース', 'フリーズ'), function* (duel) {
      seen = duel.energyZone().map((energy) => energy.orientation)
    })

    expect(seen).toEqual(['リリース', 'フリーズ'])
  })

  it('リリース状態のエネルギーをフリーズする', () => {
    const resolved = resolve(withEnergies('リリース', 'リリース'), freezeAnEnergy)

    expect(orientationsOf(resolved)).toEqual(['フリーズ', 'リリース'])
    // 「そうしたら」の続きが起こる。
    expect(resolved.damage['先攻']).toBe(500)
  })

  it('フリーズ状態のエネルギーをリリースする', () => {
    const resolved = resolve(withEnergies('フリーズ', 'フリーズ'), function* (duel) {
      const energy = yield* choose(duel.energyZone())
      if (energy !== undefined) yield* release(energy)
    })

    expect(orientationsOf(resolved)).toEqual(['リリース', 'フリーズ'])
  })

  it('選ぶ候補はカードの側で向きによって絞れ、フリーズ状態のものは候補に並ばない', () => {
    let offered: readonly unknown[] = []
    resolve(withEnergies('フリーズ', 'リリース', 'フリーズ'), freezeAnEnergy, (candidates) => {
      offered = candidates
      return candidates[0]
    })

    expect(offered).toHaveLength(1)
    expect(offered).toMatchObject([{ id: '先攻のエネルギー1', orientation: 'リリース' }])
  })

  it('選ばなければ、何も起こらず、続きも起こらない', () => {
    const state = withEnergies('リリース', 'リリース')

    const resolved = resolve(state, freezeAnEnergy, () => undefined)

    expect(orientationsOf(resolved)).toEqual(['リリース', 'リリース'])
    expect(resolved.damage['先攻']).toBe(0)
  })

  // 総合ルール 第1部 第1章 3。候補が無ければ選ぶ行動が実行されず、続きも起こらない。
  it('エネルギーが全部フリーズ状態なら、候補が無く、何も起こらない', () => {
    const state = withEnergies('フリーズ', 'フリーズ')
    let asked = false

    const resolved = resolve(state, freezeAnEnergy, (candidates) => {
      asked = true
      return candidates[0]
    })

    expect(asked).toBe(false)
    expect(withoutLog(resolved)).toEqual(withoutLog(state))
  })

  it('エネルギーが 0 枚なら、候補が無く、何も起こらない', () => {
    const state = withEnergies()

    const resolved = resolve(state, freezeAnEnergy)

    expect(withoutLog(resolved)).toEqual(withoutLog(state))
  })

  // 総合ルール 第2部 第24章 1-1。
  it('すでにフリーズ状態のエネルギーはフリーズできず、効果はそのまま続く', () => {
    const state = withEnergies('フリーズ')

    const resolved = resolve(state, function* (duel) {
      const [energy] = duel.energyZone()
      if (energy === undefined) throw new Error('エネルギーがある盤面で試すこと')
      yield* freeze(energy)
      yield* damagePlayer(duel.controller, 500)
    })

    expect(orientationsOf(resolved)).toEqual(['フリーズ'])
    expect(resolved.damage['先攻']).toBe(500)
    // 実行されなかった行動は、ログにも残らない。
    expect(executedInstructions(resolved).map((instruction) => instruction.kind)).toEqual([
      'プレイヤーにダメージを与える',
    ])
  })

  // 総合ルール 第2部 第24章 1-1。
  it('すでにリリース状態のエネルギーはリリースできない', () => {
    const state = withEnergies('リリース')

    const resolved = resolve(state, function* (duel) {
      const [energy] = duel.energyZone()
      if (energy === undefined) throw new Error('エネルギーがある盤面で試すこと')
      yield* release(energy)
    })

    expect(withoutLog(resolved)).toEqual(withoutLog(state))
  })

  it('向きを変えたことは、これまでと同じ形でログに残る', () => {
    const resolved = resolve(withEnergies('リリース'), freezeAnEnergy)

    expect(executedInstructions(resolved)).toContainEqual({
      kind: '向きを変える',
      card: '先攻のエネルギー0',
      orientation: 'フリーズ',
    })
  })

  it('すでにエネルギーゾーンを離れたエネルギーの向きは変わらないが、効果はそのまま続く', () => {
    const state = withEnergies('リリース')

    const resolved = resolve(state, function* (duel) {
      const [energy] = duel.energyZone()
      if (energy === undefined) throw new Error('エネルギーがある盤面で試すこと')
      yield* placeInZone(energy, '捨札', 'リリース')
      yield* freeze(energy)
      yield* damagePlayer(duel.controller, 500)
    })

    expect(orientationsOf(resolved)).toEqual([])
    expect(idsOf(cardsIn(resolved, '先攻', '捨札'))).toEqual(['先攻のエネルギー0'])
    expect(cardsIn(resolved, '先攻', '捨札')[0]?.orientation).toBe('リリース')
    expect(resolved.damage['先攻']).toBe(500)
  })

  it('相手のエネルギーには触れない', () => {
    const resolved = resolve(withEnergies('リリース'), freezeAnEnergy)

    expect(orientationsOf(resolved, '後攻')).toEqual(['リリース'])
  })

  // 見せたカードが相手のエネルギーゾーンへ移ると、その識別子を指すエネルギーは相手のものになる。
  it('相手のエネルギーゾーンにあるカードを指していても、向きは変わらず、ログにも残らない', () => {
    const state = putOnSquare(
      withEnergies('リリース'),
      enemySquare,
      instantiate({ id: '相手のユニット', card: vanilla, owner: '後攻' }),
    )

    const resolved = resolve(state, function* (duel) {
      const enemy = yield* choose(duel.enemies())
      if (enemy === undefined) throw new Error('相手のユニットがいる盤面で試すこと')
      yield* placeInZone(enemy, 'エネルギーゾーン', 'リリース')
      yield* freeze({ id: enemy.id, zone: 'エネルギーゾーン', card: enemy.card, orientation: 'リリース' })
    })

    expect(idsOf(cardsIn(resolved, '後攻', 'エネルギーゾーン'))).toContain('相手のユニット')
    expect(orientationsOf(resolved, '後攻')).toEqual(['リリース', 'リリース'])
    expect(executedInstructions(resolved).map((instruction) => instruction.kind)).not.toContain('向きを変える')
  })

  it('ユニットとして読んだ写しのカードがエネルギーゾーンへ移った後にフリーズしても、エネルギーの向きは変わらない', () => {
    const state = putOnSquare(
      withEnergies('リリース'),
      mySquare,
      instantiate({ id: '味方のユニット', card: vanilla, owner: '先攻' }),
    )

    const resolved = resolve(state, function* (duel) {
      const ally = yield* choose(duel.allies())
      if (ally === undefined) throw new Error('味方のユニットがいる盤面で試すこと')
      yield* placeInZone(ally, 'エネルギーゾーン', 'リリース')
      yield* freeze(ally)
    })

    expect(idsOf(cardsIn(resolved, '先攻', 'エネルギーゾーン'))).toContain('味方のユニット')
    expect(orientationsOf(resolved)).toEqual(['リリース', 'リリース'])
    expect(executedInstructions(resolved).map((instruction) => instruction.kind)).not.toContain('向きを変える')
  })

  it('見せていないエネルギーは対象にできない', () => {
    expect(() =>
      resolve(withEnergies('リリース'), function* () {
        yield* freeze({ id: '先攻のエネルギー0', zone: 'エネルギーゾーン', card: vanilla, orientation: 'リリース' })
      }),
    ).toThrowError('効果に見せていないカードが対象にされた')
  })
})

// 総合ルール 第2部 第21章 7-2・7-3（ADR-0006）
describe('効果から見えるスマッシュ', () => {
  /** それぞれのプレイヤーのスマッシュゾーンに、その枚数のカードを置いた盤面。 */
  function withSmashes(mineCount: number, theirsCount: number): DuelState {
    const smashes = (player: '先攻' | '後攻', count: number) =>
      Array.from({ length: count }, (_, index) =>
        instantiate({ id: `${player}のスマッシュ${index}`, card: vanilla, owner: player }),
      )
    const board = putInZone(emptyDuelState(), '先攻', 'スマッシュゾーン', smashes('先攻', mineCount))
    return putInZone(board, '後攻', 'スマッシュゾーン', smashes('後攻', theirsCount))
  }

  /** 効果が数えた、両方のプレイヤーのスマッシュの枚数。 */
  function counted(state: DuelState): readonly number[] {
    const seen: number[] = []
    resolveEffect(
      state,
      function* (duel) {
        seen.push(duel.smashCount(duel.controller), duel.smashCount(duel.opponent))
      },
      { controller: '先攻', via: VIA, chooser: chooseFirst },
    )
    return seen
  }

  /** 支配者自身のスマッシュを 1 枚まで選び、捨札に置く効果。選んだものを効果が覚えて返す。 */
  function discardingASmash(state: DuelState, chooser: Chooser): { readonly state: DuelState; readonly seen: unknown } {
    let seen: unknown = 'まだ選んでいない'
    const resolved = resolveEffect(
      state,
      function* (duel) {
        const smash = yield* chooseAtMostOne(duel.smashZone())
        seen = smash
        if (smash !== undefined) yield* placeInZone(smash, '捨札', 'リリース')
      },
      { controller: '先攻', via: VIA, chooser },
    )
    return { state: resolved, seen }
  }

  it('両方のプレイヤーのスマッシュの枚数を数えられる', () => {
    expect(counted(withSmashes(3, 1))).toEqual([3, 1])
  })

  // 総合ルール 第2部 第21章 7-3。いつでも、両方のスマッシュゾーンの枚数を数えられる。
  it('相手のスマッシュの枚数も数えられる', () => {
    expect(counted(withSmashes(0, 2))).toEqual([0, 2])
  })

  it('スマッシュが 0 枚なら 0 と数える', () => {
    expect(counted(withSmashes(0, 0))).toEqual([0, 0])
  })

  // 総合ルール 第3部 第19章 1。希望ステップで表向きに置かれたカードは、スマッシュではない。
  it('スマッシュ判定中に表向きで置かれているカードは数えない', () => {
    const state = withSmashes(3, 0)
    const judging: DuelState = {
      ...state,
      smashJudgments: [
        {
          player: '先攻',
          step: '希望ステップ',
          repeats: 1,
          round: 1,
          faceUp: '先攻のスマッシュ0',
          heldBank: [],
          heldTriggered: [],
          startedAt: 0,
        },
      ],
    }

    expect(counted(judging)).toEqual([2, 0])
  })

  it('支配者自身のスマッシュを 1 枚ずつ選べるが、中身は見えない', () => {
    const { seen } = discardingASmash(withSmashes(2, 2), chooseFirst)

    // 効果が受け取るのは識別子とゾーンだけで、カードそのものは含まれない（総合ルール 第2部
    // 第21章 7-3）。
    expect(seen).toEqual({ id: '先攻のスマッシュ0', zone: 'スマッシュゾーン' })
  })

  it('選んだスマッシュを捨札に置ける', () => {
    const state = withSmashes(2, 2)

    const { state: resolved } = discardingASmash(state, (candidates) => candidates[1])

    expect(idsOf(cardsIn(resolved, '先攻', 'スマッシュゾーン'))).toEqual(['先攻のスマッシュ0'])
    expect(idsOf(cardsIn(resolved, '先攻', '捨札'))).toEqual(['先攻のスマッシュ1'])
    // 相手のスマッシュには触れない。
    expect(cardsIn(resolved, '後攻', 'スマッシュゾーン')).toHaveLength(2)
  })

  it('選んだスマッシュの分だけ、数えた枚数が減る', () => {
    const counts: number[] = []
    resolveEffect(
      withSmashes(2, 0),
      function* (duel) {
        const smash = yield* choose(duel.smashZone())
        if (smash === undefined) throw new Error('スマッシュがある盤面で試すこと')
        yield* placeInZone(smash, '捨札', 'リリース')
        counts.push(duel.smashCount(duel.controller))
      },
      { controller: '先攻', via: VIA, chooser: chooseFirst },
    )

    expect(counts).toEqual([1])
  })

  it('選ばないことも選べる', () => {
    const state = withSmashes(2, 0)

    const { state: resolved, seen } = discardingASmash(state, () => undefined)

    expect(seen).toBeUndefined()
    expect(withoutLog(resolved)).toEqual(withoutLog(state))
  })

  // 総合ルール 第1部 第1章 3。候補が無いなら選ぶ行動は実行されず、効果はそのまま続く。
  it('スマッシュが 1 枚も無ければ、選べないまま効果が続く', () => {
    const state = withSmashes(0, 2)

    const { state: resolved, seen } = discardingASmash(state, chooseFirst)

    expect(seen).toBeUndefined()
    expect(withoutLog(resolved)).toEqual(withoutLog(state))
  })

  it('スマッシュ判定中に表向きで置かれているカードは、選ぶ候補にならない', () => {
    const judging: DuelState = {
      ...withSmashes(2, 0),
      smashJudgments: [
        {
          player: '先攻',
          step: '希望ステップ',
          repeats: 1,
          round: 1,
          faceUp: '先攻のスマッシュ0',
          heldBank: [],
          heldTriggered: [],
          startedAt: 0,
        },
      ],
    }

    const { seen } = discardingASmash(judging, chooseFirst)

    expect(seen).toEqual({ id: '先攻のスマッシュ1', zone: 'スマッシュゾーン' })
  })

  it('見せていないスマッシュは対象にできない', () => {
    const state = withSmashes(1, 0)

    expect(() =>
      resolveEffect(
        state,
        function* () {
          yield* placeInZone({ id: '先攻のスマッシュ0', zone: 'スマッシュゾーン' }, '捨札', 'リリース')
        },
        { controller: '先攻', via: VIA, chooser: chooseFirst },
      ),
    ).toThrowError('効果に見せていないカードが対象にされた')
  })
})

// 総合ルール 第4部 第3章 4（ADR-0006）
describe('効果が誘発型能力を作る', () => {
  /** 味方を 1 枚選び、その味方をあなたのターンの終わりにエネルギーゾーンへ置く能力を作る。 */
  const postponing = triggeredAbility('登場した時', function* (duel) {
    const ally = yield* choose(duel.allies())
    if (ally === undefined) throw new Error('味方がいる盤面で試すこと')
    yield* createTriggeredAbility(ally, 'あなたのターンの終わり', function* (_duel, affected) {
      yield* placeInZone(affected, 'エネルギーゾーン', 'フリーズ')
    })
  })

  const created = (state: DuelState): DuelState =>
    resolveEffect(state, postponing.effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

  it('作られた能力を盤面が持つ', () => {
    const resolved = created(boardOf([mySquare, mine()]))

    expect(resolved.createdAbilities.map((each) => each.affecting)).toEqual(['味方'])
    expect(resolved.createdAbilities.map((each) => each.ability.trigger)).toEqual(['あなたのターンの終わり'])
  })

  // 作られた能力の支配者は、作った効果の支配者である（総合ルール 第4部 第7章 1）。
  it('作られた能力の支配者は、作った効果の支配者である', () => {
    const resolved = resolveEffect(boardOf([enemySquare, theirs('敵')]), postponing.effect, {
      controller: '後攻',
      via: VIA,
      chooser: chooseFirst,
    })

    expect(resolved.createdAbilities.map((each) => each.controller)).toEqual(['後攻'])
  })

  // 誘発イベントが起こるまで何も起こらない（総合ルール 第4部 第3章 4）。作った時点では
  // 盤面はそのままで、対象のユニットも動かない。
  it('作っただけでは何も起こらない', () => {
    const resolved = created(boardOf([mySquare, mine()]))

    expect(idsOf(cardsOn(resolved, mySquare))).toEqual(['味方'])
    expect(resolved.triggered).toEqual([])
    expect(resolved.bank).toEqual([])
  })

  it('見せていないカードを対象にはできない', () => {
    const forge = triggeredAbility('登場した時', function* (duel) {
      const [ally] = duel.allies()
      if (ally === undefined) throw new Error('味方がいる盤面で試すこと')
      yield* createTriggeredAbility({ ...ally, id: '敵' }, 'あなたのターンの終わり', function* () {})
    })
    const state = boardOf([mySquare, mine()], [enemySquare, theirs('敵')])

    expect(() =>
      resolveEffect(state, forge.effect, { controller: '先攻', via: VIA, chooser: chooseFirst }),
    ).toThrowError('効果に見せていないカードが対象にされた')
  })
})

/**
 * エリアを選ぶ（#278）。「エリアを 1 つ選び、そのエリアにいる（敵）全員に〜」。
 *
 * 候補に並べるエリアの呼び名は能力の支配者から見たものである（総合ルール 第2部 第22章 6-1）。
 * 先攻の味方エリアは row 0、敵エリアは row 2、後攻ではそれが入れ替わる（`board.ts` の `areaOf`）。
 */
describe('エリアを選ぶ', () => {
  /** 選んだエリアにいるユニット全員（味方も敵も）を破壊する。 */
  const destroyAllInArea: Effect = function* (duel) {
    const area = yield* choose(AREAS)
    if (area === undefined) return
    for (const unit of [...duel.allies(), ...duel.enemies()]) {
      if (areaOf(duel.controller, unit.square) === area) yield* destroy(unit)
    }
    yield* damagePlayer(duel.opponent, 100)
  }

  /** 選んだエリアにいる敵だけを破壊する。 */
  const destroyEnemiesInArea: Effect = function* (duel) {
    const area = yield* choose(AREAS)
    if (area === undefined) return
    for (const enemy of duel.enemies()) {
      if (areaOf(duel.controller, enemy.square) === area) yield* destroy(enemy)
    }
  }

  const choosing =
    (area: Area): Chooser =>
    () =>
      area

  const resolveAs = (controller: '先攻' | '後攻', state: DuelState, effect: Effect, chooser: Chooser) =>
    resolveEffect(state, effect, { controller, via: VIA, chooser })

  const unit = (id: string, owner: '先攻' | '後攻') => instantiate({ id, card: vanilla, owner })

  const executedInstructions = (state: DuelState) =>
    state.log.flatMap((recorded) => (recorded.event.kind === '命令を実行した' ? [recorded.event.instruction] : []))

  // 総合ルール 第2部 第22章 5・6
  it('選んだエリアにいるユニットが全員、効果の対象になる', () => {
    const state = boardOf(
      [{ row: 1, column: 0 }, unit('中央の味方', '先攻')],
      [{ row: 1, column: 2 }, unit('中央の敵', '後攻')],
      [{ row: 2, column: 1 }, unit('敵エリアの敵', '後攻')],
    )

    const resolved = resolveAs('先攻', state, destroyAllInArea, choosing('中央エリア'))

    expect(idsOf(cardsIn(resolved, '先攻', '捨札'))).toEqual(['中央の味方'])
    expect(idsOf(cardsIn(resolved, '後攻', '捨札'))).toEqual(['中央の敵'])
    expect(idsOf(cardsOn(resolved, { row: 2, column: 1 }))).toEqual(['敵エリアの敵'])
  })

  // 総合ルール 第2部 第22章 6
  it('敵だけに作用する書き方もできる', () => {
    const state = boardOf(
      [{ row: 1, column: 0 }, unit('中央の味方', '先攻')],
      [{ row: 1, column: 2 }, unit('中央の敵', '後攻')],
    )

    const resolved = resolveAs('先攻', state, destroyEnemiesInArea, choosing('中央エリア'))

    expect(idsOf(cardsOn(resolved, { row: 1, column: 0 }))).toEqual(['中央の味方'])
    expect(idsOf(cardsIn(resolved, '後攻', '捨札'))).toEqual(['中央の敵'])
  })

  // 総合ルール 第2部 第22章 5。エリアはユニットがいなくても選べる。
  it('ユニットのいないエリアを選んでも何も起きず、効果は続く', () => {
    const state = boardOf([{ row: 1, column: 0 }, unit('中央の敵', '後攻')])

    const resolved = resolveAs('先攻', state, destroyAllInArea, choosing('敵エリア'))

    expect(idsOf(cardsOn(resolved, { row: 1, column: 0 }))).toEqual(['中央の敵'])
    expect(resolved.damage['後攻']).toBe(100)
  })

  // 総合ルール 第2部 第22章 6-1。エリアの呼び名は、支配者から見て決まる。
  it('支配者が後攻でも、敵エリアは後攻から見た敵の側の行を指す', () => {
    const state = boardOf(
      [{ row: 0, column: 1 }, unit('先攻の手前', '先攻')],
      [{ row: 2, column: 1 }, unit('先攻の奥', '先攻')],
    )

    const resolved = resolveAs('後攻', state, destroyEnemiesInArea, choosing('敵エリア'))

    expect(idsOf(cardsIn(resolved, '先攻', '捨札'))).toEqual(['先攻の手前'])
    expect(idsOf(cardsOn(resolved, { row: 2, column: 1 }))).toEqual(['先攻の奥'])
  })

  it('選んだことが、支配者から見た行に直してログに残る', () => {
    const state = boardOf([{ row: 1, column: 0 }, unit('中央の敵', '後攻')])

    const first = resolveAs('先攻', state, destroyEnemiesInArea, choosing('敵エリア'))
    const second = resolveAs('後攻', state, destroyEnemiesInArea, choosing('敵エリア'))

    expect(executedInstructions(first)[0]).toMatchObject({ kind: '選ぶ', areaRow: 2 })
    expect(executedInstructions(second)[0]).toMatchObject({ kind: '選ぶ', areaRow: 0 })
  })
})
