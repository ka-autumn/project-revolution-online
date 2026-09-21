import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import { NOT_SIGNED_IN } from '@revolution/engine'
import type { DeckId, FromClient, RecipeKey, ToClient, WireDeck } from '@revolution/engine'
import { isCpu } from './cpu.js'
import { poolFacesOf, restrictionChoicesOf, withOwnedDecks } from './deck.js'
import type { CardKey, CardSupply, PresetDeck } from './deck.js'
import { readName } from './name.js'
import { OWNED_DECK_LIMIT, readCards, readDeck, sortCards, violationsOf } from './owned-deck.js'
import { recipeKeyOf, readShareRequest, wireRecipeSummaryOf, wireShareOf } from './recipe.js'
import { describeViolation, emptyRooms, lobbyOf, partnerOf, receive, restore, roomOf, rulesFor, violationsUnder } from './room.js'
import type { DeckSource, Names, ParticipantId, Room, RoomOutcome, RoomSetup, Rooms } from './room.js'
import type { SignIn } from './sign-in.js'
import type { Store } from './store.js'

/**
 * WebSocket で 2 人を繋ぐ（ADR-0009、#83）。
 *
 * 決まりごとを持っているのは `room.ts` で、ここは**受け取ったバイト列を組み立て直して渡し、
 * 返ってきたものを送り分けるだけ**である。盤面を進めるところと同じように（ADR-0001）、
 * 決まりごとと I/O を分けている。
 *
 * **接続 1 本が参加者 1 人に対応する。** 誰であるかは 2 通りのどちらかで決まる（ADR-0019）。
 *
 * - **ログインの設定があるとき** — 握手に付いてきた Cookie のセッションで決まる。`?participant=`
 *   は読まない。**両方であることはできない**ので、開いているかどうかを別の旗で持たず、
 *   設定が渡されたかどうかがそのまま境目になる
 * - **設定が無いとき** — 繋ぐ時の URL で名乗る（`?participant=`）。これは認証ではなく、知って
 *   いる人がその席に座れる合言葉である（ADR-0009）。手元で 2 人ぶん試すためのものである
 *
 * 同じ人として繋ぎ直すと、部屋はそのままに続きから打てる。切れた接続は覚えておかず、その人に
 * 紐づく接続を新しいものに差し替えるだけでよい。**入り直した人にいまの盤面を送り直すのは
 * `room.ts` の仕事**である。
 *
 * **HTTP も同じポートで喋る**（ADR-0019）。ログインの口（`sign-in.ts`）がそこに乗る。中継の
 * 設定も、WebSocket を通すだけでなく通常の HTTP の道が要る（ADR-0015）。
 */

export interface ServeOptions {
  readonly port: number
  /**
   * デュエルを始めるのに要るもの。部屋が始まるたびに呼ぶ。
   *
   * 呼ぶたびに違うシードを返せるようにするため、値ではなく関数で受け取る。同じシードを返すと
   * どの部屋も同じ山札の並びになる（ADR-0005）。
   */
  readonly setup: () => RoomSetup
  /**
   * 席に持ち込めるデッキ（ADR-0021、`deck.ts` の `deckSourceFrom`）。
   *
   * **部屋ごとに変わらないので、`setup` とは別に受け取る。** 引けるものを決めるのは立てる時に
   * 渡されたもので、シードや合言葉のように部屋ごとに引き直すものではない。
   */
  readonly decks: DeckSource
  /**
   * コピー元としてロビーに出す既製デッキ（`deck.ts` の `deckChoicesOf`）。
   *
   * **引くところ（`decks`）と別に受け取る。** 引けるかどうかと、選ぶ人に見せるかどうかは
   * 別である——記録を立て直す時に引くデッキは、棚に並んでいるとは限らない。
   *
   * **席に着く時に選べるものではない**（ADR-0021、#194）。座るのは自分のデッキで、既製デッキは
   * コピーしてから使う。
   */
  readonly deckChoices: readonly WireDeck[]
  /**
   * 立てる時に渡されたもの一式（`deck.ts` の `CardSupply`）。**自分のデッキを預かる時に引く**
   * （ADR-0021）。
   *
   * 保存されるデッキにプールに無いカードが入っていないかを見るのにプールが、コピーするのと
   * 初めて入った人に配るのに既製デッキが要る。
   */
  readonly supply: CardSupply
  /** 生きているかを確かめる間隔（ミリ秒）。既定は `HEARTBEAT_MS`。テストで縮めるために開けてある。 */
  readonly heartbeatMs?: number
  /**
   * 書いたものが残る置き場（ADR-0018、`store.ts`）。
   *
   * **渡さなければ何も残らない。** 立て直せば対戦は消える——ADR-0018 より前と同じ振る舞いに
   * なる。置き場を持つかどうかを決めるのは、サーバを立てる側である（`tools/bundle-server.mjs`）。
   */
  readonly store?: Store
  /**
   * ログインの口（ADR-0019、`sign-in.ts`）。
   *
   * **渡すと `?participant=` は受け付けなくなる。** 誰であるかは Cookie のセッションだけから
   * 決まり、ログインしていない接続は断られる。渡さなければ今までどおり名乗りで入れる。
   */
  readonly signIn?: SignIn
}

