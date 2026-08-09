import type { Effect } from './effect.js'

/**
 * 誘発型能力を誘発させるできごと。
 *
 * テキストの「～の始めに」「～の終わりに」「～した時」にあたる語句
 * （総合ルール 第4部 第3章 1）。
 *
 * いまはユニットの登場だけを持つ。フェイズやバトルを実装する時に、そこで起きる
 * できごとを足していく。
 */
export const TRIGGER_EVENTS = ['登場した時'] as const

export type TriggerEvent = (typeof TRIGGER_EVENTS)[number]

/**
 * 誘発イベントが満たされるたびに自動的に誘発する能力（総合ルール 第4部 第3章 2）。
 *
 * 誘発しても即座には何も起こらず、次にどちらかのプレイヤーが優先権を獲得した時に
 * バンクに入る（同 第4部 第7章 2）。バンクと優先権はまだ実装していないため、いまは
 * 誘発イベントと効果の組を持つだけである。
 */
export interface TriggeredAbility {
  readonly kind: '誘発型能力'
  readonly event: TriggerEvent
  readonly effect: Effect
}

/**
 * テキストによって決められた、カードが行うことまたは行えること
 * （総合ルール 第4部 第1章 1）。
 *
 * 能力には起動型・誘発型・常在型の 3 つがある（同 2）が、起動型はコストの支払いを、
 * 常在型は継続効果を先に必要とするため、まだ誘発型しかない。
 */
export type Ability = TriggeredAbility

/** 誘発型能力を 1 つ書く。 */
export function triggeredAbility(event: TriggerEvent, effect: Effect): TriggeredAbility {
  return { kind: '誘発型能力', event, effect }
}
