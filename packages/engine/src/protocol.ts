import type { Square } from './board.js'
import { cardsIn } from './duel.js'
import type { CardId, DuelState } from './duel.js'
import { applyLegalAction } from './legal-action.js'
import type { LegalAction } from './legal-action.js'
import { cardIdOf, squareOf } from './log.js'
import { visibleIdsOf } from './perspective.js'
import type { PassOutcome } from './progress.js'
import { PLAYERS } from './player.js'
import type { Player } from './player.js'
import type { ChoicePurpose, Chooser } from './resolve.js'
import type { WirePerspective } from './wire.js'
import { PLAYER_ZONES } from './zone.js'
import type { PlayerZone } from './zone.js'

/**
 * サーバとクライアントがやりとりする値（ADR-0008）。
 *
 * ここにあるのは形だけで、送る手立ては持たない。エンジンは I/O を持てない（ADR-0001）。
 * それでもエンジンに置いているのは、サーバとクライアントが共有しているのがエンジンだけで
 * あり、両側が同じ語彙を持てる場所がほかに無いためである。
 *
 * `LegalAction` がそのまま載るのは、カードを識別子で、スクエアを行と列で指しているからで
 * ある（`legal-action.ts`）。盤面と違って、カードそのものを含んでいない。
 */

/** 2 人を繋ぐための合言葉。最初の完走ではアカウント認証を作らない（#17）。 */
export type RoomCode = string

/** 部屋を作る時に決める、どちらを相手にするか。 */
export type OpponentKind = '人間' | 'CPU'

/**
 * 席に持ち込めるデッキ 1 つを指す識別子（ADR-0021）。
 *
 * **公開側にとってはただの文字列である。** 何を指すかも、どんなデッキがあるかも知らない
 * （ADR-0002）。**読み取らずに、そのまま返す鍵として扱う**——並べ替えにも絞り込みにも使わない。
 */
export type DeckId = string

/**
 * 席に着く時に選べるデッキ 1 つ（ADR-0021）。
 *
 * 名前が付いているのは**人が選ぶため**で、指すのは識別子のほうである。名前は重なりうるし、
 * 渡す側が変えれば次に繋いだ時から変わる（カードの表記と同じで、値はサーバから届く）。
 */
export interface WireDeck {
  readonly id: DeckId
  readonly name: string
}

/**
 * いま誰と打っているか（ADR-0020）。
 *
 * **部屋を作る時に選ぶ種類（`OpponentKind`）とは別のものである。** 作る時に決まるのは人か CPU
 * かだけで、相手が誰かは座ってみるまで分からない。
 *
 * 人が相手なら表示名が入る。**その名前は呼ぶためのもので、人を指す識別子ではない**
 * （ADR-0020）。重複しうるし、相手が変えれば次に届くものから変わる。
 */
export type Opponent = { readonly kind: 'CPU' } | { readonly kind: '人間'; readonly name: string }

/**
 * ロビーに並ぶ部屋 1 つ。
 *
 * **そこにいる人の表示名を載せる**（ADR-0020）。名乗りが席に座れる合言葉だった頃は出せなかった
 * （出すと居合わせた誰でも他人の席に着けた、ADR-0009）が、席はログインから来る身元で決まる
 * ようになった（ADR-0019）ので、その理由は消えている。
 */
export interface WireRoom {
  readonly code: RoomCode
  /** 作った人が付けた名前。付いていなければ合言葉がそのまま入る。 */
  readonly name: string
  readonly status: '相手を待っている' | '対戦中' | '終わった'
  /** CPU が座っているか。座っているなら、人が入れる席はもう無い。 */
  readonly cpu: boolean
  /**
   * そこに座っている人の表示名。入ってきた順に並ぶ（ADR-0020）。
   *
   * **CPU は入らない。** 座っているかどうかは `cpu` が持っており、CPU に表示名は無い。
   */
  readonly occupants: readonly string[]
}

