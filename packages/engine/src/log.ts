import type { Square } from './board.js'
import type { CardId, DuelResult, DuelState } from './duel.js'
import type { Instruction } from './effect.js'
import type { LegalAction } from './legal-action.js'
import type { Orientation } from './orientation.js'
import type { Player } from './player.js'
import type { ChoicePurpose } from './resolve.js'
import type { PlayerZone } from './zone.js'

/**
 * 能力がどの経路で解決されたか（#104）。
 *
 * 「発動」はトラップの言葉である（総合ルール 第2部 第20章 3-10）。起動型能力の「起動」
 * （同 第4部 第2章 1）や誘発型能力の「誘発」（同 第3章 2）と取り違えると別のことを指す。
 * **どれであるかを知っているのはエンジンだけ**なので、画面に推測させずここで持つ。
 */
export type ResolutionVia =
  /** 誘発型能力がバンクから解決された（総合ルール 第4部 第3章 2、第2部 第21章 11-3）。 */
  | '誘発'
  /** トラップが発動された（同 第2部 第20章 3-10）。 */
  | '発動'
  /** 起動型能力が起動された（同 第4部 第2章 1）。「勇気」も起動型能力である（同 第5部 第2章 1）。 */
  | '起動'
  /** ストラテジー・超必殺ストラテジー！がプレイされて解決された（同 第2部 第20章 2-3）。 */
  | 'プレイ'
  /** 「希望」がバンクを使用せずただちに解決された（同 第5部 第3章 1）。 */
  | '希望'

/**
 * 盤面に起きたできごとの記録（ADR-0011、#95）。
 *
 * 盤面は「その時点の姿」しか持たない。そこへ至る道筋——相手が何を行ったか、ルールが何を
 * したか、効果が何を選んだか——は、盤面を見比べても分からない。それを残す場所がここになる。
 *
 * **`DuelState` の一部として持つ。** エンジンは I/O を持てない（ADR-0001）ので、できごとを
 * 外へ知らせる口を生やすことはできない。盤面に積んでおけば、盤面と同じ道（射影 → 通信）で
 * 届き、入り直した人にも同じものがそのまま届く（ADR-0009）。
 *
 * 行動をやり直して適用する形（ADR-0008）と噛み合っている。**同じ盤面と同じ答えの並びからは
 * 同じログが積まれる**ので、選択のたびにやり直しても二重に積まれることはない。
 *
 * **カードは識別子で指し、見えていなければ名指ししない。** どのカードを見てよいかを決めるのは
 * 射影（`perspective.ts` の `seesFace`）ひとつであり、ここでは判断しない。
 */
