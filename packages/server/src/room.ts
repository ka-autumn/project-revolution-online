import {
  applyWithAnswers,
  hasEnded,
  legalActions,
  passOutcome,
  perspectiveOf,
  prepareDuel,
  toWire,
} from '@revolution/engine'
import type {
  ActionProgress,
  ChoiceAnswer,
  Deck,
  DuelState,
  FromClient,
  LegalAction,
  Opponent,
  Player,
  Random,
  RoomCode,
  Square,
  ToClient,
  WireRoom,
} from '@revolution/engine'
import { cpuParticipantOf, isCpu, pickCpuAction, pickCpuAnswer } from './cpu.js'

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

/** 部屋を作ってデュエルを始めるのに要るもの。呼ぶ側が用意する。 */
export interface RoomSetup {
  /** 2 人のデッキ。並びは席の順であって、先攻・後攻の順ではない（`prepareDuel`）。 */
  readonly decks: readonly [Deck, Deck]
  /** シャッフルと先攻・後攻の決定に使うシード（ADR-0005）。部屋ごとに変える。 */
  readonly seed: number
  /**
   * 新しい部屋に付ける合言葉（`部屋を作る`、#175）。すでに使われていれば、これを元に別のものを作る。
   *
   * **シードから作ってはならない。** 合言葉はロビーにいる全員に見える（`WireRoom`）ので、
   * シードが読み取れると山札の並びまで読み取れてしまう（ADR-0005）。
   */
  readonly code: RoomCode
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
  /**
   * CPU が次の手を選ぶのに使う乱数列（`cpu.ts`、#175）。準備で使った続きから始める。
   *
   * 盤面の側は乱数を持たない（`DuelState` は値であって、進めるのは呼ぶ側である）。CPU が
   * いない部屋では最初から動かない。
   */
  readonly random: Random
}

/** 1 つの部屋。 */
export interface Room {
  readonly code: RoomCode
  /**
   * ロビーに出す名前（#175）。付けられていなければ合言葉がそのまま入る。
   *
   * **席とは関係が無い。** 誰がいるかは出せない（名乗りは席に座れる合言葉である、ADR-0009）
   * ので、ロビーで部屋を見分けるためだけにある。
   */
  readonly name: string
  /** 入ってきた順の参加者。2 人目が来たところでデュエルが始まる。 */
  readonly participants: readonly ParticipantId[]
  /** 始まっていなければ `undefined`。 */
  readonly duel: DuelInRoom | undefined
  /**
   * CPU が座っている席の名乗り（#175）。座っていなければ `undefined`。
   *
   * 部屋から見れば人と変わらない 1 人の参加者で、違うのは繋がっていないことだけである。
   * 送るものは届く先が無いので捨てる（`receive`）。
   */
  readonly cpu: ParticipantId | undefined
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
  connected: ReadonlySet<ParticipantId>,
): RoomOutcome {
  const outcome = handle(rooms, participant, message, setup, connected)

  // 相手が CPU なら、そのまま打てるところまで打つ（#175）。**送り主のいる部屋だけを進める。**
  // ほかの部屋の CPU は、その部屋で手が打たれた時に動く。
  const code = roomOf(outcome.rooms, participant)?.code
  const played = code === undefined ? outcome : withCpu(outcome, code)

  // CPU は繋がっていないので、宛てたものは届く先が無い（`serve.ts`）。ここで落とす。
  return { ...played, deliveries: played.deliveries.filter((delivery) => !isCpu(delivery.to)) }
}

