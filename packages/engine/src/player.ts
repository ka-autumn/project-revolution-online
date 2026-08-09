/**
 * デュエルに参加する 2 人のプレイヤーの識別。
 *
 * 先攻・後攻はデュエルの準備でランダムに決まり（総合ルール 第3部 第1章 5）、その後は
 * 変化しない。デュエル中に入れ替わる「アクティブプレイヤー／非アクティブプレイヤー」や、
 * カードから見た「持ち主／支配者」は、このどちらであるかとは別の軸なので混ぜない。
 */
export const PLAYERS = ['先攻', '後攻'] as const

export type Player = (typeof PLAYERS)[number]

/** そのプレイヤーから見た相手。デュエルには 2 人しか参加しないので、常に 1 人に決まる。 */
export function opponentOf(player: Player): Player {
  return player === '先攻' ? '後攻' : '先攻'
}
