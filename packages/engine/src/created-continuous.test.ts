import { describe, expect, it } from 'vitest'
import { bpModification, continuousData, spModification } from './continuous.js'
// ゾーンを移したり盤面を組んだりするためだけに使う。engine の中から盤面を組み替える関数であり、
// 公開する API ではない。
import { moveToSquare, moveToZone, putInZone } from './duel.js'
import {
  bpModifying,
  bpOf,
  bpPlus,
  cardsIn,
  cardsOn,
  choose,
  createContinuousEffect,
  defineUnit,
  emptyDuelState,
  instantiate,
  passPriority,
  perspectiveOf,
  putOnSquare,
  resolveEffect,
  spOf,
  spPlus,
} from './index.js'
import type { CardId, Chooser, DuelEvent, DuelState, Effect, ResolutionVia, Square } from './index.js'

/**
 * 作成された継続効果（総合ルール 第4部 第12章 3、ADR-0036）。
 *
 * 検証したいルールだけを持つ架空のテストカードで書く（ADR-0001・ADR-0002）。カードの実装が
 * engine の公開 API だけで書けていることも、ここで示される。
 */
const VIA: ResolutionVia = '誘発'

const vanilla = defineUnit({ name: 'テスト・バニラ', level: 1, colors: ['赤'], bp: 1000, sp: 1000 })

/** 他の味方のＢＰを＋2000 する常在型能力を持つユニット。作成された継続効果と合わせて読む。 */
const boosting = defineUnit({
  name: 'テスト・味方を強化',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [
    bpModifying((duel) =>
      duel
        .allies()
        .filter((ally) => ally.id !== duel.self()?.id)
        .map((ally) => bpPlus(ally, 2000)),
    ),
  ],
})

const left: Square = { row: 2, column: 0 }
const middle: Square = { row: 2, column: 1 }
const right: Square = { row: 2, column: 2 }

const unit = (id: CardId, card = vanilla) => instantiate({ id, card, owner: '先攻' })

function boardOf(...placements: readonly (readonly [Square, CardId, typeof vanilla?])[]): DuelState {
  return placements.reduce(
    (state, [square, id, card]) => putOnSquare(state, square, unit(id, card)),
    emptyDuelState(),
  )
}

/** 候補のうち、その識別子のカードを選ぶ。 */
const choosing =
  (id: CardId): Chooser =>
  (candidates) =>
    (candidates as readonly { readonly id: CardId }[]).find((candidate) => candidate.id === id)

const chooseFirst: Chooser = (candidates) => candidates[0]

/** 味方を 1 枚選び、「ターンの終わりまで、ＢＰを＋Ｎ」の継続効果を作る効果。 */
const boostAlly = (amount: number): Effect =>
  function* (duel) {
    const ally = yield* choose(duel.allies())
    if (ally === undefined) throw new Error('味方がいる盤面で試すこと')
    yield* createContinuousEffect('ターンの終わりまで', bpPlus(ally, amount))
  }

/** そのユニットを選んで、その効果を解決した盤面。 */
function resolved(state: DuelState, effect: Effect, target: CardId): DuelState {
  return resolveEffect(state, effect, { controller: '先攻', via: VIA, chooser: choosing(target) })
}

/** そのユニットのＢＰ。継続効果を適用した後の値で読む。 */
const bpOn = (state: DuelState, id: CardId, card = vanilla) => bpOf(card, bpModification(state)(id))

const eventsOf = (state: DuelState): readonly DuelEvent[] => state.log.map((recorded) => recorded.event)

