import type { Ability } from './ability.js'

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
 * スターアイコン・属性・ムーブアイコン・トリガーアイコンもカードに印刷されているが、
 * それらを参照するルール（デッキ構築の規定・移動・侵入）をまだ実装していないため、
 * ここには持たせていない。参照する側と一緒に足す。
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
}

/** プレイして効果を解決した後、持ち主の捨札に置かれるカード（総合ルール 第2部 第20章 2）。 */
export interface StrategyCard extends PrintedCard {
  readonly type: 'ストラテジー' | '超必殺ストラテジー！'
}

/** トラップゾーンに裏向きで置き、後から発動するカード（総合ルール 第2部 第20章 3）。 */
export interface TrapCard extends PrintedCard {
  readonly type: 'トラップ'
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
}

interface UnitSpec extends CardSpec {
  readonly bp: number
  readonly sp: number
}

interface StrategySpec extends CardSpec {
  readonly type?: 'ストラテジー' | '超必殺ストラテジー！'
}

function printed<T extends CardType>(type: T, spec: CardSpec) {
  return {
    type,
    name: spec.name,
    level: spec.level,
    colors: spec.colors ?? [],
    abilities: spec.abilities ?? [],
  }
}

export function defineUnit(spec: UnitSpec): UnitCard {
  return { ...printed('ユニット', spec), bp: spec.bp, sp: spec.sp }
}

export function defineStrategy(spec: StrategySpec): StrategyCard {
  return printed(spec.type ?? 'ストラテジー', spec)
}

export function defineTrap(spec: CardSpec): TrapCard {
  return printed('トラップ', spec)
}
