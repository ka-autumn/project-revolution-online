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
 * 扱えるのは、盤面が持っているものだけで判定できる次の 3 つに限る。
 *
 * - ユニット以外のカードがスクエアにある（同 4-3）
 * - 同じプレイヤーが支配するユニットが同じスクエアに重なっている（同 4-7）
 * - 中央エリアのスクエアを指定してプレイされたユニットが置かれている（同 4-9）
 *
 * 残りはまだ扱わない。敗北（同 4-1・4-2）はデュエルの終了が、バトルの発生（同 4-4）は
 * バトルが、ＢＰとダメージによる破壊（同 4-5・4-6）はＢＰの修整とダメージが、
 * トラップゾーンの重なり（同 4-8）はトラップゾーンに置く効果が、それぞれ盤面に無いため
 * である。
 */
export function checkRuleEffects(state: DuelState): DuelState {
  // 中央エリアのスクエアを指定してプレイされ、置かれたユニットは捨札に置かれる（同 4-9）。
  // 置かれた時にバトルが発生していたなら、捨札に置かれるのはそのバトルの終了時になる
  // （同 4-10）が、バトルがまだ無いためバトルは決して発生せず、いまは常に 4-9 になる。
  const discarded = [...state.squares.flatMap(discardedFrom), ...state.playedIntoCenter]
  if (discarded.length === 0) return state

  // すべてのルールエフェクトが同時に発生する（総合ルール 第4部 第14章 2）ので、
  // 1 枚ずつ捨札に置いていっても、途中の盤面でどれを捨札に置くかを決め直さない。
  const resolved = discarded.reduce((current, id) => moveFromSquareTo(current, id, '捨札'), state)
  return { ...resolved, playedIntoCenter: [] }
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
  const staying = new Set<Player>()
  const discarded: CardId[] = []
  for (const instance of cards) {
    // 総合ルール 第4部 第14章 4-3。
    if (instance.card.type !== 'ユニット') {
      discarded.push(instance.id)
      continue
    }
    // 総合ルール 第4部 第14章 4-7。支配者が違うユニットが重なった場合はバトルが発生する
    // （同 4-4）のであって、捨札には置かれない。
    if (staying.has(instance.controller)) {
      discarded.push(instance.id)
      continue
    }
    staying.add(instance.controller)
  }
  return discarded
}
