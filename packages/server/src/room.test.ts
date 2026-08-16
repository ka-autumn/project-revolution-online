import { describe, expect, it } from 'vitest'
import { defineStrategy, defineUnit } from '@revolution/engine'
import type { Card, Deck, FromClient, LegalAction, ToClient, WirePerspective } from '@revolution/engine'
import { emptyRooms, receive } from './room.js'
import type { Delivery, ParticipantId, RoomOutcome, RoomSetup, Rooms } from './room.js'

/**
 * 部屋を、メッセージだけで動かして確かめる。
 *
 * サーバはカードを知れない（ADR-0002）ので、デッキは外から渡す。ここで使うのはエンジンの中で
 * 定義した架空のカードである。
 */

const CARDS: Readonly<Record<string, Card>> = Object.fromEntries([
  ...Array.from({ length: 14 }, (_, index) => [
    `TEST-${index}`,
    defineUnit({ name: `テスト・部屋${index}`, level: 0, bp: 100, sp: 100, moveIcon: ['上'] }),
  ]),
  ['TEST-S', defineStrategy({ name: 'テスト・部屋のストラテジー', level: 0 })],
])

/** 構築戦の最小枚数（60 枚）を満たす、15 種類 × 4 枚のデッキ（総合ルール 第3部 第1章 3-1）。 */
function buildDeck(): Deck {
  return Object.values(CARDS).flatMap((card) => Array.from({ length: 4 }, () => card))
}

const SETUP: RoomSetup = { decks: [buildDeck(), buildDeck()], seed: 20260816 }

const CODE = 'あいことば'

/** 優先権を放棄する。部屋を進めるのに何度も送る。 */
const PASS: FromClient = { kind: '行動する', action: { kind: '優先権を放棄する' } }

/** 2 人が入って、デュエルが始まったところ。 */
function started(): RoomOutcome {
  const first = receive(emptyRooms(), 'あ', { kind: '部屋に入る', room: CODE }, SETUP)
  return receive(first.rooms, 'い', { kind: '部屋に入る', room: CODE }, SETUP)
}

/** その参加者に届いたメッセージ。 */
function to(deliveries: readonly Delivery[], participant: ParticipantId): readonly ToClient[] {
  return deliveries.filter((delivery) => delivery.to === participant).map((delivery) => delivery.message)
}

/** その参加者に届いた盤面。 */
function boardOf(deliveries: readonly Delivery[], participant: ParticipantId): WirePerspective {
  const board = to(deliveries, participant).find((message) => message.kind === '盤面')
  if (board === undefined) throw new Error('盤面が届いたはずだった')

  return board.perspective
}

/** その参加者に届いた、行える手（ADR-0010）。 */
function actionsOf(deliveries: readonly Delivery[], participant: ParticipantId): readonly LegalAction[] {
  const board = to(deliveries, participant).find((message) => message.kind === '盤面')
  if (board === undefined) throw new Error('盤面が届いたはずだった')

  return board.actions
}

/** その参加者が着いた席。 */
function seatOf(deliveries: readonly Delivery[], participant: ParticipantId): string {
  const seated = to(deliveries, participant).find((message) => message.kind === '席についた')
  if (seated === undefined) throw new Error('席についたが届いたはずだった')

  return seated.seat
}

/** メッセージを 1 つ送る。 */
function send(rooms: Rooms, participant: ParticipantId, message: FromClient): RoomOutcome {
  return receive(rooms, participant, message, SETUP)
}

/**
 * 優先権を持っているほうに放棄させ続けて、そのフェイズまで進める。
 *
 * 部屋をメッセージだけで動かすので、いま誰が優先権を持っているかは届いた盤面から読む。
 */
function passUntil(outcome: RoomOutcome, phase: string): RoomOutcome {
  let current = outcome
  for (let steps = 0; steps < 200; steps += 1) {
    const board = boardOf(current.deliveries, 'あ')
    if (board.turn.phase === phase) return current

    const acting = participantAt(board.turn.priority, board.viewer)
    current = answerAll(send(current.rooms, acting, PASS))
  }
  throw new Error(`${phase} まで進まなかった`)
}

/** その席にいる参加者。`seatOfA` は参加者「あ」が着いた席。 */
function participantAt(player: string, seatOfA: string): ParticipantId {
  return player === seatOfA ? 'あ' : 'い'
}

/**
 * アクティブプレイヤーが行動できるところまで進める。
 *
 * フェイズの始めには非アクティブプレイヤーに優先権が発生する（総合ルール 第3部 第7章 1・
 * 第8章 1）ので、1 度放棄させてアクティブプレイヤーに移す。
 */