/**
 * 候補の何番目を選んだか（ADR-0008）。
 *
 * 選ばないことを選べる場面（効果の中の「◯枚まで選び」、`resolve.ts` の `Chooser` の
 * `mayDecline`）では `'選ばない'` を返す。`undefined` にしていないのは、JSON にすると
 * 値の無いものが消えて「答えていない」と見分けが付かなくなるためである。
 */
export type ChoiceAnswer = number | '選ばない'

/**
 * 盤面での置き場所（#127）。ゾーンと、そのゾーンの何番目か。
 *
 * 並び順は届く盤面（`wire.ts` の `WirePerspective.zones`）と同じである。射影はゾーンの中身を
 * 並べ替えも間引きもしない（`perspective.ts` の `project`）ので、同じ番号が同じ札を指す。
 *
 * **識別子の代わりではない。** 指しているのは盤面の枠であって、そこにあるカードが何であるかは
 * 何も言っていない。**画面上の並びでもない。** どこに描くかを決めるのは受け取った側である
 * （ADR-0001）。
 */
export interface WireCardPosition {
  readonly player: Player
  readonly zone: PlayerZone
  readonly index: number
}

/**
 * 選ぶ時に見せる候補 1 つ。
 *
 * **どれを選んだかは番号で答える**（ADR-0008）ので、ここに載るのは「何を選んでいるのか」を
 * 見せるための分だけである。表側が見えないカードは、見えないまま候補になる。プランのコスト
 * として自分の裏向きのスマッシュをフリーズできる（総合ルール 第2部 第21章 7-5）が、スマッシュは
 * どちらのプレイヤーにも見えない（同 7-3）。
 *
 * 能力そのものを選ぶ場面（バンクにある能力、プランのめくりを置き換える置換効果）では、カード
 * ではなく能力が並ぶ。**どのカードから出た能力かまでは見せられる**ので、裏向きのカードと同じ
 * 扱いにはしない。何をする能力かは見せられない（効果は関数なので通信に載らない）。
 *
 * カードが並ばない場面もある。効果が置き先を選ばせる場合（「◯◯に登場させる」）に並ぶのは
 * スクエアで、**そこに何があるかではなく、盤面のどこかが選ばれている。**
 */
export type WireCandidate =
  | { readonly kind: '見えている'; readonly card: CardId }
  /**
   * カードそのものではなく、解決を待っている能力。
   *
   * `source` は発生源のカード。見えていないか、発生源を持たない能力（作成された誘発型能力、
   * `duel.ts` の `CreatedAbilityInstance`）なら `undefined` になる。
   */
  | { readonly kind: '能力'; readonly source: CardId | undefined }
  /**
   * カードではなく、盤面のスクエアそのもの。
   *
   * 行と列で指す（`board.ts` の `Square`）。エリア・ラインの呼び名は見るプレイヤーによって
   * 入れ替わる（総合ルール 第2部 第22章 4・6）ので、呼び名にするのは受け取った側である。
   */
  | { readonly kind: 'スクエア'; readonly square: Square }
  /**
   * 表側が見えていないカード。**盤面のどこにあるかだけを持つ**（#127）。
   *
   * 位置があると、番号のボタンだけでなく盤面のその札を押しても答えられる。**見えないままで
   * あることは崩れない**——どのゾーンの何番目かは、ゾーンごとの枚数・並び・向きとして今も
   * 届いている（`wire.ts` の `WireVisibleCard`）ものの言い直しである。いま見えていない候補が
   * 並ぶのはコストの支払いだけ（`cost.ts` の `chooseAndFreeze`）で、絞り込むのは向き
   * （公開情報、総合ルール 第2部 第23章 1-1）だけなので、どれが候補かは位置が無くても数えられる。
   *
   * **候補の絞り込みが非公開の中身を見るようになったら、ここを見直すこと。** その時は、位置を
   * 出すことで「どの札がその条件を満たしているか」が新しく読み取れるようになる。
   *
   * 山札にあるカードは位置を持たない。中身を見てはならないゾーンであり（総合ルール 第2部
   * 第21章 2-2）、1 枚ずつ並べる場所も画面に無いので、押す先が無い。
   */
  | { readonly kind: '見えていない'; readonly at: WireCardPosition | undefined }