export type DuelEvent =
  /**
   * プレイヤーが行動を 1 つ行った。
   *
   * `LegalAction` をそのまま持たない。見えないカードを名指ししないためには、カードを指す
   * ところを落とせる必要がある（`LegalAction` は必ず識別子を持つ）ためである。行動が指した
   * ものはカード 1 枚とスクエア 1 つに収まるので、その 2 つだけを持つ。
   */
  | {
      readonly kind: '行動した'
      readonly player: Player
      readonly action: LegalAction['kind']
      /** その行動が指したカード。指していないか、見えていなければ `undefined`。 */
      readonly card: CardId | undefined
      /** その行動が指したスクエア。指していなければ `undefined`。 */
      readonly square: Square | undefined
    }
  /**
   * 能力を 1 つ解決し始めた（総合ルール 第4部 第8章 2）。
   *
   * バンクを経由する解決（同 第2部 第21章 11-3）に限らない。プレイ・発動・起動・希望も、
   * バンクを使わずただちに解決される（同 第2部 第20章 2-3・3-10、第4部 第2章 5、
   * 第5部 第3章 1）だけで、解決であることに変わりはない。
   */
  | {
      readonly kind: '能力を解決した'
      readonly controller: Player
      readonly via: ResolutionVia
      /** 発生源のカード。持たないか、見えていなければ `undefined`。 */
      readonly source: CardId | undefined
    }
  /** 効果が命令を 1 つ実行した（総合ルール 第4部 第1章 1）。 */
  | {
      readonly kind: '命令を実行した'
      readonly controller: Player
      readonly instruction: LoggedInstruction
    }
  /** プレイヤーがダメージを受けた（総合ルール 第3部 第9章 1）。 */
  | { readonly kind: 'ダメージを受けた'; readonly player: Player; readonly amount: number }
  /**
   * コストとして、カードをフリーズして支払った（総合ルール 第1部 第2章 3-2、第2部
   * 第24章 1、第4部 第2章 1、第3部 第8章 2-3、第4部 第6章 2-2）。
   *
   * フリーズしたカードは、エネルギーゾーンだけでなくスマッシュゾーンにもありうる
   * （プランのコスト、同 第2部 第21章 7-5）。**`zone` は必ず持つ。** どちらのゾーンを
   * 使ったかはフリーズしたカードの枚数から誰でも分かる公開情報（同 第2部 第23章 1-1）
   * だが、`card` はそうではない——エネルギーゾーンのカードは表向きで公開情報だが、
   * スマッシュは裏向きで持ち主からも見られない（同 7-3）ので、`スマッシュゾーン` から
   * 支払った時の `card` は常に `undefined` になる。`purpose` はどのコストかを画面に
   * 伝えるためだけに持つ（`resolve.ts` の `ChoicePurpose` と同じ考え方）。
   */
  | {
      readonly kind: 'コストを支払った'
      readonly player: Player
      readonly zone: 'エネルギーゾーン' | 'スマッシュゾーン'
      readonly card: CardId | undefined
      readonly purpose: ChoicePurpose
    }
  /**
   * プランして山札の 1 番上をめくった（総合ルール 第3部 第8章 2-3）。
   *
   * すでにプランゾーンにカードがあったなら、それを捨札に置いてから次のカードをめくる
   * （同、CONTEXT.md「プランする」）ので、その 2 つを 1 つのできごとにまとめて持つ。
   * `card` は山札が尽きていれば `undefined`（同 第1部 第1章 3）。`discarded` は、めくる前の
   * プランゾーンにカードが無ければ `undefined`。
   */
  | {
      readonly kind: 'プランをめくった'
      readonly player: Player
      readonly card: CardId | undefined
      readonly discarded: CardId | undefined
    }
  /**
   * 希望ステップで、山札の 1 番上をスマッシュゾーンに表向きで置いた（総合ルール 第3部
   * 第19章 1）。
   *
   * 表向きなのはここだけの間で、確定ステップで裏返されればスマッシュとして誰からも
   * 見えなくなる（同 第20章 1、`smash.ts` の `SmashJudgment.faceUp`）。それでも、この
   * できごとは `card` と `name` を落とさず持ち続ける。**他のできごとと違い、名前を「いま」
   * の見え方から引かない。** 裏返された後に見えなくなるのは「これから先」の話であって、
   * すでに公開された事実を無かったことにはしない（`perspective.ts` の `projectEvent`）。
   * 山札が空で置けなければここへは来ない（`smash.ts` の `beginHopeStep`）ので、常に何かを
   * 指す。
   */
  | { readonly kind: '希望ステップでめくった'; readonly player: Player; readonly card: CardId; readonly name: string }
  /** バトルが発生した（総合ルール 第3部 第11章 1）。 */
  | {
      readonly kind: 'バトルが始まった'
      readonly square: Square
      readonly attacker: CardId | undefined
      readonly attacked: CardId | undefined
    }
  /** バトルダメージ（総合ルール 第3部 第13章 1・第15章 1）。 */
  | {
      readonly kind: 'バトルダメージを与えた'
      readonly from: CardId | undefined
      readonly to: CardId | undefined
      readonly amount: number
    }
  /**
   * バトルが終わった（総合ルール 第3部 第16章 3・4）。
   *
   * `winner` は、バトル終了ステップの開始時に判定した勝者（同 1-1、`battle.ts` の
   * `winnerOf`）。引き分けなら `undefined`。**判定した時点のものを持ち回る。** 勝敗の決定後の
   * ルールエフェクト（同 2-1・2-2）でユニットがスクエアを離れても、ここに残る結果は変わらない。
   */
  | { readonly kind: 'バトルが終わった'; readonly winner: CardId | undefined }
  /** ルールエフェクトによって捨札に置かれた（総合ルール 第4部 第14章 4）。 */
  | { readonly kind: 'ルールで捨札に置かれた'; readonly cards: readonly CardId[] }
  /** 勝敗が決まった（総合ルール 第3部 第3章）。 */
  | { readonly kind: '決着した'; readonly result: DuelResult }

