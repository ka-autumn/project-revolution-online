import type { Square } from './board.js'
import type { Card, UnitCard } from './card.js'
import type { CardId, LibraryPosition } from './duel.js'
import type { Orientation } from './orientation.js'
import type { Player } from './player.js'
import type { PlayerZone } from './zone.js'

/**
 * 効果から見た、スクエアにいるユニット 1 枚。
 *
 * 盤面が持っているカードそのものではなく、そこから効果に見せてよい分だけを写したもの。
 * 効果はこれを命令の対象として engine に返すだけで、中身を書き換えても盤面は変わらない。
 */
export interface UnitOnSquare {
  readonly id: CardId
  /** そのユニットがいるスクエア（総合ルール 第2部 第21章 8-2）。 */
  readonly square: Square
  readonly card: UnitCard
  /** そのユニットの支配者。 */
  readonly controller: Player
}

/**
 * 効果から見た、ゾーンにあるカード 1 枚。
 *
 * `UnitOnSquare` と同じく、盤面が持っているカードそのものではなく、効果に見せてよい分だけを
 * 写したものである。支配者を持たないのは、効果に見せるゾーンが支配者自身のものだけであり
 * （`DuelView`）、ゾーンの持ち主で決まるためである。
 */
export interface CardInZone {
  readonly id: CardId
  /** そのカードがいまあるゾーン。 */
  readonly zone: PlayerZone
  readonly card: Card
}

/**
 * 効果が盤面について問い合わせられること。
 *
 * 効果に渡されるのはこのインターフェースだけで、盤面そのものは渡さない。カードの実装が
 * engine の内部状態に直接触れないようにするための境目がここにある（ADR-0002）。ここに
 * 生えていないことは、カード側からは知りようがない。
 *
 * 味方・敵はいずれも能力の支配者から見た呼び方である（総合ルール 第2部 第21章 8-2）。
 */
export interface DuelView {
  /** この能力の支配者（総合ルール 第4部 第7章 1）。 */
  readonly controller: Player
  /**
   * 支配者から見た相手。テキストの「相手」にあたる。
   *
   * 誰が相手かは公開されている情報なので名指しできる。ただし**名指しできることと、その
   * プレイヤーのゾーンを読めることは別である。** 相手のゾーンを読むアクセサは無いままで、
   * 相手に対してできるのは、中身を見ずに済む働きかけだけである。
   */
  readonly opponent: Player
  /** スクエアにいる、支配者から見た味方すべて。 */
  allies(): readonly UnitOnSquare[]
  /** スクエアにいる、支配者から見た敵すべて。 */
  enemies(): readonly UnitOnSquare[]
  /**
   * 支配者自身の手札にあるカードすべて。
   *
   * 相手の手札を読むためのアクセサは無い。相手の手札は非公開の情報であり、効果が読めては
   * ならないためである。「読めない」ことを、ここに生やさないことで型として保証している
   * （ADR-0002・ADR-0004）。相手のゾーンを見る必要が出てきた場合は、それが公開されている
   * 情報であることを確かめたうえで、そのゾーン専用のアクセサを足す。
   *
   * 山札を読むアクセサも無い。「山札の 1 番上」はカードを選ぶ行為ではなく位置の指定なので、
   * 中身を見せずに動かせる。
   */
  hand(): readonly CardInZone[]
  /** 支配者自身の捨札にあるカードすべて。 */
  discardPile(): readonly CardInZone[]
  /** 支配者自身のプランゾーンにあるカードすべて。 */
  planZone(): readonly CardInZone[]
}

/**
 * 効果が engine に出す命令。
 *
 * 効果は盤面を自分で書き換えず、何をしたいかを命令として返す。実際に盤面を変えるのは
 * engine 側（`resolveEffect`）だけである。
 *
 * カードの実装がこの型を直接組み立てることは想定していない。`choose` や `destroy` と
 * いった、この下にある記述用の関数を使う。
 */
