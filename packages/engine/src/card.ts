import type {
  Ability,
  AttributeAddingAbility,
  BpModifyingAbility,
  DreamAbility,
  PepAbility,
  GutsAbility,
  HopeAbility,
  MoveCostingAbility,
  PlanReplacingAbility,
  TrustAbility,
} from './ability.js'
import type { MoveDirection, Square } from './board.js'
import type { Effect, TrapEffect } from './effect.js'

/**
 * カードの色。レベルに含まれるエネルギー・シンボルの色と同じであり、カードの背景や枠の色
 * とは関係がない（総合ルール 第2部 第3章 2）。
 *
 * 総合ルール 第2部 第3章 4。
 */
export const COLORS = ['赤', '黒', '青', '白', '緑'] as const

export type Color = (typeof COLORS)[number]

/**
 * カードの種別。カードに書かれている分類であり、カードのデータの 1 つである
 * （総合ルール 第2部 第2章 2）。
 *
 * トラップゾーンにあるカードは種別がトラップでなくても「トラップ」と呼ばれる
 * （総合ルール 第2部 第21章 9-2）。種別と、そのカードがいまどう扱われているかは別。
 *
 * 総合ルール 第2部 第4章 2。
 */
export const CARD_TYPES = ['ユニット', 'ストラテジー', 'トラップ', '超必殺ストラテジー！'] as const

export type CardType = (typeof CARD_TYPES)[number]

/**
 * カードの属性（総合ルール 第2部 第13章）。
 *
 * 総合ルールは属性の一覧を定義していない。存在する属性を確認するにはカードリストを見る
 * （同 5）ことになっており、`Color` や `CardType` のように閉じた集合として持てない。
 * したがって綴りの揺れを engine 側では検出できない。
 */
export type Attribute = string

/**
 * 種別によらず、どのカードにも書かれていること（総合ルール 第2部 第2章 1）。
 *
 * ムーブアイコンはユニットだけが持つので、ここではなく `UnitCard` に持たせている。
 * トリガーアイコンも同じ理由で `TrapCard` に持たせている。「トラップ以外のカードも
 * トラップとしてプレイできる」（総合ルール 第2部 第20章 3-1）が、発動して解決する効果
 * （`TrapCard.effect`）を持てるのはトラップだけなので、トリガーアイコンが意味を持つ
 * 場面も無い。
 */
interface WrittenCard {
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
  /**
   * カードに書かれている属性（総合ルール 第2部 第13章）。
   *
   * 属性にはメーカーシンボル・メディアシンボル・詳細属性の 3 種類が含まれる（同 1）が、
   * ここに持つのは詳細属性だけである。テキストが参照しているのが詳細属性だけで、他の 2 つは
   * 参照する側がいないためである（ムーブアイコン・トリガーアイコンと同じ考え方）。区別が
   * 要るテキストが出てきた時に、種類ごとに分ける。
   *
   * **効果によって属性が加わることがある**（同 4）ので、いま何の属性を持っているかは
   * ここだけでは決まらない。効果から見えるのは継続効果を適用した後の姿で、それを写すのは
   * `view.ts` である。
   */
  readonly attributes: readonly Attribute[]
  /** テキストが定義する能力（総合ルール 第2部 第10章 1）。改行ごとに別の能力になる（同 第4部 第1章 3）。 */
  readonly abilities: readonly Ability[]
}