/** 選んでほしいこと 1 つ。**選ぶプレイヤーにだけ送る**（ADR-0008）。 */
export interface WireChoice {
  readonly player: Player
  /**
   * 何のために選ばせているか（`resolve.ts` の `ChoicePurpose`）。
   *
   * 候補だけを見せても、それがコストの支払いなのか効果の対象なのかは分からない。**何を
   * 聞かれているかが分からないまま選ばせない**ために載せる。
   */
  readonly purpose: ChoicePurpose
  /**
   * 選ばせている当のカード（#122）。無い場面と、見えていない場面では載らない。
   *
   * `purpose` だけでは、効果が選ばせる場面がどれも `効果の対象` になってしまう。どのカードの
   * 効果かが分かれば、何を聞かれているのかは絞れる。**engine は表示を持たない**（ADR-0001）
   * ので、載せるのは識別子だけであって、名前も文言もここには無い。
   *
   * **選ぶ人から見えていないカードなら落とす。** 見えていないものの名前を作らない（#95）のと
   * 同じ理由で、識別子も渡さない。判定は候補と同じ盤面・同じ射影を通る（`describeChoice`）。
   */
  readonly source?: CardId
  /** 選ばないことを選べるか。 */
  readonly mayDecline: boolean
  readonly candidates: readonly WireCandidate[]
  /**
   * この行動でここまでに答えた数。
   *
   * どこまで戻れるかがここで決まる。0 なら戻る先が無く、取り消せるのは行動そのものだけである。
   * 数えるのはサーバであって、クライアントが覚えておくのではない。**切れて入り直しても
   * 同じ数が届く**（`room.ts` の `pendingChoice`）ため。
   */
  readonly answered: number
  /**
   * この行動を戻せるか。`ひとつ戻る` と `取り消す` の両方にかかる（#142）。
   *
   * **行動を始めてから新しく見えたものがあれば戻せない。** 見てから取り消して別の手を打てる
   * ことになり、山札の 1 番上を覗く手立てになってしまう。盤面そのものは答えを捨てて適用し
   * 直せば戻る（ADR-0008）ので、戻せないのは知ってしまったことだけである。
   *
   * 答えが 1 つ以上あっても閉じる。手前の選択が「めくるかどうか」を左右していた場合、そこまで
   * 戻れば見たうえでめくらずに済ませられるためである。
   *
   * **これは画面のためだけの値ではない。** 断るのはサーバである（ADR-0010、`room.ts` の
   * `rewind`）。ここに載せるのは、押せないボタンを出させないためである。
   */
  readonly mayGoBack: boolean
}

