import type { Effect } from './effect.js'
import { PHASES } from './turn.js'
import type { Phase } from './turn.js'

/**
 * そのフェイズが始まったこと。
 *
 * どのフェイズにも「～フェイズの始め」に誘発する能力があり得る（総合ルール 第3部
 * 第5章 1・第6章 1-1・第7章 1・第8章 1・第9章 1・第10章 1）ため、フェイズの並びから
 * 作る。フェイズを足したのに誘発イベントを足し忘れる、ということが起こらないようにする。
 */
export function phaseBeginning(phase: Phase): `${Phase}の始め` {
  return `${phase}の始め`
}

/**
 * 誘発型能力を誘発させるできごと。
 *
 * テキストの「～の始めに」「～の終わりに」「～した時」にあたる語句
 * （総合ルール 第4部 第3章 1）。
 *
 * 並びは、ターンの中で起こる順。ターンの進行に伴って起こるものと、ユニットの登場だけを
 * 持つ。バトルやスマッシュ判定のできごと、リリースした時（同 第3部 第5章 1）・
 * カードを引いた時（同 第6章 1-1）といった、そこで起きる行動に伴うできごとは、その行動を
 * 実装する時に足す。
 */
export const TRIGGER_EVENTS = [
  // 総合ルール 第3部 第5章 1。ターンの始めはリリースフェイズの始めに来る。
  'ターンの始め',
  ...PHASES.map(phaseBeginning),
  // 総合ルール 第3部 第10章 3。ターンの終わりはリカバリーフェイズの中に来る。
  'ターンの終わり',
  '登場した時',
] as const

export type TriggerEvent = (typeof TRIGGER_EVENTS)[number]

/**
 * 誘発イベントが満たされるたびに自動的に誘発する能力（総合ルール 第4部 第3章 2）。
 *
 * 誘発しても即座には何も起こらず、次にどちらかのプレイヤーが優先権を獲得した時に
 * バンクに入る（同 第4部 第7章 2）。誘発してからバンクに入るまでの間も含め、誘発した
 * 能力そのものは `TriggeredInstance`（`duel.ts`）として盤面が持つ。ここにあるのは
 * カードのテキストが定義している側で、何回誘発しても 1 つである。
 */
export interface TriggeredAbility {
  readonly kind: '誘発型能力'
  readonly event: TriggerEvent
  readonly effect: Effect
}

/**
 * キーワード能力「夢」（総合ルール 第5部 第1章）。
 *
 * 「このカードは、プランゾーンからプレイできる。」という常在型能力であり、プランゾーンに
 * ある時に効果を発揮する（同 1・2）。効果を持たないのは、カードをプレイできるゾーンに
 * 関するルールを変更するだけで、解決される能力ではないためである。
 *
 * 総合ルール 第5部には 23 のキーワード能力があるが、それぞれ能力の種類も働き方も違う。
 * ひとまとめの「キーワード能力」型にせず、実装したものから 1 つずつ型を足していく。
 */
export interface DreamAbility {
  readonly kind: '常在型能力'
  readonly keyword: '夢'
}

/**
 * テキストによって決められた、カードが行うことまたは行えること
 * （総合ルール 第4部 第1章 1）。
 *
 * 能力には起動型・誘発型・常在型の 3 つがある（同 2）が、起動型はコストを持つ能力を
 * 書けるようになってから足す。常在型は「夢」だけで、継続効果を持つものはまだ無い。
 */
export type Ability = TriggeredAbility | DreamAbility

/** 誘発型能力を 1 つ書く。 */
export function triggeredAbility(event: TriggerEvent, effect: Effect): TriggeredAbility {
  return { kind: '誘発型能力', event, effect }
}

/** 「夢」。何回書いても同じものなので 1 つを使い回す。 */
export const dream: DreamAbility = { kind: '常在型能力', keyword: '夢' }