export interface RunningServer {
  /** 実際に使っている番号。`port` に 0 を渡した場合はここで分かる。 */
  readonly port: number
  close(): Promise<void>
}

/** 繋ぐ時に名乗った合言葉。名乗っていなければ `undefined`。 */
function participantOf(url: string | undefined): ParticipantId | undefined {
  const named = new URL(url ?? '/', 'ws://localhost').searchParams.get('participant')
  return named === null || named === '' ? undefined : named
}

/**
 * 握手してきた接続を誰のものとするか（ADR-0019）。
 *
 * **なりうる形を数え上げる。** 「誰であるか」と「断る理由」を別々に持つと、どちらも無い形や
 * どちらもある形が書けてしまう。
 */
type Seating =
  | { readonly kind: '通す'; readonly participant: ParticipantId }
  | { readonly kind: '断る'; readonly reason: string }

/**
 * 受け取ってよいメッセージの種類（`protocol.ts` の `FromClient`）。
 *
 * `FromClient` に足したら、ここにも足す。**足し忘れると読めないメッセージとして黙って断られる**
 * ので、種類をキーにした表にして、抜けが型検査で落ちるようにしている。
 */
const ACCEPTED: Readonly<Record<FromClient['kind'], true>> = {
  部屋に入る: true,
  部屋を作る: true,
  ロビーに戻る: true,
  行動する: true,
  選ぶ: true,
  ひとつ戻る: true,
  取り消す: true,
  名前を決める: true,
  デッキを保存する: true,
  デッキを消す: true,
  デッキをコピーする: true,
  デッキを確かめる: true,
  デッキを共有する: true,
  共有を取り消す: true,
  共有の公開範囲を変える: true,
  レシピを見る: true,
  レシピの一覧を見る: true,
}

/** 自分のデッキに手を加えるメッセージ（ADR-0021）。部屋の外のことなので、ここで受ける。 */
type DeckRequest = Extract<FromClient, { readonly kind: 'デッキを保存する' | 'デッキを消す' | 'デッキをコピーする' }>

function isDeckRequest(message: FromClient): message is DeckRequest {
  return message.kind === 'デッキを保存する' || message.kind === 'デッキを消す' || message.kind === 'デッキをコピーする'
}

/** レシピと共有に手を加える・見るメッセージ（ADR-0022）。部屋の外のことなので、ここで受ける。 */
type RecipeRequest = Extract<
  FromClient,
  { readonly kind: 'デッキを共有する' | '共有を取り消す' | '共有の公開範囲を変える' | 'レシピを見る' | 'レシピの一覧を見る' }
>

function isRecipeRequest(message: FromClient): message is RecipeRequest {
  return (
    message.kind === 'デッキを共有する' ||
    message.kind === '共有を取り消す' ||
    message.kind === '共有の公開範囲を変える' ||
    message.kind === 'レシピを見る' ||
    message.kind === 'レシピの一覧を見る'
  )
}

/** コピー元 1 つから写す中身（ADR-0022）。既製デッキと共有レシピのどちらも、この形に揃えてから写す。 */
interface CopySource {
  readonly name: string
  readonly description: string
  readonly cards: readonly CardKey[]
  /** コピー元が共有レシピなら、そのレシピの鍵。コピー数を数えるのに使う。既製デッキなら `undefined`。 */
  readonly copiedRecipe: RecipeKey | undefined
}

/**
 * `デッキをコピーする` の `origin` から、写す中身を決める（ADR-0022）。
 *
 * **種類を数え上げる形で書く。** 足すはずの種類を弾く側に書き足し忘れると、新しいコピー元が
 * サイレントに「そのデッキはありません」で終わる——`switch` を種類で割り、抜けは `default` で
 * 捕まえる形にして、足し忘れに気付きやすくする。
 *
 * **画面から来るものは型のとおりとは限らない**（`parse` が見るのは種類だけである）ので、`origin`
 * を `unknown` として読み直す。
 */
function copySourceOf(origin: unknown, presets: readonly PresetDeck[], store: Store): CopySource | undefined {
  if (typeof origin !== 'object' || origin === null) return undefined

  const { kind } = origin as { readonly kind?: unknown }
  switch (kind) {
    case '既製デッキ': {
      const { id } = origin as { readonly id?: unknown }
      if (typeof id !== 'string') return undefined
      const preset = presets.find((candidate) => candidate.id === id)

      return preset === undefined ? undefined : { name: preset.name, description: '', cards: preset.cards, copiedRecipe: undefined }
    }
    case '共有レシピ': {
      const { share: shareId } = origin as { readonly share?: unknown }
      if (typeof shareId !== 'string') return undefined
      // **持ち主を見ない。** 他人が「一覧に載せる」・「リンクを知っている人だけ」で出した共有も、
      // 誰でもコピーできる（ADR-0022）。取り消された共有だけはここで弾く。
      const share = store.shareById(shareId)
      if (share === undefined || share.revoked) return undefined
      const cards = store.recipeCards(share.recipe)

      return cards === undefined
        ? undefined
        : { name: share.name, description: share.description, cards, copiedRecipe: share.recipe }
    }
    default:
      return undefined
  }
}

