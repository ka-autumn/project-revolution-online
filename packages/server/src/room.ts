import {
  applyWithAnswers,
  hasEnded,
  legalActions,
  perspectiveOf,
  prepareDuel,
  toWire,
} from '@revolution/engine'
import type {
  ChoiceAnswer,
  Deck,
  DuelState,
  FromClient,
  LegalAction,
  Player,
  RoomCode,
  Square,
  ToClient,
} from '@revolution/engine'

/**
 * ルームコードで 2 人を繋いで 1 つのデュエルを進めるところ（ADR-0004 / ADR-0008、#13）。
 *
 * **通信の手立ては持たない。** 受け取ったメッセージ 1 つから、次の部屋の状態と「誰に何を送るか」を
 * 返すだけの純粋な関数である。ソケットを張るのも、受け取ったバイト列を組み立て直すのも、これを
 * 呼ぶ側の仕事になる。盤面を進めるところと同じように（ADR-0001）、決まりごとと I/O を分けている。
 *
 * **カードを知らない。** 使うデッキは外から渡してもらう（`RoomSetup`）。サーバがカードの実装に
 * 依存すると、カードを持たない環境（ADR-0002）で組み立てられなくなる。盤面に載せるカードの
 * 表記は engine が自分で書き出す（ADR-0010、`wire.ts`）ので、ここで読むことは無い。
 */

/** 部屋にいる 1 人。誰であるかを決めるのは通信の側なので、識別子だけを受け取る。 */
export type ParticipantId = string

/** 部屋でデュエルを始めるのに要るもの。呼ぶ側が用意する。 */
export interface RoomSetup {
  /** 2 人のデッキ。並びは席の順であって、先攻・後攻の順ではない（`prepareDuel`）。 */
  readonly decks: readonly [Deck, Deck]
  /** シャッフルと先攻・後攻の決定に使うシード（ADR-0005）。部屋ごとに変える。 */
  readonly seed: number
}

/** 適用しかけている行動と、そこまでに受け取った答え（ADR-0008）。 */
interface PendingAction {
  readonly action: LegalAction
  readonly answers: readonly ChoiceAnswer[]
  /** いま答えを待っているプレイヤー。この人以外の答えは受け取らない。 */
  readonly player: Player
}

/** 始まっているデュエル。 */
interface DuelInRoom {
  readonly state: DuelState
  /** どちらの席に誰がいるか。 */
  readonly seats: Readonly<Record<Player, ParticipantId>>
  readonly pending: PendingAction | undefined
}

/** 1 つの部屋。 */
export interface Room {
  readonly code: RoomCode
  /** 入ってきた順の参加者。2 人目が来たところでデュエルが始まる。 */
  readonly participants: readonly ParticipantId[]
  /** 始まっていなければ `undefined`。 */
  readonly duel: DuelInRoom | undefined
}

/** 開いているすべての部屋。ルームコードで引く。 */
export type Rooms = ReadonlyMap<RoomCode, Room>

/** 送り先の付いたメッセージ 1 つ。 */
export interface Delivery {
  readonly to: ParticipantId
  readonly message: ToClient
}

/** メッセージ 1 つを受け取った結果。 */
export interface RoomOutcome {
  readonly rooms: Rooms
  readonly deliveries: readonly Delivery[]
}

export function emptyRooms(): Rooms {
  return new Map()
}

/**
 * メッセージを 1 つ受け取り、次の部屋の状態と送るものを返す。
 *
 * 受け取れないメッセージ（部屋にいない、優先権が無い、行えない行動）には `行えなかった` を
 * 送り主にだけ返し、部屋はそのままにする。**相手には何も送らない。** 何を試したかは、相手に
 * とっては知る筋合いの無いことである。
 */
export function receive(
  rooms: Rooms,
  participant: ParticipantId,
  message: FromClient,
  setup: RoomSetup,
): RoomOutcome {
  switch (message.kind) {
    case '部屋に入る':
      return enter(rooms, participant, message.room, setup)
    case '行動する':
      return act(rooms, participant, message.action)
    case '選ぶ':
      return answer(rooms, participant, message.answer)
    case 'ひとつ戻る':
      return rewind(rooms, participant, 'ひとつ')
    case '取り消す':
      return rewind(rooms, participant, 'すべて')
  }
}

function refuse(rooms: Rooms, participant: ParticipantId, reason: string): RoomOutcome {
  return { rooms, deliveries: [{ to: participant, message: { kind: '行えなかった', reason } }] }
}

function withRoom(rooms: Rooms, room: Room): Rooms {
  return new Map([...rooms, [room.code, room]])
}