export type Instruction =
  | {
      readonly kind: '選ぶ'
      readonly candidates: readonly unknown[]
      /**
       * 候補があっても「選ばない」ことを選べるか。テキストが「◯枚まで選び」と書いている
       * 場合に真になる（総合ルール 第4部 第8章 2-3。選択はテキストの指定に従う）。
       */
      readonly mayDecline: boolean
    }
  | { readonly kind: '破壊する'; readonly target: UnitOnSquare }
  | { readonly kind: 'プレイヤーにダメージを与える'; readonly player: Player; readonly amount: number }
  | { readonly kind: 'ユニットにダメージを与える'; readonly target: UnitOnSquare; readonly amount: number }
  | { readonly kind: '向きを変える'; readonly target: UnitOnSquare; readonly orientation: Orientation }
  | {
      readonly kind: 'ゾーンへ置く'
      readonly card: CardInZone | UnitOnSquare
      readonly to: PlayerZone
      readonly orientation: Orientation
      readonly position: LibraryPosition
    }
  | { readonly kind: '山札の1番上をゾーンへ置く'; readonly to: PlayerZone; readonly orientation: Orientation }
  | { readonly kind: 'カードを引く'; readonly player: Player; readonly count: number }
  | { readonly kind: 'プランを裏返す'; readonly player: Player }
  | {
      readonly kind: 'スクエアへ置く'
      readonly card: CardInZone | UnitOnSquare
      readonly square: Square
      readonly orientation: Orientation
    }

/**
 * 効果の途中経過。`T` はその手順が効果に返す値。
 *
 * 記述用の関数はこれを返し、カードの実装は `yield*` でつないでいく。
 */
export type EffectStep<T> = Generator<Instruction, T, unknown>

/**
 * カードや能力の指示によって生み出される結果（総合ルール 第4部 第1章 1）。
 *
 * 盤面を引数に取って次の盤面を返す関数ではなく、命令を並べたものとして書く。効果の途中で
 * プレイヤーの選択をはさめるようにするためである。
 */
export type Effect = (duel: DuelView) => EffectStep<void>

/**
 * 候補の中から 1 つ選ぶ。選ぶのは能力の支配者（総合ルール 第4部 第8章 2-3）。
 *
 * 候補が 1 つもない場合、選ぶという行動は実行できない（同、および 第1部 第1章 3）。
 * その時この効果はここで終わる。選んだものを対象にする行動が後ろに続いているのが普通で、
 * 選べなければそれらも実行できないためである。
 */
export function* choose<T>(candidates: readonly T[]): EffectStep<T> {
  const chosen = yield { kind: '選ぶ', candidates, mayDecline: false }
  // 命令を解釈する側が候補の中から選んで返すことを、この関数だけが知っている。
  // 候補が空の場合は解決が打ち切られるので、ここまで戻ってこない。
  return chosen as T
}

/**
 * 候補の中から 1 つ選ぶ。ただし選ばないことも選べる。テキストの「◯枚まで選び」にあたる。
 * 選ばなかった場合は `undefined` を返す（総合ルール 第4部 第8章 2-3）。
 *
 * `choose` と違い、候補が 1 つも無くても効果はそこで終わらない。「まで」は 0 枚を許して
 * いるので、選べなかったことと選ばなかったことが同じ結果になり、後ろに続く指示は
 * 「選んだもの」を持たないまま進むだけだからである。選ばれなかった時に何もしないのは、
 * 呼ぶ側が `undefined` を見て決める。
 *
 * 「◯」が 2 以上のテキストはまだ書けない。複数を選ぶ仕組みを持っていないためで、
 * 必要になった時に足す（`card.ts` の属性・トリガーアイコンと同じ考え方）。
 */
export function* chooseAtMostOne<T>(candidates: readonly T[]): EffectStep<T | undefined> {
  const chosen = yield { kind: '選ぶ', candidates, mayDecline: true }
  // 選ばなかったことを `undefined` で表せるのは、候補がスクエアにいるユニットのように
  // 必ず値を持つものだけだからである。候補そのものが `undefined` になり得る使い方は無い。
  return chosen as T | undefined
}

/**
 * スクエアにいるユニットを持ち主の捨札に置く。
 *
 * 「スクエアにあるカードを捨札に置く」ことを「破壊する」と表現する
 * （総合ルール 第2部 第21章 1-5）。
 *
 * 対象がすでにスクエアを離れていた場合、破壊するという行動は実行されない
 * （総合ルール 第1部 第1章 3）。効果はそのまま続く。
 */
export function* destroy(target: UnitOnSquare): EffectStep<void> {
  yield { kind: '破壊する', target }
}

/**
 * プレイヤーにダメージを与える。
 *
 * ダメージはそのプレイヤーに載って蓄積する。合計 1000 以上になった時にスマッシュ判定が
 * 発生する（総合ルール 第4部 第14章 4-12）のはルールエフェクトの仕事であり、効果の解決中に
 * チェックされることはない（同 第8章 4）。次にどちらかのプレイヤーが優先権を獲得する時に
 * まとめて処理されるので、ここでは与えるだけでよい。
 *
 * 与える相手をプレイヤーとして受け取るが、効果が名指しできるのは `DuelView` が渡している
 * 支配者だけである。相手を指せるようにするのは、それを必要とするカードを書く時でよい。
 */