/**
 * ログに残す形にした命令 1 つ。
 *
 * `Instruction`（`effect.ts`）をそのまま持てない。命令はカードそのもの（`UnitOnSquare` や
 * `CardInZone`）を対象に持ち、カードは効果を関数として持つので通信に載らないためである。
 * かわりに、識別子と、何をしたかが分かるだけの値を持つ。
 *
 * **カードを指すところの名前は、どの種類でも `card` に揃えている。** 見えないカードを落とす
 * のが 1 か所で済む（`perspective.ts` の `projectInstruction`）ようにするためである。
 */
export type LoggedInstruction =
  | { readonly kind: '選ぶ'; readonly card: CardId | undefined }
  | { readonly kind: '破壊する'; readonly card: CardId | undefined }
  | { readonly kind: 'プレイヤーにダメージを与える'; readonly player: Player; readonly amount: number }
  | { readonly kind: 'ユニットにダメージを与える'; readonly card: CardId | undefined; readonly amount: number }
  | { readonly kind: '向きを変える'; readonly card: CardId | undefined; readonly orientation: Orientation }
  | { readonly kind: 'ゾーンへ置く'; readonly card: CardId | undefined; readonly to: PlayerZone }
  | { readonly kind: '山札の1番上をゾーンへ置く'; readonly card: CardId | undefined; readonly to: PlayerZone }
  | { readonly kind: 'スクエアへ置く'; readonly card: CardId | undefined; readonly square: Square }
  | { readonly kind: '誘発型能力を作る'; readonly card: CardId | undefined }
  | { readonly kind: 'プランを裏返す'; readonly player: Player }
  | { readonly kind: 'カードを引く'; readonly player: Player; readonly count: number }

/** できごとを 1 つ積む。 */
export function record(state: DuelState, event: DuelEvent): DuelState {
  return { ...state, log: [...state.log, event] }
}

/**
 * 候補や、選ばれたものが指しているカードの識別子。カードを指していなければ `undefined`。
 *
 * 選ばせる場面ごとに候補の型が違う（スクエアにあるユニット・ゾーンにあるカード・バンクに
 * ある能力・置換効果）ため、`Chooser` は候補を `unknown` として受け取る（`resolve.ts`）。
 * 記録するのにも通信に載せるのにも要るのは「どのカードのことか」だけなので、尋ねるのも
 * その 1 つだけにしている。
 */
export function cardIdOf(candidate: unknown): CardId | undefined {
  if (typeof candidate !== 'object' || candidate === null) return undefined

  const { id } = candidate as { readonly id?: unknown }
  return typeof id === 'string' ? id : undefined
}

/**
 * 実行した命令を、ログに残す形にする。
 *
 * 対象を持つ命令は、実行された時点で `resolve.ts` が engine の見せたカードであることを
 * 確かめている（`shown`）ので、ここでは識別子を写すだけでよい。
 *
 * `subject` は、**命令そのものには書かれていない、実際に触れたもの**である。選ばれたものと、
 * 位置で指定されて動いたカードの 2 つがこれにあたり、どちらも実行してみないと分からない。
 */
export function loggedInstruction(instruction: Instruction, subject: unknown): LoggedInstruction {
  switch (instruction.kind) {
    case '選ぶ':
      return { kind: '選ぶ', card: cardIdOf(subject) }
    case '破壊する':
      return { kind: '破壊する', card: instruction.target.id }
    case 'プレイヤーにダメージを与える':
      return { kind: 'プレイヤーにダメージを与える', player: instruction.player, amount: instruction.amount }
    case 'ユニットにダメージを与える':
      return { kind: 'ユニットにダメージを与える', card: instruction.target.id, amount: instruction.amount }
    case '向きを変える':
      return { kind: '向きを変える', card: instruction.target.id, orientation: instruction.orientation }
    case 'ゾーンへ置く':
      return { kind: 'ゾーンへ置く', card: instruction.card.id, to: instruction.to }
    case '山札の1番上をゾーンへ置く':
      // どのカードが動いたかは命令に書かれていない（位置で指定されている）。
      return { kind: '山札の1番上をゾーンへ置く', card: cardIdOf(subject), to: instruction.to }
    case 'スクエアへ置く':
      return { kind: 'スクエアへ置く', card: instruction.card.id, square: instruction.square }
    case '誘発型能力を作る':
      return { kind: '誘発型能力を作る', card: instruction.affecting.id }
    case 'プランを裏返す':
      return { kind: 'プランを裏返す', player: instruction.player }
    case 'カードを引く':
      return { kind: 'カードを引く', player: instruction.player, count: instruction.count }
  }
}