function readyToAct(outcome: RoomOutcome): RoomOutcome {
  const board = boardOf(outcome.deliveries, 'あ')
  if (board.turn.priority === board.turn.active) return outcome

  const waiting = participantAt(board.turn.priority, board.viewer)
  return answerAll(send(outcome.rooms, waiting, PASS))
}

/**
 * 選んでほしいと言われている間、最初の候補を選び続ける。
 *
 * 放棄でバンクにある能力が解決される（総合ルール 第2部 第21章 11-3）と、その効果が選択を
 * 求めることがある。ここで確かめたいのは進め方ではないので、どれを選ぶかは問わない。
 */
function answerAll(outcome: RoomOutcome): RoomOutcome {
  let current = outcome
  for (let steps = 0; steps < 100; steps += 1) {
    const refused = current.deliveries.find((delivery) => delivery.message.kind === '行えなかった')
    if (refused?.message.kind === '行えなかった') throw new Error(`行えなかった: ${refused.message.reason}`)

    const asked = current.deliveries.find((delivery) => delivery.message.kind === '選んでほしい')
    if (asked === undefined) return current

    current = send(current.rooms, asked.to, { kind: '選ぶ', answer: 0 })
  }
  throw new Error('選び終わらなかった')
}

// #13。ルームコードで 2 人を繋ぐ。
describe('部屋に入る', () => {
  it('1 人目は相手を待つ', () => {
    const outcome = receive(emptyRooms(), 'あ', { kind: '部屋に入る', room: CODE }, SETUP)

    expect(outcome.deliveries).toEqual([{ to: 'あ', message: { kind: '相手を待っている' } }])
  })

  // 総合ルール 第3部 第1章 4。先攻・後攻はデュエルの準備で決まる。
  it('2 人目が入ると、それぞれが席につく', () => {
    const outcome = started()

    expect([seatOf(outcome.deliveries, 'あ'), seatOf(outcome.deliveries, 'い')].sort()).toEqual(['先攻', '後攻'])
  })

  it('2 人目が入ると、両方に盤面が届く', () => {
    const outcome = started()

    expect(boardOf(outcome.deliveries, 'あ').viewer).toBe(seatOf(outcome.deliveries, 'あ'))
    expect(boardOf(outcome.deliveries, 'い').viewer).toBe(seatOf(outcome.deliveries, 'い'))
  })

  // 観戦は扱わない。相手の非公開情報を見てよい人がいない（ADR-0004）。
  it('3 人目は入れない', () => {
    const outcome = send(started().rooms, 'う', { kind: '部屋に入る', room: CODE })

    expect(outcome.deliveries).toEqual([{ to: 'う', message: { kind: '行えなかった', reason: '部屋がいっぱい' } }])
  })

  it('別のルームコードなら別の部屋になる', () => {
    const outcome = send(started().rooms, 'う', { kind: '部屋に入る', room: 'べつのあいことば' })

    expect(outcome.deliveries).toEqual([{ to: 'う', message: { kind: '相手を待っている' } }])
    expect(outcome.rooms.size).toBe(2)
  })
})

// #13 の完了条件。部屋を通しても、相手の非公開情報は届かない。
describe('部屋が配る盤面', () => {
  it('相手の手札は見えないまま届く', () => {
    const outcome = started()
    const board = boardOf(outcome.deliveries, 'あ')
    const opponent = board.viewer === '先攻' ? '後攻' : '先攻'

    expect(board.zones[opponent].手札).toHaveLength(5) // 総合ルール 第3部 第1章 6
    expect(board.zones[opponent].手札.every((card) => card.kind === '見えていない')).toBe(true)
  })

  it('自分の手札は見えて届く', () => {
    const outcome = started()
    const board = boardOf(outcome.deliveries, 'あ')

    expect(board.zones[board.viewer].手札.every((card) => card.kind === '見えている')).toBe(true)
  })
})