/**
 * その部屋から 1 人を抜けさせる。誰もいなくなった部屋は取り除く。
 *
 * 席の並び（`duel.seats`）からは抜かない。**抜けられるのは終わったデュエルの部屋だけ**であり、
 * 終わった盤面はもう動かない（総合ルール 第3部 第3章 3）ので、誰がどちらの席にいたかは
 * そのまま残しておいてよい。残ったほうが入り直せば、同じ席で終わった盤面を見られる。
 */
function withoutParticipant(rooms: Rooms, room: Room, participant: ParticipantId): Rooms {
  const remaining = room.participants.filter((each) => each !== participant)
  const next = new Map(rooms)
  if (remaining.length === 0) next.delete(room.code)
  else next.set(room.code, { ...room, participants: remaining })

  return next
}

/**
 * その部屋を抜けて、別の部屋に移れるか（#92）。
 *
 * 移れるのは、まだ相手を待っているだけの部屋と、決着した部屋である。**打っている途中の部屋は
 * 抜けられない。** 合言葉を打ち間違えただけで対戦が消えることになるためである。意図して
 * 投げ出す経路は、席をどう扱うかを決めてから別に足す。
 */
function canLeave(room: Room): boolean {
  return room.duel === undefined || hasEnded(room.duel.state)
}

/** その参加者がいる部屋。どこにもいなければ `undefined`。 */
function roomOf(rooms: Rooms, participant: ParticipantId): Room | undefined {
  return [...rooms.values()].find((room) => room.participants.includes(participant))
}

/**
 * 部屋に入る。
 *
 * 空いていれば作って待ち、1 人いれば 2 人目として入ってデュエルが始まる。定員は 2 人で、
 * 観戦は扱わない。相手の非公開情報を見てよい人がいない（ADR-0004）ためである。
 *
 * すでにその部屋にいる参加者が入り直した場合は、**再入場として扱う**（ADR-0009）。接続が
 * 切れて繋ぎ直した場合がこれにあたる。
 *
 * 違う合言葉が来た場合は、抜けてよい部屋にいるなら移る（#92）。**入れなかった場合は元の部屋に
 * いるまま**にする。移れないことが分かった時点で抜けたことにすると、どこにもいない参加者が
 * できてしまう。
 */
function enter(rooms: Rooms, participant: ParticipantId, code: RoomCode, setup: RoomSetup): RoomOutcome {
  const current = roomOf(rooms, participant)
  if (current !== undefined) {
    if (current.code === code) return rejoin(rooms, current, participant)
    if (!canLeave(current)) return refuse(rooms, participant, 'ほかの部屋にいる')
  }
  const left = current === undefined ? rooms : withoutParticipant(rooms, current, participant)

  const room = left.get(code)
  if (room === undefined) {
    const opened: Room = { code, participants: [participant], duel: undefined }
    return {
      rooms: withRoom(left, opened),
      deliveries: [{ to: participant, message: { kind: '相手を待っている' } }],
    }
  }
  const [waiting] = room.participants
  if (waiting === undefined || room.participants.length >= 2) {
    return refuse(rooms, participant, '部屋がいっぱい')
  }
  // 決着した部屋から片方だけが抜けると、デュエルを持ったまま 1 人になった部屋が残る。そこへ
  // 席に着いていない人を入れると、始まっているデュエルを上書きしてしまう。
  if (room.duel !== undefined) {
    return refuse(rooms, participant, '対戦が終わっている部屋')
  }

  return start(left, room, waiting, participant, setup)
}

/**
 * 入り直した人に、いまの様子を送り直す（ADR-0009）。**部屋は変えない。**
 *
 * 盤面は差分ではなく毎回まるごと送っている（`wire.ts`）ので、追いつかせる仕組みは要らない。
 * いまの盤面をもう一度送れば足りる。
 *
 * 選択の途中で切れていた場合は、貯めた答えの並びで適用をやり直せば同じ「選んでほしい」が
 * 返る（ADR-0008）。**送ったメッセージを覚えておく必要は無い。**
 */
function rejoin(rooms: Rooms, room: Room, participant: ParticipantId): RoomOutcome {
  const duel = room.duel
  if (duel === undefined) {
    return { rooms, deliveries: [{ to: participant, message: { kind: '相手を待っている' } }] }
  }

  const seat = seatOf(duel, participant)
  if (seat === undefined) return refuse(rooms, participant, '席に着いていない')

  return {
    rooms,
    deliveries: [
      { to: participant, message: { kind: '席についた', seat } },
      ...boards(duel).filter((delivery) => delivery.to === participant),
      ...pendingChoice(duel, seat),
    ],
  }
}

