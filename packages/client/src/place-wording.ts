import type { SquarePlaceAction, ZonePlaceAction } from '@revolution/engine'

/**
 * 効果がカードを置いた行の言い方（ADR-0076）。置いた先のゾーンと述語を分けて持つ。行は「〈名前〉を」＋
 * 「誰の」＋ゾーン＋述語で組み立てるので、ゾーンの前に「自分の」などを差し込める。
 *
 * 動詞を活用させる仕組みは持たず、値ごとに言い方を丸ごと書く。テキストの動詞（「加える」「戻す」など）に
 * そろえるために、動きの値が動詞まで含んでいる。`satisfies Record<ZonePlaceAction, ...>` で、動きの値を
 * 追加して行を書き忘れると、型検査で失敗する。
 */
interface ZonePlaceWording {
  /** 置いた先のゾーン。「自分の」などの後ろに続ける。 */
  readonly zone: string
  /** ゾーンの後ろに続く述語。 */
  readonly predicate: string
}

export const ZONE_PLACE_WORDING = {
  手札に加える: { zone: '手札', predicate: 'に加えた' },
  捨札に置く: { zone: '捨札', predicate: 'に置いた' },
  スマッシュゾーンにリリースして置く: { zone: 'スマッシュゾーン', predicate: 'にリリースして置いた' },
  山札の1番上に表向きで置く: { zone: '山札', predicate: 'の1番上に表向きで置いた' },
  山札の1番上に裏向きで置く: { zone: '山札', predicate: 'の1番上に裏向きで置いた' },
  山札の1番下に戻す: { zone: '山札', predicate: 'の1番下に戻した' },
  エネルギーゾーンにフリーズして置く: { zone: 'エネルギーゾーン', predicate: 'にフリーズして置いた' },
  エネルギーゾーンにリリースして置く: { zone: 'エネルギーゾーン', predicate: 'にリリースして置いた' },
} as const satisfies Record<ZonePlaceAction, ZonePlaceWording>

/** スクエアへ置いた行の述語。スクエアは、見る人から見た呼び名で言う（誰のゾーンかは言わない）。 */
export const SQUARE_PLACE_PREDICATE = {
  リリースして置く: 'にリリースして置いた',
  フリーズして置く: 'にフリーズして置いた',
  向きを変えずに置く: 'に向きを変えずに置いた',
} as const satisfies Record<SquarePlaceAction, string>

/**
 * 値から言い方を取得する。この画面が知らない値（新しいサーバが追加した値。ADR-0038）や、値が届かなかった行は
 * `undefined` を返し、呼ぶ側が「読めなかった」として扱う（#285）。表を直接参照すると、知らない値で例外になり、
 * 盤面ごと描けなくなる。
 */
export function zonePlaceWordingOf(action: string | undefined): ZonePlaceWording | undefined {
  return action !== undefined && Object.hasOwn(ZONE_PLACE_WORDING, action) ? ZONE_PLACE_WORDING[action as ZonePlaceAction] : undefined
}

/** スクエアへ置いた行の述語を取得する。取得できない時は `undefined`（`zonePlaceWordingOf` と同じ）。 */
export function squarePlacePredicateOf(action: string | undefined): string | undefined {
  return action !== undefined && Object.hasOwn(SQUARE_PLACE_PREDICATE, action) ? SQUARE_PLACE_PREDICATE[action as SquarePlaceAction] : undefined
}