// 総合ルール 第4部 第12章 3（ADR-0006）
describe('作成された継続効果を作る', () => {
  it('作った効果を、盤面が値として持つ', () => {
    const state = resolved(boardOf([middle, '味方']), boostAlly(3000), '味方')

    expect(state.createdContinuousEffects).toEqual([
      { target: '味方', change: { kind: 'ＢＰの変更', amount: 3000 }, until: 'ターンの終わりまで', controller: '先攻' },
    ])
  })

  // 同 第12章 2・5-2 の(5)
  it('作った後のＢＰに、変更が現れる', () => {
    const state = resolved(boardOf([middle, '味方']), boostAlly(3000), '味方')

    expect(bpOn(state, '味方')).toBe(4000)
    expect(continuousData(state)('味方', vanilla).bp).toBe(4000)
  })

  it('作る前のＢＰは、カードに書かれた数字のままである', () => {
    expect(bpOn(boardOf([middle, '味方']), '味方')).toBe(1000)
  })

  // 同 第12章 4-1 は常在型能力、3 は作成された継続効果。読む所で合わせる（ADR-0036）。
  it('常在型能力が生み出した分に、足される', () => {
    const board = boardOf([left, '強化するユニット', boosting], [middle, '味方'])

    expect(bpOn(board, '味方')).toBe(3000)
    expect(bpOn(resolved(board, boostAlly(1500), '味方'), '味方')).toBe(4500)
  })

  // 同 第12章 3-2・3-3: 発生した時点で影響を受けなかったカードには影響しない。
  it('作った後にスクエアに置かれたユニットには、及ばない', () => {
    const made = resolved(boardOf([middle, '味方']), boostAlly(3000), '味方')
    const later = putOnSquare(made, right, unit('後から置かれた味方'))

    expect(bpOn(later, '後から置かれた味方')).toBe(1000)
    expect(bpOn(later, '味方')).toBe(4000)
  })

  // 同 第12章 5-4 に備えて、並びは発生した順を保つ（ADR-0036）。
  it('効果が複数あれば、発生した順を保ち、その分だけ足される', () => {
    const board = boardOf([left, '先に選ぶ味方'], [middle, '味方'])
    const first = resolved(board, boostAlly(1000), '味方')
    const second = resolved(first, boostAlly(2500), '先に選ぶ味方')
    const third = resolved(second, boostAlly(500), '味方')

    expect(third.createdContinuousEffects.map((effect) => [effect.target, effect.change.amount])).toEqual([
      ['味方', 1000],
      ['先に選ぶ味方', 2500],
      ['味方', 500],
    ])
    expect(bpOn(third, '味方')).toBe(1000 + 1000 + 500)
    expect(bpOn(third, '先に選ぶ味方')).toBe(1000 + 2500)
  })

  it('1 つの命令で複数の変更を渡せば、1 件ずつ作る', () => {
    const effect: Effect = function* (duel) {
      const [a, b] = duel.allies()
      if (a === undefined || b === undefined) throw new Error('味方が 2 枚いる盤面で試すこと')
      yield* createContinuousEffect('ターンの終わりまで', bpPlus(a, 1000), bpPlus(b, 2000))
    }
    const state = resolveEffect(boardOf([left, 'A'], [middle, 'B']), effect, {
      controller: '先攻',
      via: VIA,
      chooser: (candidates) => candidates[0],
    })

    expect(state.createdContinuousEffects.map((each) => [each.target, each.change.amount])).toEqual([
      ['A', 1000],
      ['B', 2000],
    ])
  })

  // 効果は engine が見せたユニットしか対象にできない（`resolve.ts` の `shown`）。
  it('見せていないカードを対象にはできない', () => {
    const forge: Effect = function* (duel) {
      const [ally] = duel.allies()
      if (ally === undefined) throw new Error('味方がいる盤面で試すこと')
      yield* createContinuousEffect('ターンの終わりまで', bpPlus({ ...ally, id: 'よそのカード' }, 1000))
    }

    expect(() =>
      resolveEffect(boardOf([middle, '味方']), forge, { controller: '先攻', via: VIA, chooser: (c) => c[0] }),
    ).toThrowError('効果に見せていないカードが対象にされた')
  })

  // 同 第4部 第7章 1
  it('支配者は、作った効果の支配者である', () => {
    const board = putOnSquare(emptyDuelState(), middle, instantiate({ id: '敵', card: vanilla, owner: '後攻' }))
    const effect: Effect = function* (duel) {
      const [enemy] = duel.enemies()
      if (enemy === undefined) throw new Error('敵がいる盤面で試すこと')
      yield* createContinuousEffect('ターンの終わりまで', bpPlus(enemy, -500))
    }
    const state = resolveEffect(board, effect, { controller: '先攻', via: VIA, chooser: (c) => c[0] })

    expect(state.createdContinuousEffects.map((each) => each.controller)).toEqual(['先攻'])
  })

  it('作ったことが、ログに積まれる', () => {
    const state = resolved(boardOf([middle, '味方']), boostAlly(3000), '味方')

    expect(
      eventsOf(state).flatMap((event) => (event.kind === '命令を実行した' ? [event.instruction] : [])),
    ).toContainEqual({
      kind: '継続効果を作成する',
      card: '味方',
      duration: 'ターンの終わりまで',
      change: { kind: 'ＢＰの変更', amount: 3000 },
    })
  })
})