/** その席のプレイヤーが答えを待たれているなら、その「選んでほしい」を作り直す。 */
function pendingChoice(duel: DuelInRoom, seat: Player): readonly Delivery[] {
  const pending = duel.pending
  if (pending === undefined || pending.player !== seat) return []

  const progress = applyWithAnswers(duel.state, pending.action, pending.answers)
  if (progress.kind !== '選んでほしい') return []

  return [{ to: duel.seats[seat], message: { kind: '選んでほしい', choice: progress.choice } }]
}

/**
 * 2 人が揃ったのでデュエルを始める（総合ルール 第3部 第1章）。
 *
 * 先攻・後攻を決めるのは `prepareDuel` である（同 4）。席の並びは入ってきた順で、どちらが先攻に
 * なるかはそこで決まる。
 */
function start(
  rooms: Rooms,
  room: Room,
  waiting: ParticipantId,
  joining: ParticipantId,
  setup: RoomSetup,
): RoomOutcome {
  const prepared = prepareDuel({ decks: setup.decks, seed: setup.seed })
  if (prepared.kind !== '準備完了') {
    const reason = `デッキ不備: ${JSON.stringify(prepared.violations)}`
    return {
      rooms,
      deliveries: [waiting, joining].map((to) => ({ to, message: { kind: '行えなかった', reason } as const })),
    }
  }

  const duel: DuelInRoom = {
    state: prepared.state,
    seats: prepared.first === 0 ? { 先攻: waiting, 後攻: joining } : { 先攻: joining, 後攻: waiting },
    pending: undefined,
  }
  const seated: Room = { ...room, participants: [waiting, joining], duel }

  return {
    rooms: withRoom(rooms, seated),
    deliveries: [
      ...seats(duel).map(([player, to]) => ({ to, message: { kind: '席についた', seat: player } as const })),
      ...boards(duel),
    ],
  }
}

/** 席と、そこにいる参加者の組。 */
function seats(duel: DuelInRoom): readonly (readonly [Player, ParticipantId])[] {
  return [
    ['先攻', duel.seats.先攻],
    ['後攻', duel.seats.後攻],
  ]
}

/**
 * いまの盤面を、それぞれの視点で射影して両方に送る（ADR-0004）。
 *
 * 行える手も一緒に送る（ADR-0010）。数え上げるのは優先権を持っているプレイヤーのぶんだけで、
 * もう 1 人には空で届く。優先権を持たないプレイヤーは何も行えない（総合ルール 第3部 第3章 1）
 * ので、送るものが無い。
 *
 * 選ぶのを待っている間も空で届く。行動の途中であり、次に受け取るのは答えだけだからである
 * （`act` が `選ぶのを待っている` として断る）。**打てない手を並べさせないために、断る側と
 * 送る側で同じ判断をしている。**
 */
function boards(duel: DuelInRoom): readonly Delivery[] {
  const actions = duel.pending === undefined ? legalActions(duel.state) : []

  return seats(duel).map(([player, to]) => ({
    to,
    message: {
      kind: '盤面',
      perspective: toWire(perspectiveOf(duel.state, player)),
      actions: player === duel.state.turn.priority ? actions : [],
    },
  }))
}

/** その参加者が着いている席。着いていなければ `undefined`。 */
function seatOf(duel: DuelInRoom, participant: ParticipantId): Player | undefined {
  return seats(duel).find(([, who]) => who === participant)?.[0]
}

/**
 * 行動する。
 *
 * 行えるのは優先権を持っているプレイヤーだけで、行えるのは合法手だけである。どちらも
 * 確かめるのはサーバの側である。**クライアントはルールの判断を持たない**（ADR-0010）ので、
 * ここが唯一の関門になる。
 */
function act(rooms: Rooms, participant: ParticipantId, action: LegalAction): RoomOutcome {
  const room = roomOf(rooms, participant)
  if (room?.duel === undefined) return refuse(rooms, participant, 'デュエルが始まっていない')

  const duel = room.duel
  if (duel.pending !== undefined) return refuse(rooms, participant, '選ぶのを待っている')

  const seat = seatOf(duel, participant)
  if (seat === undefined) return refuse(rooms, participant, '席に着いていない')
  if (seat !== duel.state.turn.priority) return refuse(rooms, participant, '優先権が無い')
  if (!legalActions(duel.state).some((each) => sameAction(each, action))) {
    return refuse(rooms, participant, '行えない行動')
  }

  return advance(rooms, room, duel, { action, answers: [], player: seat })
}

/** 選んだ答えを受け取る。答えるのは、選んでほしいと言われたプレイヤーだけである。 */
function answer(rooms: Rooms, participant: ParticipantId, chosen: ChoiceAnswer): RoomOutcome {
  const room = roomOf(rooms, participant)
  if (room?.duel === undefined) return refuse(rooms, participant, 'デュエルが始まっていない')

  const duel = room.duel
  const pending = duel.pending
  if (pending === undefined) return refuse(rooms, participant, '選ぶところではない')
  if (seatOf(duel, participant) !== pending.player) return refuse(rooms, participant, '選ぶ人ではない')

  return advance(rooms, room, duel, { ...pending, answers: [...pending.answers, chosen] })
}

