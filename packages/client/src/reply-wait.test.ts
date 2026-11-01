import { describe, expect, it } from 'vitest'
import type { LegalAction, ToClient } from '@revolution/engine'
import { NOT_WAITING, WAITING, afterLinkChange, afterMessage, isReply, trySend } from './reply-wait.js'
import type { DuelMove, ReplyWait } from './reply-wait.js'
import { emptyBoard } from './test-support.js'

/**
 * 手を送ってから返事が届くまでの待ち（#253）。
 *
 * 画面（`index.ts`）は、押されたら `trySend` に尋ね、届いたら `afterMessage` を通し、繋がりの様子が
 * 変わったら `afterLinkChange` を通す。ここで見るのは、その順に並べた時に何通送られるかである。
 * 盤面や行える手の中身は待ちに関係しないので、空の盤面で足りる。
 */

const PASS: LegalAction = { kind: '優先権を放棄する' }
const PASS_MOVE: DuelMove = { kind: '行動する', action: PASS }

const BOARD: ToClient = { kind: '盤面', perspective: emptyBoard('先攻'), actions: [PASS], passOutcome: undefined }
const CHOOSE: ToClient = {
  kind: '選んでほしい',
  choice: {
    player: '先攻',
    purpose: '効果の対象',
    mayDecline: false,
    answered: 0,
    mayGoBack: true,
    mayCancel: true,
    candidates: [{ kind: '見えていない', at: undefined }],
  },
}
const REFUSED: ToClient = { kind: '行えなかった', reason: '行えない行動' }
const OPPONENT_LINK: ToClient = { kind: '相手の繋がり', connected: false }
const SEATED: ToClient = {
  kind: '席についた',
  seat: '先攻',
  room: 'あいことば',
  opponent: { kind: 'CPU' },
  own: 'わたし',
}

const WAITING_FOR_OPPONENT: ToClient = { kind: '相手を待っている', room: 'あいことば' }
const LOBBY: ToClient = {
  kind: 'ロビー',
  rooms: [],
  presets: [],
  chosen: undefined,
  cpuChosen: undefined,
  restrictions: [],
  own: 'わたし',
}

/** 画面が受けるできごと。押した・届いた・切れた・繋がった。 */
type Happening =
  | { readonly kind: '押した'; readonly move: DuelMove }
  | { readonly kind: '届いた'; readonly message: ToClient }
  | { readonly kind: '切れた' }
  | { readonly kind: '繋がった'; readonly rejoining: boolean }

const press = (move: DuelMove = PASS_MOVE): Happening => ({ kind: '押した', move })
const arrive = (message: ToClient): Happening => ({ kind: '届いた', message })
const cut: Happening = { kind: '切れた' }
/** 繋がった。部屋にいるなら、`connection.ts` が `部屋に入る` を送る。 */
const reconnect = (rejoining = true): Happening => ({ kind: '繋がった', rejoining })

/** できごとを順に通し、送られた手を返す。`index.ts` の `move`・`onMessage`・`onLinkChanged` と同じ並べ方。 */
function run(...happenings: readonly Happening[]): readonly DuelMove[] {
  let waiting: ReplyWait = NOT_WAITING
  const sent: DuelMove[] = []
  for (const happening of happenings) {
    switch (happening.kind) {
      case '押した': {
        const next = trySend(waiting)
        waiting = next.waiting
        if (next.send) sent.push(happening.move)
        break
      }
      case '届いた':
        waiting = afterMessage(waiting, happening.message)
        break
      case '切れた':
        waiting = afterLinkChange({ kind: '繋ごうとしている', attempt: 1 }, true)
        break
      case '繋がった':
        waiting = afterLinkChange({ kind: '繋がっている' }, happening.rejoining)
        break
    }
  }

  return sent
}

