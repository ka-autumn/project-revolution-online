import type { Square } from './board.js'
import type { UnitCard } from './card.js'
import type { CardId } from './duel.js'
import type { Player } from './player.js'

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
  /** スクエアにいる、支配者から見た味方すべて。 */
  allies(): readonly UnitOnSquare[]
  /** スクエアにいる、支配者から見た敵すべて。 */
  enemies(): readonly UnitOnSquare[]
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
