import { describe, expect, it } from 'vitest'
import type { LegalAction, ToClient } from '@revolution/engine'
import { NOT_WAITING, WAITING, afterMessage, isReply, trySend } from './reply-wait.js'
import type { DuelMove, ReplyWait } from './reply-wait.js'
import { emptyBoard } from './test-support.js'

/**
 * 手を送ってから返事が届くまでの待ち（#253）。
 *
 * 画面（`index.ts`）は、押されたら `trySend` に尋ね、届いたら `afterMessage` を通し、繋がりの様子が
 * 変わったら `NOT_WAITING` に戻す。**ここで見るのは、その順に並べた時に何通送られるかである。**
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

/** 画面が受けるできごと。押した・届いた・繋がりが変わった。 */
type Happening =
  | { readonly kind: '押した'; readonly move: DuelMove }
  | { readonly kind: '届いた'; readonly message: ToClient }
  | { readonly kind: '繋がりが変わった' }

const press = (move: DuelMove = PASS_MOVE): Happening => ({ kind: '押した', move })
const arrive = (message: ToClient): Happening => ({ kind: '届いた', message })
const relink: Happening = { kind: '繋がりが変わった' }

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
      case '繋がりが変わった':
        waiting = NOT_WAITING
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

  it('切れたら（繋ぎ直しのあとも）、また押せる', () => {
    expect(run(press(), relink, press())).toEqual([PASS_MOVE, PASS_MOVE])
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