// 総合ルール 第4部 第12章 3-1、第3章 4-1 と同じ場所で取り除く（ADR-0036）
describe('作成された継続効果と、カードの移動', () => {
  /** 'A' が 'B' に効果を作った盤面。A は作ったカード、B は対象。 */
  function made(): DuelState {
    return resolved(boardOf([left, 'A'], [middle, 'B']), boostAlly(3000), 'B')
  }

  // 同 第12章 3-1: テキストが指定する期間継続する。
  it('作ったカードが場を離れても、続く', () => {
    const moved = moveToZone(made(), 'A', '捨札')

    expect(moved.createdContinuousEffects).toHaveLength(1)
    expect(bpOn(moved, 'B')).toBe(4000)
  })

  it('対象がスクエアからスクエアへ移動しても、続く', () => {
    const moved = moveToSquare(made(), 'B', right, { controller: '先攻', orientation: 'リリース' })

    expect(moved.createdContinuousEffects).toHaveLength(1)
    expect(bpOn(moved, 'B')).toBe(4000)
  })

  it('対象がスクエアから捨札に置かれると、取り除かれる', () => {
    expect(moveToZone(made(), 'B', '捨札').createdContinuousEffects).toEqual([])
  })

  // 総合ルール 第2部 第21章 1-4。ゾーンを移ったカードは新しいカードとして扱われるので、手札に
  // 戻して同じターンに出し直したユニットは、効果を受けていないカードとして出る。
  it('対象が手札へ戻り、出し直されても、効果は付き直さない', () => {
    const returned = moveToZone(made(), 'B', '手札')
    const replayed = moveToSquare(returned, 'B', middle, { controller: '先攻', orientation: 'リリース' })

    expect(replayed.createdContinuousEffects).toEqual([])
    expect(bpOn(replayed, 'B')).toBe(1000)
  })

  it('対象がゾーンからスクエアへ移動した時も、取り除かれる', () => {
    const inZone = putInZone(emptyDuelState(), '先攻', 'エネルギーゾーン', [unit('B')])
    const state: DuelState = {
      ...inZone,
      createdContinuousEffects: [
        { target: 'B', change: { kind: 'ＢＰの変更', amount: 3000 }, until: 'ターンの終わりまで', controller: '先攻' },
      ],
    }

    const moved = moveToSquare(state, 'B', middle, { controller: '先攻', orientation: 'リリース' })

    expect(moved.createdContinuousEffects).toEqual([])
  })

  it('対象ではないカードが動いても、取り除かれない', () => {
    expect(moveToZone(made(), 'A', '手札').createdContinuousEffects).toHaveLength(1)
  })

  it('対象が別の効果の対象でもあれば、動いた対象あての分だけが取り除かれる', () => {
    const both = resolved(made(), boostAlly(500), 'A')

    const moved = moveToZone(both, 'B', '捨札')

    expect(moved.createdContinuousEffects.map((each) => each.target)).toEqual(['A'])
  })
})

