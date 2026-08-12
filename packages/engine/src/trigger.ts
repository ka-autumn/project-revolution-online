import type { TriggerEvent } from './ability.js'
import type { CardInstance, DuelState, TriggeredInstance } from './duel.js'

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
  matches: (instance: CardInstance) => boolean,
): readonly TriggeredInstance[] {
  return state.squares.flatMap((cards) =>
    cards.flatMap((instance) => (matches(instance) ? triggeredBy(instance, event) : [])),
  )
}
