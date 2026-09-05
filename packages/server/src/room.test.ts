import { describe, expect, it } from 'vitest'
import {
  CONSTRUCTED_DECK_MINIMUM,
  choose,
  defineStrategy,
  defineUnit,
  drawCards,
  placeTopOfLibrary,
} from '@revolution/engine'
import type { Card, Deck, FromClient, LegalAction, ToClient, WireChoice, WirePerspective } from '@revolution/engine'
import { emptyRooms, lobbyOf, partnerOf, receive, roomOf } from './room.js'
import type { Delivery, ParticipantId, RoomOutcome, RoomSetup, Rooms } from './room.js'

/**
 * 部屋を、メッセージだけで動かして確かめる。
 *
 * サーバはカードを知れない（ADR-0002）ので、デッキは外から渡す。ここで使うのはエンジンの中で
 * 定義した架空のカードである。
 */

/**
 * 1 つの行動で 2 度選ばせるカード。
 *
 * **`ひとつ戻る` が意味を持つのは、答えが 2 つ以上要る行動だけである。** レベル 0 のユニットは
 * コストを払わないので何も選ばせず、プランは 1 度で終わる。2 度聞かれる場面をここで作る。
 * 何を選んだかは使わない。聞かれる回数だけが要る。
 */
const STRATEGY_NAME = 'テスト・部屋のストラテジー'

const CARDS: Readonly<Record<string, Card>> = Object.fromEntries([
  ...Array.from({ length: 14 }, (_, index) => [
    `TEST-${index}`,
    defineUnit({ name: `テスト・部屋${index}`, level: 0, bp: 100, sp: 100, moveIcon: ['上'] }),
  ]),
  [
    'TEST-S',
    defineStrategy({
      name: STRATEGY_NAME,
      level: 0,
      effect: function* () {
        yield* choose(['ひとつめのア', 'ひとつめのイ'])
        yield* choose(['ふたつめのア', 'ふたつめのイ'])
      },
    }),
  ],
])

/** 構築戦の最小枚数（60 枚）を満たす、15 種類 × 4 枚のデッキ（総合ルール 第3部 第1章 3-1）。 */
function buildDeck(): Deck {
  return Object.values(CARDS).flatMap((card) => Array.from({ length: 4 }, () => card))
}

const SETUP: RoomSetup = { decks: [buildDeck(), buildDeck()], seed: 20260816, code: 'あたらしいへや' }

/**
 * 引くだけで山札を空にするストラテジー。**支配者が自分で負ける**（総合ルール 第3部 第3章 2）。
 *
 * 決着した部屋を作るために要る。部屋はメッセージだけで動かすので、終わった盤面を外から差し込む
 * 手立てが無い。誰が勝つかはここで確かめたいことではなく、部屋が終わっていることだけが要る。
 */
const DECKOUT_NAME = 'テスト・部屋の引き切り'

const DECKOUT: Card = defineStrategy({
  name: DECKOUT_NAME,
  level: 0,
  effect: function* (duel) {
    yield* drawCards(duel.controller, CONSTRUCTED_DECK_MINIMUM)
  },
})

/** 2 度選ばせるストラテジーを、引き切るストラテジーに差し替えたデッキ。ほかは同じ。 */
function buildEndingDeck(): Deck {
  return Object.entries(CARDS).flatMap(([id, card]) =>
    Array.from({ length: 4 }, () => (id === 'TEST-S' ? DECKOUT : card)),
  )
}

const ENDING_SETUP: RoomSetup = { decks: [buildEndingDeck(), buildEndingDeck()], seed: 20260816, code: 'あたらしいへや' }

/**
 * 山札の 1 番上を捨札へ置いてから選ばせるストラテジー（#142）。
 *
 * 捨札はいつでも見られる（総合ルール 第2部 第21章 5-2）ので、選ばせる前に、それまで誰にも
 * 見えていなかったカードが 1 枚見えるようになる。**見てから取り消せてはならない**場面を作る。
 */
const REVEALING_NAME = 'テスト・部屋のめくるストラテジー'

const REVEALING: Card = defineStrategy({
  name: REVEALING_NAME,
  level: 0,
  effect: function* () {
    yield* placeTopOfLibrary('捨札', 'リリース')
    yield* choose(['ア', 'イ'])
  },
})

/** 2 度選ばせるストラテジーを、めくってから選ばせるものに差し替えたデッキ。ほかは同じ。 */
function buildRevealingDeck(): Deck {
  return Object.entries(CARDS).flatMap(([id, card]) =>
    Array.from({ length: 4 }, () => (id === 'TEST-S' ? REVEALING : card)),
  )
}

const REVEALING_SETUP: RoomSetup = {
  decks: [buildRevealingDeck(), buildRevealingDeck()],
  seed: 20260816,
  code: 'あたらしいへや',
}

const CODE = 'あいことば'

/** 優先権を放棄する。部屋を進めるのに何度も送る。 */
const PASS: FromClient = { kind: '行動する', action: { kind: '優先権を放棄する' } }

