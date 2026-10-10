/**
 * スマートフォンの、エネルギー・スマッシュのボタンに出す、種類ごとの枚数（ADR-0034）。
 *
 * 縮めた盤面では、重ねて並べたカードは指で押し分けられないので、ボタンにして中身を数で見せる。1 枚ごとに印を
 * 並べる形は、枚数が増えるとボタンからはみ出す（スマッシュは 6 枚、エネルギーは 10 枚ほど）ので採らない。
 * ここは、カードを種類ごとに数える部分と、読み上げの名前を決める部分で、DOM は作らない（`render.ts` が作る）。
 */
import type { Color } from '@revolution/engine'
import { primaryColorOf } from './view-model.js'
import type { CardView } from './view-model.js'

/** 数える置き場。 */
export type TallyZone = 'エネルギーゾーン' | 'スマッシュゾーン'

/** エネルギーの列の並び順。ボタンの中でも、読み上げでも、この順に並べる。 */
export const ENERGY_COLORS: readonly Color[] = ['赤', '青', '白', '緑', '黒']

/**
 * 印の種類。エネルギーは色（そのレベルアイコンで描く）、スマッシュは裏向きで色が無いので `裏`（カードの裏面）。
 *
 * エネルギーゾーンのカードは、盤面に届く時点で表向きに決まっている（総合ルール 第2部 第21章 6-3、
 * `perspective.ts` の `seesFace`）ので、エネルギーに `裏` が混じることは無い。型の上では起こりうるので、
 * 混じったら、色の列のあとに「裏向き」の列として数える（落とさない）。
 */
export type TallySymbol = Color | '裏'

/** 数える 1 種類。`column` と `row` は、ボタンの中の格子の位置（1 始まり。上の段がリリース、下の段がフリーズ）。 */
export interface TallyKind {
  readonly symbol: TallySymbol
  readonly frozen: boolean
  readonly count: number
  readonly column: number
  readonly row: 1 | 2
}

export interface ZoneTally {
  /** ゾーンの枚数。 */
  readonly total: number
  /** うち、フリーズしている枚数。 */
  readonly frozen: number
  /**
   * 出す種類。1 枚でもある色（スマッシュは 1 枚でもあれば）は、片方の状態が 0 枚でも両方を出す（0 枚は薄く描く）。
   * 1 枚も無い色と、0 枚のゾーンには何も出さない。
   */
  readonly kinds: readonly TallyKind[]
  /** 読み上げの名前。 */
  readonly label: string
}

function symbolOf(zone: TallyZone, card: CardView): TallySymbol {
  return zone === 'エネルギーゾーン' && card.kind === '表' ? primaryColorOf(card.colors) : '裏'
}

/** 読み上げでの種類の呼び名（「白」「フリーズの黒」）。 */
function nameOf(symbol: TallySymbol, frozen: boolean): string {
  return `${frozen ? 'フリーズの' : ''}${symbol === '裏' ? '裏向き' : symbol}`
}

/** カードを種類ごとに数える。 */
export function zoneTally(zone: TallyZone, cards: readonly CardView[]): ZoneTally {
  const total = cards.length
  const frozen = cards.filter((card) => card.orientation === 'フリーズ').length
  const countOf = (symbol: TallySymbol, isFrozen: boolean): number =>
    cards.filter((card) => symbolOf(zone, card) === symbol && (card.orientation === 'フリーズ') === isFrozen).length

  // 列は、1 枚でもある色だけを色の順に詰める。スマッシュは 1 列（裏）。
  const symbols: readonly TallySymbol[] = (zone === 'スマッシュゾーン' ? (['裏'] as const) : [...ENERGY_COLORS, '裏' as const]).filter(
    (symbol) => cards.some((card) => symbolOf(zone, card) === symbol),
  )
  const kinds = symbols.flatMap((symbol, at): readonly TallyKind[] => [
    { symbol, frozen: false, count: countOf(symbol, false), column: at + 1, row: 1 },
    { symbol, frozen: true, count: countOf(symbol, true), column: at + 1, row: 2 },
  ])

  // 読み上げは、リリース、フリーズの順に、色の順で。0 枚の種類は言わない。スマッシュは色が無く、枚数とフリーズの枚数
  // で種類ごとの枚数が分かるので、種類は添えない。
  const parts =
    zone === 'スマッシュゾーン'
      ? []
      : [false, true].flatMap((isFrozen) =>
          symbols.flatMap((symbol) => {
            const count = countOf(symbol, isFrozen)
            return count > 0 ? [`${nameOf(symbol, isFrozen)} ${count}`] : []
          }),
        )
  const detail = parts.length > 0 ? `。${parts.join('、')}` : ''

  return { total, frozen, kinds, label: `${zone}（${total}、うちフリーズ ${frozen}${detail}）の一覧を開く` }
}