/** クライアントからサーバへ送るもの。 */
export type FromClient =
  | {
      readonly kind: '部屋に入る'
      readonly room: RoomCode
      /**
       * どのデッキで座るか（ADR-0021）。**選ばなければ `undefined`。**
       *
       * 入り直し（繋ぎ直し、ADR-0016）でも同じものが飛ぶので、**選ばなかった時に選び直させない。**
       * `undefined` で入ってきた人は、その部屋で前に選んでいたものに座る。まだ何も選んでいなければ、
       * サーバが決めた既定のデッキになる。
       */
      readonly deck: DeckId | undefined
    }
  /**
   * 新しい部屋を作って、そこに入る（#175）。
   *
   * **合言葉を決めるのはサーバである。** 打つ前に相手と合言葉を決めておかなくても、ロビーに
   * 並んだ部屋を選べば入れる。付けられるのは名前だけで、これは席とは関係が無い（`WireRoom`）。
   *
   * `against` が `CPU` なら、もう一方の席にはサーバが座り、そのまま始まる。
   */
  | {
      readonly kind: '部屋を作る'
      readonly name: string
      readonly against: OpponentKind
      /** どのデッキで座るか（ADR-0021）。選ばなければ、サーバが決めた既定のデッキになる。 */
      readonly deck: DeckId | undefined
    }
  /**
   * 自分の表示名を決める（ADR-0020）。すでに付いていれば付け替える。
   *
   * **決まりを見るのはサーバである**（`server` の `name.ts`）。長さも使える文字も、通らなければ
   * `名前を決めてほしい` が理由を添えて返る。画面は断らない（ADR-0010）。
   */
  | { readonly kind: '名前を決める'; readonly name: string }
  /**
   * いる部屋を出てロビーに戻る（#175）。
   *
   * 出られるのは、まだ相手を待っているだけの部屋と、決着した部屋である（`server` の `room.ts` の
   * `canLeave`）。打っている途中では断られる。
   */
  | { readonly kind: 'ロビーに戻る' }
  | { readonly kind: '行動する'; readonly action: LegalAction }
  | { readonly kind: '選ぶ'; readonly answer: ChoiceAnswer }
  /**
   * 直前に答えたものを取り消して、その選択をやり直す（ADR-0008）。
   *
   * 答えていなければ、行動そのものを取り消す（`取り消す` と同じになる）。
   */
  | { readonly kind: 'ひとつ戻る' }
  /**
   * 行動そのものを取り消して、行動する前に戻る。
   *
   * **戻れるのは、盤面をまだ進めていないからである。** 答えが足りているところまで進めては
   * やり直す形（ADR-0008）なので、行動が終わるまで `DuelState` は動かない。貯めた答えを
   * 捨てれば、行動を始める前と同じ盤面がそこにある。
   */
  | { readonly kind: '取り消す' }