describe('手を送ってから返事が届くまで', () => {
  it('優先権の放棄を素早く 2 回押しても、送るのは 1 通だけ', () => {
    expect(run(press(), press())).toEqual([PASS_MOVE])
  })

  it('3 回以上押しても、返事が届くまでは 1 通だけ', () => {
    expect(run(press(), press(), press(), press())).toHaveLength(1)
  })

  it('盤面が届いたあとは、また押せる', () => {
    expect(run(press(), press(), arrive(BOARD), press())).toEqual([PASS_MOVE, PASS_MOVE])
  })

  /**
   * 1 つの手の返事が、盤面のあとに選んでほしいが続く 2 通で届く（`room.ts` の `advance`）。1 通目で解けるが、
   * その盤面は選ぶのを待っている間のもので、行える手が空で届く（`room.ts` の `boards`）ので、2 通目までの間に
   * 押せるものは無い。
   */
  it('盤面に選んでほしいが続いて届いても、2 通目のあとにまた押せ、待ちは狂わない', () => {
    const answer: DuelMove = { kind: '選ぶ', answer: 0 }
    expect(run(press(), arrive(BOARD), arrive(CHOOSE), press(answer), press(answer))).toEqual([PASS_MOVE, answer])
    // 2 通目は待っていない時に届くだけで、待ちに入れない。続く 1 往復も、1 通ずつになる。
    expect(afterMessage(afterMessage(WAITING, BOARD), CHOOSE)).toBe(NOT_WAITING)
    expect(run(press(), arrive(BOARD), arrive(CHOOSE), press(answer), press(answer), arrive(BOARD), press(), press())).toEqual([
      PASS_MOVE,
      answer,
      PASS_MOVE,
    ])
  })

  it('選んでほしいが届いたあとは、また押せる', () => {
    const answer: DuelMove = { kind: '選ぶ', answer: 0 }
    expect(run(press(), arrive(CHOOSE), press(answer), press(answer))).toEqual([PASS_MOVE, answer])
  })

  it('行えなかったが届いたあとは、また押せる', () => {
    expect(run(press(), arrive(REFUSED), press())).toEqual([PASS_MOVE, PASS_MOVE])
  })

  it('席についたが届いたあとは、また押せる', () => {
    expect(run(press(), arrive(SEATED), press())).toEqual([PASS_MOVE, PASS_MOVE])
  })

  /** 行える手を変えないもの。返事より先に届いて描き直しを起こしても、押せるようには戻らない（#253 のコメント）。 */
  it('相手の繋がりが届いても、返事が届くまでは押せない', () => {
    expect(run(press(), arrive(OPPONENT_LINK), press())).toEqual([PASS_MOVE])
  })

  /** 切れている間は手を出さない（`index.ts` の `draw`）。待ちは解けているが、押す先が無い。 */
  it('切れたら、待ちは解ける', () => {
    expect(run(press(), cut, press())).toEqual([PASS_MOVE, PASS_MOVE])
  })

  /**
   * 返事より先に切れて繋ぎ直すと、入り直しの返事が届くまで、切れる前の盤面と行える手が残る。そこで押した
   * 手は入り直しのすぐ後にサーバに届き、いまの盤面で合法なら通ってしまう（ADR-0016）。
   */
  it('繋ぎ直してから入り直しの返事が届くまでは、押しても何も送らない', () => {
    expect(run(press(), cut, reconnect(), press(), press())).toEqual([PASS_MOVE])
  })

  it('入り直しの返事（席についた・盤面）が届いたら、また押せる', () => {
    expect(run(press(), cut, reconnect(), arrive(SEATED), arrive(BOARD), press())).toEqual([PASS_MOVE, PASS_MOVE])
  })

  it('入り直しが断られても、部屋がもう無くても、待ちは解ける', () => {
    for (const reply of [REFUSED, WAITING_FOR_OPPONENT, LOBBY]) {
      expect(run(press(), cut, reconnect(), arrive(reply), press())).toEqual([PASS_MOVE, PASS_MOVE])
    }
  })

  /** 何も送っていなくても、繋ぎ直した直後の盤面は切れる前のものである。入り直しの返事までは押させない。 */
  it('送っていなくても、繋ぎ直してから入り直しの返事までは押せない', () => {
    expect(run(cut, reconnect(), press())).toEqual([])
    expect(run(cut, reconnect(), arrive(SEATED), press())).toEqual([PASS_MOVE])
  })

  it('入り直す部屋が無ければ、繋がった時点で待ちは解ける', () => {
    expect(run(press(), cut, reconnect(false), press())).toEqual([PASS_MOVE, PASS_MOVE])
  })

  /** 返事が来なければ、時間では解かない。押せるのは、届くか繋がりが変わってから。 */
  it('返事が来ないうちは、何度押しても 1 通だけ', () => {
    expect(run(press(), ...Array.from({ length: 20 }, () => press()))).toHaveLength(1)
  })

  /** 該当する送信（#253）のどれも同じ待ちを通る。種類が違っても、返事までは 2 通目を送らない。 */
  it('種類の違う手でも、返事が届くまでは 2 通目を送らない', () => {
    const moves: readonly DuelMove[] = [
      PASS_MOVE,
      { kind: '選ぶ', answer: 0 },
      { kind: '選ぶ', answer: '選ばない' },
      { kind: 'ひとつ戻る' },
      { kind: '取り消す' },
    ]
    for (const first of moves) {
      for (const second of moves) expect(run(press(first), press(second))).toEqual([first])
    }
  })
})

describe('返事として数えるもの', () => {
  it('盤面・選んでほしい・行えなかった・席についたは返事', () => {
    for (const message of [BOARD, CHOOSE, REFUSED, SEATED]) expect(isReply(message)).toBe(true)
  })

  it('入り直しの先が無いことを言うもの（相手を待っている・ロビー・名前を決めてほしい）も返事', () => {
    const asking: ToClient = { kind: '名前を決めてほしい', current: undefined, reason: undefined }
    for (const message of [WAITING_FOR_OPPONENT, LOBBY, asking]) expect(isReply(message)).toBe(true)
  })

  it('相手の繋がりやデッキにまつわるものは返事ではない', () => {
    const others: readonly ToClient[] = [OPPONENT_LINK, { kind: 'デッキを確かめた', violations: [] }]
    for (const message of others) {
      expect(isReply(message)).toBe(false)
      expect(afterMessage(WAITING, message)).toBe(WAITING)
    }
  })

  it('待っていない時に返事が届いても、待っていないまま', () => {
    expect(afterMessage(NOT_WAITING, BOARD)).toBe(NOT_WAITING)
  })
})
