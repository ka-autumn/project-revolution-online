import type { ActivationCost, ActivationTiming } from './ability.js'
import { cannot, done } from './action.js'
import type { ActionOutcome } from './action.js'
import { activatedAbilitiesOf } from './card.js'
import { payActivationEnergies } from './cost.js'
import { hasEnded, locateOnSquares, moveToZone } from './duel.js'
import type { CardId, CardInstance, DuelState } from './duel.js'
import type { UnitOnSquare } from './effect.js'
import type { Player } from './player.js'
import { activePlayerMayAct, grantPriorityToInactive } from './priority.js'
import { resolveEffect } from './resolve.js'
import type { Chooser } from './resolve.js'

/**
 * スクエアにいるユニットが持つ起動型能力を 1 つ起動する（総合ルール 第4部 第2章）。
 *
 * 見るのはスクエアにいるユニットの能力だけである。ユニットのテキストはスクエアに置かれて
 * いる間だけ有効であり（同 第7章 10 に引かれているルール）、スクエアにあってもユニット以外の
 * カードはそこにある間テキストが有効にならない（同 第14章 4-3）。**手札にある間に働く能力は
 * ここを通らない。** キーワード能力「勇気」（同 第5部 第2章 1）がそれにあたるが、あちらは
 * 手札にある時に効果を発揮するという規定を「勇気」自身が持っているので、その規定と一緒に足す。
 *
 * 起動できるのはそのカードの支配者だけである（同 第4部 第2章 2）。どの時に起動できるかは
 * 能力が名指しする（`ability.ts` の `ACTIVATION_TIMINGS`）。
 *
 * **バンクを使用しない**（同 5）。コストをすべて支払い（同 1）、その場で効果を解決する。
 * 行動を行った後、非アクティブプレイヤーが優先権を獲得する（同 第5章 2）。
 *
 * `ability` はそのカードが持つ起動型能力の並びの位置である（`card.ts` の
 * `activatedAbilitiesOf`）。1 枚が 2 つ以上持つことがありうるので、どれを起動するかを
 * 指せるようにしている。
 */
export function activateAbility(
  state: DuelState,
  card: CardId,
  ability: number,
  chooser: Chooser,
): ActionOutcome {
  const located = locateOnSquares(state, card)
  if (located === undefined) return cannot('そのゾーンにない')

  const { instance, square } = located
  if (instance.card.type !== 'ユニット') return cannot('そのゾーンにない')

  const unit = instance.card
  const activated = activatedAbilitiesOf(unit)[ability]
  if (activated === undefined) return cannot('起動できる能力がない')
  if (!mayActivate(state, activated.timing, instance.controller)) return cannot('行える時ではない')

  const paid = payActivationCost(state, instance, activated.cost, chooser)
  if (paid === undefined) return cannot('コストを支払えない')

  // 発生源はコストを支払う前の姿を写して渡す。自身を捨札に置くコストを支払っていれば、
  // 解決する時にはもうスクエアにいない（総合ルール 第4部 第8章 2-5、`resolve.ts` の
  // `duelView`）。
  const self: UnitOnSquare = { id: instance.id, square, card: unit, controller: instance.controller }
  const resolved = resolveEffect(paid, activated.effect, {
    controller: instance.controller,
    via: '起動',
    source: instance.id,
    chooser,
    self,
  })
  return done(grantPriorityToInactive(resolved))
}

/**
 * いまその時に起動できるか（総合ルール 第4部 第2章 4）。
 *
 * 起動できるのは支配者だけである（同 2）。既定の時であれば、そのプレイヤーがアクティブ
 * プレイヤーであることまで `activePlayerMayAct` が見ている（優先権を持ち、バンクが空で、
 * バトル中でない自分のメインフェイズ）。
 *
 * `'優先権を持っている時'` はキーワード能力「勇気」が既定を上書きしたもので、優先権を持って
 * いること以外は求めない（同 第5部 第2章 2）。バトル中に起動できないのは、起動する権利が
 * そもそも発生していない（同 2 ただし書き、`courage.ts` の `courageRightsOf`）ためであって、
 * 行動そのものが禁じられているからではない。トラップの発動（`play.ts` の `activateTrap`）と
 * 同じ形である。
 *
 * 起動する経路は能力の種類ごとに分かれている（スクエアにいるユニットは `activateAbility`、
 * 「勇気」は `courage.ts` の `activateCourage`）が、**どの時に起動できるかの判定はここ 1 つ**
 * にまとめてある。engine が持つと決めたのはこの判定である。
 */
export function mayActivate(state: DuelState, timing: ActivationTiming, controller: Player): boolean {
  switch (timing) {
    case '自分のメインフェイズ':
      return activePlayerMayAct(state, 'メインフェイズ') && state.turn.active === controller
    case '優先権を持っている時':
      // 勝敗が決まったデュエルではそこから先に優先権が発生しない（同 第3部 第3章 3）。
      return !hasEnded(state) && state.turn.priority === controller
  }
}

/**
 * 起動のコストをすべて支払う（総合ルール 第4部 第2章 1）。支払えなければ `undefined`。
 *
 * 支払いかけた分が盤面に残ることはない。呼ぶ側は返ってきた盤面だけを使うためで、
 * `cost.ts` の `freezeEnergies` と同じ扱いである。
 *
 * どのゾーンにあるカードでも支払える。エネルギーをフリーズするのも、そのカード自身を捨札に
 * 置くのも、置かれている場所によらないためである。手札にある「勇気」もこれで支払う。
 */
export function payActivationCost(
  state: DuelState,
  instance: CardInstance,
  cost: ActivationCost,
  chooser: Chooser,
): DuelState | undefined {
  const frozen = payActivationEnergies(
    state,
    instance.controller,
    instance.card,
    cost.energiesOfOwnColor,
    chooser,
  )
  if (frozen === undefined) return undefined

  return cost.discardsSelf ? moveToZone(frozen, instance.id, '捨札') : frozen
}
