import type { AppearanceOccasion, TriggerEvent, TriggerOccasion } from './ability.js'
import { locateOnSquares } from './duel.js'
import type { CardId, DuelState } from './duel.js'
import { resolveEffect } from './resolve.js'
import type { Chooser } from './resolve.js'
import { addTriggered, triggeredBy } from './trigger.js'

/**
 * 誘発イベントを満たしたそのカード自身の能力だけを誘発させる。
 *
 * 「登場した時」「移動が起動された時」は、誘発イベントを満たすのがそのカード自身の
 * できごとであって、盤面に同じ能力を持つ他のカードがあることではない。`trigger` は
 * イベントを満たすスクエアの全ユニットを見てしまうので、対象を 1 枚に絞れるようここを
 * 別に持つ。
 */
function triggerSelf(state: DuelState, id: CardId, event: TriggerEvent, occasion?: TriggerOccasion): DuelState {
  const located = locateOnSquares(state, id)
  if (located === undefined) return state

  return addTriggered(state, triggeredBy(located, event, occasion))
}

/**
 * プレイされたユニットがスクエアに置かれたことで、「登場した時」を誘発させる（総合ルール
 * 第2部 第20章 1-4-a）。
 *
 * 呼ぶのはプレイされたユニットを置いた側（`play.ts`）だけである。効果によってスクエアに
 * 置かれる場合はここを通らない。それは「登場」ではないため誘発しない（同 1-4-a、ADR-0003
 * の元になる CONTEXT.md「登場」）。
 *
 * きっかけ（置かれたスクエアとプレイされたゾーン）をここで受け取る。**プレイされたゾーンは
 * この瞬間にしか分からない。** プランゾーンにあったカードが登場すると、そのプランゾーンは
 * 無くなる（同 第2部 第21章 3-3）ためである。
 */
export function triggerAppearance(state: DuelState, id: CardId, occasion: AppearanceOccasion): DuelState {
  return triggerSelf(state, id, '登場した時', occasion)
}

/**
 * ユニットの移動が起動されたことで、「移動が起動された時」を誘発させる（総合ルール
 * 第4部 第6章 2-5）。呼ぶのは移動を解決した側（`move.ts`）だけである。
 */
export function triggerMovement(state: DuelState, id: CardId): DuelState {
  return triggerSelf(state, id, '移動が起動された時')
}

/**
 * バトルが発生したことで、攻撃したユニットの「攻撃した時」と、攻撃されたユニットの
 * 「攻撃された時」を誘発させる（総合ルール 第3部 第12章 1）。
 *
 * 攻撃したのはそのスクエアに後から置かれたユニット、攻撃されたのは先に置かれていた
 * ユニットである（同 第11章 4）。どちらもそのユニット自身のできごとなので、盤面にある
 * 同じ能力を持つ他のカードは誘発しない。
 */
export function triggerAttack(state: DuelState, attacker: CardId, attacked: CardId): DuelState {
  return triggerSelf(triggerSelf(state, attacker, '攻撃した時'), attacked, '攻撃された時')
}

/**
 * バトルの勝者が決まったことで、そのユニットの「バトルに勝った時」を誘発させる
 * （総合ルール 第3部 第16章 1・1-1）。
 */
export function triggerBattleWin(state: DuelState, winner: CardId): DuelState {
  return triggerSelf(state, winner, 'バトルに勝った時')
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
    self: chosen.self,
  })
  return { ...resolved, bank: resolved.bank.filter((banked) => banked !== chosen) }
}
