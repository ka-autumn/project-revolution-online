/**
 * あるプレイヤーから見た、スクエアにあるユニットの呼び方。
 * 自分のユニットが「味方」、相手のユニットが「敵」。
 *
 * 総合ルール 第2部 第21章 8-2。
 */
export const RELATIONS_FROM_PLAYER = ['味方', '敵'] as const

export type RelationFromPlayer = (typeof RELATIONS_FROM_PLAYER)[number]

/**
 * あるユニットから見た、スクエアにある他のユニットの呼び方。
 * 支配者が同じユニットが「仲間」、上下左右に接するスクエアにあるユニットが
 * 「隣のユニット」（斜めに接するものは含まない）。
 *
 * この 2 つは支配者と位置という別々の軸なので、同じユニットが両方に当てはまる
 * ことも、どちらにも当てはまらないこともある。互いに排他ではない。
 *
 * 「味方」がプレイヤーから見た呼び方であるのに対し、「仲間」はユニットから見た
 * 呼び方であり視点が異なる。取り違えると効果の範囲がずれるため、
 * `RelationFromPlayer` とは別の型にして混ぜられないようにしている。
 *
 * 総合ルール 第2部 第21章 8-2。
 */
export const RELATIONS_FROM_UNIT = ['仲間', '隣のユニット'] as const

export type RelationFromUnit = (typeof RELATIONS_FROM_UNIT)[number]