// 総合ルール 第1部 第2章 2（ADR-0036）
describe('ＢＰが 0 を下回る時', () => {
  const reduce = (state: DuelState, amount: number) => resolved(state, boostAlly(amount), '味方')

  it('読む所では 0 として扱う', () => {
    const state = reduce(boardOf([middle, '味方']), -3000)

    expect(bpOn(state, '味方')).toBe(0)
    expect(continuousData(state)('味方', vanilla).bp).toBe(0)
  })

  // 合計は負のまま持つ。「その数値が変更される時には、マイナスになった数値を元に計算」。
  it('変更の合計は、負のまま持つ', () => {
    const state = reduce(boardOf([middle, '味方']), -3000)

    expect(bpModification(state)('味方')).toBe(-3000)
  })

  it('さらに足す時は、マイナスになった数値を元に計算する', () => {
    const state = reduce(reduce(boardOf([middle, '味方']), -3000), 1500)

    // 1000 - 3000 + 1500 = -500 → 0。0 に 1500 を足した 1500 にはならない。
    expect(bpOn(state, '味方')).toBe(0)
    expect(bpOn(reduce(state, 1000), '味方')).toBe(500)
  })

  // 総合ルール 第4部 第14章 4-5。ＢＰが 0 以下のユニットは、次に優先権が発生する時に捨札に置かれる。
  // 取り除かれたユニットあての効果は、ゾーンを移った時に消える（同 第2部 第21章 1-4）。
  it('作成された継続効果でＢＰが 0 以下になったユニットは、次に優先権が発生する時に捨札に置かれ、その効果も消える', () => {
    // 山札が空のプレイヤーは敗北する（同 第4部 第14章 4-2）ので、決着しないよう 1 枚ずつ置く。
    const stocked = putInZone(
      putInZone(boardOf([middle, '味方']), '先攻', '山札', [unit('先攻の山札')]),
      '後攻',
      '山札',
      [instantiate({ id: '後攻の山札', card: vanilla, owner: '後攻' })],
    )
    const lowered = reduce(stocked, -3000)
    expect(cardsOn(lowered, middle).map((card) => card.id)).toEqual(['味方'])

    const after = passPriority(lowered, chooseFirst)

    expect(cardsOn(after, middle)).toEqual([])
    expect(cardsIn(after, '先攻', '捨札').map((card) => card.id)).toEqual(['味方'])
    expect(after.createdContinuousEffects).toEqual([])
  })

  it('下げる変更を、ログに符号つきで残す', () => {
    const state = reduce(boardOf([middle, '味方']), -3000)

    expect(
      eventsOf(state).flatMap((event) => (event.kind === '命令を実行した' ? [event.instruction] : [])),
    ).toContainEqual(
      expect.objectContaining({ kind: '継続効果を作成する', change: { kind: 'ＢＰの変更', amount: -3000 } }),
    )
  })
})

describe('作成された継続効果は、通信に載らない', () => {
  it('射影した盤面は、効果の一覧を持たない。適用した後のデータを持つ', () => {
    const state = resolved(boardOf([middle, '味方']), boostAlly(3000), '味方')
    const projected = perspectiveOf(state, '先攻')

    expect(projected).not.toHaveProperty('createdContinuousEffects')
    expect(projected.effective.find((data) => data.card === '味方')?.bp).toBe(4000)
  })
})

/** 味方を 1 枚選び、「ターンの終わりまで、ＳＰを＋Ｎ」の継続効果を作る効果。 */
const raiseSp = (amount: number): Effect =>
  function* (duel) {
    const ally = yield* choose(duel.allies())
    if (ally === undefined) throw new Error('味方がいる盤面で試すこと')
    yield* createContinuousEffect('ターンの終わりまで', spPlus(ally, amount))
  }