// #14 の完了条件。打てない手が画面に出ない。クライアントは行える手を数え上げられない（ADR-0010）。
describe('盤面と一緒に届く、行える手', () => {
  it('優先権を持っているほうには届く', () => {
    const outcome = started()
    const board = boardOf(outcome.deliveries, 'あ')
    const acting = participantAt(board.turn.priority, board.viewer)

    // 優先権を持っていれば、少なくとも放棄はできる（総合ルール 第3部 第3章 2）。
    expect(actionsOf(outcome.deliveries, acting)).toContainEqual({ kind: '優先権を放棄する' })
  })

  /** 相手が何を行えるかは、そのプレイヤーが知る筋合いの無いことである。 */
  it('優先権を持っていないほうには届かない', () => {
    const outcome = started()
    const board = boardOf(outcome.deliveries, 'あ')
    const waiting = participantAt(board.turn.priority, board.viewer) === 'あ' ? 'い' : 'あ'

    expect(actionsOf(outcome.deliveries, waiting)).toEqual([])
  })

  /**
   * 届いた手はどれも、そのまま送り返せば通る。
   *
   * UI は届いた手だけを並べる（ADR-0010）ので、ここに断られるものが混ざっていれば、押しても
   * 何も起こらないボタンが画面に出ることになる。**送る側と断る側が同じ `legalActions` を
   * 見ている**ことを、部屋の外側から確かめる。
   */
  it('届いた手はどれも断られない', () => {
    // メインフェイズまで進める。始まった直後は放棄しか行えず、断られる手が混ざる余地が無い。
    const outcome = readyToAct(passUntil(started(), 'メインフェイズ'))
    const board = boardOf(outcome.deliveries, 'あ')
    const acting = participantAt(board.turn.priority, board.viewer)
    const actions = actionsOf(outcome.deliveries, acting)
    expect(actions.length).toBeGreaterThan(1) // 前提: 放棄以外にも行えることがある

    const refused = actions.flatMap((action) =>
      send(outcome.rooms, acting, { kind: '行動する', action }).deliveries.filter(
        (delivery) => delivery.message.kind === '行えなかった',
      ),
    )

    expect(refused).toEqual([])
  })
})

describe('行動する', () => {
  it('優先権を持っていない人の行動は断られ、相手には何も届かない', () => {
    const outcome = started()
    const board = boardOf(outcome.deliveries, 'あ')
    const withoutPriority = board.turn.priority === board.viewer ? 'い' : 'あ'

    const refused = send(outcome.rooms, withoutPriority, PASS)

    expect(refused.deliveries).toEqual([
      { to: withoutPriority, message: { kind: '行えなかった', reason: '優先権が無い' } },
    ])
  })

  it('合法手でない行動は断られる', () => {
    const outcome = started()
    const board = boardOf(outcome.deliveries, 'あ')
    const acting = board.turn.priority === board.viewer ? 'あ' : 'い'

    const refused = send(outcome.rooms, acting, { kind: '行動する', action: { kind: 'プランする' } })

    expect(to(refused.deliveries, acting)).toEqual([{ kind: '行えなかった', reason: '行えない行動' }])
  })

  it('行動が通ると、両方に新しい盤面が届く', () => {
    const outcome = started()
    const board = boardOf(outcome.deliveries, 'あ')
    const acting = board.turn.priority === board.viewer ? 'あ' : 'い'

    const passed = send(outcome.rooms, acting, PASS)

    expect(passed.deliveries.map((delivery) => delivery.message.kind)).toEqual(['盤面', '盤面'])
  })

  it('部屋に入っていない人は行動できない', () => {
    const outcome = send(started().rooms, 'う', PASS)

    expect(to(outcome.deliveries, 'う')).toEqual([{ kind: '行えなかった', reason: 'デュエルが始まっていない' }])
  })
})

/**
 * メインフェイズまで進めて、アクティブプレイヤーにプランさせたところ。
 *
 * プランするコストはエネルギーかスマッシュを 1 枚フリーズすることなので（総合ルール 第3部
 * 第8章 2-3）、その前にエネルギーフェイズで手札を 1 枚エネルギーゾーンに置いておく（同 第7章 2）。
 */
function planning(): { readonly outcome: RoomOutcome; readonly acting: ParticipantId } {
  const inEnergyPhase = readyToAct(passUntil(started(), 'エネルギーフェイズ'))
  const board = boardOf(inEnergyPhase.deliveries, 'あ')
  const acting = participantAt(board.turn.active, board.viewer)
  const [inHand] = boardOf(inEnergyPhase.deliveries, acting).zones[board.turn.active].手札
  if (inHand?.kind !== '見えている') throw new Error('自分の手札は見えているはずだった')

  const placed = send(inEnergyPhase.rooms, acting, {
    kind: '行動する',
    action: { kind: 'エネルギーを置く', card: inHand.instance.id },
  })
  const inMainPhase = readyToAct(passUntil(placed, 'メインフェイズ'))
  return {
    outcome: send(inMainPhase.rooms, acting, { kind: '行動する', action: { kind: 'プランする' } }),
    acting,
  }
}

