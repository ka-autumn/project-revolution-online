/**
 * カードや能力がデュエル中に存在できる場所。
 *
 * 値は総合ルールの表記をそのまま持つ（ADR-0003）。
 *
 * 総合ルール 第2部 第21章 1。「エリア」「ライン」は場所の呼び方であって
 * ゾーンではないため含めない（同 1－1）。
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
] as const

export type Zone = (typeof ZONES)[number]

const SHARED_ZONES: ReadonlySet<Zone> = new Set<Zone>(['スクエア', 'バンク', 'リゾルブゾーン'])

/**
 * 両プレイヤーで共有するゾーンか。共有しないゾーンはプレイヤーごとに存在する。
 * 総合ルール 第2部 第21章 1。
 */
export const isSharedZone = (zone: Zone): boolean => SHARED_ZONES.has(zone)