/** そのユニットのＳＰ。継続効果を適用した後の値で読む。 */
const spOn = (state: DuelState, id: CardId, card = vanilla) => spOf(card, spModification(state)(id))

// 総合ルール 第4部 第12章 5-2 の(5)。ＢＰの変更とＳＰの変更は同じ種類で、同じ仕組みに乗る（ADR-0036）
describe('ＳＰを変える作成された継続効果', () => {
  it('作った効果を、盤面が値として持つ', () => {
    const state = resolved(boardOf([middle, '味方']), raiseSp(500), '味方')

    expect(state.createdContinuousEffects).toEqual([
      { target: '味方', change: { kind: 'ＳＰの変更', amount: 500 }, until: 'ターンの終わりまで', controller: '先攻' },
    ])
  })

  // 同 第12章 2
  it('作った後のＳＰに、変更が現れる。作る前は、カードに書かれた数字のままである', () => {
    const board = boardOf([middle, '味方'])
    const state = resolved(board, raiseSp(500), '味方')

    expect(spOn(board, '味方')).toBe(1000)
    expect(spOn(state, '味方')).toBe(1500)
    expect(continuousData(state)('味方', vanilla).sp).toBe(1500)
  })

  it('効果が複数あれば、その分だけ足される', () => {
    const board = boardOf([left, '先に選ぶ味方'], [middle, '味方'])
    const state = resolved(resolved(resolved(board, raiseSp(500), '味方'), raiseSp(300), '先に選ぶ味方'), raiseSp(200), '味方')

    expect(spOn(state, '味方')).toBe(1000 + 500 + 200)
    expect(spOn(state, '先に選ぶ味方')).toBe(1000 + 300)
  })

  // 同 第12章 3-2・3-3
  it('作った後にスクエアに置かれたユニットには、及ばない', () => {
    const made = resolved(boardOf([middle, '味方']), raiseSp(500), '味方')
    const later = putOnSquare(made, right, unit('後から置かれた味方'))

    expect(spOn(later, '後から置かれた味方')).toBe(1000)
  })

  // 同 第12章 5-2 の(5): どちらも「ＢＰやＳＰを変更する継続効果」だが、互いの値は見ない。
  it('ＢＰの変更と同じ対象に作っても、互いの値に影響しない', () => {
    const board = boardOf([middle, '味方'])
    const state = resolved(resolved(board, boostAlly(3000), '味方'), raiseSp(500), '味方')

    expect(bpOn(state, '味方')).toBe(4000)
    expect(spOn(state, '味方')).toBe(1500)
    expect(bpModification(state)('味方')).toBe(3000)
    expect(spModification(state)('味方')).toBe(500)
    const data = continuousData(state)('味方', vanilla)
    expect([data.bp, data.sp]).toEqual([4000, 1500])
  })

  it('1 つの命令でＢＰとＳＰの変更を渡せば、1 件ずつ作る', () => {
    const effect: Effect = function* (duel) {
      const [ally] = duel.allies()
      if (ally === undefined) throw new Error('味方がいる盤面で試すこと')
      yield* createContinuousEffect('ターンの終わりまで', bpPlus(ally, 1000), spPlus(ally, 200))
    }
    const state = resolveEffect(boardOf([middle, '味方']), effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

    expect(state.createdContinuousEffects.map((each) => each.change)).toEqual([
      { kind: 'ＢＰの変更', amount: 1000 },
      { kind: 'ＳＰの変更', amount: 200 },
    ])
  })

  // 常在型能力が返す型はＢＰの変更に絞られるので、ＳＰの変更を返す能力は型で書けない。
  it('常在型能力のＢＰの変更は、ＳＰに影響しない', () => {
    const board = boardOf([left, '強化するユニット', boosting], [middle, '味方'])

    expect(bpOn(board, '味方')).toBe(3000)
    expect(spOn(board, '味方')).toBe(1000)
  })

  it('作ったことが、ログに積まれる', () => {
    const state = resolved(boardOf([middle, '味方']), raiseSp(500), '味方')

    expect(
      eventsOf(state).flatMap((event) => (event.kind === '命令を実行した' ? [event.instruction] : [])),
    ).toContainEqual({
      kind: '継続効果を作成する',
      card: '味方',
      duration: 'ターンの終わりまで',
      change: { kind: 'ＳＰの変更', amount: 500 },
    })
  })

  // 同 第12章 3-1、第3章 4-1 と同じ場所で取り除く（ADR-0036）
  it('対象がスクエアからスクエアへ移動しても、続く。それ以外のゾーン移動で取り除かれる', () => {
    const made = resolved(boardOf([middle, '味方']), raiseSp(500), '味方')
    const moved = moveToSquare(made, '味方', right, { controller: '先攻', orientation: 'リリース' })

    expect(spOn(moved, '味方')).toBe(1500)
    expect(moveToZone(made, '味方', '捨札').createdContinuousEffects).toEqual([])
    const replayed = moveToSquare(moveToZone(made, '味方', '手札'), '味方', middle, {
      controller: '先攻',
      orientation: 'リリース',
    })
    expect(spOn(replayed, '味方')).toBe(1000)
  })

  it('射影した盤面は、効果の一覧を持たない。適用した後のＳＰを持つ', () => {
    const state = resolved(boardOf([middle, '味方']), raiseSp(500), '味方')
    const projected = perspectiveOf(state, '先攻')

    expect(projected).not.toHaveProperty('createdContinuousEffects')
    expect(projected.effective.find((data) => data.card === '味方')).toMatchObject({ bp: 1000, sp: 1500 })
  })
})

// 総合ルール 第1部 第2章 2（ADR-0036）
describe('ＳＰが 0 を下回る時', () => {
  const reduce = (state: DuelState, amount: number) => resolved(state, raiseSp(amount), '味方')

  it('読む所では 0 として扱う', () => {
    const state = reduce(boardOf([middle, '味方']), -1500)

    expect(spOn(state, '味方')).toBe(0)
    expect(continuousData(state)('味方', vanilla).sp).toBe(0)
  })

  it('変更の合計は、負のまま持つ', () => {
    expect(spModification(reduce(boardOf([middle, '味方']), -1500))('味方')).toBe(-1500)
  })

  it('さらに足す時は、マイナスになった数値を元に計算する', () => {
    const state = reduce(reduce(boardOf([middle, '味方']), -1500), 1000)

    // 1000 - 1500 + 1000 = 500。0 に 1000 を足した 1000 にはならない。
    expect(spOn(state, '味方')).toBe(500)
  })

  // 同 第4部 第14章 4-5・4-6 はＢＰの規定である。ＳＰが 0 以下でも、ユニットは捨札に置かれない。
  it('ＳＰが 0 以下になったユニットは、捨札に置かれない', () => {
    const stocked = putInZone(
      putInZone(boardOf([middle, '味方']), '先攻', '山札', [unit('先攻の山札')]),
      '後攻',
      '山札',
      [instantiate({ id: '後攻の山札', card: vanilla, owner: '後攻' })],
    )
    const after = passPriority(reduce(stocked, -1500), chooseFirst)

    expect(cardsOn(after, middle).map((card) => card.id)).toEqual(['味方'])
  })

  it('下げる変更を、ログに符号つきで残す', () => {
    const state = reduce(boardOf([middle, '味方']), -1500)

    expect(
      eventsOf(state).flatMap((event) => (event.kind === '命令を実行した' ? [event.instruction] : [])),
    ).toContainEqual(
      expect.objectContaining({ kind: '継続効果を作成する', change: { kind: 'ＳＰの変更', amount: -1500 } }),
    )
  })
})
