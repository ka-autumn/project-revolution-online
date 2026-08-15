import type { TriggerEvent, TriggerOccasion, TriggeredAbility } from './ability.js'
import { BATTLE_SPACE } from './board.js'
import type { Square } from './board.js'
import { locateOnSquares } from './duel.js'
import type { BankedAbility, CardInstance, CreatedAbility, DuelState, TriggeredInstance } from './duel.js'
import type { UnitOnSquare } from './effect.js'
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
  return addTriggered(triggerCreated(state, event), triggeredOnSquares(state, event))
}

/**
 * 作成された誘発型能力のうち、そのできごとで誘発するものを誘発させ、盤面から取り除く
 * （総合ルール 第4部 第3章 4）。
 *
 * 特別に規定された期限が無ければ、次にそのできごとが起こった時に 1 度だけ誘発する（同 4）。
 * **誘発と同時に取り除く**ことがそのまま「1 度だけ」にあたる。期限を持つ能力（同 4 の 2 文目）
 * を書けるようになった時に、取り除かずに残す道を足す。
 *
 * 誘発するできごとは、誰のターンかまで含んだ 1 つの値である（`CreatedTrigger`）。「あなたの
 * ターンの終わり」は、支配者がアクティブプレイヤーであるターンの終わりを指す。
 *
 * 対象がスクエアにいなければ誘発しない。作られた後にスクエアを離れていれば能力は消滅して
 * いる（同 4-1）ので通常は起こらないが、まだスクエアに置かれていないカードを対象に能力を
 * 作った場合には起こりうる。実行できない行動は実行されない（同 第1部 第1章 3）。
 */
function triggerCreated(state: DuelState, event: TriggerEvent): DuelState {
  const firing = state.createdAbilities.filter((created) => matchesEvent(created, event, state.turn.active))
  if (firing.length === 0) return state

  const instances = firing.flatMap((created) => {
    const located = locateOnSquares(state, created.affecting)
    if (located === undefined) return []

    const { instance, square } = located
    const { card } = instance
    if (card.type !== 'ユニット') return []

    const affected: UnitOnSquare = { id: instance.id, square, card, controller: instance.controller }
    return [{ ability: created.ability, controller: created.controller, affected }]
  })

  return addTriggered(
    { ...state, createdAbilities: state.createdAbilities.filter((created) => !firing.includes(created)) },
    instances,
  )
}

/** その作成された誘発型能力が、いま起きた誘発イベントで誘発するか。 */
function matchesEvent(created: CreatedAbility, event: TriggerEvent, active: Player): boolean {
  switch (created.ability.trigger) {
    case 'あなたのターンの終わり':
      return event === 'ターンの終わり' && created.controller === active
  }
}

/** 誘発した能力を、まだバンクに入っていない能力の並びに積む。何も無ければ盤面はそのまま。 */
export function addTriggered(state: DuelState, triggered: readonly BankedAbility[]): DuelState {
  if (triggered.length === 0) return state

  return { ...state, triggered: [...state.triggered, ...triggered] }
}

/**
 * そのカードが持つ能力のうち、その誘発イベントで誘発するもの。
 *
 * 能力が絞り込みの述語（`TriggeredAbility.when`）を持つ場合、きっかけを渡してそれが真の
 * ものだけが誘発する。きっかけを持つ誘発イベントは限られている（`TriggerOccasion`）ので、
 * それ以外のイベントでは `occasion` を渡さない。
 */
export function triggeredBy(
  located: { readonly instance: CardInstance; readonly square: Square },
  event: TriggerEvent,
  occasion?: TriggerOccasion,
): readonly TriggeredInstance[] {
  const { instance, square } = located
  const { card } = instance
  if (card.type !== 'ユニット') return []

  // 誘発した時点の発生源を写す。解決する時にスクエアを離れていた場合に使う
  // （`duel.ts` の `TriggeredInstance.self`）。
  const self: UnitOnSquare = { id: instance.id, square, card, controller: instance.controller }

  return card.abilities.flatMap((ability) =>
    ability.kind === '誘発型能力' && ability.event === event && triggers(ability, occasion, instance.controller)
      ? [{ ability, source: instance.id, controller: instance.controller, self }]
      : [],
  )
}

/**
 * 絞り込みの述語を満たすか。述語を持たない能力は、誘発イベントを満たすたびに誘発する。
 *
 * きっかけを持たない誘発イベントに述語が付いていた場合は、確かめようがないので投げる。
 * カードの書き間違いであって、盤面から起こり得る状態ではない。
 */
function triggers(ability: TriggeredAbility, occasion: TriggerOccasion | undefined, controller: Player): boolean {
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
  return state.squares.flatMap((cards, index) => {
    const square = BATTLE_SPACE[index]
    if (square === undefined) return []
    return cards.flatMap((instance) => (matches(instance) ? triggeredBy({ instance, square }, event) : []))
  })
}
