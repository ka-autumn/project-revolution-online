import type { Ability } from './ability.js'
import type { MoveDirection, Square } from './board.js'
import type { Effect } from './effect.js'

/**
 * カードの色。レベルに含まれるエネルギー・シンボルの色と同じであり、カードの背景や枠の色
 * とは関係がない（総合ルール 第2部 第3章 2）。
 *
 * 総合ルール 第2部 第3章 4。
 */
export const COLORS = ['赤', '黒', '青', '白', '緑'] as const

export type Color = (typeof COLORS)[number]

/**
 * カードの種別。カードに印刷されている分類。
 *
 * トラップゾーンにあるカードは種別がトラップでなくても「トラップ」と呼ばれる
 * （総合ルール 第2部 第21章 9-2）。種別と、そのカードがいまどう扱われているかは別。
 *
 * 総合ルール 第2部 第4章 2。
 */
export const CARD_TYPES = ['ユニット', 'ストラテジー', 'トラップ', '超必殺ストラテジー！'] as const

export type CardType = (typeof CARD_TYPES)[number]

/**
 * 種別によらずカードに印刷されている項目。
 *
 * 属性もカードに印刷されているが、それを参照するルールをまだ実装していないため、
 * ここには持たせていない。参照する側と一緒に足す。ムーブアイコンはユニットだけが持つ項目
 * なので、ここではなく `UnitCard` に持たせている。トリガーアイコンも同じ理由で
 * `TrapCard` に持たせている。「トラップ以外のカードもトラップとしてプレイできる」
 * （総合ルール 第2部 第20章 3-1）が、発動して解決する効果（`TrapCard.effect`）を
 * 持てるのはトラップだけなので、トリガーアイコンが意味を持つ場面も無い。
 */
interface PrintedCard {
  readonly type: CardType
  readonly name: string
  /**
   * プレイするために満たす必要がある数値（総合ルール 第2部 第20章 1-2）。
   * レベルに含まれるエネルギー・シンボルの個数でもある。
   */
  readonly level: number
  /** 空なら無色（総合ルール 第2部 第3章 3）。 */
  readonly colors: readonly Color[]
  /**
   * カード名の左に書かれた ★ の個数。デッキに入れられる合計に上限がある
   * （総合ルール 第2部 第7章 2）。
   *
   * 数字が書かれたスターアイコンは、その数字分のスターを持つカードとして扱う（同 4）
   * ため、アイコンの個数ではなくスターの個数を持つ。
   */
  readonly stars: number
  /**
   * リバーススターアイコンの個数。1 個につきスターアイコンの上限が 1 個増える
   * （総合ルール 第2部 第7章 3）。
   *
   * リバーススターアイコンはスターアイコンではない（同 5）ため、`stars` とは別に持つ。
   */
  readonly reverseStars: number
  /** テキストが定義する能力（総合ルール 第2部 第10章 1）。改行ごとに別の能力になる（同 第4部 第1章 3）。 */
  readonly abilities: readonly Ability[]
}

/** スクエアに置いて使うカード（総合ルール 第2部 第20章 1）。 */
export interface UnitCard extends PrintedCard {
  readonly type: 'ユニット'
  /** バトルで比較される数値（総合ルール 第2部 第14章 1）。 */
  readonly bp: number
  /** スマッシュ時に相手プレイヤーに与えるダメージの数値（総合ルール 第2部 第15章 1）。 */
  readonly sp: number
  /**
   * ムーブアイコンの向き（総合ルール 第2部 第11章）。空ならムーブアイコンを持たず、
   * このユニットは移動できない（同 第3部 第8章 2-5）。
   */
  readonly moveIcon: readonly MoveDirection[]
}

/** プレイして効果を解決した後、持ち主の捨札に置かれるカード（総合ルール 第2部 第20章 2）。 */
export interface StrategyCard extends PrintedCard {
  readonly type: 'ストラテジー' | '超必殺ストラテジー！'
  /**
   * 解決された時に発揮する効果（総合ルール 第2部 第10章 3-1）。
   *
   * `abilities` に入れていないのは、これが起動型・誘発型・常在型のどれでもない
   * （同 第4部 第1章 2）ためである。プレイされて解決される時に、テキストに書かれている
   * 順番の通りに指示に従う（同 第8章 2-2）のがこの効果にあたる。
   *
   * テキストが段落に分かれている場合は段落ごとに宣言と実行を行う（同 2-4）が、それが
   * 見えるのは両方のプレイヤーが同時に選択や行動をする時だけなので、1 つの効果にまとめて
   * 持つ。段落を分けて持つのは、その規定を実装する時でよい。
   */
  readonly effect: Effect
}