function handle(
  rooms: Rooms,
  participant: ParticipantId,
  message: FromClient,
  setup: RoomSetup,
  connected: ReadonlySet<ParticipantId>,
): RoomOutcome {
  switch (message.kind) {
    case '部屋に入る':
      return enter(rooms, participant, message.room, setup, connected)
    case '部屋を作る':
      return open(rooms, participant, message.name, message.against, setup, connected)
    case 'ロビーに戻る':
      return leave(rooms, participant, connected)
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

/**
 * いま開いている部屋の一覧（#175）。作られた順に並ぶ。
 *
 * **そこにいる人の名乗りは出さない**（`WireRoom`）。名乗りは認証ではなく席に座れる合言葉
 * （ADR-0009）なので、一覧に出すと居合わせた誰でも他人の席に着けてしまう。
 */
export function lobbyOf(rooms: Rooms): readonly WireRoom[] {
  return [...rooms.values()].map((room) => ({
    code: room.code,
    name: room.name,
    status: statusOf(room),
    cpu: room.cpu !== undefined,
  }))
}

function statusOf(room: Room): WireRoom['status'] {
  if (room.duel === undefined) return '相手を待っている'

  return hasEnded(room.duel.state) ? '終わった' : '対戦中'
}

/** その部屋で誰と打っているか。 */
function opponentOf(room: Room): Opponent {
  return room.cpu === undefined ? '人間' : 'CPU'
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
 * **打っている途中に抜けられたら、部屋ごと取り除く**（#175）。席は 2 つで（ADR-0004）、抜けた
 * 席に誰かが座り直すことはない（`enter` が断る）ので、**その対戦はもう続けられない。** 残して
 * おくと、動かない対戦がロビーに「対戦中」として残り、戻ってきた相手は誰も来ない席に座り続ける
 * ことになる。
 *
 * **終わった対戦の部屋は残す。** 終わった盤面はもう動かない（総合ルール 第3部 第3章 3）ので、
 * 残ったほうが入り直せば、同じ席で終わった盤面を見られる。席の並び（`duel.seats`）から抜かない
 * のもそのためである。
 */
function withoutParticipant(rooms: Rooms, room: Room, participant: ParticipantId): Rooms {
  const next = new Map(rooms)
  if (room.duel !== undefined && !hasEnded(room.duel.state)) {
    next.delete(room.code)
    return next
  }

  const remaining = room.participants.filter((each) => each !== participant)
  // 残ったのが CPU だけなら、その部屋にはもう誰もいない（#175）。CPU は繋がっておらず、
  // 入り直してくることも無いので、待たせておく先が無い。
  if (remaining.every((each) => isCpu(each))) next.delete(room.code)
  else next.set(room.code, { ...room, participants: remaining })

  return next
}

/**
 * その部屋を抜けられるか（#92）。
 *
 * 抜けられるのは、まだ相手を待っているだけの部屋と、決着した部屋である。**打っている途中の
 * 部屋は抜けられない。** 合言葉を打ち間違えただけで対戦が消えることになるためである。人を
 * 相手に意図して投げ出す経路は、席をどう扱うかを決めてから別に足す。
 *
 * 打っている途中でも抜けられるのは 2 つの場合だけである（#175）。
 *
 * - **CPU との対戦。** 抜けられなくしているのは相手の対戦を消さないためであり、CPU の側には
 *   消えて困るものが無い。1 人で始めた対戦を終えるまでロビーに戻れないのはおかしい。
 * - **相手が繋がっていない対戦。** 相手が画面を閉じるとその席には誰も戻ってこない（名乗りは
 *   画面が覚えているもので、閉じれば消える、ADR-0009）。残された側が永久に待たされ、その部屋も
 *   ロビーに残り続けることになる。**回線が切れただけなら相手は戻ってくる**（ADR-0016）ので、
 *   抜けるかどうかは人が決める。ここでは口を開けるだけである。
 */
function canLeave(room: Room, participant: ParticipantId, connected: ReadonlySet<ParticipantId>): boolean {
  if (room.duel === undefined || hasEnded(room.duel.state)) return true
  if (room.cpu !== undefined) return true

  return room.participants.every((each) => each === participant || !connected.has(each))
}

/** その参加者がいる部屋。どこにもいなければ `undefined`（＝ロビーにいる）。 */
export function roomOf(rooms: Rooms, participant: ParticipantId): Room | undefined {
  return [...rooms.values()].find((room) => room.participants.includes(participant))
}

/**
 * その人の向かいの席にいる相手。まだデュエルが始まっていなければ `undefined`（#175）。
 *
 * **席から引く。部屋にいる人から引くのではない。** 相手が部屋を出た後も席の並びは残る
 * （`withoutParticipant`）ので、**出ていった相手もここでは分かる。** 出ていったかどうかは、
 * その名乗りが `participants` にあるかで見る。
 */
export function partnerOf(room: Room, participant: ParticipantId): ParticipantId | undefined {
  const duel = room.duel
  if (duel === undefined) return undefined

  return seats(duel).find(([, who]) => who !== participant)?.[1]
}

/** ロビーに出す名前の長さの上限。一覧が読めなくなるほど長い名前を置かせない。 */
const NAME_LIMIT = 24

/** 付けられた名前。空なら合言葉をそのまま名前にする。 */
function nameOf(name: string, code: RoomCode): string {
  const trimmed = name.trim().slice(0, NAME_LIMIT)

  return trimmed === '' ? code : trimmed
}

/** まだ使われていない合言葉。渡されたものが空いていればそれを使う。 */
function unusedCode(rooms: Rooms, code: RoomCode): RoomCode {
  let candidate = code
  for (let n = 2; rooms.has(candidate); n += 1) candidate = `${code}-${n}`

  return candidate
}

/**
 * 新しい部屋を作って、そこに入る（#175）。
 *
 * **合言葉を決めるのはサーバである。** 打つ前に相手と決めておかなくても、ロビーに並んだ部屋を
 * 選べば入れる。相手が `CPU` なら、もう一方の席には繋がっていない参加者（`cpu.ts`）が座り、
 * 2 人揃ったものとしてそのまま始まる。
 *
 * いま打っている途中の部屋にいるなら断る。抜けられる部屋にいるなら、そこを出てから作る
 * （`enter` と同じ扱い、#92）。
 */
function open(
  rooms: Rooms,
  participant: ParticipantId,
  name: string,
  against: Opponent,
  setup: RoomSetup,
  connected: ReadonlySet<ParticipantId>,
): RoomOutcome {
  const current = roomOf(rooms, participant)
  if (current !== undefined && !canLeave(current, participant, connected)) {
    return refuse(rooms, participant, 'ほかの部屋にいる')
  }
  const left = current === undefined ? rooms : withoutParticipant(rooms, current, participant)

  const code = unusedCode(left, setup.code)
  const opened: Room = {
    code,
    name: nameOf(name, code),
    participants: [participant],
    duel: undefined,
    cpu: against === 'CPU' ? cpuParticipantOf(code) : undefined,
  }
  if (opened.cpu === undefined) {
    return {
      rooms: withRoom(left, opened),
      deliveries: [{ to: participant, message: { kind: '相手を待っている', room: code } }],
    }
  }

  return start(left, opened, participant, opened.cpu, setup)
}

/**
 * いる部屋を出てロビーに戻る（#175）。
 *
 * 出られる部屋は `canLeave` が決める。**何も送らない。** 部屋から出たことは、ロビーが届くこと
 * そのもので分かる（`serve.ts`）。
 */
function leave(rooms: Rooms, participant: ParticipantId, connected: ReadonlySet<ParticipantId>): RoomOutcome {
  const room = roomOf(rooms, participant)
  if (room === undefined) return { rooms, deliveries: [] }
  if (!canLeave(room, participant, connected)) return refuse(rooms, participant, '打っている途中の部屋')

  return { rooms: withoutParticipant(rooms, room, participant), deliveries: [] }
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
function enter(
  rooms: Rooms,
  participant: ParticipantId,
  code: RoomCode,
  setup: RoomSetup,
  connected: ReadonlySet<ParticipantId>,
): RoomOutcome {
  const current = roomOf(rooms, participant)
  if (current !== undefined) {
    if (current.code === code) return rejoin(rooms, current, participant)
    if (!canLeave(current, participant, connected)) return refuse(rooms, participant, 'ほかの部屋にいる')
  }
  const left = current === undefined ? rooms : withoutParticipant(rooms, current, participant)

  const room = left.get(code)
  if (room === undefined) {
    // 合言葉を直に指して入った部屋。ロビーで見分けるものが無いので、合言葉を名前にする。
    const opened: Room = { code, name: code, participants: [participant], duel: undefined, cpu: undefined }
    return {
      rooms: withRoom(left, opened),
      deliveries: [{ to: participant, message: { kind: '相手を待っている', room: code } }],
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
    return { rooms, deliveries: [{ to: participant, message: { kind: '相手を待っている', room: room.code } }] }
  }

  const seat = seatOf(duel, participant)
  if (seat === undefined) return refuse(rooms, participant, '席に着いていない')

  // 選ぶのを待っているなら、行動を始める前の盤面ではなく、その選択が起きている盤面を
  // 送り直す（#142）。入り直す前に見えていたものと同じものが届く。
  return {
    rooms,
    deliveries: [
      { to: participant, message: { kind: '席についた', seat, room: room.code, opponent: opponentOf(room) } },
      ...boards(duel, pendingProgress(duel)?.board).filter((delivery) => delivery.to === participant),
      ...pendingChoice(duel, seat),
    ],
  }
}

/**
 * 選ぶのを待っているなら、いまその選択がどうなっているか。待っていなければ `undefined`。
 *
 * **覚えておく必要が無い。** 貯めた答えの並びで適用をやり直せば同じところへ進む（ADR-0008）
 * ので、送った候補も、見せた盤面も、尋ねるたびにここで作り直せる。
 */
function pendingProgress(duel: DuelInRoom): Extract<ActionProgress, { kind: '選んでほしい' }> | undefined {
  const pending = duel.pending
  if (pending === undefined) return undefined

  const progress = applyWithAnswers(duel.state, pending.action, pending.answers)
  return progress.kind === '選んでほしい' ? progress : undefined
}

/** その席のプレイヤーが答えを待たれているなら、その「選んでほしい」を作り直す。 */
function pendingChoice(duel: DuelInRoom, seat: Player): readonly Delivery[] {
  const progress = duel.pending?.player === seat ? pendingProgress(duel) : undefined
  if (progress === undefined) return []

  return [{ to: duel.seats[seat], message: { kind: '選んでほしい', choice: progress.choice } }]
}

/**
 * 選びかけている行動を戻せるか（#142）。
 *
 * 決めるのはエンジンである（`protocol.ts` の `describeChoice`）。**サーバはそれを尋ねるだけで、
 * 同じ判断を書かない。** 画面に載せる値（`WireChoice.mayGoBack`）と、ここで断るかどうかが
 * 食い違わないための形である。
 *
 * 選択がもう要らないところまで進んでいれば、戻る話にならないので戻れることにする。
 */
function mayGoBack(duel: DuelInRoom): boolean {
  return pendingProgress(duel)?.choice.mayGoBack ?? true
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
    random: prepared.random,
  }
  const seated: Room = { ...room, participants: [waiting, joining], duel }

  return {
    rooms: withRoom(rooms, seated),
    deliveries: [
      ...seats(duel).map(([player, to]) => ({
        to,
        message: { kind: '席についた', seat: player, room: room.code, opponent: opponentOf(seated) } as const,
      })),
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
 *
 * `showing` は、送る盤面を差し替えるためにある。選ぶのを待っている間は**その選択が起きている
 * 盤面**を送る（#142）。行動が終わるまで `duel.state` は動かない（ADR-0008）ので、そのまま
 * 送ると、選ぶ人が見るのは行動を始める前の姿になってしまう。**差し替えるのは送るものだけで、
 * `duel.state` は動かさない。** やり直しの起点がそこにある。
 */
function boards(duel: DuelInRoom, showing: DuelState = duel.state): readonly Delivery[] {
  const actions = duel.pending === undefined ? legalActions(duel.state) : []

  return seats(duel).map(([player, to]) => ({
    to,
    message: {
      kind: '盤面',
      perspective: toWire(perspectiveOf(showing, player)),
      actions: player === duel.state.turn.priority ? actions : [],
      // 放棄したら何が起きるかは、進行中の盤面ではなく確定した盤面から決まる。押すのは
      // これから（`duel.state` に対して）だからである（#130）。
      passOutcome: passOutcome(duel.state),
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
  if (!mayGoBack(duel)) return refuse(rooms, participant, '見てしまったので戻れない')

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
 *
 * **止まった時は、両方に盤面も送り直す**（#141）。選んでいる間は誰も何も行えない（`act` が
 * 断り、`boards` が `actions` を空にする）ので、選ばないほうのプレイヤーに 1 つ前の盤面と
 * 一緒に届いた手が並んだままになってはならない。
 */
function advance(rooms: Rooms, room: Room, duel: DuelInRoom, pending: PendingAction): RoomOutcome {
  const progress = applyWithAnswers(duel.state, pending.action, pending.answers)
  if (progress.kind === '選んでほしい') {
    const choice = progress.choice
    const waiting: DuelInRoom = { ...duel, pending: { ...pending, player: choice.player } }
    return {
      rooms: withRoom(rooms, { ...room, duel: waiting }),
      deliveries: [
        // 送るのは**その選択が起きている盤面**である（#142）。答えを受け取っている間
        // `duel.state` は動かない（ADR-0008）ので、そのままだと選ぶ人が見るのは行動を
        // 始める前の姿になる。答えが増えれば進む先も変わるので、毎回送り直す
        ...boards(waiting, progress.board),
        // **盤面より後に送る。** 受け取った側は盤面が届くと選択を畳む（`session.ts`）ので、
        // 先に送ると選んでほしいことが消える。`rejoin` も同じ順で送っている。
        { to: waiting.seats[choice.player], message: { kind: '選んでほしい', choice } },
      ],
    }
  }

  const advanced: DuelInRoom = { ...duel, state: progress.state, pending: undefined }
  return { rooms: withRoom(rooms, { ...room, duel: advanced }), deliveries: boards(advanced) }
}

/**
 * CPU が 1 度に打つ手数の上限（#175）。
 *
 * **終わらない手順に落ちてもサーバが止まらないようにするためだけにある。** 打つのは自分の
 * 優先権がある間だけで、1 手ごとに相手へ優先権が渡る（`play.ts` の `grantPriorityToInactive`）
 * ため、実際に続けて打つのは数手である。ここに届くのはエンジンの穴であり、その時は打ち切って
 * 盤面を止める——回り続けて応答を返さないよりは、止まって見えるほうがましである。
 */
const CPU_STEP_LIMIT = 200

/**
 * CPU の番である限り、CPU に打たせる（#175）。
 *
 * **人が打った後に呼ぶ。** 1 手ごとに盤面が両方に送られる（`advance`）ので、人の画面には
 * CPU が何をしたかが順に届く。CPU 宛てのものを落とすのは呼ぶ側（`receive`）である。
 */
function withCpu(outcome: RoomOutcome, code: RoomCode): RoomOutcome {
  let rooms = outcome.rooms
  let deliveries = outcome.deliveries

  for (let step = 0; step < CPU_STEP_LIMIT; step += 1) {
    const room = rooms.get(code)
    const played = room === undefined ? undefined : cpuStep(rooms, room)
    if (played === undefined) break

    rooms = played.rooms
    deliveries = [...deliveries, ...played.deliveries]
  }

  return { rooms, deliveries }
}

/**
 * CPU の番なら 1 手だけ進める。CPU の番でなければ `undefined`。
 *
 * 打つのも答えるのも、人が送ってきた時と同じ道筋（`advance`）を通す。**CPU のために別の
 * 進め方を作らない。** 通り道が分かれると、片方だけで起きる違いが生まれる。
 */
function cpuStep(rooms: Rooms, room: Room): RoomOutcome | undefined {
  const duel = room.duel
  if (duel === undefined || room.cpu === undefined || hasEnded(duel.state)) return undefined

  const seat = seatOf(duel, room.cpu)
  if (seat === undefined) return undefined

  const pending = duel.pending
  if (pending !== undefined) {
    if (pending.player !== seat) return undefined

    const progress = pendingProgress(duel)
    if (progress === undefined) return undefined

    const picked = pickCpuAnswer(progress.choice, duel.random)
    const stepped: DuelInRoom = { ...duel, random: picked.random }
    return advance(rooms, { ...room, duel: stepped }, stepped, {
      ...pending,
      answers: [...pending.answers, picked.answer],
    })
  }

  if (duel.state.turn.priority !== seat) return undefined

  const picked = pickCpuAction(duel.state, duel.random)
  if (picked === undefined) return undefined

  const stepped: DuelInRoom = { ...duel, random: picked.random }
  return advance(rooms, { ...room, duel: stepped }, stepped, { action: picked.action, answers: [], player: seat })
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
