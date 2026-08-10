import { cardsIn } from './duel.js'
import type { CardId, CardInstance, DuelState } from './duel.js'
import { PLAYERS } from './player.js'
import { PLAYER_ZONES } from './zone.js'

/** 盤面が守っているはずの不変条件が崩れていることを説明する文。 */
export type InvariantViolation = string

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
    if (instance.damage < 0) violations.push(`カード ${instance.id} が負のダメージ ${instance.damage} を持っている`)
  }
  for (const player of PLAYERS) {
    if (state.damage[player] < 0) violations.push(`${player} が負のダメージ ${state.damage[player]} を受けている`)
  }

  for (const id of initialCardIds) {
    const count = seen.get(id) ?? 0
    if (count === 0) violations.push(`カード ${id} がどこにも見つからない`)
    else if (count > 1) violations.push(`カード ${id} が ${count} か所に重複して存在する`)
  }
  for (const id of seen.keys()) {
    if (!initialCardIds.has(id)) violations.push(`見覚えのないカード ${id} が存在する`)
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