/** トラップゾーンに裏向きで置き、後から発動するカード（総合ルール 第2部 第20章 3）。 */
export interface TrapCard extends PrintedCard {
  readonly type: 'トラップ'
  /**
   * トリガーアイコンで赤く塗られたスクエア（総合ルール 第2部 第12章、第20章 3-6）。
   *
   * トラップゾーンに裏向きで置かれている間、相手のユニットがここに置かれることを
   * 「侵入される」と表現し、発動条件になる（同 3-6・3-8-a、`trap.ts`）。
   *
   * 印刷された図なので、ムーブアイコンの矢印の向き（`board.ts` の `squareInDirection`）と
   * 同じ理由で、支配者の手前を基準にした向きで持つ。盤面に固定した絶対のスクエアに変換
   * するには `squareFromView` を使う（`trap.ts` の `checkIntrusion` 参照）。
   *
   * 空なら、トリガーアイコンを持たないか、トリガーアイコンにスクエアの指定が無い
   * （同 3-8-b）カード。
   */
  readonly triggerIcon: readonly Square[]
  /**
   * 発動して解決された時に発揮する効果（総合ルール 第2部 第10章 3-2）。
   *
   * 《 》でくくられた発動条件のテキストはまだ持っていない。発動条件のうち、トリガーアイコン
   * （スクエア）で表される「侵入」だけは `triggerIcon` として持てる。
   */
  readonly effect: Effect
}

export type Card = UnitCard | StrategyCard | TrapCard

/**
 * ストラテジーとして扱われるカードかどうか。
 *
 * 超必殺ストラテジー！はストラテジーとして扱う（総合ルール 第2部 第4章 2-1）ため、
 * 種別を直接比べるかわりにこれを使う。
 */
export function isStrategy(card: Card): boolean {
  return card.type === 'ストラテジー' || card.type === '超必殺ストラテジー！'
}

/**
 * `define*` に渡す記述。省略した項目は「持っていない」ものとして埋める。
 *
 * エンジンのテストは実カードではなく架空のテストカードで書く（ADR-0002）。検証したい
 * ルールに関係のない項目まで毎回書かせないために、能力と色は省略できるようにしている。
 */
interface CardSpec {
  readonly name: string
  readonly level: number
  readonly colors?: readonly Color[]
  readonly abilities?: readonly Ability[]
  readonly stars?: number
  readonly reverseStars?: number
}

interface UnitSpec extends CardSpec {
  readonly bp: number
  readonly sp: number
  /** 省略した場合はムーブアイコンを持たない。 */
  readonly moveIcon?: readonly MoveDirection[]
}

interface StrategySpec extends CardSpec {
  readonly type?: 'ストラテジー' | '超必殺ストラテジー！'
  /** 省略した場合は、解決しても何も起こらない。 */
  readonly effect?: Effect
}

interface TrapSpec extends CardSpec {
  /** 省略した場合はトリガーアイコンを持たない。 */
  readonly triggerIcon?: readonly Square[]
  /** 省略した場合は、発動して解決しても何も起こらない。 */
  readonly effect?: Effect
}

/** 解決しても何も起こらない効果。効果を書いていないカードに使う。 */
function* noEffect(): ReturnType<Effect> {}

function printed<T extends CardType>(type: T, spec: CardSpec) {
  return {
    type,
    name: spec.name,
    level: spec.level,
    colors: spec.colors ?? [],
    abilities: spec.abilities ?? [],
    stars: spec.stars ?? 0,
    reverseStars: spec.reverseStars ?? 0,
  }
}

export function defineUnit(spec: UnitSpec): UnitCard {
  return { ...printed('ユニット', spec), bp: spec.bp, sp: spec.sp, moveIcon: spec.moveIcon ?? [] }
}

export function defineStrategy(spec: StrategySpec): StrategyCard {
  return { ...printed(spec.type ?? 'ストラテジー', spec), effect: spec.effect ?? noEffect }
}

export function defineTrap(spec: TrapSpec): TrapCard {
  return { ...printed('トラップ', spec), triggerIcon: spec.triggerIcon ?? [], effect: spec.effect ?? noEffect }
}

/** そのカードが「夢」を持つか（総合ルール 第5部 第1章 2）。 */
export function hasDream(card: Card): boolean {
  return card.abilities.some((ability) => ability.kind === '常在型能力' && ability.keyword === '夢')
}
