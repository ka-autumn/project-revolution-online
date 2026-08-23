import { describe, expect, it } from 'vitest'
import type { DuelEvent, ToClient, WireChoice, WirePerspective } from '@revolution/engine'
import { applyMessage, connecting } from './session.js'
import type { Session } from './session.js'
import { emptyBoard, logged } from './test-support.js'

/**
 * 届いたものを畳むところ（ADR-0010）。
 *
 * クライアントで確かめられるのはここまでである。**ルールの判断はいっさい持たない**ので、
 * 「この盤面ならこの手が行える」を見ることはできないし、見てはならない。見るのは「届いたものが
 * どう画面に出る形になるか」だけである。
 */

/** 盤面の中身は畳むところに関係しないので、何ターン目かだけを違えて区別する。 */
function board(turn: number): WirePerspective {
  const empty = emptyBoard('先攻')
  return { ...empty, turn: { ...empty.turn, number: turn } }
}

/** ログを積んだ盤面。中身は問わないので、同じできごとを繰り返して使う。 */
function boardWithLog(turn: number, count: number): WirePerspective {
  const event: DuelEvent = { kind: 'バトルが終わった', winner: undefined }
  return { ...board(turn), log: logged(Array.from({ length: count }, () => event)) }
}

const CHOICE: WireChoice = {
  player: '先攻',
  purpose: '効果の対象',
  mayDecline: false,
  answered: 0,
  mayGoBack: true,
  candidates: [{ kind: '見えていない', at: undefined }, { kind: '見えている', card: 'あるカード' }],
}

/** 届いたものを順に畳む。 */
function fold(...messages: readonly ToClient[]): Session {
  return messages.reduce(applyMessage, connecting())
}

const SEATED: ToClient = { kind: '席についた', seat: '先攻' }

describe('届いたものを畳む', () => {
  it('繋いだ直後は、まだ何も届いていない', () => {
    expect(connecting()).toEqual({ stage: { kind: '繋いでいる' }, refusal: undefined })
  })

  it('相手を待っていると言われたら、待っている', () => {
    expect(fold({ kind: '相手を待っている' }).stage).toEqual({ kind: '相手を待っている' })
  })

  it('席についたら、盤面が届く前でも席は分かる', () => {
    const stage = fold(SEATED).stage
    if (stage.kind !== '打っている') throw new Error('打っているはずだった')

    expect(stage.seat).toBe('先攻')
    expect(stage.board).toBeUndefined()
  })

  it('盤面と行える手は一緒に届く', () => {
    const stage = fold(SEATED, {
      kind: '盤面',
      perspective: board(1),
      actions: [{ kind: '優先権を放棄する' }],
      passOutcome: undefined,
    }).stage
    if (stage.kind !== '打っている') throw new Error('打っているはずだった')

    expect(stage.board).toEqual(board(1))
    expect(stage.actions).toEqual([{ kind: '優先権を放棄する' }])
  })

  /**
   * 行える手を数えるのはサーバである（ADR-0010）。届いたものをそのまま持つだけで、優先権を
   * 持っていないほうには空で届く（`server` の `room.ts` の `boards`）。
   */
  it('行える手が空なら、行えることは無い', () => {
    const stage = fold(SEATED, { kind: '盤面', perspective: board(1), actions: [], passOutcome: undefined }).stage
    if (stage.kind !== '打っている') throw new Error('打っているはずだった')

    expect(stage.actions).toEqual([])
  })

  it('選んでほしいと言われたら、候補を覚える', () => {
    const stage = fold(SEATED, { kind: '選んでほしい', choice: CHOICE }).stage
    if (stage.kind !== '打っている') throw new Error('打っているはずだった')

    expect(stage.choice).toEqual(CHOICE)
  })

  /**
   * 選んでいる間は行えることが無い。サーバも `選ぶのを待っている` として断る（`room.ts` の
   * `act`）ので、1 つ前の盤面と一緒に届いた手を並べ続けてはならない（#14 の完了条件）。
   */
  it('選んでほしいと言われたら、行える手は消える', () => {
    const acting = fold(SEATED, {
      kind: '盤面',
      perspective: board(1),
      actions: [{ kind: '優先権を放棄する' }],
      passOutcome: undefined,
    })

    const stage = applyMessage(acting, { kind: '選んでほしい', choice: CHOICE }).stage
    if (stage.kind !== '打っている') throw new Error('打っているはずだった')

    expect(stage.actions).toEqual([])
  })

  /** 選び終われば盤面が動く。答えるものはもう無い。 */
  it('盤面が届いたら、選ぶことは終わっている', () => {
    const stage = fold(SEATED, { kind: '選んでほしい', choice: CHOICE }, {
      kind: '盤面',
      perspective: board(2),
      actions: [],
      passOutcome: undefined,
    }).stage
    if (stage.kind !== '打っている') throw new Error('打っているはずだった')

    expect(stage.choice).toBeUndefined()
  })

  it('入り直して席についたら、前の盤面は残らない', () => {
    const played = fold(SEATED, { kind: '盤面', perspective: board(1), actions: [], passOutcome: undefined })
    const stage = applyMessage(played, SEATED).stage
    if (stage.kind !== '打っている') throw new Error('打っているはずだった')

    expect(stage.board).toBeUndefined()
  })
})

/**
 * この盤面で新しく届いたできごと（#104）。カットインが読む分で、盤面の中身そのものは
 * 問わないので、ログの長さの変化だけを見る。
 */
