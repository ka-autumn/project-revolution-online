import type { TriggerEvent } from './ability.js'
import type { CardInstance, DuelState, TriggeredInstance } from './duel.js'

/**
 * その誘発イベントを満たしたことで、誘発型能力を誘発させる。
 *
 * 誘発しても即座には何も起こらない（総合ルール 第4部 第7章 2）。誘発した能力は盤面に
 * 積まれるだけで、バンクに入るのは次にどちらかのプレイヤーが優先権を獲得する時である。
 *
 * 見るのはスクエアにあるユニットの能力だけ。ユニットのテキストはスクエアに置かれている間
 * だけ有効である（総合ルール 第4部 第7章 10 に引かれているルール）。スクエアにあっても
 * ユニット以外のカードはそこにある間テキストが有効にならず、ルールエフェクトによって
 * 捨札に置かれる（同 第14章 4-3）。トラップゾーンや手札にあるカードの能力は、トラップの
 * 発動やカードのプレイを実装する時に足す。
 *
 * 誘発イベントを満たすたびに 1 度ずつ誘発する（同 第7章 6）ため、同じ能力が複数回
 * 誘発することもある。ここではイベント 1 つにつき 1 度ずつ積む。
 */
export function trigger(state: DuelState, event: TriggerEvent): DuelState {
  return addTriggered(state, triggeredOnSquares(state, event))
}

/** 誘発した能力を、まだバンクに入っていない能力の並びに積む。何も無ければ盤面はそのまま。 */
export function addTriggered(state: DuelState, triggered: readonly TriggeredInstance[]): DuelState {
  if (triggered.length === 0) return state

  return { ...state, triggered: [...state.triggered, ...triggered] }
}

/** そのカードが持つ能力のうち、その誘発イベントで誘発するもの。 */
export function triggeredBy(instance: CardInstance, event: TriggerEvent): readonly TriggeredInstance[] {
  if (instance.card.type !== 'ユニット') return []

  return instance.card.abilities.flatMap((ability) =>
    ability.kind === '誘発型能力' && ability.event === event
      ? [{ ability, source: instance.id, controller: instance.controller }]
      : [],
  )
}

/** スクエアにあるカードのうち、`matches` を満たすものが持つ、その誘発イベントで誘発する能力。 */
export function triggeredOnSquares(
  state: DuelState,
  event: TriggerEvent,
  matches: (instance: CardInstance) => boolean = () => true,
): readonly TriggeredInstance[] {
  return state.squares.flatMap((cards) =>
    cards.flatMap((instance) => (matches(instance) ? triggeredBy(instance, event) : [])),
  )
}