/** 受け取ったバイト列をメッセージとして読む。読めなければ `undefined`。 */
function parse(data: unknown): FromClient | undefined {
  try {
    const parsed: unknown = JSON.parse(String(data))
    if (typeof parsed !== 'object' || parsed === null) return undefined

    const { kind } = parsed as { readonly kind?: unknown }
    // `hasOwn` で引く。`in` だと `toString` のような受け継いだ名前まで通ってしまう。
    return typeof kind === 'string' && Object.hasOwn(ACCEPTED, kind) ? (parsed as FromClient) : undefined
  } catch {
    return undefined
  }
}

/**
 * 生きているかを確かめる間隔（ミリ秒）。
 *
 * 不安定な回線では、切れたことが TCP から降りてこないまま黙って死ぬ接続ができる。放っておくと
 * その席は埋まったままになり、繋ぎ直してきた本人が入れなくなる——のではなく、**繋ぎ直した側は
 * 入れるが、死んだ接続がずっと残る**（ADR-0016）。合わせて、間に置いた中継が黙っている接続を
 * 切る場合の予防にもなる（ADR-0015）。
 *
 * 30 秒にしているのは、よくある中継のアイドル打ち切り（60 秒）の半分だからである。
 */
const HEARTBEAT_MS = 30_000

function send(socket: WebSocket | undefined, message: ToClient): void {
  if (socket !== undefined && socket.readyState === socket.OPEN) socket.send(JSON.stringify(message))
}

/**
 * サーバを立てる。返る約束は、繋げるようになったところで果たされる。
 *
 * 部屋も、合言葉から接続を引く表も、この中にしか無い。落とすと対戦は消える（ADR-0009）。
 */