export function* damagePlayer(player: Player, amount: number): EffectStep<void> {
  yield { kind: 'プレイヤーにダメージを与える', player, amount }
}

/**
 * スクエアにいるユニットにダメージを与える。
 *
 * ダメージはそのカードに載って蓄積する。ＢＰと同じかそれ以上のダメージを受けたユニットが
 * 捨札に置かれること（総合ルール 第4部 第14章 4-6）はルールエフェクトの仕事であり、効果の
 * 解決中にはチェックされない（同 第8章 4）。`damagePlayer` と同じく、次にどちらかの
 * プレイヤーが優先権を獲得する時にまとめて処理されるので、ここでは与えるだけでよい。
 *
 * **捨札に置かれるのを待たずに済ませたい場合は `destroy` を使う。** ＢＰより多いダメージを
 * 与えることと破壊することは、盤面の上では別の出来事である。
 *
 * 載ったダメージは、リカバリーフェイズの始めに取り除かれる（同 第3部 第10章 1）。また
 * 「スクエアからスクエア」以外のゾーン移動をしたカードは新しいカードとして扱われる
 * （同 第2部 第21章 1-4）ので、そこでも失われる。
 *
 * 対象がすでにスクエアを離れていた場合、この行動は実行されない
 * （同 第1部 第1章 3）。効果はそのまま続く。
 */
export function* damageUnit(target: UnitOnSquare, amount: number): EffectStep<void> {
  yield { kind: 'ユニットにダメージを与える', target, amount }
}

/**
 * スクエアにいるユニットをリリースする（総合ルール 第2部 第24章 1）。
 *
 * フリーズ状態のカードをリリース状態にすることを「リリースする」と呼ぶ。
 *
 * **すでにリリース状態のカードをリリースすることはできない**（同 1-1）。その場合この行動は
 * 実行されない（同 第1部 第1章 3）。効果はそのまま続く。対象がすでにスクエアを離れていた
 * 場合も同じである。
 *
 * これは向きを変えるだけで、ゾーンの移動ではない。置く経路（`placeOnSquare`）に同じ
 * スクエアを渡して代用しないこと。置く経路を通すと、ユニットがあるスクエアに同じ
 * プレイヤーの支配するユニットが置かれた時に働くルールエフェクト（同 第4部 第14章 4-7）の
 * 判定に、向きを変えただけのカードが紛れ込む。
 */
export function* release(target: UnitOnSquare): EffectStep<void> {
  yield { kind: '向きを変える', target, orientation: 'リリース' }
}

/**
 * スクエアにいるユニットをフリーズする（総合ルール 第2部 第24章 1）。
 *
 * リリース状態のカードをフリーズ状態にすることを「フリーズする」と呼ぶ。すでにフリーズ
 * 状態のカードをフリーズすることはできない（同 1-1）。実行できない場合の扱いは `release`
 * と同じである。
 *
 * スマッシュのようにフリーズすることをコストにする行動（`action.ts` の `smash`）とは別で、
 * こちらは効果が行うものである。コストとしてのフリーズは、フリーズできることを先に
 * 確かめたうえで支払われる。
 */
export function* freeze(target: UnitOnSquare): EffectStep<void> {
  yield { kind: '向きを変える', target, orientation: 'フリーズ' }
}

/**
 * ゾーンにあるカードを、持ち主の別のゾーンの 1 番上に置く。向きを指定する。
 *
 * 置けるのは持ち主のゾーンだけである。持ち主以外のゾーンに動かされる場合、代わりに持ち主の
 * 該当するゾーンに動かされる（総合ルール 第2部 第21章 1-2）。効果に見せているゾーンは
 * 支配者自身のものだけなので、いまはその区別が表に出る場面が無い。
 *
 * 置く位置は、指定しなければそのゾーンの 1 番上になる。「山札の 1 番下に戻す」であれば
 * 1 番下を指定する。順番に意味があるのは山札・プランゾーン・捨札だけである
 * （同 第2部 第21章 1-3）。
 *
 * 「スクエアからスクエア」以外のゾーン移動をしたカードは新しいカードとして扱われ、以前の
 * ゾーンに関連した効果は失われる（同 1-4）。すでにそのゾーンを離れていた場合、この行動は
 * 実行されない（同 第1部 第1章 3）。効果はそのまま続く。
 *
 * スクエアにいるユニットも渡せる。スクエアから捨札に置くことは「破壊する」と呼ばれ
 * （同 第2部 第21章 1-5）、それを見て誘発する能力がある（同 第4部 第7章 6）。カードを書く
 * 側はその場合 `destroy` を使うが、ここに捨札を渡された場合も誘発は起こる。
 *
 * スクエアへ置く効果はここでは扱わない。プレイされたユニットがスクエアに置かれることは
 * 「登場」と呼ばれて効果によって置かれる場合と区別され（同 第2部 第20章 1-4-a）、
 * 「登場した時」の誘発や「根性」（同 第5部 第6章 3）が働くかどうかがそこで分かれるためである。
 */
