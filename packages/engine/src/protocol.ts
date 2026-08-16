import type { CardId, DuelState } from './duel.js'
import { applyLegalAction } from './legal-action.js'
import type { LegalAction } from './legal-action.js'
import { perspectiveOf } from './perspective.js'
import type { Player } from './player.js'
import type { Chooser } from './resolve.js'
import type { WirePerspective } from './wire.js'

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
 * 選ぶ時に見せる候補 1 つ。
 *
 * **どれを選んだかは番号で答える**（ADR-0008）ので、ここに載るのは「何を選んでいるのか」を
 * 見せるための分だけである。表側が見えないカードは、見えないまま候補になる。プランのコスト
 * として自分の裏向きのスマッシュをフリーズできる（総合ルール 第2部 第21章 7-5）が、スマッシュは
 * どちらのプレイヤーにも見えない（同 7-3）。
 *
 * 能力そのものを選ぶ場面（バンクにある能力、プランのめくりを置き換える置換効果）では、いまは
 * どれも `見えていない` になる。`Chooser` は候補を `unknown` として受け取る——選ばせる場面ごとに
 * 候補の型が違うためである——ので、カードを指しているかどうかしか外から尋ねられない。何の能力
 * であるかまで見せるには、`Chooser` が候補の描き方を持つ必要がある。
 */
export type WireCandidate =
  | { readonly kind: '見えている'; readonly card: CardId }
  | { readonly kind: '見えていない' }

/** 選んでほしいこと 1 つ。**選ぶプレイヤーにだけ送る**（ADR-0008）。 */
export interface WireChoice {
  readonly player: Player
  /** 選ばないことを選べるか。 */
  readonly mayDecline: boolean
  readonly candidates: readonly WireCandidate[]
  /**
   * この行動でここまでに答えた数。
   *
   * 戻れるかどうかがここで決まる。0 なら戻る先が無く、取り消せるのは行動そのものだけである。
   * 数えるのはサーバであって、クライアントが覚えておくのではない。**切れて入り直しても
   * 同じ数が届く**（`room.ts` の `pendingChoice`）ため。
   */
  readonly answered: number
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
    }
  | { readonly kind: '選んでほしい'; readonly choice: WireChoice }
  | { readonly kind: '行えなかった'; readonly reason: string }

/** 行動を適用しようとした結果（ADR-0008）。 */
export type ActionProgress =
  | { readonly kind: '進んだ'; readonly state: DuelState }
  | { readonly kind: '選んでほしい'; readonly choice: WireChoice }

const CHOICE_NEEDED = '選択が要る'

interface ChoiceNeeded {
  readonly kind: typeof CHOICE_NEEDED
  readonly choice: WireChoice
}

function isChoiceNeeded(thrown: unknown): thrown is ChoiceNeeded {
  return typeof thrown === 'object' && thrown !== null && (thrown as Partial<ChoiceNeeded>).kind === CHOICE_NEEDED
}

/**
 * その候補が指しているカードの識別子。カードを指していなければ `undefined`。
 *
 * `Chooser` は候補を `unknown` として受け取る。選ばせる場面ごとに候補の型が違う（スクエアに
 * あるユニット・ゾーンにあるカード・バンクにある能力・置換効果）ためである。通信に載せる時に
 * 必要なのは「どのカードのことか」だけなので、尋ねるのもその 1 つだけにしている。
 */
function cardIdOf(candidate: unknown): CardId | undefined {
  if (typeof candidate !== 'object' || candidate === null) return undefined

  const { id } = candidate as { readonly id?: unknown }
  return typeof id === 'string' ? id : undefined
}

/**
 * その視点から表側が見えているカードの識別子すべて。
 *
 * 見え方の決まりを二度書かずに済むよう、射影（ADR-0004）から取り出す。
 */
function visibleIds(state: DuelState, viewer: Player): ReadonlySet<CardId> {
  const perspective = perspectiveOf(state, viewer)
  return new Set([
    ...Object.values(perspective.zones).flatMap((zones) =>
      Object.values(zones).flatMap((cards) =>
        cards.flatMap((card) => (card.kind === '見えている' ? [card.instance.id] : [])),
      ),
    ),
    ...perspective.squares.flat().map((card) => card.id),
    ...perspective.resolveZone.map((card) => card.id),
  ])
}

/**
 * 選んでほしいことを、送れる形にする。
 *
 * 見えているかどうかは**行動を始める前の盤面**で判定する。選択が起こるのは行動の途中の盤面に
 * 対してだが、`Chooser` は候補しか受け取らないのでその盤面を持っていない。食い違うのは、解決の
 * 途中でカードが見えるゾーンへ動いた場合だけで、その時は見えているものを `見えていない` として
 * 送る。**少なく見せる側に倒しているので、漏れることはない。**
 */
function describeChoice(
  state: DuelState,
  candidates: readonly unknown[],
  player: Player,
  mayDecline: boolean,
  answered: number,
): WireChoice {
  const visible = visibleIds(state, player)
  return {
    player,
    mayDecline,
    answered,
    candidates: candidates.map((candidate): WireCandidate => {
      const id = cardIdOf(candidate)
      if (id === undefined || !visible.has(id)) return { kind: '見えていない' }

      return { kind: '見えている', card: id }
    }),
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
  const chooser: Chooser = (candidates, player, mayDecline = false) => {
    const [answer, ...rest] = remaining
    if (answer === undefined) {
      // 答えが尽きたところで止まるので、ここまでに答えた数は渡された答えの数そのものである。
      const choice = describeChoice(state, candidates, player, mayDecline, answers.length)
      throw { kind: CHOICE_NEEDED, choice } satisfies ChoiceNeeded
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
    if (isChoiceNeeded(thrown)) return { kind: '選んでほしい', choice: thrown.choice }

    throw thrown
  }
}