/** サーバからクライアントへ送るもの。 */
export type ToClient =
  /**
   * いま開いている部屋の一覧。**どの部屋にもいない人にだけ届く。**
   *
   * 部屋の様子が変わるたびに送り直す。受け取った側は覚えておくだけでよく、尋ね直す手立ては
   * 要らない。
   */
  | {
      readonly kind: 'ロビー'
      readonly rooms: readonly WireRoom[]
      /**
       * 席に着く時に選べるデッキ（ADR-0021）。**渡す側が決めたものがそのまま並ぶ。**
       *
       * 部屋の一覧と一緒に届くのは、**選ぶ場所がここだから**である。どのデッキで座るかは部屋を
       * 作る時と入る時に決まる（`FromClient` の `部屋を作る`・`部屋に入る`）ので、選べるものは
       * それを押せる画面に無ければならない。
       */
      readonly decks: readonly WireDeck[]
    }
  /**
   * 部屋に入って、相手が来るのを待っている。
   *
   * どの部屋かを添えるのは、**合言葉を決めたのがサーバだから**である（`部屋を作る`）。切れて
   * 繋ぎ直す時に入り直す先は、これで分かる（ADR-0016）。
   */
  | { readonly kind: '相手を待っている'; readonly room: RoomCode }
  | {
      readonly kind: '席についた'
      readonly seat: Player
      readonly room: RoomCode
      /**
       * 誰と打っているか。人が相手なら、その表示名も入る（ADR-0020）。
       *
       * 部屋が続く限り変わらないので、席と一緒に届く。**CPU との対戦は打っている途中でも
       * 投げ出せる**（`server` の `room.ts` の `canLeave`）ので、その口を出すかどうかがこれで
       * 決まる（#175）。
       */
      readonly opponent: Opponent
    }
  | {
      readonly kind: '盤面'
      readonly perspective: WirePerspective
      /**
       * 受け取ったプレイヤーがいま行える行動（ADR-0010）。行えることが無ければ空になる。
       *
       * **クライアントはルールの判断を持たない**ので、行える手を数え上げられるのはサーバだけ
       * である（`legalActions` は完全な盤面を要る）。盤面と一緒に送ることで、UI は打てる手だけを
       * 並べればよくなり、打てない手を描いて断られる経路が無くなる。
       *
       * 優先権を持っていないプレイヤーには空で届く。優先権を持つのは 1 人だけ（総合ルール 第3部
       * 第3章 1）で、相手が何を行えるかはその人が知る筋合いの無いことである。
       */
      readonly actions: readonly LegalAction[]
      /**
       * いま優先権を放棄したら何が起きるか（`progress.ts` の `passOutcome`、#130）。放棄が
       * 行えない場面では意味を持たない。
       *
       * `actions` と同じ理由でここにある。**進行の規則を知っているのはサーバだけ**なので
       * （ADR-0010）、「このボタンを押すと何が起きるか」も数え上げて送る。押すものは
       * `優先権を放棄する` のまま変わらない。
       */
      readonly passOutcome: PassOutcome | undefined
    }
  | { readonly kind: '選んでほしい'; readonly choice: WireChoice }
  /**
   * 相手がいま繋がっているか（#175）。変わるたびに、同じ部屋のもう 1 人に届く。
   *
   * **止まっている理由が読めるようにするためにある。** 相手が画面を閉じると、待っている側の
   * 画面は相手の優先権のまま動かなくなる。回線が切れただけなら戻ってくる（ADR-0016）が、
   * 待っている側からはどちらか分からない。
   *
   * 繋がっていない間は、その対戦を投げ出してロビーに戻れる（`server` の `room.ts` の
   * `canLeave`）。CPU が相手の部屋には届かない。繋がらないのが当たり前であり、投げ出せるかは
   * 相手が CPU であることから決まっている。
   */
  | { readonly kind: '相手の繋がり'; readonly connected: boolean }
  /**
   * 表示名を決めてほしい（ADR-0020）。**決めるまで、ほかのことは受け付けない。**
   *
   * 繋いだ時に名前が無ければ届き、送った名前が決まりに通らなくても理由を添えて届く。
   * **画面はログインしているかどうかも、名前が要るかどうかも判断しない**（ADR-0019、
   * ADR-0010）。繋いだ結果としてこれが届き、従うだけである。
   *
   * 断って閉じないのは、**閉じると名前を送り返す口が無くなる**からである。画面とサーバは
   * 出所が違う（ADR-0019）ので、HTTP の口を開けば CORS が 1 つ増える。同じ接続の上で決めさせる。
   */
  | {
      readonly kind: '名前を決めてほしい'
      /** いま付いている名前。まだ決めていなければ `undefined`。 */
      readonly current: string | undefined
      /** 送ったものが通らなかった理由。初めて尋ねる時は `undefined`。 */
      readonly reason: string | undefined
    }
  | { readonly kind: '行えなかった'; readonly reason: string }

/**
 * ログインしていないので繋げない（ADR-0019）。`行えなかった` の `reason` に載る。
 *
 * **理由の中で 1 つだけ、受け取った側が見分けるものである。** ほかの理由は人に見せるための
 * 文言だが、これはログインへ送るという次の手に繋がる。**両側が同じ文字列を指せる場所がここ
 * しか無い**ので、語彙としてここに置く（`protocol.ts` の説明）。
 *
 * **ログインしているかどうかを画面が判断するのではない**（ADR-0019）。繋ぎに行った結果として
 * サーバがこれを返し、画面はそれに従うだけである。
 */
export const NOT_SIGNED_IN = 'ログインしていない'

/**
 * ログインを始める道筋（ADR-0019）。サーバが待ち、画面がそこへ送る。
 *
 * **同じポートに WebSocket と HTTP が同居している**（`server` の `serve.ts`）ので、画面は繋ぎ先
 * からこの URL を作れる。向き先を 2 つ持たずに済む。**両側が指す同じ 1 つの文字列**なので、
 * 断る理由（`NOT_SIGNED_IN`）と同じくここに置く。
 */
export const SIGN_IN_PATH = '/auth/google'