/**
 * ここに出てくる人が全員繋がっている状態（#175）。
 *
 * 繋がりで変わるのは、打っている途中に抜けられるかだけ（`canLeave`）である。**それ以外の
 * テストは、全員が繋がっているものとして書く。** 相手が消えた場合を見るテストだけが、別の
 * ものを渡す。
 */
const ALL_LINKED: ReadonlySet<ParticipantId> = new Set(['あ', 'い', 'う', 'え'])

/** 2 人が入って、デュエルが始まったところ。 */
function started(setup: RoomSetup = SETUP): RoomOutcome {
  const first = receive(emptyRooms(), 'あ', { kind: '部屋に入る', room: CODE }, setup, ALL_LINKED)
  return receive(first.rooms, 'い', { kind: '部屋に入る', room: CODE }, setup, ALL_LINKED)
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

/**
 * その参加者に**最後に**届いた盤面。
 *
 * 1 度のやりとりで盤面が何度も届くことがある（CPU が続けて打つ、#175）。いまの盤面が要る時は
 * こちらを使う。
 */
function latestBoard(deliveries: readonly Delivery[], participant: ParticipantId): WirePerspective {
  const boards = to(deliveries, participant).filter((message) => message.kind === '盤面')
  const last = boards.at(-1)
  if (last === undefined) throw new Error('盤面が届いたはずだった')

  return last.perspective
}

/** その参加者に届いた、選んでほしいこと。 */
function choiceOf(deliveries: readonly Delivery[], participant: ParticipantId): WireChoice {
  const asked = to(deliveries, participant).find((message) => message.kind === '選んでほしい')
  if (asked === undefined) throw new Error('選んでほしいが届いたはずだった')

  return asked.choice
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
function send(
  rooms: Rooms,
  participant: ParticipantId,
  message: FromClient,
  connected: ReadonlySet<ParticipantId> = ALL_LINKED,
): RoomOutcome {
  return receive(rooms, participant, message, SETUP, connected)
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
    const outcome = receive(emptyRooms(), 'あ', { kind: '部屋に入る', room: CODE }, SETUP, ALL_LINKED)

    expect(outcome.deliveries).toEqual([{ to: 'あ', message: { kind: '相手を待っている', room: CODE } }])
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

    expect(outcome.deliveries).toEqual([{ to: 'う', message: { kind: '相手を待っている', room: 'べつのあいことば' } }])
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
 * プランするコストはエネルギーかスマッシュを 1 枚フリーズすることである（総合ルール 第3部
 * 第8章 2-3）。**フリーズできるカードが 2 枚以上ないと選択にならない**（候補が 1 つで選ばない
 * ことも選べないなら聞かれない、`protocol.ts` の `applyWithAnswers`）ので、エネルギーが 2 枚
 * 貯まるまでターンを進める。エネルギーは 1 ターンに 1 枚しか置けない（同 第7章 1）ため、同じ
 * プレイヤーのエネルギーフェイズを 2 度通すことになる。
 */
function planning(): { readonly outcome: RoomOutcome; readonly acting: ParticipantId } {
  let current = started()
  for (let turns = 0; turns < 8; turns += 1) {
    current = placeEnergy(readyToAct(passUntil(current, 'エネルギーフェイズ')))

    const inMainPhase = readyToAct(passUntil(current, 'メインフェイズ'))
    const board = boardOf(inMainPhase.deliveries, 'あ')
    const acting = participantAt(board.turn.active, board.viewer)
    if (boardOf(inMainPhase.deliveries, acting).zones[board.turn.active].エネルギーゾーン.length >= 2) {
      return {
        outcome: send(inMainPhase.rooms, acting, { kind: '行動する', action: { kind: 'プランする' } }),
        acting,
      }
    }
    current = inMainPhase
  }
  throw new Error('エネルギーが 2 枚あるメインフェイズに届かなかった')
}

/** アクティブプレイヤーが手札を 1 枚エネルギーゾーンに置く（総合ルール 第3部 第7章 1）。 */
function placeEnergy(outcome: RoomOutcome): RoomOutcome {
  const board = boardOf(outcome.deliveries, 'あ')
  const acting = participantAt(board.turn.active, board.viewer)
  const [inHand] = boardOf(outcome.deliveries, acting).zones[board.turn.active].手札
  if (inHand?.kind !== '見えている') throw new Error('自分の手札は見えているはずだった')

  return send(outcome.rooms, acting, {
    kind: '行動する',
    action: { kind: 'エネルギーを置く', card: inHand.instance.id },
  })
}

/**
 * 2 度選ばせる行動を始めたところまで進める。
 *
 * 2 度聞くのは `TEST-S` のストラテジーだけなので、それを手札に持っているほうが自分のメイン
 * フェイズにプレイできるまで、放棄で進める。どちらが先に引くかはシードで決まるので、席を
 * 決め打ちにせず、持っているほうを探す。
 */
function choosingTwice(): { readonly outcome: RoomOutcome; readonly acting: ParticipantId } {
  return playingStrategy(SETUP, STRATEGY_NAME)
}

/** めくってから選ばせる行動を始めたところまで進める（#142）。 */
function revealingThenChoosing(): { readonly outcome: RoomOutcome; readonly acting: ParticipantId } {
  return playingStrategy(REVEALING_SETUP, REVEALING_NAME)
}

/**
 * そのストラテジーをプレイしたところまで進める。
 *
 * 手札に持っているほうが自分のメインフェイズにプレイできるまで、放棄で進める。どちらが先に
 * 引くかはシードで決まるので、席を決め打ちにせず、持っているほうを探す。
 */
function playingStrategy(
  setup: RoomSetup,
  name: string,
): { readonly outcome: RoomOutcome; readonly acting: ParticipantId } {
  let current = readyToAct(passUntil(started(setup), 'メインフェイズ'))
  for (let steps = 0; steps < 300; steps += 1) {
    const board = boardOf(current.deliveries, 'あ')
    const acting = participantAt(board.turn.priority, board.viewer)
    const play = playFromHand(current, acting, name)
    if (play !== undefined) return { outcome: send(current.rooms, acting, { kind: '行動する', action: play }), acting }

    current = readyToAct(answerAll(send(current.rooms, acting, PASS)))
  }
  throw new Error(`${name} をプレイできるところに届かなかった`)
}

/** その参加者が、その名前のカードを手札からプレイする手。行えなければ `undefined`。 */
function playFromHand(outcome: RoomOutcome, participant: ParticipantId, name: string): LegalAction | undefined {
  const inHand = cardInHand(outcome, participant, name)

  return actionsOf(outcome.deliveries, participant).find(
    (action) => action.kind === 'カードをプレイする' && action.declaration.card === inHand,
  )
}

/** その参加者の手札にある、その名前のカードの識別子。持っていなければ `undefined`。 */
function cardInHand(outcome: RoomOutcome, participant: ParticipantId, name: string): string | undefined {
  const board = boardOf(outcome.deliveries, participant)
  const found = board.zones[board.viewer].手札.find(
    (card) => card.kind === '見えている' && card.instance.card.name === name,
  )

  return found?.kind === '見えている' ? found.instance.id : undefined
}

/**
 * 決着するまで進めた部屋（#92）。
 *
 * 山札を引き切るストラテジーを持っているほうが、自分のメインフェイズにプレイできるまで放棄で
 * 進める。どちらが先に引くかはシードで決まるので、席を決め打ちにせず、持っているほうを探す。
 */
function ended(): RoomOutcome {
  let current = readyToAct(passUntil(started(ENDING_SETUP), 'メインフェイズ'))
  for (let steps = 0; steps < 300; steps += 1) {
    const board = boardOf(current.deliveries, 'あ')
    const acting = participantAt(board.turn.priority, board.viewer)
    const play = playFromHand(current, acting, DECKOUT_NAME)
    if (play !== undefined) {
      const over = answerAll(send(current.rooms, acting, { kind: '行動する', action: play }))
      if (boardOf(over.deliveries, 'あ').result === undefined) throw new Error('決着したはずだった')

      return over
    }

    current = readyToAct(answerAll(send(current.rooms, acting, PASS)))
  }
  throw new Error('決着に届かなかった')
}

// ADR-0008。選択は候補の番号で答え、行動はやり直して適用する。
describe('選ぶ', () => {
  it('選ぶ人にだけ、選んでほしいことが届く', () => {
    const { outcome, acting } = planning()
    const other = acting === 'あ' ? 'い' : 'あ'

    expect(to(outcome.deliveries, acting).map((message) => message.kind)).toEqual(['盤面', '選んでほしい'])
    expect(to(outcome.deliveries, other).map((message) => message.kind)).toEqual(['盤面'])
  })

  /**
   * #141。選んでいる間は誰も何も行えない（`act` が `選ぶのを待っている` として断る）。
   *
   * **選ばないほうにも盤面を送る。** そちらには「選んでほしい」が届かないので、送らないと
   * 1 つ前の盤面と一緒に届いた手が並んだままになり、押しても断られるボタンが残る。
   */
  it('選び始めると、両方の行える手が空になる', () => {
    const { outcome, acting } = planning()
    const other = acting === 'あ' ? 'い' : 'あ'

    // 行動したほうは優先権を持っている。空になるのは、選ぶのを待っているからである。
    expect(actionsOf(outcome.deliveries, acting)).toEqual([])
    expect(actionsOf(outcome.deliveries, other)).toEqual([])
  })

  /**
   * 答え終わって行動が進めば、行える手も戻る。
   *
   * 手が戻るのは行動したほうではない。行動するとその時点で非アクティブプレイヤーが優先権を
   * 得る（総合ルール 第3部 第4章 3）ので、次に行えるのは相手である。
   */
  it('答え終わると、行える手が戻る', () => {
    const { outcome, acting } = planning()
    const other = acting === 'あ' ? 'い' : 'あ'

    const answered = send(outcome.rooms, acting, { kind: '選ぶ', answer: 0 })

    expect(answered.deliveries.map((delivery) => delivery.message.kind)).toEqual(['盤面', '盤面'])
    expect(actionsOf(answered.deliveries, other)).not.toEqual([])
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

  it('まだ何も答えていなければ、答えた数は 0 で届く', () => {
    const { outcome, acting } = planning()

    expect(choiceOf(outcome.deliveries, acting).answered).toBe(0)
  })
})

/**
 * ADR-0008。**盤面をまだ進めていないので、選びかけたものは捨てれば元に戻る。**
 *
 * 答えが足りているところまで進めてはやり直す形なので、行動が終わるまで盤面は動かない。
 * 巻き戻す仕組みを別に持つ必要が無い。
 */
describe('選ぶのをやめる', () => {
  it('取り消すと、行動する前の盤面が両方に届く', () => {
    const { outcome, acting } = planning()
    const before = boardOf(readyToAct(passUntil(started(), 'メインフェイズ')).deliveries, 'あ')

    const cancelled = send(outcome.rooms, acting, { kind: '取り消す' })

    expect(cancelled.deliveries.map((delivery) => delivery.message.kind)).toEqual(['盤面', '盤面'])
    // プランは解決していないので、プランゾーンは空のままである。
    expect(boardOf(cancelled.deliveries, acting).zones[before.turn.active].プランゾーン).toEqual([])
  })

  /** 取り消した後は、また行動できる。断られる状態に落ちない。 */
  it('取り消すと、行える手がまた届く', () => {
    const { outcome, acting } = planning()

    const cancelled = send(outcome.rooms, acting, { kind: '取り消す' })

    expect(actionsOf(cancelled.deliveries, acting)).toContainEqual({ kind: 'プランする' })
  })

  it('取り消した後は、同じ行動をやり直せる', () => {
    const { outcome, acting } = planning()
    const cancelled = send(outcome.rooms, acting, { kind: '取り消す' })

    const again = send(cancelled.rooms, acting, { kind: '行動する', action: { kind: 'プランする' } })

    expect(to(again.deliveries, acting).map((message) => message.kind)).toEqual(['盤面', '選んでほしい'])
  })

  /** まだ 1 つも答えていなければ、戻る先が無いので行動そのものを取り消す。 */
  it('ひとつ戻るは、答えていなければ取り消すのと同じになる', () => {
    const { outcome, acting } = planning()

    const back = send(outcome.rooms, acting, { kind: 'ひとつ戻る' })

    expect(back.deliveries.map((delivery) => delivery.message.kind)).toEqual(['盤面', '盤面'])
    expect(actionsOf(back.deliveries, acting)).toContainEqual({ kind: 'プランする' })
  })

  it('選ぶところでなければ断られる', () => {
    const outcome = readyToAct(passUntil(started(), 'メインフェイズ'))
    const board = boardOf(outcome.deliveries, 'あ')
    const acting = participantAt(board.turn.priority, board.viewer)

    const refused = send(outcome.rooms, acting, { kind: '取り消す' })

    expect(to(refused.deliveries, acting)).toEqual([{ kind: '行えなかった', reason: '選ぶところではない' }])
  })

  it('選ぶ人でなければ取り消せない', () => {
    const { outcome, acting } = planning()
    const other = acting === 'あ' ? 'い' : 'あ'

    const refused = send(outcome.rooms, other, { kind: '取り消す' })

    expect(to(refused.deliveries, other)).toEqual([{ kind: '行えなかった', reason: '選ぶ人ではない' }])
  })

  /** 取り消しは、相手には知らせない。何を試したかは相手の知る筋合いではない。 */
  it('取り消しても、相手に届くのは盤面だけ', () => {
    const { outcome, acting } = planning()
    const other = acting === 'あ' ? 'い' : 'あ'

    const cancelled = send(outcome.rooms, acting, { kind: '取り消す' })

    expect(to(cancelled.deliveries, other).map((message) => message.kind)).toEqual(['盤面'])
  })

  /**
   * 2 度聞かれる行動で、1 つ答えてから戻す。
   *
   * 貯めた答えの末尾を捨ててやり直すだけである（ADR-0008）。**同じ盤面と同じ答えの並びからは
   * 必ず同じところまで進む**ので、1 つ前と同じことをもう一度聞かれる。
   */
  it('ひとつ戻ると、1 つ前の選択をやり直せる', () => {
    const { outcome, acting } = choosingTwice()
    expect(choiceOf(outcome.deliveries, acting).answered).toBe(0)

    const answered = send(outcome.rooms, acting, { kind: '選ぶ', answer: 0 })
    expect(choiceOf(answered.deliveries, acting).answered).toBe(1)

    const back = send(answered.rooms, acting, { kind: 'ひとつ戻る' })

    expect(choiceOf(back.deliveries, acting)).toEqual(choiceOf(outcome.deliveries, acting))
  })

  /** 戻したあとは、違う答えを選べる。行動そのものは取り消されていない。 */
  it('ひとつ戻っても、行動は取り消されない', () => {
    const { outcome, acting } = choosingTwice()
    const answered = send(outcome.rooms, acting, { kind: '選ぶ', answer: 0 })

    const back = send(answered.rooms, acting, { kind: 'ひとつ戻る' })
    const again = send(back.rooms, acting, { kind: '選ぶ', answer: 1 })

    expect(choiceOf(again.deliveries, acting).answered).toBe(1)
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
    const asked = choiceOf(outcome.deliveries, acting)

    const again = send(outcome.rooms, acting, { kind: '部屋に入る', room: CODE })

    expect(to(again.deliveries, acting).map((message) => message.kind)).toEqual([
      '席についた',
      '盤面',
      '選んでほしい',
    ])
    expect(choiceOf(again.deliveries, acting)).toEqual(asked)
  })

  /**
   * #95。**ログは盤面の一部として届く**（`log.ts`）ので、追いつかせる仕組みは要らない。
   * 入り直した人にいまの盤面を送り直せば、それまでのできごともそのまま届く。
   */
  /**
   * `優先権を放棄する` はログに残らない（#111）ので、何か残る行動として `エネルギーを置く`
   * を使う。
   */
  it('それまでのログも送り直される', () => {
    const acted = placeEnergy(readyToAct(passUntil(started(), 'エネルギーフェイズ')))
    expect(boardOf(acted.deliveries, 'あ').log).not.toEqual([]) // 前提: 何か起きている

    const again = send(acted.rooms, 'あ', { kind: '部屋に入る', room: CODE })

    expect(boardOf(again.deliveries, 'あ').log).toEqual(boardOf(acted.deliveries, 'あ').log)
  })

  it('選ぶ人でないほうが入り直しても、選んでほしいことは届かない', () => {
    const { outcome, acting } = planning()
    const other = acting === 'あ' ? 'い' : 'あ'

    const again = send(outcome.rooms, other, { kind: '部屋に入る', room: CODE })

    expect(to(again.deliveries, other).map((message) => message.kind)).toEqual(['席についた', '盤面'])
  })

  it('まだ 1 人で待っている間に入り直すと、また待つ', () => {
    const waiting = receive(emptyRooms(), 'あ', { kind: '部屋に入る', room: CODE }, SETUP, ALL_LINKED)

    const again = send(waiting.rooms, 'あ', { kind: '部屋に入る', room: CODE })

    expect(again.deliveries).toEqual([{ to: 'あ', message: { kind: '相手を待っている', room: CODE } }])
  })
})

/**
 * #92。対戦を 1 回終えたら、同じ名乗りのまま別の部屋に入れる。
 *
 * 切断では部屋から抜けない（ADR-0009）ので、意図して抜ける口が別に要る。違う合言葉で入り直す
 * ことがそれにあたり、**打っている途中の部屋だけは抜けられない**。
 */
describe('別の部屋に移る', () => {
  const OTHER = 'べつのあいことば'

  it('決着した部屋にいた人は、別の部屋に入れる', () => {
    const moved = send(ended().rooms, 'あ', { kind: '部屋に入る', room: OTHER })

    expect(to(moved.deliveries, 'あ')).toEqual([{ kind: '相手を待っている', room: OTHER }])
  })

  it('決着した部屋にいた 2 人が移ると、そこでまた始まる', () => {
    const first = send(ended().rooms, 'あ', { kind: '部屋に入る', room: OTHER })

    const again = send(first.rooms, 'い', { kind: '部屋に入る', room: OTHER })

    expect([seatOf(again.deliveries, 'あ'), seatOf(again.deliveries, 'い')].sort()).toEqual(['先攻', '後攻'])
  })

  it('相手を待っているだけの人は、別の部屋に入れる', () => {
    const waiting = receive(emptyRooms(), 'あ', { kind: '部屋に入る', room: CODE }, SETUP, ALL_LINKED)

    const moved = send(waiting.rooms, 'あ', { kind: '部屋に入る', room: OTHER })

    expect(to(moved.deliveries, 'あ')).toEqual([{ kind: '相手を待っている', room: OTHER }])
    expect([...moved.rooms.keys()]).toEqual([OTHER])
  })

  /** 合言葉の打ち間違いで、打っている途中の対戦が消えてはならない。 */
  it('打っている途中なら移れない', () => {
    const again = send(started().rooms, 'あ', { kind: '部屋に入る', room: OTHER })

    expect(to(again.deliveries, 'あ')).toEqual([{ kind: '行えなかった', reason: 'ほかの部屋にいる' }])
  })

  it('誰もいなくなった部屋は残らない', () => {
    const first = send(ended().rooms, 'あ', { kind: '部屋に入る', room: OTHER })

    const second = send(first.rooms, 'い', { kind: '部屋に入る', room: OTHER })

    expect([...second.rooms.keys()]).toEqual([OTHER])
  })

  /** 片方が残っているなら、その人はまだ終わった盤面を見に入り直せる（ADR-0009）。 */
  it('片方が残っている間は、部屋も残る', () => {
    const moved = send(ended().rooms, 'あ', { kind: '部屋に入る', room: OTHER })

    const again = send(moved.rooms, 'い', { kind: '部屋に入る', room: CODE })

    expect([...moved.rooms.keys()].sort()).toEqual([CODE, OTHER].sort())
    expect(boardOf(again.deliveries, 'い').result).toBeDefined()
  })

  /** 席が 1 つ空いたように見えても、そこは始まっているデュエルの部屋である。 */
  it('決着した部屋に、席に着いていない人は入れない', () => {
    const moved = send(ended().rooms, 'あ', { kind: '部屋に入る', room: OTHER })

    const outsider = send(moved.rooms, 'う', { kind: '部屋に入る', room: CODE })

    expect(to(outsider.deliveries, 'う')).toEqual([{ kind: '行えなかった', reason: '対戦が終わっている部屋' }])
  })

  /** 入れなかった時に抜けたことにすると、どこにもいない参加者ができてしまう。 */
  it('移れなかったときは、元の部屋にいるまま', () => {
    const over = ended()
    const opened = receive(over.rooms, 'う', { kind: '部屋に入る', room: OTHER }, SETUP, ALL_LINKED)
    const full = receive(opened.rooms, 'え', { kind: '部屋に入る', room: OTHER }, SETUP, ALL_LINKED)

    const refused = send(full.rooms, 'あ', { kind: '部屋に入る', room: OTHER })

    expect(to(refused.deliveries, 'あ')).toEqual([{ kind: '行えなかった', reason: '部屋がいっぱい' }])
    expect(refused.rooms).toEqual(full.rooms)
  })
})

/**
 * #142。**選ぶ人が見るのは、その選択が起きている盤面である。**
 *
 * 行動が終わるまで `duel.state` は動かない（ADR-0008）ので、そのまま送ると、選ぶ人が見るのは
 * 行動を始める前の姿になる。何を見て選べばよいのか分からない。
 */
describe('選んでいる間に見せる盤面', () => {
  it('その行動が始まったことが、届く盤面に出ている', () => {
    const { outcome, acting } = planning()

    const started = boardOf(outcome.deliveries, acting).log
    expect(started.some(({ event }) => event.kind === '行動した' && event.action === 'プランする')).toBe(true)
  })

  it('選ばせる前にめくれたカードが、選んでいる間に見える', () => {
    const { outcome, acting } = revealingThenChoosing()

    const turned = boardOf(outcome.deliveries, acting).log.flatMap(({ event }) =>
      event.kind === '命令を実行した' && event.instruction.kind === '山札の1番上をゾーンへ置く'
        ? [event.instruction.card]
        : [],
    )
    expect(turned).toHaveLength(1)
    expect(turned[0]).not.toBeUndefined()
  })

  /** 見せるのは送るものだけである。やり直しの起点は動かない（ADR-0008）。 */
  it('取り消せば、めくる前の盤面に戻る', () => {
    const { outcome, acting } = choosingTwice()

    const cancelled = send(outcome.rooms, acting, { kind: '取り消す' })

    const back = boardOf(cancelled.deliveries, acting).log
    expect(back.some(({ event }) => event.kind === '行動した' && event.action === 'カードをプレイする')).toBe(false)
  })
})

/**
 * #142。行動を始めてから新しく見えたものがあれば、その行動は戻せない。見てから取り消して
 * 別の手を打てると、山札の 1 番上を覗く手立てになる。
 */
describe('見てしまったら戻れない', () => {
  it('新しく見えたものがあれば、戻れないと届く', () => {
    const { outcome, acting } = revealingThenChoosing()

    expect(choiceOf(outcome.deliveries, acting).mayGoBack).toBe(false)
  })

  it('新しく見えたものが無ければ、これまでどおり戻れる', () => {
    const { outcome, acting } = planning()

    expect(choiceOf(outcome.deliveries, acting).mayGoBack).toBe(true)
  })

  // 断るのはサーバである（ADR-0010）。画面がボタンを出さないことに頼らない。
  it.each([
    ['取り消す'],
    ['ひとつ戻る'],
  ] as const)('%s を断る', (kind) => {
    const { outcome, acting } = revealingThenChoosing()

    const refused = send(outcome.rooms, acting, { kind })

    expect(to(refused.deliveries, acting)).toEqual([
      { kind: '行えなかった', reason: '見てしまったので戻れない' },
    ])
  })
})

/**
 * #175。打つ前に合言葉を決めておかなくても、部屋を作れば入れる。
 *
 * 合言葉を決めるのはサーバである。ロビーに並んだものから選んで入るので、**相手と申し合わせて
 * おく必要が無い。**
 */
describe('部屋を作る', () => {
  const MAKE: FromClient = { kind: '部屋を作る', name: 'てすとのへや', against: '人間' }

  it('サーバが決めた合言葉の部屋に入って、相手を待つ', () => {
    const outcome = send(emptyRooms(), 'あ', MAKE)

    expect(outcome.deliveries).toEqual([{ to: 'あ', message: { kind: '相手を待っている', room: SETUP.code } }])
    expect([...outcome.rooms.keys()]).toEqual([SETUP.code])
  })

  it('付けた名前がロビーに出る', () => {
    const outcome = send(emptyRooms(), 'あ', MAKE)

    expect(lobbyOf(outcome.rooms)).toEqual([
      { code: SETUP.code, name: 'てすとのへや', status: '相手を待っている', cpu: false },
    ])
  })

  it('名前を付けなければ、合言葉が名前になる', () => {
    const outcome = send(emptyRooms(), 'あ', { ...MAKE, name: '   ' })

    expect(lobbyOf(outcome.rooms)[0]?.name).toBe(SETUP.code)
  })

  /** 合言葉は部屋を引く鍵なので、重なると先にある部屋を上書きしてしまう。 */
  it('合言葉が使われていたら、別のものになる', () => {
    const first = send(emptyRooms(), 'あ', MAKE)

    const second = send(first.rooms, 'い', MAKE)

    expect([...second.rooms.keys()]).toHaveLength(2)
    expect(to(second.deliveries, 'い')).toEqual([{ kind: '相手を待っている', room: `${SETUP.code}-2` }])
  })

  it('作った部屋に、ロビーから入って始められる', () => {
    const opened = send(emptyRooms(), 'あ', MAKE)

    const joined = send(opened.rooms, 'い', { kind: '部屋に入る', room: SETUP.code })

    expect([seatOf(joined.deliveries, 'あ'), seatOf(joined.deliveries, 'い')].sort()).toEqual(['先攻', '後攻'])
  })

  it('打っている途中なら作れない', () => {
    const outcome = send(started().rooms, 'あ', MAKE)

    expect(to(outcome.deliveries, 'あ')).toEqual([{ kind: '行えなかった', reason: 'ほかの部屋にいる' }])
  })
})

/**
 * #175。CPU と対戦する。
 *
 * CPU は繋がっていないだけの参加者で、部屋から見れば人と変わらない（`cpu.ts`）。**進め方も
 * 人と同じ道筋を通る。**
 */
describe('CPU と対戦する', () => {
  const AGAINST_CPU: FromClient = { kind: '部屋を作る', name: 'ひとり', against: 'CPU' }

  it('作った時点で始まっている', () => {
    const outcome = send(emptyRooms(), 'あ', AGAINST_CPU)

    expect(seatOf(outcome.deliveries, 'あ')).toMatch(/先攻|後攻/)
    expect(boardOf(outcome.deliveries, 'あ').viewer).toBe(seatOf(outcome.deliveries, 'あ'))
  })

  /** 繋がっていない相手に送っても届く先が無い（`serve.ts`）ので、送るものから落とす。 */
  it('CPU 宛のメッセージは残らない', () => {
    const outcome = send(emptyRooms(), 'あ', AGAINST_CPU)

    expect(outcome.deliveries.map((delivery) => delivery.to)).toEqual(['あ', 'あ'])
  })

  it('ロビーには CPU がいる部屋として出る', () => {
    const outcome = send(emptyRooms(), 'あ', AGAINST_CPU)

    expect(lobbyOf(outcome.rooms)).toEqual([
      { code: SETUP.code, name: 'ひとり', status: '対戦中', cpu: true },
    ])
  })

  /** 席が空いているように見えても、そこには CPU が座っている。 */
  it('CPU がいる部屋には入れない', () => {
    const opened = send(emptyRooms(), 'あ', AGAINST_CPU)

    const outsider = send(opened.rooms, 'い', { kind: '部屋に入る', room: SETUP.code })

    expect(to(outsider.deliveries, 'い')).toEqual([{ kind: '行えなかった', reason: '部屋がいっぱい' }])
  })

  /**
   * 人が打ち終わったら、CPU の番が終わって人に優先権が戻るところまで進む。**人は待たされない。**
   *
   * 見るのは最後に届いた盤面である。CPU が打つたびに盤面が届く（`withCpu`）ので、途中のものは
   * まだ CPU の番でありうる。
   */
  it('打ち終わると、いつも人に優先権が戻っている', () => {
    let current = send(emptyRooms(), 'あ', AGAINST_CPU)
    const seat = seatOf(current.deliveries, 'あ')
    let cpuActed = false

    for (let steps = 0; steps < 30; steps += 1) {
      const board = latestBoard(current.deliveries, 'あ')
      if (board.result !== undefined) break

      expect(board.turn.priority).toBe(seat)
      cpuActed ||= board.log.some(({ event }) => event.kind === '行動した' && event.player !== seat)
      current = answerAll(send(current.rooms, 'あ', PASS))
    }

    expect(cpuActed).toBe(true)
  })

  /**
   * 1 人で始めた対戦を、終わるまで投げ出せないと、ロビーに戻れなくなる。人が相手の時と違って
   * 消えて困る対戦が無い（`canLeave`）。
   */
  it('打っている途中でも出られて、部屋ごと無くなる', () => {
    const opened = send(emptyRooms(), 'あ', AGAINST_CPU)

    const left = send(opened.rooms, 'あ', { kind: 'ロビーに戻る' })

    expect([...left.rooms.keys()]).toEqual([])
  })
})

/** #175。部屋を出てロビーに戻る。 */
describe('ロビーに戻る', () => {
  it('相手を待っているだけなら、出られる', () => {
    const waiting = send(emptyRooms(), 'あ', { kind: '部屋を作る', name: '', against: '人間' })

    const left = send(waiting.rooms, 'あ', { kind: 'ロビーに戻る' })

    expect([...left.rooms.keys()]).toEqual([])
    expect(left.deliveries).toEqual([])
  })

  it('決着した部屋からも、出られる', () => {
    const left = send(ended().rooms, 'あ', { kind: 'ロビーに戻る' })

    expect(lobbyOf(left.rooms)).toEqual([{ code: CODE, name: CODE, status: '終わった', cpu: false }])
  })

  /** 投げ出す口はまだ無い（#92）。合言葉の打ち間違いと同じく、対戦が消えてはならない。 */
  it('打っている途中は、出られない', () => {
    const outcome = send(started().rooms, 'あ', { kind: 'ロビーに戻る' })

    expect(to(outcome.deliveries, 'あ')).toEqual([{ kind: '行えなかった', reason: '打っている途中の部屋' }])
  })

  /**
   * #175。相手が画面を閉じるとその席には誰も戻ってこない（名乗りは画面が覚えているもので、
   * 閉じれば消える、ADR-0009）。**残された側が永久に待たされてはならない。**
   */
  it('相手が繋がっていないなら、打っている途中でも出られる', () => {
    const alone: ReadonlySet<ParticipantId> = new Set(['あ'])

    const left = send(started().rooms, 'あ', { kind: 'ロビーに戻る' }, alone)

    expect(to(left.deliveries, 'あ')).toEqual([])
  })

  /**
   * #175。**投げ出された対戦はもう続けられない。** 席は 2 つで、抜けた席に座り直す人はいない
   * （`enter` が断る）。残しておくと、動かない対戦がロビーに「対戦中」として残る。
   */
  it('打っている途中で出られた部屋は、そのまま無くなる', () => {
    const left = send(started().rooms, 'あ', { kind: 'ロビーに戻る' }, new Set(['あ']))

    expect([...left.rooms.keys()]).toEqual([])
    expect(lobbyOf(left.rooms)).toEqual([])
  })

  /** 終わった対戦の部屋は残す。残ったほうが入り直せば、終わった盤面を見られる（ADR-0009）。 */
  it('決着した部屋は、片方が出ても残る', () => {
    const left = send(ended().rooms, 'あ', { kind: 'ロビーに戻る' })

    expect(left.rooms.get(CODE)?.participants).toEqual(['い'])
  })

  /** 回線が切れただけなら相手は戻ってくる（ADR-0016）。繋がっている限り、投げ出す口は開かない。 */
  it('相手が繋がっているなら、やはり出られない', () => {
    const outcome = send(started().rooms, 'あ', { kind: 'ロビーに戻る' }, new Set(['あ', 'い']))

    expect(to(outcome.deliveries, 'あ')).toEqual([{ kind: '行えなかった', reason: '打っている途中の部屋' }])
  })

  /**
   * #175。閉じていた側が後から戻ってくることはある。**戻る先はもう無い。** 投げ出された時点で
   * その対戦は続けられなくなっており、部屋ごと消えている。
   */
  it('出ていかれた後に戻っても、その対戦はもう無い', () => {
    const left = send(started().rooms, 'あ', { kind: 'ロビーに戻る' }, new Set(['あ']))

    expect(roomOf(left.rooms, 'い')).toBeUndefined()
  })

  /** 決着した部屋に残っている人からは、出ていった相手が席の相手として分かる（`serve.ts` が使う）。 */
  it('決着した部屋では、出ていった相手も席の相手として分かる', () => {
    const left = send(ended().rooms, 'あ', { kind: 'ロビーに戻る' })

    const room = left.rooms.get(CODE)
    if (room === undefined) throw new Error('部屋があるはずだった')
    expect(partnerOf(room, 'い')).toBe('あ')
    expect(room.participants).toEqual(['い'])
  })

  /** 出ていった人は、その席に戻れない。**残っている人の対戦を、後から上書きさせない。** */
  it('決着した部屋を出ていった人は、その部屋に戻れない', () => {
    const left = send(ended().rooms, 'あ', { kind: 'ロビーに戻る' })

    const back = send(left.rooms, 'あ', { kind: '部屋に入る', room: CODE })

    expect(to(back.deliveries, 'あ')).toEqual([{ kind: '行えなかった', reason: '対戦が終わっている部屋' }])
  })

  it('どこにもいないなら、何も起きない', () => {
    const outcome = send(emptyRooms(), 'あ', { kind: 'ロビーに戻る' })

    expect(outcome.deliveries).toEqual([])
  })
})

/** #175。ロビーには、いま開いている部屋が並ぶ。 */
describe('ロビー', () => {
  it('何も無ければ空', () => {
    expect(lobbyOf(emptyRooms())).toEqual([])
  })

  it('始まった部屋は対戦中になる', () => {
    expect(lobbyOf(started().rooms)).toEqual([{ code: CODE, name: CODE, status: '対戦中', cpu: false }])
  })

  it('決着した部屋は終わったになる', () => {
    expect(lobbyOf(ended().rooms)).toEqual([{ code: CODE, name: CODE, status: '終わった', cpu: false }])
  })
})
