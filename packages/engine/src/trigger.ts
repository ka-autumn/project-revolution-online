import type { Occasion, TriggerEvent, TriggeredAbility } from './ability.js'
import type { CardInstance, DuelState, TriggeredInstance } from './duel.js'
import type { Player } from './player.js'

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

/**
 * そのカードが持つ能力のうち、その誘発イベントで誘発するもの。
 *
 * 能力が絞り込みの述語（`TriggeredAbility.when`）を持つ場合、きっかけを渡してそれが真の
 * ものだけが誘発する。きっかけを持つ誘発イベントは限られている（`Occasion`）ので、
 * それ以外のイベントでは `occasion` を渡さない。
 */
export function triggeredBy(
  instance: CardInstance,
  event: TriggerEvent,
  occasion?: Occasion,
): readonly TriggeredInstance[] {
  if (instance.card.type !== 'ユニット') return []

  return instance.card.abilities.flatMap((ability) =>
    ability.kind === '誘発型能力' && ability.event === event && triggers(ability, occasion, instance.controller)
      ? [{ ability, source: instance.id, controller: instance.controller }]
      : [],
  )
}

/**
 * 絞り込みの述語を満たすか。述語を持たない能力は、誘発イベントを満たすたびに誘発する。
 *
 * きっかけを持たない誘発イベントに述語が付いていた場合は、確かめようがないので投げる。
 * カードの書き間違いであって、盤面から起こり得る状態ではない。
 */
function triggers(ability: TriggeredAbility, occasion: Occasion | undefined, controller: Player): boolean {
  if (ability.when === undefined) return true
  if (occasion === undefined) {
    throw new Error('きっかけを持たない誘発イベントに絞り込みが付いている')
  }
  return ability.when(occasion, controller)
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
