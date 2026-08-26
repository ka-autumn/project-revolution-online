import { pendingBattle } from './battle.js'
import { bpOf } from './card.js'
import { bpModification } from './continuous.js'
import type { BpModification } from './continuous.js'
import { discardFromSquares, discardedFromSquares } from './discard.js'
import { hasEnded, librarySize } from './duel.js'
import type { CardId, CardInstance, DuelResult, DuelState } from './duel.js'
import { record } from './log.js'
import { PLAYERS, opponentOf } from './player.js'
import type { Player } from './player.js'
import { smashesOf } from './smash.js'

/**
 * 発生しているルールエフェクトをすべて解決する。何も発生していなければ、渡された盤面を
 * そのまま返す。呼ぶ側は、返ってきた盤面が同じものかどうかで、新しいルールエフェクトが
 * 発生したかどうかを判断できる。
 *
 * ルールエフェクトは、カードの能力ではなくルールによって発生する効果であり、どちらの
 * プレイヤーにも支配されない（総合ルール 第4部 第14章 1）。そのため誰の選択も要らず、
 * 発生しているものは同時に解決される（同 2）。
 * スクエアから捨札への移動は `discardFromSquares` を通し、そこで誘発型能力も誘発させる。
 *
 * 呼ぶのはプレイヤーが優先権を獲得する時だけである（同 2）。カードや能力の解決中には
 * チェックしない（同 3）。
 *
 * 扱えるのは、盤面が持っているものだけで判定できる次の 7 つに限る。
 *
 * - スマッシュが 7 枚以上のプレイヤーが敗北する（同 4-1）
 * - 山札が 0 枚以下のプレイヤーが敗北する（同 4-2）
 * - ユニット以外のカードがスクエアにある（同 4-3）
 * - ＢＰが 0 以下のユニットがスクエアにある（同 4-5）
 * - ＢＰと同じかそれ以上のダメージを受けたユニットがスクエアにある（同 4-6）
 * - 同じプレイヤーが支配するユニットが同じスクエアに重なっている（同 4-7）
 * - 中央エリアのスクエアを指定してプレイされたユニットが置かれている（同 4-9）
 *
 * バトルの発生（同 4-4）とスマッシュ判定の発生（同 4-12）はここでは扱わない。バトルは
 * 他のルールエフェクトよりも後で処理される（同 4-4-1）ため、ここを呼ぶ側（`priority.ts` の
 * `settleBeforePriority`）が、ここが何も返さなくなってから `battle.ts` の
 * `startBattleIfAny` を呼ぶ。スマッシュ判定も同じ場所で `smash.ts` の
 * `startSmashJudgmentIfAny` が始める。
 *
 * 残るトラップゾーンの重なり（同 4-8）は、トラップゾーンに置く効果が盤面に無いため
 * まだ扱わない。
 */
export function checkRuleEffects(state: DuelState): DuelState {
  // 勝敗が決まったデュエルは即座に終了する（総合ルール 第3部 第3章 3）。もうルール
  // エフェクトは発生しない。
  if (hasEnded(state)) return state

  // 敗北のルールエフェクト（同 第4部 第14章 4-1・4-2）。他のルールエフェクトと同時に
  // 発生していても、デュエルが終わる以上その結果は盤面に残らないので、ここで打ち切る。
  const result = resultOf(state)
  if (result !== undefined) return record({ ...state, result }, { kind: '決着した', result })

  // ＢＰの修整は 1 度だけ集める。ルールエフェクトはすべて同時に発生する（総合ルール
  // 第4部 第14章 2）ので、どのユニットを捨札に置くかは 1 つの盤面から決まらなければ
  // ならない。1 枚の写しを全ユニットで使い回すことが、それを構造として保証する。
  const modification = bpModification(state)
  const discarded = discardedFromSquares(state, [
    ...state.squares.flatMap((cards) => discardedFrom(cards, modification)),
    ...discardedFromCenter(state),
  ])
  if (discarded.length === 0) return state

  // すべてのルールエフェクトが同時に発生する（総合ルール 第4部 第14章 2）ので、
  // 1 枚ずつ捨札に置いていっても、途中の盤面でどれを捨札に置くかを決め直さない。
  return record(discardFromSquares(state, discarded), {
    kind: 'ルールで捨札に置かれた',
    cards: discarded,
  })
}

/**
 * 敗北の条件を満たしたプレイヤーが敗北して決まる勝敗（総合ルール 第3部 第3章 1・2・4）。
 * 誰も満たしていなければ `undefined`。
 *
 * 両方のプレイヤーが同時に敗北した場合、デュエルは引き分けになる（同 4）。勝利と敗北の
 * 条件を同時に満たしたプレイヤーは敗北する（同 5）が、勝利の条件は「相手が敗北すること」
 * しかないため、それは両方が敗北して引き分けになる場合と同じことになる。
 */
function resultOf(state: DuelState): DuelResult | undefined {
  const losers = PLAYERS.filter((player) => isDefeated(state, player))
  const [loser] = losers
  if (loser === undefined) return undefined

  return losers.length === PLAYERS.length ? { kind: '引き分け' } : { kind: '勝利', winner: opponentOf(loser) }
}

/** デュエルに敗北する枚数のスマッシュ（総合ルール 第3部 第3章 1、第4部 第14章 4-1）。 */
const SMASHES_TO_LOSE = 7

/**
 * そのプレイヤーが敗北の条件を満たしているか。
 *
 * スマッシュが 7 枚以上になったか（総合ルール 第3部 第3章 1、第4部 第14章 4-1）、山札に
 * あるカードが 0 枚以下になったか（同 第3章 2、第14章 4-2）のいずれか。投了（同 第3章 7）は
 * ルールエフェクトではないので、ここでは扱わない。
 */
function isDefeated(state: DuelState, player: Player): boolean {
  return smashesOf(state, player).length >= SMASHES_TO_LOSE || librarySize(state, player) <= 0
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
function discardedFrom(cards: readonly CardInstance[], modification: BpModification): readonly CardId[] {
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

    const bp = bpOf(instance.card, modification(instance.id))
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
 *
 * 条件は本来「そのユニットが置かれた時にバトルが発生したか」だが、盤面にバトルがあるか
 * どうかで代用している。バトルは入れ子になりうる（`duel.ts` の `battles`）が、`playedIntoCenter`
 * に複数が並ぶのはどれも今のバトルの手順が終わる前——バトルの最中はプレイという行動が
 * 行えない（`priority.ts` の `inSpecialProcedure`）ため——なので、どのバトルに紐づくかを
 * 覚えなくても今のところ同じ結果になる。
 */
function discardedFromCenter(state: DuelState): readonly CardId[] {
  if (state.playedIntoCenter.length === 0) return []
  if (state.battles.length > 0 || pendingBattle(state) !== undefined) return []
  return state.playedIntoCenter
}
