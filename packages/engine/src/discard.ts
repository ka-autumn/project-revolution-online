import { findOnSquares, moveFromSquareTo } from './duel.js'
import type { CardId, DuelState } from './duel.js'
import { addTriggered, triggeredOnSquares } from './trigger.js'

/**
 * 指定されたカードを、スクエアから持ち主の捨札へ置く。
 *
 * 同じカードが複数の条件を満たしていても、1 回のゾーン移動につき誘発イベントを満たすのは
 * 1 度だけである（総合ルール 第4部 第7章 6）ため、id は重複除去する。すでにスクエアを
 * 離れているカードも除く。
 *
 * 同時に捨札へ置かれるユニットごとに、その支配者の「あなたのユニットがスクエアから捨札に
 * 置かれた時」の能力を誘発させる。能力を持つユニット自身も同時にスクエアを離れ得るため、
 * すべての能力を移動前の盤面から探してからカードを動かす（同 10）。
 */
export function discardFromSquares(state: DuelState, ids: readonly CardId[]): DuelState {
  const discarded = [...new Set(ids)].flatMap((id) => {
    const instance = findOnSquares(state, id)
    return instance === undefined ? [] : [instance]
  })
  const event = 'あなたのユニットがスクエアから捨札に置かれた時'
  const triggered = discarded.flatMap((instance) =>
    instance.card.type === 'ユニット'
      ? triggeredOnSquares(state, event, (each) => each.controller === instance.controller)
      : [],
  )
  const withTriggered = addTriggered(state, triggered)
  return discarded.reduce(
    (current, instance) => moveFromSquareTo(current, instance.id, '捨札'),
    withTriggered,
  )
}
