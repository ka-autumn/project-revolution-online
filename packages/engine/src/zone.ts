/**
 * プレイヤーごとに存在するゾーン。
 *
 * 値は総合ルールの表記をそのまま持つ（ADR-0003）。
 *
 * 総合ルール 第2部 第21章 1。
 */
export const PLAYER_ZONES = [
  '山札',
  'プランゾーン',
  '手札',
  '捨札',
  'エネルギーゾーン',
  'スマッシュゾーン',
  'トラップゾーン',
  'リムーブゾーン',
  'パートナーゾーン',
] as const

export type PlayerZone = (typeof PLAYER_ZONES)[number]

/**
 * 両方のプレイヤーが共有するゾーン。
 *
 * 総合ルール 第2部 第21章 1。
 */
export const SHARED_ZONES = ['スクエア', 'バンク', 'リゾルブゾーン'] as const

export type SharedZone = (typeof SHARED_ZONES)[number]

/**
 * カードや能力がデュエル中に存在できる場所。12 種類。
 *
 * プレイヤーごとに存在するか両者で共有するかは、`PlayerZone` と `SharedZone` という
 * 別々の型で区別する。どちらであるかを実行時に問い合わせる必要はない。
 *
 * 「バトルスペース」「エリア」「ライン」はいくつかのスクエアをまとめてグループとして
 * とらえた場所の呼び方であってゾーンではないため、ここには含めない（同 1-1）。
 * それらは `board.ts` にある。
 *
 * 並びは総合ルール 第2部 第21章 1 の列挙順のまま。原文と突き合わせられるように、
 * プレイヤーごと／共有でまとめ直さない。
 */
export const ZONES = [
  '山札',
  'プランゾーン',
  '手札',
  '捨札',
  'エネルギーゾーン',
  'スマッシュゾーン',
  'スクエア',
  'トラップゾーン',
  'リムーブゾーン',
  'バンク',
  'リゾルブゾーン',
  'パートナーゾーン',
] as const satisfies readonly Zone[]

export type Zone = PlayerZone | SharedZone
