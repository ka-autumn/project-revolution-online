import { areaOf } from './board.js'
import type { CourageConditionMet, DuelState } from './duel.js'
import type { UnitOnSquare } from './effect.js'
import { opponentOf } from './player.js'
import type { Player } from './player.js'
import { deferringRights } from './priority.js'

/**
 * 相手のユニットが味方エリアか中央エリアに置かれたことで、「勇気」の起動条件が満たされる
 * （総合ルール 第5部 第2章 2）。
 *
 * 見るのは置いた側から見た相手、つまり置かれたユニットを支配していないプレイヤーである。
 * 「相手のユニットが」なので、置いた本人の起動条件は満たされない。エリアの呼び名は見る
 * プレイヤーによって入れ替わる（同 第2部 第22章 6）ので、判定はそのプレイヤーから見て行う
 * （同 6-1）。中央エリアはどちらから見ても中央エリアである。
 *
 * トラップの発動条件（`trap.ts` の `checkIntrusion`）と同じ場面で満たされるが、どのスクエアが
 * 対象かの決まり方が違う。あちらはトラップのトリガーアイコンに描かれたスクエア、こちらは
 * エリアである。呼ぶのはユニットをスクエアに置いた側（`play.ts` の登場・`move.ts` の移動）
 * だけで、そこも同じである。
 *
 * すでに満たされている場合は、そのままにする。`checkIntrusion` と同じ理由で、古いできごとと
 * 新しいできごとのどちらを持つかがまだ分かれようがないためである。
 */
export function checkCourageCondition(state: DuelState, placed: UnitOnSquare): DuelState {
  const player = opponentOf(placed.controller)
  const area = areaOf(player, placed.square)
  if (area !== '味方エリア' && area !== '中央エリア') return state
  if (state.courageConditionsMet.some((met) => met.player === player)) return state

  return { ...state, courageConditionsMet: [...state.courageConditionsMet, { player, placed }] }
}

/**
 * そのプレイヤーがいま「勇気」を起動する権利を得ている、満たされた起動条件すべて
 * （総合ルール 第5部 第2章 2）。得ていなければ空。
 *
 * 起動条件が満たされていることに加えて、バトルもスマッシュ判定も進行中でないことが要る
 * （同 2 ただし書き、`priority.ts` の `deferringRights`）。
 *
 * 条文の「優先権を持った時に」は見ていない。優先権を持っているプレイヤーだけがこれを呼ぶ
 * ためで、トラップの発動する権利（`trap.ts` の `trapRightOf`）と同じ扱いである。
 *
 * 満たされた条件を並びで返すのは、**起動しても条件が消えない**ためである。同一のイベントに
 * よって複数の勇気を起動できる（同 3）ので、1 つ起動しても残りの勇気は同じ条件で起動できる。
 */
export function courageRightsOf(state: DuelState, player: Player): readonly CourageConditionMet[] {
  if (deferringRights(state)) return []
  return state.courageConditionsMet.filter((met) => met.player === player)
}

/**
 * 優先権をパスしたプレイヤーは、「勇気」を起動する権利を失う（総合ルール 第5部 第2章 2
 * 「１度でも優先権をパスすると……起動する権利を失います」）。権利を失うと、再び起動条件を
 * 満たすまで起動できないので、満たされた起動条件を取り除く。
 *
 * バトルやスマッシュ判定が進行中の間は何も失わない。条文が権利を失わせるのは「権利を獲得
 * した後」であり、その間は権利がそもそも発生していない（`courageRightsOf`）ためである。
 * トラップの発動する権利（`trap.ts` の `loseTrapRightOnPass`）と同じ読み方をしている。
 */
export function loseCourageRightOnPass(state: DuelState, player: Player): DuelState {
  if (deferringRights(state)) return state
  if (!state.courageConditionsMet.some((met) => met.player === player)) return state

  return { ...state, courageConditionsMet: state.courageConditionsMet.filter((met) => met.player !== player) }
}
