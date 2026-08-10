import { pendingBattle } from './battle.js'
import { bpOf } from './card.js'
import { moveFromSquareTo } from './duel.js'
import type { CardId, CardInstance, DuelState } from './duel.js'
import type { Player } from './player.js'

/**
 * 発生しているルールエフェクトをすべて解決する。何も発生していなければ、渡された盤面を
 * そのまま返す。呼ぶ側は、返ってきた盤面が同じものかどうかで、新しいルールエフェクトが
 * 発生したかどうかを判断できる。
 *
 * ルールエフェクトは、カードの能力ではなくルールによって発生する効果であり、どちらの
 * プレイヤーにも支配されない（総合ルール 第4部 第14章 1）。そのため誰の選択も要らず、
 * 発生しているものは同時に解決される（同 2）。
 *
 * 呼ぶのはプレイヤーが優先権を獲得する時だけである（同 2）。カードや能力の解決中には
 * チェックしない（同 3）。
 *
 * 扱えるのは、盤面が持っているものだけで判定できる次の 5 つに限る。
 *
 * - ユニット以外のカードがスクエアにある（同 4-3）
 * - ＢＰが 0 以下のユニットがスクエアにある（同 4-5）
 * - ＢＰと同じかそれ以上のダメージを受けたユニットがスクエアにある（同 4-6）
 * - 同じプレイヤーが支配するユニットが同じスクエアに重なっている（同 4-7）
 * - 中央エリアのスクエアを指定してプレイされたユニットが置かれている（同 4-9）
 *
 * バトルの発生（同 4-4）はここでは扱わない。他のルールエフェクトよりも後で処理される
 * （同 4-4-1）ため、ここを呼ぶ側（`priority.ts` の `settleBeforePriority`）が、ここが
 * 何も返さなくなってから `battle.ts` の `startBattleIfAny` を呼ぶ。
 *
 * 残りはまだ扱わない。敗北（同 4-1・4-2）はデュエルの終了が、トラップゾーンの重なり
 * （同 4-8）はトラップゾーンに置く効果が、スマッシュ判定の発生（同 4-12）はプレイヤーへの
 * ダメージが、それぞれ盤面に無いためである。
 */
export function checkRuleEffects(state: DuelState): DuelState {
  const fromCenter = discardedFromCenter(state)
  const discarded = [...state.squares.flatMap(discardedFrom), ...fromCenter]
  if (discarded.length === 0) return state

  // すべてのルールエフェクトが同時に発生する（総合ルール 第4部 第14章 2）ので、
  // 1 枚ずつ捨札に置いていっても、途中の盤面でどれを捨札に置くかを決め直さない。
  const resolved = discarded.reduce((current, id) => moveFromSquareTo(current, id, '捨札'), state)
  return fromCenter.length === 0 ? resolved : { ...resolved, playedIntoCenter: [] }
}

/**
 * そのスクエアにあるカードのうち、ルールエフェクトによって持ち主の捨札に置かれるもの。
 *
 * 並びの後ろが後から置かれたカードである（`duel.ts` の `squares` を参照）。同じ
 * プレイヤーが支配するユニットが重なった時に捨札に置かれるのは後から置かれた側なので、
 * 先頭から見て、そのプレイヤーの 1 枚目だけを残す。
 *
 * 複数のユニットが「同時に置かれた」場合はそれらがすべて捨札に置かれる（総合ルール
 * 第4部 第14章 4-7）が、同時に置く効果がまだ無いため、ここでは区別していない。
 */
function discardedFrom(cards: readonly CardInstance[]): readonly CardId[] {
  const placed = new Set<Player>()
  const discarded: CardId[] = []
  for (const instance of cards) {
    // 総合ルール 第4部 第14章 4-3。
    if (instance.card.type !== 'ユニット') {
      discarded.push(instance.id)
      continue
    }
    // 総合ルール 第4部 第14章 4-7。支配者が違うユニットが重なった場合はバトルが発生する
    // （同 4-4）のであって、捨札には置かれない。
    //
    // 何枚目かは、そのユニットが他のルールエフェクトで捨札に置かれるかどうかとは関係なく、
    // 置かれた順で決まる。1 枚目が別の理由で捨札に置かれても、2 枚目は「後から置かれた
    // ユニット」のままである。
    const stacked = placed.has(instance.controller)
    placed.add(instance.controller)

    const bp = bpOf(instance.card)
    // 総合ルール 第4部 第14章 4-5・4-6。
    if (stacked || bp <= 0 || instance.damage >= bp) discarded.push(instance.id)
  }
  return discarded
}

/**
 * 中央エリアのスクエアを指定してプレイされ、置かれたユニットのうち、いま捨札に置かれるもの
 * （総合ルール 第4部 第14章 4-9）。
 *
 * 捨札に置かれるのは「バトルが発生しなければ」である。バトルが発生したならそのバトルの
 * 終了時に置かれる（同 4-10、第3部 第16章 2-2）ので、これから発生するバトルがある間も、
 * バトルが進行中の間も、ここでは何も返さない。
 */
function discardedFromCenter(state: DuelState): readonly CardId[] {
  if (state.playedIntoCenter.length === 0) return []
  if (state.battle !== undefined || pendingBattle(state) !== undefined) return []
  return state.playedIntoCenter
}