describe('この盤面で新しく届いたできごと', () => {
  it('最初の盤面では、まだ何も新しくない', () => {
    const stage = fold(SEATED, { kind: '盤面', perspective: boardWithLog(1, 2), actions: [], passOutcome: undefined }).stage
    if (stage.kind !== '打っている') throw new Error('打っているはずだった')

    expect(stage.fresh).toEqual([])
  })

  it('増えた分だけが新しく届いたことになる', () => {
    const stage = fold(
      SEATED,
      { kind: '盤面', perspective: boardWithLog(1, 2), actions: [], passOutcome: undefined },
      { kind: '盤面', perspective: boardWithLog(2, 5), actions: [], passOutcome: undefined },
    ).stage
    if (stage.kind !== '打っている') throw new Error('打っているはずだった')

    expect(stage.fresh).toEqual(boardWithLog(2, 5).log.slice(2))
  })

  // ADR-0009。入り直しても最初の盤面から届くので、それまでの履歴を演出し直してはならない。
  it('入り直して席についたら、空に戻る', () => {
    const played = fold(SEATED, { kind: '盤面', perspective: boardWithLog(1, 3), actions: [], passOutcome: undefined })
    const stage = applyMessage(played, SEATED).stage
    if (stage.kind !== '打っている') throw new Error('打っているはずだった')

    expect(stage.fresh).toEqual([])
  })

  // ADR-0008。やり直すとログが短くなることがあるが、その時は何も演出しない。
  it('ログが短くなっていたら、新しく届いた分は無い', () => {
    const stage = fold(
      SEATED,
      { kind: '盤面', perspective: boardWithLog(1, 5), actions: [], passOutcome: undefined },
      { kind: '盤面', perspective: boardWithLog(2, 2), actions: [], passOutcome: undefined },
    ).stage
    if (stage.kind !== '打っている') throw new Error('打っているはずだった')

    expect(stage.fresh).toEqual([])
  })

  // 選んでいる間に新しいできごとが増えることは無い（盤面が動いていないため）。参照が変わら
  // なければ、同じカットインを出し直すことも無い。
  it('選んでほしいが届いても、新しく届いた分は変わらない', () => {
    const acting = fold(SEATED, { kind: '盤面', perspective: boardWithLog(1, 2), actions: [], passOutcome: undefined })
    const before = acting.stage.kind === '打っている' ? acting.stage.fresh : undefined

    const stage = applyMessage(acting, {
      kind: '選んでほしい',
      choice: { player: '先攻', purpose: '効果の対象', mayDecline: false, answered: 0, mayGoBack: true, candidates: [] },
    }).stage
    if (stage.kind !== '打っている') throw new Error('打っているはずだった')

    expect(stage.fresh).toBe(before)
  })
})

/**
 * 1 つ前の盤面でのターン（#96）。フェイズ・ターンが変わったことを知らせる演出
 * （`view-model.ts` の `transitionViews`）が比べる相手にする。
 */
describe('1 つ前の盤面でのターン', () => {
  it('最初の盤面には、比べる相手がいない', () => {
    const stage = fold(SEATED, { kind: '盤面', perspective: board(1), actions: [], passOutcome: undefined }).stage
    if (stage.kind !== '打っている') throw new Error('打っているはずだった')

    expect(stage.previousTurn).toBeUndefined()
  })

  it('次の盤面が届いたら、1 つ前の盤面のターンを覚える', () => {
    const stage = fold(
      SEATED,
      { kind: '盤面', perspective: board(1), actions: [], passOutcome: undefined },
      { kind: '盤面', perspective: board(2), actions: [], passOutcome: undefined },
    ).stage
    if (stage.kind !== '打っている') throw new Error('打っているはずだった')

    expect(stage.previousTurn).toEqual(board(1).turn)
  })

  // ADR-0009。入り直しても最初の盤面から届くので、それまでのターンを比べ相手にしてはならない。
  it('入り直して席についたら、比べる相手は無くなる', () => {
    const played = fold(
      SEATED,
      { kind: '盤面', perspective: board(1), actions: [], passOutcome: undefined },
      { kind: '盤面', perspective: board(2), actions: [], passOutcome: undefined },
    )
    const stage = applyMessage(played, SEATED).stage
    if (stage.kind !== '打っている') throw new Error('打っているはずだった')

    expect(stage.previousTurn).toBeUndefined()
  })

  it('選んでほしいが届いても、比べる相手は変わらない', () => {
    const acting = fold(
      SEATED,
      { kind: '盤面', perspective: board(1), actions: [], passOutcome: undefined },
      { kind: '盤面', perspective: board(2), actions: [], passOutcome: undefined },
    )

    const stage = applyMessage(acting, {
      kind: '選んでほしい',
      choice: { player: '先攻', purpose: '効果の対象', mayDecline: false, answered: 0, mayGoBack: true, candidates: [] },
    }).stage
    if (stage.kind !== '打っている') throw new Error('打っているはずだった')

    expect(stage.previousTurn).toEqual(board(1).turn)
  })
})

describe('断られたこと', () => {
  it('断られた理由を覚える', () => {
    expect(fold(SEATED, { kind: '行えなかった', reason: '優先権が無い' }).refusal).toBe('優先権が無い')
  })

  /** 席につく前にも断られる。3 人目が入ろうとした場合がこれにあたる（`room.ts` の `enter`）。 */
  it('席につく前に断られても覚える', () => {
    const session = fold({ kind: '行えなかった', reason: '部屋がいっぱい' })

    expect(session.stage).toEqual({ kind: '繋いでいる' })
    expect(session.refusal).toBe('部屋がいっぱい')
  })

  it('盤面が動いたら消える', () => {
    const refused = fold(SEATED, { kind: '行えなかった', reason: '行えない行動' })

    const advanced = applyMessage(refused, { kind: '盤面', perspective: board(2), actions: [], passOutcome: undefined })

    expect(advanced.refusal).toBeUndefined()
  })
})