export function serve(options: ServeOptions): Promise<RunningServer> {
  /**
   * HTTP と WebSocket を同じポートに同居させる（ADR-0019）。
   *
   * 引き受け先の無い要求は断る。**ここに置くのはログインの道筋だけ**で、画面を配るのは別の
   * ところである（ADR-0013）。
   */
  const http = createServer((request, response) => {
    if (options.signIn?.handle(request, response) === true) return

    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('ここには何もありません')
  })
  const server = new WebSocketServer({ server: http })
  const sockets = new Map<ParticipantId, WebSocket>()
  /** 前回の確認から返事があった接続。ここに無いものは死んだものとして落とす。 */
  const answered = new Set<WebSocket>()
  /**
   * その人に最後に送ったロビー（#175）。同じものを送り直さないために覚えている。
   *
   * 部屋にいる間は消す。出てきた時に、変わっていなくてももう一度届くようにするためである。
   */
  const lobbySent = new Map<ParticipantId, string>()
  /** 部屋を作る時に選べる禁止／制限リスト（ADR-0021）。立てる時に渡されたもので、変わらない。 */
  const restrictions = restrictionChoicesOf(options.supply)
  /**
   * その人に最後に伝えた「相手が繋がっているか」（#175）。同じことを言い続けないために覚えている。
   *
   * 切れたら消す。**繋ぎ直してきた人には、変わっていなくてももう一度伝える。**
   */
  const linkSent = new Map<ParticipantId, boolean>()
  /**
   * 置き場に残っていた対戦から始める（ADR-0018）。
   *
   * **立て直しても対戦が消えない。** 作り直すのは記録した入力を打ち直すことで、決着まで打った
   * 1 本でも 18ms しかかからない（`room.ts` の `restore`）。デッキは記録に残っている識別子から
   * 引き直し（ADR-0021）、引けないカードを含んでいればその対戦は作り直さない。
   */
  let rooms: Rooms = options.store === undefined ? emptyRooms() : restore(options.store.openDuels(), options.decks)

  /** いま繋がっている人。部屋はこれを見て、抜けられるかを決める（`room.ts` の `canLeave`）。 */
  const linked = (): ReadonlySet<ParticipantId> => new Set(sockets.keys())

  /**
   * その人が付けた表示名。まだ決めていなければ `undefined`（ADR-0020）。
   *
   * **預かるのは置き場である**（`store.ts`）。ログインの設定が無いときは預ける先が無いので、
   * **名乗りがそのまま表示名になる**——ここでも、設定が渡されたかどうかがそのまま境目である
   * （ADR-0019、ADR-0020）。
   */
  function nameOf(participant: ParticipantId): string | undefined {
    if (options.signIn === undefined || options.store === undefined) return participant

    return options.store.nameOf(participant)
  }

  /**
   * 部屋に渡す名前の引き方（`room.ts` の `Names`）。
   *
   * **CPU は置き場に居ない。** 部屋の側は CPU の名前を尋ねないが（ロビーからは外し、相手が CPU
   * なら名前を持たない）、尋ねられても置き場を引きに行かせない。
   */
  const names: Names = (participant) => (isCpu(participant) ? participant : (nameOf(participant) ?? participant))

  /** 表示名を決めたか（ADR-0020）。**決めるまで、ほかのことは受け付けない。** */
  const named = (participant: ParticipantId): boolean => nameOf(participant) !== undefined

  /**
   * デッキを預かる置き場。**ログインを持たない立て方では `undefined`**（ADR-0021）。
   *
   * 名乗りは認証ではなく、知っている人がその席に座れる合言葉である（ADR-0009）。そこにデッキを
   * 紐づけると、名乗りを知っている人が他人のデッキを書き換えられる。
   */
  const deckStore: Store | undefined = options.signIn === undefined ? undefined : options.store

  /**
   * 席に持ち込めるデッキ（ADR-0021、#194）。**自分のデッキを預かれるなら、そこからも引く。**
   *
   * **CPU の席には自分のデッキが無い。** CPU は身元を持たない参加者（`cpu.ts`）で、置き場に
   * 引きに行くと身元の識別子として読めずに落ちる。**引く前に外す。**
   */
  const decks: DeckSource =
    deckStore === undefined
      ? options.decks
      : withOwnedDecks(options.decks, options.supply.pool, {
          decksOf: (participant) => (isCpu(participant) ? [] : deckStore.decksOf(participant)),
          lastChosenOf: (participant) => (isCpu(participant) ? undefined : deckStore.lastChosenDeckOf(participant)),
          lastChosenCpuOf: (participant) =>
            isCpu(participant) ? undefined : deckStore.lastChosenCpuDeckOf(participant),
        })

  /** 既製デッキを、その人の新しいデッキとして写す（ADR-0022）。名前はコピー元のものが付く。 */
  function copyPreset(store: Store, participant: ParticipantId, preset: PresetDeck): string | undefined {
    return store.saveDeck(participant, undefined, {
      name: preset.name,
      description: '',
      cards: sortCards(preset.cards),
    })
  }

  /**
   * 自分のデッキを送る（ADR-0021）。**1 つも持っていなければ、先に既製デッキを 1 つ配る。**
   *
   * 配るのを「初めて表示名を決めた時」にしないのは、それより前に名前を決めた人に届かないから
   * である。最後の 1 つは消せないので、消した後に知らないデッキが湧いて出ることはない。
   */
  function sendOwnDecks(socket: WebSocket, participant: ParticipantId): void {
    if (deckStore === undefined) return

    const [first] = options.supply.presets
    if (first !== undefined && deckStore.decksOf(participant).length === 0) copyPreset(deckStore, participant, first)

    send(socket, { kind: '自分のデッキ', decks: deckStore.decksOf(participant) })
  }

  /**
   * 配るカードプール（ADR-0021）。**プールは立てている間変わらないので、書き出すのは 1 度でよい。**
   *
   * デッキを預かれない立て方では配らない。組んでも残す場所が無い。
   */
  const poolFaces = deckStore === undefined ? undefined : poolFacesOf(options.supply)

  /** カードプールを送る（ADR-0021）。**繋いだ接続ごとに 1 度だけ呼ぶ**——中身は変わらない。 */
  function sendPool(socket: WebSocket): void {
    if (poolFaces === undefined) return

    send(socket, { kind: 'カードプール', cards: poolFaces })
  }

  /**
   * 握手してきた接続が誰のものかを決める（ADR-0019）。
   *
   * **ログインの設定があるなら Cookie だけを見る。** URL の名乗りは読まない——読めば、他人の
   * 識別子を名乗るだけでその席に座れてしまう。**両方であることはできない。**
   *
   * 断るときは理由を送ってから閉じる。**握手そのものを断らない**のは、ブラウザの `WebSocket`
   * には閉じた理由が降りてこないからである。画面はこの返事を見てログインへ送る（同）。
   */
  function whoIs(cookie: string | undefined, url: string | undefined): Seating {
    if (options.signIn !== undefined) {
      const holder = options.signIn.holderOf(cookie)
      return holder === undefined ? { kind: '断る', reason: NOT_SIGNED_IN } : { kind: '通す', participant: holder }
    }

    const named = participantOf(url)
    if (named === undefined) return { kind: '断る', reason: '名乗っていない' }
    // CPU の名乗りは人に使わせない（#175）。名乗りは認証ではなく、知っている人がその席に
    // 座れる合言葉である（ADR-0009）ため、名乗れてしまうと CPU の席に座れる。
    if (isCpu(named)) return { kind: '断る', reason: '使えない名乗り' }

    return { kind: '通す', participant: named }
  }

  /**
   * 部屋が返したものを、それぞれの宛先へ送る。ロビーも送り直す。
   *
   * **送る前に書く**（ADR-0018）。書く前に送ると、書けないまま人の画面だけが先に進む。書いてから
   * 落ちたなら、繋ぎ直した先で同じ盤面が作り直される。
   */
  function deliver(outcome: RoomOutcome): void {
    keep(outcome)
    rooms = outcome.rooms
    for (const delivery of outcome.deliveries) send(sockets.get(delivery.to), delivery.message)
    pushLobby()
  }

  /**
   * 起きたことを置き場へ書き足す（ADR-0018）。
   *
   * **書けなくても対戦は止めない。** 記録が欠けるのは失うものだが、打てなくなるほうが重い。
   * 黙って落とさずに残すのは、置き場が壊れていることに気付けるようにするためである。
   */
  function keep(outcome: RoomOutcome): void {
    if (options.store === undefined || outcome.records.length === 0) return

    try {
      options.store.write(outcome.records)
    } catch (error) {
      console.error('置き場へ書けませんでした:', error)
    }
  }

  /**
   * その部屋にいる人それぞれに、相手が繋がっているかを伝える（#175）。
   *
   * **繋がりを知っているのはここだけである。** 部屋は決まりごとしか持たない（`room.ts`）ので、
   * 誰が繋がっているかは渡す側の仕事になる。相手が閉じたまま戻らない対戦から抜けられるかも、
   * 同じものから決まる（同 `canLeave`）。
   *
   * CPU が相手の部屋には送らない。CPU は繋がらないのが当たり前で、投げ出せるかどうかも相手が
   * CPU であることから決まっている。
   */
  function tellLinks(room: Room | undefined): void {
    if (room === undefined || room.cpu !== undefined) return

    for (const participant of room.participants) {
      const partner = partnerOf(room, participant)
      if (partner === undefined) continue

      // 繋がっていない人には送れない。**覚えてもおかない。** 繋ぎ直してきた時に、変わって
      // いないからと黙ってしまうことになる。
      const socket = sockets.get(participant)
      if (socket === undefined) {
        linkSent.delete(participant)
        continue
      }

      // **部屋を出た相手は繋がっていない。** 出た人はその席に戻れない（`enter` が断る）ので、
      // 繋ぎ直してくるかどうかに関わらず、待っていても相手は来ない。
      const present = room.participants.includes(partner) && sockets.has(partner)
      // **変わった時だけ送る。** 同じことを言い続けると、受け取るたびに畳み直す側
      // （`client` の `index.ts`）が動くことになる。
      if (linkSent.get(participant) === present) continue

      linkSent.set(participant, present)
      send(socket, { kind: '相手の繋がり', connected: present })
    }
  }

  /**
   * どの部屋にもいない人に、いまのロビーを送る（#175）。
   *
   * **部屋の様子が変わりうるたびに呼ぶ。** 尋ねに来るのを待たずに送ることで、誰かが部屋を
   * 作れば、ほかの人の一覧にすぐ出る。前に送ったものと同じなら送らない。
   */
  function pushLobby(): void {
    const lobby = lobbyOf(rooms, names)
    for (const [participant, socket] of sockets) {
      if (roomOf(rooms, participant) !== undefined) {
        lobbySent.delete(participant)
        continue
      }
      // 名前を決めていない人には出さない（ADR-0020）。**入れない場所を見せない**——ここから
      // 押せるものは、どれも名前を決めるまで断られる。
      if (!named(participant)) {
        lobbySent.delete(participant)
        continue
      }
      // **人ごとに違うものを送る。** 既定のデッキはその人のものである（ADR-0021、#194）ので、
      // 部屋の一覧が同じでも同じメッセージにはならない。
      const message = {
        kind: 'ロビー',
        rooms: lobby,
        presets: options.deckChoices,
        // **座る時に使うものと同じところで決める**（`room.ts` の `refusalOfDeck`）。既定を
        // 2 か所で決めると、出ているものと座るものがずれる。
        chosen: decks.fallbackFor(participant),
        // CPU の席の既定も、座る時に使うものと同じところで決める（`room.ts` の `open`、#195）。
        cpuChosen: decks.cpuFallbackFor(participant),
        restrictions,
      } as const
      const shown = JSON.stringify(message)
      if (lobbySent.get(participant) === shown) continue

      lobbySent.set(participant, shown)
      send(socket, message)
    }
  }

  /**
   * 生きているかを確かめて、返事の無かった接続を落とす。
   *
   * 落とすと `close` が起きるので、表から外すのは今までどおりそちらの仕事である。相手の
   * 返事（pong）は `ws` が勝手に返すので、**繋いでいる側は何もしなくてよい**。
   */
  const heartbeat = setInterval(() => {
    for (const socket of server.clients) {
      if (!answered.has(socket)) {
        socket.terminate()
        continue
      }
      answered.delete(socket)
      socket.ping()
    }
  }, options.heartbeatMs ?? HEARTBEAT_MS)
  // これ自体はサーバを生かしておく理由にならない。待っているポートのほうが生かす。
  heartbeat.unref()

  server.on('connection', (socket, request) => {
    answered.add(socket)
    socket.on('pong', () => answered.add(socket))
    socket.on('close', () => answered.delete(socket))


    const decided = whoIs(request.headers.cookie, request.url)
    if (decided.kind === '断る') {
      send(socket, { kind: '行えなかった', reason: decided.reason })
      socket.close()
      return
    }
    const { participant } = decided

    // 同じ合言葉で繋ぎ直された場合、古い接続は捨てる。部屋の側は入り直しとして扱う。
    sockets.set(participant, socket)
    // **新しい接続には、覚えていることを言い直す。** 送ったかどうかは名乗りで覚えている
    // （`lobbySent`・`linkSent`）ので、消しておかないと、同じ名乗りで繋ぎ直した先が
    // 「もう伝えてある」として黙って何も受け取れないままになる。
    lobbySent.delete(participant)
    linkSent.delete(participant)

    /**
     * 部屋にいるならその様子を、いないならロビーを送る（#175）。
     *
     * **どこにいるかを知っているのはサーバである。** 画面を読み込み直すと、繋ぐ側は自分が
     * どの部屋にいたかを忘れている（合言葉を決めたのはサーバなので、URL にも無い）。入り直しを
     * 待っていると、誰も何も送らないまま止まる。部屋にいる人には、入り直したものとして
     * いまの盤面を送る（ADR-0009、`room.ts` の `rejoin`）。
     *
     * **名前を決めていないなら、そこへ通さない**（ADR-0020）。繋ぎはするが、決まるまで先へは
     * 進めない。名前を決め終わったところで、もう一度ここを通る。
     */
    function admit(): void {
      if (!named(participant)) {
        send(socket, { kind: '名前を決めてほしい', current: undefined, reason: undefined })
        return
      }

      // **カードプールはデッキより先に送る。** デッキは識別子の並びで、引く先がプールである。
      // `admit` は接続ごとに 1 度だけ通る（名前を初めて決めた時か、決め終えた人が繋いだ時）。
      sendPool(socket)
      sendOwnDecks(socket, participant)
      sendMyShares()
      const current = roomOf(rooms, participant)
      if (current === undefined) pushLobby()
      else {
        // **デッキは選び直さない。** どれで座っていたかは部屋が覚えている（`room.ts` の
        // `rejoin`）ので、入り直しで上書きしない（ADR-0021）。
        const entering = { kind: '部屋に入る', room: current.code, deck: undefined } as const
        deliver(receive(rooms, participant, entering, options.setup(), decks, linked(), names))
      }
      // 入り直した本人にも、相手にも、繋がりが変わったことを伝える。
      tellLinks(roomOf(rooms, participant))
    }

    /**
     * 送られてきたものを表示名として預かる（ADR-0020）。
     *
     * **決まりを見るのは `name.ts` である。** 通らなければ理由を添えて尋ね直し、置き場には
     * 何も書かない。**通れば、そこで初めて先へ進める**（`admit`）。
     */
    function decideName(raw: string): void {
      const store = options.store
      if (options.signIn === undefined || store === undefined) {
        // 手元で立てたときは名乗りがそのまま表示名である（ADR-0020）。預ける先が無い。
        send(socket, { kind: '行えなかった', reason: '名前は名乗りで決まっています' })
        return
      }

      const reading = readName(raw)
      if (reading.kind === '断る') {
        send(socket, { kind: '名前を決めてほしい', current: nameOf(participant), reason: reading.reason })
        return
      }

      // **初めて決めた人だけを、そこで先へ通す。** すでに入っている人まで通し直すと、名前を
      // 変えるたびに盤面が送り直される（`admit` は入り直しと同じ道筋である）。
      const first = !named(participant)
      store.rename(participant, reading.name)
      if (first) admit()
      // **ロビーの中身は人の名前でも変わる**（ADR-0020）。名前を変えた人だけでなく、ロビーに
      // いる全員に送り直す。前と同じなら送られない（`pushLobby`）。
      pushLobby()
    }

    /**
     * 自分のデッキに手を加える（ADR-0021）。
     *
     * **決まりを見るのは `owned-deck.ts` である。** ここが見るのは、置き場の中身を数えないと
     * 決まらないこと——持てる数の上限と、最後の 1 つかどうか——だけである。通れば、変わった後の
     * 自分のデッキを送り直す。
     */
    function changeDecks(message: DeckRequest): void {
      if (deckStore === undefined) {
        send(socket, { kind: '行えなかった', reason: 'ログインしていないとデッキを持てません' })
        return
      }
      const refuse = (reason: string): void => send(socket, { kind: '行えなかった', reason })
      const full = (): boolean => deckStore.decksOf(participant).length >= OWNED_DECK_LIMIT
      const { pool, presets } = options.supply

      switch (message.kind) {
        case 'デッキを保存する': {
          const reading = readDeck(message, pool)
          if (reading.kind === '断る') return refuse(reading.reason)
          if (message.deck === undefined && full()) return refuse(`デッキは ${OWNED_DECK_LIMIT} 個までです`)

          const saved = deckStore.saveDeck(participant, message.deck, reading.deck)
          if (saved === undefined) return refuse('そのデッキはありません')

          send(socket, { kind: 'デッキを保存した', deck: saved, violations: violationsOf(reading.deck.cards, pool) })
          break
        }
        case 'デッキを消す': {
          const decks = deckStore.decksOf(participant)
          if (!decks.some((deck) => deck.id === message.deck)) return refuse('そのデッキはありません')
          // **最後の 1 つは消せない。** 消せると、次に繋いだ時に既製デッキが配られ直して、消した
          // はずのところに知らないデッキが湧いて出る（`sendOwnDecks`）。
          if (decks.length === 1) return refuse('最後のデッキは消せません')

          deckStore.deleteDeck(participant, message.deck)
          break
        }
        case 'デッキをコピーする': {
          // **コピー元の種類は数え上げる**（ADR-0022）——既製デッキと共有レシピのどちらも、
          // ここでは同じ形に揃えてから写す。
          const source = copySourceOf(message.origin, presets, deckStore)
          if (source === undefined) return refuse('そのデッキはありません')
          if (full()) return refuse(`デッキは ${OWNED_DECK_LIMIT} 個までです`)

          const saved = deckStore.saveDeck(participant, undefined, {
            name: source.name,
            description: source.description,
            cards: sortCards(source.cards),
          })
          if (saved === undefined) return refuse('そのデッキはありません')

          // **コピー数はレシピ単位で数える**（ADR-0022）。既製デッキのコピーは数えない——一覧に
          // 並ぶのはレシピだけである。
          if (source.copiedRecipe !== undefined) deckStore.recordCopy(source.copiedRecipe)

          send(socket, { kind: 'デッキを保存した', deck: saved, violations: violationsOf(source.cards, pool) })
          break
        }
      }

      sendOwnDecks(socket, participant)
      // **ロビーも送り直す。** 何も選ばずに座った時のデッキはその人のデッキから決まる（#194）ので、
      // デッキが増えたり消えたりすると変わりうる。**部屋の様子が変わっていなくても送り直す。**
      pushLobby()
    }

    /**
     * 組んでいるデッキを、選んだルールで確かめる（ADR-0021）。**置き場には触らない。**
     *
     * **ログインを持たない立て方では断る。** 組んでも残す場所が無く、カードプールも配っていない
     * （`sendPool`）。確かめる口だけを開けておく理由が無い。
     */
    function checkDeck(message: Extract<FromClient, { readonly kind: 'デッキを確かめる' }>): void {
      const refuse = (reason: string): void => send(socket, { kind: '行えなかった', reason })
      if (deckStore === undefined) return refuse('ログインしていないとデッキを持てません')

      const reading = readCards(message.cards, options.supply.pool)
      if (reading.kind === '断る') return refuse(reading.reason)
      const rules = rulesFor(message.format, message.restriction, options.decks.restrictions)
      if (typeof rules === 'string') return refuse(rules)
      // `readCards` を通った並びはプールのカードだけなので、引けないことは無い。
      const deck = options.decks.from(reading.cards)
      if (deck === undefined) throw new Error('プールにあるはずのカードが引けませんでした')

      send(socket, { kind: 'デッキを確かめた', violations: violationsUnder(deck.cards, rules) })
    }

    /** 自分の共有全部を送り直す（ADR-0022）。`sendOwnDecks` と同じ形。 */
    function sendMyShares(): void {
      if (deckStore === undefined) return

      send(socket, { kind: '自分の共有', shares: deckStore.sharesOf(participant).map((share) => wireShareOf(share, names)) })
    }

    /**
     * レシピと共有に手を加える・見る（ADR-0022）。
     *
     * **決まりを見るのは `recipe.ts` である。** ここが見るのは、置き場の中身を読まないと決まら
     * ないこと——共有しようとしているデッキの中身、規定を満たしているか、共有や共有先のレシピが
     * あるかどうか——だけである。
     *
     * **ログインを持たない立て方では断る。** 組んだデッキを残す場所が無く、共有もできない
     * （`changeDecks` と同じ理由）。
     */
    function handleRecipe(message: RecipeRequest): void {
      const refuse = (reason: string): void => send(socket, { kind: '行えなかった', reason })
      if (deckStore === undefined) return refuse('ログインしていないと共有できません')

      switch (message.kind) {
        case 'デッキを共有する': {
          const deck = deckStore.decksOf(participant).find((each) => each.id === message.deck)
          if (deck === undefined) return refuse('そのデッキはありません')

          const reading = readShareRequest(message)
          if (reading.kind === '断る') return refuse(reading.reason)

          const rules = rulesFor(message.format, message.restriction, options.decks.restrictions)
          if (typeof rules === 'string') return refuse(rules)
          // `deck.cards` は保存する時にプールで確かめてある（`owned-deck.ts`）ので、引けないこと
          // は無い——取り下げられたカードを含むデッキだけが例外である（ADR-0021）。
          const seated = decks.from(deck.cards)
          if (seated === undefined) return refuse('使えないカードが入っています')

          const violations = violationsUnder(seated.cards, rules)
          if (violations.length > 0) {
            return refuse(`この規定を満たしていません: ${violations.map(describeViolation).join('、')}`)
          }

          const key = recipeKeyOf(deck.cards)
          deckStore.ensureRecipe(key, sortCards(deck.cards))
          const id = deckStore.addShare(key, participant, {
            name: reading.name,
            description: reading.description,
            visibility: reading.visibility,
            format: rules.format,
            restriction: rules.restriction.kind === '制限なし' ? undefined : rules.restriction.list.id,
          })
          const created = deckStore.shareById(id)
          if (created !== undefined) send(socket, { kind: '共有した', share: wireShareOf(created, names) })
          sendMyShares()
          return
        }
        case '共有を取り消す': {
          if (!deckStore.revokeShare(participant, message.share)) return refuse('その共有はありません')

          sendMyShares()
          return
        }
        case '共有の公開範囲を変える': {
          if (!deckStore.setShareVisibility(participant, message.share, message.visibility)) {
            return refuse('その共有はありません')
          }

          sendMyShares()
          return
        }
        case 'レシピを見る': {
          const cards = deckStore.recipeCards(message.recipe)
          // **共有が 1 つも残っていない（全部取り消された）レシピは開けない**（ADR-0022）。鍵を
          // 知らない場合と同じ形で返す——見分けても、開けないことは変わらない。
          const shares = deckStore.sharesOfRecipe(message.recipe)
          if (cards === undefined || shares.length === 0) {
            send(socket, { kind: 'レシピ', recipe: undefined })
            return
          }

          send(socket, {
            kind: 'レシピ',
            recipe: {
              key: message.recipe,
              cards,
              shares: [...shares].sort((left, right) => right.sharedAt - left.sharedAt).map((share) => wireShareOf(share, names)),
            },
          })
          return
        }
        case 'レシピの一覧を見る': {
          send(socket, {
            kind: 'レシピの一覧',
            order: message.order,
            recipes: deckStore.publicRecipes(message.order).map(wireRecipeSummaryOf),
          })
          return
        }
      }
    }

    /**
     * 席に着く時に選んだデッキを覚える（ADR-0021、#194）。**次にロビーへ出た時の既定になる。**
     *
     * **選ばずに座った人の既定も覚える。** 画面は既定を選んだ状態で出している（`ロビー` の
     * `chosen`）ので、そのまま座ったのは、出ていたものを選んだのと同じことである。**覚えないと、
     * そのデッキを消した時に別のデッキが黙って既定になる**——仕組みが防ごうとしているものが、
     * 一度も選び直さなかった人にだけ起きる。
     *
     * **入り直し（ADR-0016）で既定が変わることはない。** 繋ぎ直した人に送り直すのはサーバの側で
     * （`admit`）、ここを通らない。画面から同じ部屋へ選ばずに入り直した場合も、覚えているものを
     * 引き直して同じ値を書くだけである。選んで入り直したなら、待っている間のデッキは選び直せる
     * （`room.ts` の `rejoin`）ので、そのまま覚えてよい。
     *
     * **選んだことだけを覚え、座れたかどうかは見ない。** 部屋のルールで断られたとしても、その人が
     * 選んだのはそのデッキである。通るかどうかは部屋ごとに変わる（同）ので、断られたことを理由に
     * 忘れると、ルールの違う部屋を覗いただけで既定が消える。
     *
     * **自分のデッキでなければ覚えない。** 既製デッキは選ぶところに並ばず（#194）、他人のデッキの
     * 識別子は送られてきただけのものである。
     */
    function rememberChoice(message: FromClient): void {
      if (deckStore === undefined) return
      if (message.kind !== '部屋に入る' && message.kind !== '部屋を作る') return

      const chosen = message.deck ?? decks.fallbackFor(participant)
      if (chosen === undefined) return
      if (!deckStore.decksOf(participant).some((deck) => deck.id === chosen)) return

      deckStore.rememberChosenDeck(participant, chosen)
    }

    /**
     * CPU の席に選んだデッキを覚える（#195）。**自分のデッキでなければ覚えない**（`rememberChoice`
     * と同じ）。相手が人の部屋では `cpuDeck` は読まれないので、覚えない。
     */
    function rememberCpuChoice(message: FromClient): void {
      if (deckStore === undefined) return
      if (message.kind !== '部屋を作る' || message.against !== 'CPU') return

      const chosen = message.cpuDeck ?? decks.cpuFallbackFor(participant)
      if (chosen === undefined) return
      if (!deckStore.decksOf(participant).some((deck) => deck.id === chosen)) return

      deckStore.rememberChosenCpuDeck(participant, chosen)
    }

    admit()

    socket.on('message', (data) => {
      const message = parse(data)
      if (message === undefined) {
        send(socket, { kind: '行えなかった', reason: '読めないメッセージ' })
        return
      }
      if (message.kind === '名前を決める') {
        decideName(message.name)
        return
      }
      // **決まるまで、ほかのことは受け付けない**（ADR-0020）。断るのではなく尋ね直すのは、
      // 画面がそこで止まっているとは限らないためである（繋ぎ直した先など）。
      if (!named(participant)) {
        send(socket, { kind: '名前を決めてほしい', current: undefined, reason: undefined })
        return
      }
      if (isDeckRequest(message)) {
        changeDecks(message)
        return
      }
      if (message.kind === 'デッキを確かめる') {
        checkDeck(message)
        return
      }
      if (isRecipeRequest(message)) {
        handleRecipe(message)
        return
      }

      rememberChoice(message)
      rememberCpuChoice(message)

      // 部屋を出入りすると、残った人から見た相手が変わる（#175）。出た先と入った先の両方に伝える。
      const before = roomOf(rooms, participant)?.code
      deliver(receive(rooms, participant, message, options.setup(), decks, linked(), names))
      for (const code of new Set([before, roomOf(rooms, participant)?.code])) {
        if (code !== undefined) tellLinks(rooms.get(code))
      }
    })

    // 切れたことは覚えておかない。部屋は残り、同じ合言葉で入り直せば続きから打てる。
    socket.on('close', () => {
      if (sockets.get(participant) === socket) sockets.delete(participant)
      lobbySent.delete(participant)
      linkSent.delete(participant)
      // 待っている相手には伝える。**止まっている理由が読めないままにしない**（#175）。
      tellLinks(roomOf(rooms, participant))
    })
  })

  return new Promise((resolve, reject) => {
    http.on('error', reject)
    http.listen(options.port, () => {
      const address = http.address()
      resolve({
        port: typeof address === 'object' && address !== null ? address.port : options.port,
        close: () =>
          new Promise((done, failed) => {
            clearInterval(heartbeat)
            for (const socket of sockets.values()) socket.terminate()
            // **両方閉じる。** ポートを持っているのは HTTP のほうで、WebSocket はその上に
            // 乗っている（ADR-0019）。片方だけ閉じるとポートが空かない。
            server.close(() => {
              http.close((error) => (error === undefined ? done() : failed(error)))
              // **繋ぎっぱなしのものを待たない。** HTTP は返事の後も繋いだままにされうるので、
              // 閉じるのを頼むだけでは、誰も何もしていなくてもポートが空かないことがある。
              http.closeAllConnections()
            })
          }),
      })
    })
  })
}
