import { cardsIn } from './duel.js'
import type { CardId, CardInstance, DuelState } from './duel.js'
import type { Player } from './player.js'
import { PLAYERS } from './player.js'
import { PLAYER_ZONES } from './zone.js'

/**
 * 盤面の不変条件、および自己対戦が検出する進行上の異常を説明する値（ADR-0005）。
 *
 * `ActionViolation`（`action.ts`）と同じく、呼び出し側が崩れた条件の種類で分岐できるように
 * 構造化する。文字列 1 つに自由文で説明を詰め込むと、種類ごとに違う扱いをしたい場合に文字列を
 * パースし直す必要が出てしまう。ほとんどの種類は `checkBoardInvariants` が盤面そのものを見て
 * 生成するが、`終了していないのに合法手が無い` だけは例外で、盤面ではなく `legalActions`
 * （`legal-action.ts`）の列挙結果を見た `self-play.ts` が生成する。デュエルが終了していない
 * 限り必ず `優先権を放棄する` が候補にあるはずなので、これも自己対戦が炙り出すべき異常として
 * 同じ型に含める。
 */
export type InvariantViolation =
  | { readonly kind: 'カードがどこにも見つからない'; readonly card: CardId }
  | { readonly kind: 'カードが重複して存在する'; readonly card: CardId; readonly count: number }
  | { readonly kind: '見覚えのないカードが存在する'; readonly card: CardId }
  | { readonly kind: 'カードが負のダメージを持っている'; readonly card: CardId; readonly damage: number }
  | { readonly kind: 'プレイヤーが負のダメージを受けている'; readonly player: Player; readonly damage: number }
  /** デュエルが終了していないのに合法手が 1 つも無い（`self-play.ts`）。 */
  | { readonly kind: '終了していないのに合法手が無い' }

/**
 * 盤面にあるすべてのカードの id（ADR-0005 の「盤面の不変条件チェック」の基準を作る）。
 *
 * デュエルの開始直後に呼んで基準とし、その後の盤面をこれと比べ続ける
 * （`checkBoardInvariants`）。
 */
export function cardIdsOf(state: DuelState): ReadonlySet<CardId> {
  return new Set(allCardInstances(state).map((instance) => instance.id))
}

/**
 * 盤面がカードの総数についての不変条件を守っているか調べる（ADR-0005）。
 *
 * カードは、行動や効果によって消滅したり増えたりしない。移動・破壊・捨て札はすべて
 * 「いまある場所からある場所へ動かす」だけで（`duel.ts` の `detach`）、新しいカードを
 * 作らない。したがって、デュエル開始直後に見えていたカードの id の集合は、デュエル中
 * いつ見ても変わらないはずである。1 枚が同時に 2 か所以上に見つかる、見えていたはずの
 * カードがどこにも見つからない、見たことのない id のカードが現れる、のいずれも崩れている
 * 印である。
 *
 * 受けているダメージが負の数になっていないかも合わせて見る。ダメージは与える・回復する・
 * 取り除くしかなく（`duel.ts` の `dealDamage`・`recoverDamage`・`removeAllDamage`）、
 * どれも負の数を作らないはずである。
 */
export function checkBoardInvariants(
  state: DuelState,
  initialCardIds: ReadonlySet<CardId>,
): readonly InvariantViolation[] {
  const violations: InvariantViolation[] = []
  const seen = new Map<CardId, number>()

  for (const instance of allCardInstances(state)) {
    seen.set(instance.id, (seen.get(instance.id) ?? 0) + 1)
    if (instance.damage < 0) violations.push({ kind: 'カードが負のダメージを持っている', card: instance.id, damage: instance.damage })
  }
  for (const player of PLAYERS) {
    if (state.damage[player] < 0) violations.push({ kind: 'プレイヤーが負のダメージを受けている', player, damage: state.damage[player] })
  }

  for (const id of initialCardIds) {
    const count = seen.get(id) ?? 0
    if (count === 0) violations.push({ kind: 'カードがどこにも見つからない', card: id })
    else if (count > 1) violations.push({ kind: 'カードが重複して存在する', card: id, count })
  }
  for (const id of seen.keys()) {
    if (!initialCardIds.has(id)) violations.push({ kind: '見覚えのないカードが存在する', card: id })
  }

  return violations
}

/** 盤面上のスクエア・すべてのゾーン・リゾルブゾーンにあるカードすべて。 */
function allCardInstances(state: DuelState): readonly CardInstance[] {
  return [
    ...state.squares.flat(),
    ...state.resolveZone,
    ...PLAYERS.flatMap((player) => PLAYER_ZONES.flatMap((zone) => cardsIn(state, player, zone))),
  ]
}