// ADR-0008。選択は候補の番号で答え、行動はやり直して適用する。
describe('選ぶ', () => {
  it('選ぶ人にだけ、選んでほしいことが届く', () => {
    const { outcome, acting } = planning()

    expect(outcome.deliveries.map((delivery) => delivery.to)).toEqual([acting])
    expect(to(outcome.deliveries, acting).map((message) => message.kind)).toEqual(['選んでほしい'])
  })

  it('選ぶ人でなければ答えられない', () => {
    const { outcome, acting } = planning()
    const other = acting === 'あ' ? 'い' : 'あ'

    const refused = send(outcome.rooms, other, { kind: '選ぶ', answer: 0 })

    expect(to(refused.deliveries, other)).toEqual([{ kind: '行えなかった', reason: '選ぶ人ではない' }])
  })

  it('答えを待っている間は、行動を受け取らない', () => {
    const { outcome, acting } = planning()

    const refused = send(outcome.rooms, acting, PASS)

    expect(to(refused.deliveries, acting)).toEqual([{ kind: '行えなかった', reason: '選ぶのを待っている' }])
  })

  it('答えると行動が進み、両方に盤面が届く', () => {
    const { outcome, acting } = planning()

    const answered = send(outcome.rooms, acting, { kind: '選ぶ', answer: 0 })

    expect(answered.deliveries.map((delivery) => delivery.message.kind)).toEqual(['盤面', '盤面'])
    // プランの効果として山札の 1 番上が表返り、プランゾーンに置かれる（総合ルール 第3部 第8章 2-3）。
    const board = boardOf(answered.deliveries, acting)
    expect(board.zones[board.viewer].プランゾーン).toHaveLength(1)
  })
})

// ADR-0009。接続が切れても部屋は残り、同じ合言葉で入り直せば続きから打てる。
describe('入り直す', () => {
  it('席と、いまの盤面が送り直される', () => {
    const outcome = started()
    const before = boardOf(outcome.deliveries, 'あ')

    const again = send(outcome.rooms, 'あ', { kind: '部屋に入る', room: CODE })

    expect(seatOf(again.deliveries, 'あ')).toBe(before.viewer)
    expect(boardOf(again.deliveries, 'あ')).toEqual(before)
  })

  // 入り直したのは片方だけなので、相手には何も起こらない。
  it('相手には何も届かない', () => {
    const again = send(started().rooms, 'あ', { kind: '部屋に入る', room: CODE })

    expect(again.deliveries.every((delivery) => delivery.to === 'あ')).toBe(true)
  })

  it('部屋も盤面もそのまま', () => {
    const outcome = started()

    const again = send(outcome.rooms, 'あ', { kind: '部屋に入る', room: CODE })

    expect(again.rooms).toEqual(outcome.rooms)
  })

  it('入り直した後も、続きから打てる', () => {
    const outcome = started()
    const board = boardOf(outcome.deliveries, 'あ')
    const acting = participantAt(board.turn.priority, board.viewer)

    const again = send(outcome.rooms, 'あ', { kind: '部屋に入る', room: CODE })
    const passed = send(again.rooms, acting, PASS)

    expect(passed.deliveries.map((delivery) => delivery.message.kind)).toEqual(['盤面', '盤面'])
  })

  /**
   * 選択の途中で切れても、同じ選択を求められる（ADR-0008 / ADR-0009）。
   *
   * 貯めた答えの並びで適用をやり直せば同じものが返るので、送ったメッセージを覚えておく必要は無い。
   */
  it('選択の途中で入り直すと、同じ選択が送り直される', () => {
    const { outcome, acting } = planning()
    const asked = to(outcome.deliveries, acting)[0]
    if (asked?.kind !== '選んでほしい') throw new Error('選んでほしいが届いたはずだった')

    const again = send(outcome.rooms, acting, { kind: '部屋に入る', room: CODE })

    expect(to(again.deliveries, acting).map((message) => message.kind)).toEqual([
      '席についた',
      '盤面',
      '選んでほしい',
    ])
    expect(to(again.deliveries, acting).find((message) => message.kind === '選んでほしい')).toEqual(asked)
  })

  it('選ぶ人でないほうが入り直しても、選んでほしいことは届かない', () => {
    const { outcome, acting } = planning()
    const other = acting === 'あ' ? 'い' : 'あ'

    const again = send(outcome.rooms, other, { kind: '部屋に入る', room: CODE })

    expect(to(again.deliveries, other).map((message) => message.kind)).toEqual(['席についた', '盤面'])
  })

  it('まだ 1 人で待っている間に入り直すと、また待つ', () => {
    const waiting = receive(emptyRooms(), 'あ', { kind: '部屋に入る', room: CODE }, SETUP)

    const again = send(waiting.rooms, 'あ', { kind: '部屋に入る', room: CODE })

    expect(again.deliveries).toEqual([{ to: 'あ', message: { kind: '相手を待っている' } }])
  })

  it('別のルームコードには移れない', () => {
    const again = send(started().rooms, 'あ', { kind: '部屋に入る', room: 'べつのあいことば' })

    expect(to(again.deliveries, 'あ')).toEqual([{ kind: '行えなかった', reason: 'ほかの部屋にいる' }])
  })
})
