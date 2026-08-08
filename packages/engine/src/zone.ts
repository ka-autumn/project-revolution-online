/**
 * カードや能力がデュエル中に存在できる場所。
 *
 * 値は総合ルールの表記をそのまま持つ（ADR-0003）。「エリア」「ライン」は
 * 場所の呼び方であってゾーンではないため、ここには含めない。
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

/** 両プレイヤーで共有するゾーンか。共有しないゾーンはプレイヤーごとに存在する。 */
export const isSharedZone = (zone: Zone): boolean => SHARED_ZONES.has(zone)
