import type { TriggerEvent } from './ability.js'
import type { CardInstance, DuelState, TriggeredInstance } from './duel.js'
import { resolveEffect } from './resolve.js'
import type { Chooser } from './resolve.js'

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
  const triggered = state.squares.flatMap((cards) =>
    cards.flatMap((instance) => triggeredBy(instance, event)),
  )
  if (triggered.length === 0) return state

  return { ...state, triggered: [...state.triggered, ...triggered] }
}

/** そのカードが持つ能力のうち、その誘発イベントで誘発するもの。 */
function triggeredBy(instance: CardInstance, event: TriggerEvent): readonly TriggeredInstance[] {
  if (instance.card.type !== 'ユニット') return []

  return instance.card.abilities.flatMap((ability) =>
    ability.kind === '誘発型能力' && ability.event === event
      ? [{ ability, source: instance.id, controller: instance.controller }]
      : [],
  )
}

/**
 * 誘発していた能力をすべてバンクに入れる。
 *
 * 複数の誘発型能力が誘発していた場合、すべて同時にバンクに入る（総合ルール 第4部
 * 第7章 3）。バンクに入った能力はすでにあった能力と同列に扱われる（同 第2部 第21章
 * 11-2）ので、並べる順に意味はない。
 *
 * バンクに入る時にコストの支払いや選択が要ることがあり、適正な選択ができなければその
 * 能力はバンクから取り除かれる（同 第4部 第7章 4）。コストを持つ能力をまだ書けないため
 * ここでは扱わない。
 */
export function putTriggeredIntoBank(state: DuelState): DuelState {
  if (state.triggered.length === 0) return state

  return { ...state, bank: [...state.bank, ...state.triggered], triggered: [] }
}

/**
 * バンクにある能力を 1 つ解決する。バンクが空なら盤面はそのまま。
 *
 * 解決するのはアクティブプレイヤーの支配する能力が先で、それが無い場合にだけ非アクティブ
 * プレイヤーの支配する能力を解決する（総合ルール 第4部 第8章 1-1、第2部 第21章 11-3）。
 * どれを解決するかはその能力の支配者が選ぶ。
 *
 * 解決した能力はバンクから取り除かれて消滅する（同 第4部 第8章 2-7）。解決の間、
 * ルールエフェクトはチェックされない（同 第14章 3）。
 *
 * 解決した後に誰が優先権を獲得するかは、ここではなく `progress.ts` の仕事である。
 */
export function resolveFromBank(state: DuelState, chooser: Chooser): DuelState {
  const controlledByActive = state.bank.filter((banked) => banked.controller === state.turn.active)
  const candidates = controlledByActive.length > 0 ? controlledByActive : state.bank
  const [first] = candidates
  if (first === undefined) return state

  // 候補はすべて同じプレイヤーの支配する能力なので、選ぶプレイヤーはどれから見ても同じ。
  const choice = chooser(candidates, first.controller)
  const chosen = candidates.find((banked) => banked === choice)
  if (chosen === undefined) throw new Error('バンクにない能力が選ばれた')

  const resolved = resolveEffect(state, chosen.ability.effect, {
    controller: chosen.controller,
    chooser,
  })
  return { ...resolved, bank: resolved.bank.filter((banked) => banked !== chosen) }
}