export function* placeInZone(
  card: CardInZone | UnitOnSquare,
  to: PlayerZone,
  orientation: Orientation,
  position: LibraryPosition = '1番上',
): EffectStep<void> {
  yield { kind: 'ゾーンへ置く', card, to, orientation, position }
}

/**
 * そのプレイヤーがカードを引く（総合ルール 第2部 第21章 1-5）。
 *
 * 山札の 1 番上のカードを手札に加えることを「引く」と表現する。プランゾーンにカードが
 * あれば、それが同時に山札の 1 番上のカードである（同 3-1）ので、そちらを引く。
 *
 * 山札が空なら引けない。山札が 0 枚になったプレイヤーが次に優先権が発生した時に敗北する
 * こと（同 第3部 第3章 2）は引けないこととは別のルールエフェクトなので、ここでは何も
 * 起こらないだけである。
 *
 * 引く相手をプレイヤーとして受け取るが、効果が名指しできるのは `DuelView` が渡している
 * 支配者だけである（`damagePlayer` と同じ）。
 */
export function* drawCards(player: Player, count: number): EffectStep<void> {
  yield { kind: 'カードを引く', player, count }
}

/**
 * カードを、能力の支配者の支配下でスクエアに置く。向きを指定する。
 *
 * **これは「登場」ではない。** プレイされたユニットがスクエアに置かれることだけを「登場」と
 * 呼ぶ（総合ルール 第2部 第20章 1-4-a）。効果によって置かれるこの経路では、
 *
 * - 「登場した時」に誘発する能力は誘発しない
 * - 「根性」は働かない（同 第5部 第6章 3）。ここで指定した向きがそのまま使われる
 *
 * どちらも、プレイの経路（`play.ts` の `placePlayedUnit`）を通らないことで分かれている。
 *
 * どのスクエアに置くかはカードのテキストが決める。「味方エリアに置く」であれば、エリアの
 * 中のどのスクエアかを支配者が選ぶ。エリアとスクエアの対応は `areaOf`、置けるスクエアの
 * 一覧は `BATTLE_SPACE` で、いずれもカードの側から使える。自分のユニットがすでにいる
 * スクエアを避けるかどうかも、テキストの読み方としてカードの側が決める。
 */
export function* placeOnSquare(
  card: CardInZone | UnitOnSquare,
  square: Square,
  orientation: Orientation,
): EffectStep<void> {
  yield { kind: 'スクエアへ置く', card, square, orientation }
}

/**
 * そのプレイヤーのプランを裏返す（総合ルール 第2部 第21章 3-4）。
 *
 * 山札の 1 番上のカードが表向きの場合にそれをプランと呼ぶ（同 3-1・3-2）ので、裏返すことは
 * そのカードを裏向きの山札に戻すことにあたる。表向きかどうかを盤面が別に持っていないのは、
 * それが置かれている場所から決まるためである（`play.ts` 参照）。
 *
 * 裏返した後、プランゾーンはなくなる。次に現れる山札の 1 番上のカードは裏向きのままになる
 * （同 3-3）ので、めくり直されることはない。
 *
 * プランが無ければ、この行動は実行されない（同 第1部 第1章 3）。効果はそのまま続く。
 *
 * 相手のプランも裏返せる。誰が相手かは公開されている情報であり、裏返すのに中身を読む必要も
 * ないためである（`DuelView.opponent`）。
 */
export function* flipPlan(player: Player): EffectStep<void> {
  yield { kind: 'プランを裏返す', player }
}

/**
 * 支配者の山札の 1 番上のカードを、別のゾーンの 1 番上に置く。向きを指定する。
 *
 * カードを選ぶのではなく位置を指定するので、山札の中身を効果に見せずに動かせる。
 * `DuelView` に山札を読むアクセサが無いのはそのためである。どのカードが動いたかは、
 * 効果からは分からないままになる。
 *
 * プランゾーンにカードがあれば、それが同時に山札の 1 番上のカードである
 * （総合ルール 第2部 第21章 3-1）ので、そちらが動く。
 *
 * 山札が空なら、この行動は実行されない（同 第1部 第1章 3）。効果はそのまま続く。
 */
export function* placeTopOfLibrary(to: PlayerZone, orientation: Orientation): EffectStep<void> {
  yield { kind: '山札の1番上をゾーンへ置く', to, orientation }
}
