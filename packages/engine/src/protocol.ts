import { BATTLE_SPACE } from './board.js'
import type { Square } from './board.js'
import { cardsIn } from './duel.js'
import type { CardId, DuelState } from './duel.js'
import { applyLegalAction } from './legal-action.js'
import type { LegalAction } from './legal-action.js'
import { cardIdOf } from './log.js'
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
  | { readonly kind: '部屋に入る'; readonly room: RoomCode }
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
  | { readonly kind: '相手を待っている' }
  | { readonly kind: '席についた'; readonly seat: Player }
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
  | { readonly kind: '行えなかった'; readonly reason: string }

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
 * その候補がスクエアであるとき、そのスクエア。カードなら `undefined`。
 *
 * 効果が置き先を選ばせる場合、候補として並ぶのはスクエアそのものである（`board.ts` の
 * `Square`）。行と列で持つのはスクエアだけで、スクエアにいるユニットは自分の位置を
 * `square` として持つ（`board.ts` の `UnitOnSquare`）ので、取り違えることはない。
 *
 * 行と列が 0・1・2 のいずれかであること（同 `SquareIndex`）は、同じ位置がバトルスペースに
 * あることで確かめる。
 */
function squareOf(candidate: unknown): Square | undefined {
  if (typeof candidate !== 'object' || candidate === null) return undefined

  const { row, column } = candidate as { readonly row?: unknown; readonly column?: unknown }
  return BATTLE_SPACE.find((square) => square.row === row && square.column === column)
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