/** スクエアに置いて使うカード（総合ルール 第2部 第20章 1）。 */
export interface UnitCard extends WrittenCard {
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
export interface StrategyCard extends WrittenCard {
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
export interface TrapCard extends WrittenCard {
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
   *
   * 効果は第 2 引数で、発動条件を満たしたできごとの写しを受け取る（`effect.ts` の
   * `TrapEffect`）。「侵入してきた敵」「侵入されたスクエア」はそこからしか取れない。
   */
  readonly effect: TrapEffect
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
  /** 省略した場合は属性を持たない。 */
  readonly attributes?: readonly Attribute[]
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
  readonly effect?: TrapEffect
}

/** 解決しても何も起こらない効果。効果を書いていないカードに使う。 */
function* noEffect(): ReturnType<Effect> {}

function written<T extends CardType>(type: T, spec: CardSpec) {
  return {
    type,
    name: spec.name,
    level: spec.level,
    colors: spec.colors ?? [],
    abilities: spec.abilities ?? [],
    stars: spec.stars ?? 0,
    reverseStars: spec.reverseStars ?? 0,
    attributes: spec.attributes ?? [],
  }
}

export function defineUnit(spec: UnitSpec): UnitCard {
  return { ...written('ユニット', spec), bp: spec.bp, sp: spec.sp, moveIcon: spec.moveIcon ?? [] }
}

export function defineStrategy(spec: StrategySpec): StrategyCard {
  return { ...written(spec.type ?? 'ストラテジー', spec), effect: spec.effect ?? noEffect }
}

export function defineTrap(spec: TrapSpec): TrapCard {
  return { ...written('トラップ', spec), triggerIcon: spec.triggerIcon ?? [], effect: spec.effect ?? noEffect }
}

/**
 * そのカードがそのキーワード能力を持つか。
 *
 * 常在型のキーワード能力だけを見る。テキストに書かれた能力のうち、名前だけで参照できて
 * 内容を持たないのはこの形のものである（`ability.ts` の `DreamAbility`・`PepAbility`）。
 * 常在型能力には内容を持つもの（`BpModifyingAbility`）もあるので、名前で引く前に
 * 名前を持つ側であることを確かめる。
 */
function hasKeyword(
  card: Card,
  keyword: (DreamAbility | PepAbility | TrustAbility | GutsAbility)['keyword'],
): boolean {
  return card.abilities.some(
    (ability) => ability.kind === '常在型能力' && 'keyword' in ability && ability.keyword === keyword,
  )
}

/** そのカードが「夢」を持つか（総合ルール 第5部 第1章 2）。 */
export function hasDream(card: Card): boolean {
  return hasKeyword(card, '夢')
}

/** そのカードが「元気」を持つか（総合ルール 第5部 第8章 2）。 */
export function hasPep(card: Card): boolean {
  return hasKeyword(card, '元気')
}

/** そのカードが「信頼」を持つか（総合ルール 第5部 第4章 2）。 */
export function hasTrust(card: Card): boolean {
  return hasKeyword(card, '信頼')
}

/** そのカードが「根性」を持つか（総合ルール 第5部 第6章 2）。 */
export function hasGuts(card: Card): boolean {
  return hasKeyword(card, '根性')
}

/**
 * そのカードが持つ「希望」（総合ルール 第5部 第3章 2）。持たなければ `undefined`。
 *
 * 「夢」「元気」と違って効果を持つ能力なので、持つかどうかではなく能力そのものを返す。
 * 同じカードが「希望」を 2 つ持つことは無いので、最初に見つかったものを返す。
 */
export function hopeOf(card: Card): HopeAbility | undefined {
  return card.abilities.find(
    (ability): ability is HopeAbility => ability.kind === '特別な能力' && ability.keyword === '希望',
  )
}

/**
 * そのカードが持つ、ＢＰを修整する常在型能力（総合ルール 第4部 第12章 5-2 の(5)）。
 *
 * 「希望」と違って、同じカードが 2 つ以上持つことがあり得る（キーワード能力と、テキストに
 * 書かれた修整とを同時に持てる）ので、見つかったものをすべて返す。
 */
export function bpModifyingAbilitiesOf(card: Card): readonly BpModifyingAbility[] {
  return card.abilities.filter(
    (ability): ability is BpModifyingAbility => ability.kind === '常在型能力' && 'bpModifiers' in ability,
  )
}

/**
 * そのカードが持つ、属性を加える常在型能力（総合ルール 第4部 第12章 5-2 の(3)）。
 *
 * `bpModifyingAbilitiesOf` と同じ理由で、見つかったものをすべて返す。
 */
export function attributeAddingAbilitiesOf(card: Card): readonly AttributeAddingAbility[] {
  return card.abilities.filter(
    (ability): ability is AttributeAddingAbility => ability.kind === '常在型能力' && 'attributesAdded' in ability,
  )
}

/**
 * そのカードが持つ、プランによるめくりを置き換える常在型能力（総合ルール 第4部 第13章）。
 *
 * 同じカードが 2 つ以上持つことはいまのところ無いが、能力の並びから種類で引く形は他と
 * 同じにしておく。
 */
export function planReplacingAbilitiesOf(card: Card): readonly PlanReplacingAbility[] {
  return card.abilities.filter(
    (ability): ability is PlanReplacingAbility => ability.kind === '常在型能力' && 'turnsUpUntil' in ability,
  )
}

/**
 * そのカードが持つ、ユニットの移動に追加コストを課す常在型能力
 * （総合ルール 第4部 第6章 2-2・2-3）。
 */
export function moveCostingAbilitiesOf(card: Card): readonly MoveCostingAbility[] {
  return card.abilities.filter(
    (ability): ability is MoveCostingAbility => ability.kind === '常在型能力' && 'moveCost' in ability,
  )
}

/**
 * そのユニットのＢＰ（総合ルール 第2部 第14章 1）。バトルで比較され、ダメージと比べられる
 * 数値である（同 第4部 第14章 4-5・4-6）。
 *
 * カードに書かれている数字に、継続効果による修整を足したものになる（同 第4部 第12章）。
 * 修整は盤面に書き込まれていないので、読む側が `continuous.ts` の `bpModification` で
 * 集めてから渡す。**引数を省略できるようにしていない。** 省略できると、修整を渡し忘れた
 * 呼び出しが書かれている数字をＢＰとして読んでしまい、それが型では見つからないためである。
 */
export function bpOf(unit: UnitCard, modifier: number): number {
  return unit.bp + modifier
}

/**
 * そのユニットのＳＰ（総合ルール 第2部 第15章 1）。スマッシュした時に相手プレイヤーに
 * 与えるダメージの数値である（同 第3部 第9章 1）。
 *
 * ＢＰと同じ理由で、修整を持つようになった時に直す場所を 1 か所にするために置いている
 * （`bpOf` 参照）。
 */
export function spOf(unit: UnitCard): number {
  return unit.sp
}