/** 行動を適用しようとした結果（ADR-0008）。 */
export type ActionProgress =
  | { readonly kind: '進んだ'; readonly state: DuelState }
  | {
      readonly kind: '選んでほしい'
      readonly choice: WireChoice
      /**
       * その選択が起きている盤面（#142）。
       *
       * **確定した盤面ではない。** 答えが揃うまで行動は終わっておらず、これは適用を途中で
       * 止めたところの姿である。答えを 1 つ足して呼び直せば作り直せる（ADR-0008）ので、
       * 呼んだ側はこれを覚え込まず、**選ぶ人に見せるためだけに使う。** ここから次の盤面を
       * 進めてはならない。
       */
      readonly board: DuelState
    }

const CHOICE_NEEDED = '選択が要る'

interface ChoiceNeeded {
  readonly kind: typeof CHOICE_NEEDED
  readonly choice: WireChoice
  readonly board: DuelState
}

function isChoiceNeeded(thrown: unknown): thrown is ChoiceNeeded {
  return typeof thrown === 'object' && thrown !== null && (thrown as Partial<ChoiceNeeded>).kind === CHOICE_NEEDED
}

/**
 * その候補が能力であるとき、その発生源のカードの識別子。持たなければ `undefined`。
 *
 * 解決を待っている能力は発生源を覚えている（`duel.ts` の `TriggeredInstance.source`）。
 * プランのめくりの置換効果は、生み出しているユニットと組にして選ばせる（`action.ts` の
 * `PlanReplacementCandidate`）ので、同じ形で読める。
 *
 * 作成された誘発型能力は発生源のカードを持たない（同 `CreatedAbilityInstance.source`）ので、
 * その場合は `undefined` になる。
 */
function sourceOf(candidate: unknown): CardId | undefined {
  if (typeof candidate !== 'object' || candidate === null) return undefined

  const { source } = candidate as { readonly source?: unknown }
  return typeof source === 'string' ? source : undefined
}

/**
 * 見えていないカードが盤面のどこにあるか（#127）。ゾーンに無ければ `undefined`。
 *
 * スクエアとリゾルブゾーンは見ない。どちらも表向きのカードしか置かれない（総合ルール 第2部
 * 第23章 1-1・第21章 12-2）ので、見えていないカードがそこに居ることは無い。
 *
 * **山札だけは位置も出さない。** 持ち主であっても中身を見てはならないゾーンであり（同 第21章
 * 2-2）、画面にも 1 枚ずつは並ばない（`view-model.ts` の `COUNTED_ZONES`）。押す先が無いのに
 * 深さだけが分かると、そこだけ新しく読み取れるものが増える。
 */
function positionOf(board: DuelState, id: CardId): WireCardPosition | undefined {
  const found = PLAYERS.flatMap((player) =>
    PLAYER_ZONES.filter((zone) => zone !== '山札').flatMap((zone): readonly WireCardPosition[] => {
      const index = cardsIn(board, player, zone).findIndex((card) => card.id === id)
      return index === -1 ? [] : [{ player, zone, index }]
    }),
  )

  return found[0]
}

/**
 * 候補 1 つを、送れる形にする。
 *
 * **候補の型は選ばせる場面ごとに違う。** `Chooser` が候補を `unknown` として受け取るのはその
 * ためで、候補そのものからは何であるか尋ねられない。何が来るかを知っているのは呼んだ側なので、
 * **何のための選択か**（`ChoicePurpose`）から読み方を決める。効果が選ばせている場面
 * （`効果の対象`）だけは、カードとスクエアのどちらも来るので、候補の形で見分ける。
 */
function describeCandidate(
  candidate: unknown,
  purpose: ChoicePurpose,
  visible: ReadonlySet<CardId>,
  board: DuelState,
): WireCandidate {
  // 能力が並ぶ場面。カードではないので、発生源のカードで指す。
  if (purpose === '解決する能力' || purpose === 'プランの置き換え') {
    const source = sourceOf(candidate)
    return { kind: '能力', source: source !== undefined && visible.has(source) ? source : undefined }
  }

  const id = cardIdOf(candidate)
  if (id !== undefined) {
    return visible.has(id) ? { kind: '見えている', card: id } : { kind: '見えていない', at: positionOf(board, id) }
  }

  // スクエアは盤面の位置なので、隠すものが無い。誰がどこを選べるかは、候補として並んだ時点で
  // 決まっている。
  const square = squareOf(candidate)
  if (square !== undefined) return { kind: 'スクエア', square }

  return { kind: '見えていない', at: undefined }
}