/** どこまで戻すか。 */
type Rewind = 'ひとつ' | 'すべて'

/**
 * 選びかけているものを戻す（ADR-0008）。
 *
 * **戻れるのは、盤面をまだ進めていないからである。** 答えが足りているところまで進めては
 * やり直す形なので、行動が終わるまで `duel.state` は動かない。貯めた答えを捨てれば、行動を
 * 始める前と同じ盤面がそこにある。**取り消すために巻き戻す仕組みは要らない。**
 *
 * 見たものを見なかったことにはできない、という心配は要らない。選ぶ時に見せる候補は、**行動を
 * 始める前の盤面で見えていたものだけ**である（`protocol.ts` の `describeChoice`）。選んでいる
 * 間に新しく分かることが無いので、戻っても得をしない。
 *
 * まだ 1 つも答えていなければ、`ひとつ` でも行動そのものを取り消す。戻る先が無いためである。
 */
function rewind(rooms: Rooms, participant: ParticipantId, how: Rewind): RoomOutcome {
  const room = roomOf(rooms, participant)
  if (room?.duel === undefined) return refuse(rooms, participant, 'デュエルが始まっていない')

  const duel = room.duel
  const pending = duel.pending
  if (pending === undefined) return refuse(rooms, participant, '選ぶところではない')
  if (seatOf(duel, participant) !== pending.player) return refuse(rooms, participant, '選ぶ人ではない')

  if (how === 'すべて' || pending.answers.length === 0) {
    const cleared: DuelInRoom = { ...duel, pending: undefined }
    return { rooms: withRoom(rooms, { ...room, duel: cleared }), deliveries: boards(cleared) }
  }

  return advance(rooms, room, duel, { ...pending, answers: pending.answers.slice(0, -1) })
}

/**
 * 答えの並びで行動を適用し、進んだか、まだ選ぶことがあるかで分かれる（ADR-0008）。
 *
 * 進んだなら両方に新しい盤面を送る。まだ選ぶことがあるなら、**選ぶプレイヤーにだけ**候補を送る。
 * 候補にはそのプレイヤーだけが見てよいものが含まれる（総合ルール 第2部 第23章 3）。
 */
function advance(rooms: Rooms, room: Room, duel: DuelInRoom, pending: PendingAction): RoomOutcome {
  const progress = applyWithAnswers(duel.state, pending.action, pending.answers)
  if (progress.kind === '選んでほしい') {
    const choice = progress.choice
    const waiting: DuelInRoom = { ...duel, pending: { ...pending, player: choice.player } }
    return {
      rooms: withRoom(rooms, { ...room, duel: waiting }),
      deliveries: [{ to: waiting.seats[choice.player], message: { kind: '選んでほしい', choice } }],
    }
  }

  const advanced: DuelInRoom = { ...duel, state: progress.state, pending: undefined }
  return { rooms: withRoom(rooms, { ...room, duel: advanced }), deliveries: boards(advanced) }
}

/**
 * 同じ行動か。
 *
 * 送られてきた値と `legalActions` が返したものを見比べて、合法かどうかを決める。`JSON.stringify`
 * では比べられない。**通信を通ると項目の並びは送り主の書いた順のままになる**ので、同じ行動でも
 * 文字列としては違いうる。種類ごとに、指しているものを並べて比べる。
 */
function sameAction(one: LegalAction, other: LegalAction): boolean {
  if (one.kind !== other.kind) return false

  switch (one.kind) {
    case '優先権を放棄する':
    case 'プランする':
      return true
    case 'エネルギーを置く':
    case 'トラップを廃棄する':
    case 'トラップとしてプレイする':
    case 'トラップを発動する':
    case '「勇気」を起動する':
      return one.card === (other as typeof one).card
    case 'スマッシュする':
      return one.unit === (other as typeof one).unit
    case 'カードをプレイする': {
      const declaration = (other as typeof one).declaration
      return one.declaration.card === declaration.card && sameSquare(one.declaration.square, declaration.square)
    }
    case 'ユニットを移動する': {
      const moving = other as typeof one
      return one.unit === moving.unit && sameSquare(one.destination, moving.destination)
    }
    case '起動型能力を起動する': {
      const activating = other as typeof one
      return one.unit === activating.unit && one.ability === activating.ability
    }
  }
}

function sameSquare(one: Square | undefined, other: Square | undefined): boolean {
  return one === undefined || other === undefined
    ? one === other
    : one.row === other.row && one.column === other.column
}