/**
 * 選んでほしいことを、送れる形にする。
 *
 * 見えているかどうかは**その選択が起きている盤面**（`board`）で判定する。選ぶ人が見るのも
 * その盤面である（#142）ので、候補の説明と食い違わない。
 *
 * 戻れるかどうかも、そこと行動を始める前の盤面（`started`）を見比べて決める。**新しく見えた
 * ものが 1 枚でもあれば戻せない。** 見てから取り消せると、山札の 1 番上を覗く手立てになる。
 * 見えるようになったかを決めるのは射影ひとつ（`perspective.ts` の `visibleIdsOf`）である。
 *
 * 発生源（`source`）も同じ盤面から見る。**見えていなければ落とす**（#122）。見えていない
 * カードの識別子を渡さないのは候補と同じ扱いである。
 */
function describeChoice(
  board: DuelState,
  started: DuelState,
  candidates: readonly unknown[],
  player: Player,
  purpose: ChoicePurpose,
  mayDecline: boolean,
  answered: number,
  source: CardId | undefined,
): WireChoice {
  const visible = visibleIdsOf(board, player)
  const before = visibleIdsOf(started, player)
  return {
    player,
    purpose,
    ...(source !== undefined && visible.has(source) ? { source } : {}),
    mayDecline,
    answered,
    mayGoBack: [...visible].every((card) => before.has(card)),
    candidates: candidates.map((candidate) => describeCandidate(candidate, purpose, visible, board)),
  }
}

/**
 * 答えの並びを使って行動を適用する（ADR-0008）。
 *
 * 答えが足りているうちは進み、足りなくなったところで**適用をやめて選んでほしいことを返す**。
 * 呼んだ側は答えを 1 つ受け取り、それを末尾に足して**同じ盤面に対してもう一度呼ぶ**。エンジンは
 * 純粋なので、同じ盤面と同じ答えの並びからは必ず同じところまで進む。
 *
 * 途中で止めて待てるようにエンジンを作り替えるかわりに、やり直している。1 つの行動あたりの
 * 選択は多くて数回なので、やり直しの費用は問題にならない。
 */
export function applyWithAnswers(
  state: DuelState,
  action: LegalAction,
  answers: readonly ChoiceAnswer[],
): ActionProgress {
  let remaining = answers
  const chooser: Chooser = (candidates, player, purpose, board, mayDecline = false, source) => {
    // 選ぶ余地が無いなら聞かない。候補が 1 つで、選ばないことも選べないなら、答えは 1 通りしか
    // 無く、押させても盤面は同じところへ進む。**答えとして数えない**ので、`ひとつ戻る`
    // （ADR-0008）はこの手前の選択まで戻る。
    const [only] = candidates
    if (candidates.length === 1 && !mayDecline) return only

    const [answer, ...rest] = remaining
    if (answer === undefined) {
      // 答えが尽きたところで止まるので、ここまでに答えた数は渡された答えの数そのものである。
      const choice = describeChoice(board, state, candidates, player, purpose, mayDecline, answers.length, source)
      throw { kind: CHOICE_NEEDED, choice, board } satisfies ChoiceNeeded
    }

    remaining = rest
    if (answer === '選ばない') return undefined
    if (!Number.isInteger(answer) || answer < 0 || answer >= candidates.length) {
      throw new Error(`候補にない番号が答えられた: ${answer}`)
    }

    return candidates[answer]
  }

  try {
    return { kind: '進んだ', state: applyLegalAction(state, action, chooser) }
  } catch (thrown) {
    if (isChoiceNeeded(thrown)) return { kind: '選んでほしい', choice: thrown.choice, board: thrown.board }

    throw thrown
  }
}
