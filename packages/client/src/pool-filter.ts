import { CARD_TYPES, COLORS, MOVE_DIRECTIONS } from '@revolution/engine'
import type { CardType, WireCardFace, WirePoolCard } from '@revolution/engine'
import { squareLabel } from './view-model.js'

/**
 * デッキを組むところで、プールを絞り込む（#193）。
 *
 * **絞り込む軸は、カードに印刷されている項目そのものである**（ADR-0021）。それにエキスパンションを
 * 足している。**識別子では絞り込まない。**
 *
 * **同じ軸の中で選んだものは「どれか」、軸どうしは「どれも」で合わせる。** 赤と青を選べば赤か青の
 * カードが残り、そこでユニットを選べば、赤か青のユニットが残る。**何も選んでいない軸は絞り込まない。**
 */

/** 色を持たないカードを選ぶ時の値。`COLORS` には無い。 */
export const COLORLESS = '無色'

/** 数の範囲。どちらかが `undefined` なら、その側は区切らない。 */
export interface NumberRange {
  readonly min: number | undefined
  readonly max: number | undefined
}

/**
 * スターアイコンで絞り込む時の値。
 *
 * **数え上げられるので、列挙で持つ。** 何個持っているかより、持っているかどうかで探すことが多い。
 */
export type StarChoice = 'スターアイコンあり' | 'リバーススターアイコンあり' | 'どちらも無し'

export const STAR_CHOICES: readonly StarChoice[] = ['スターアイコンあり', 'リバーススターアイコンあり', 'どちらも無し']

/** 絞り込みの条件。何も選んでいない軸は空（数の範囲は両側 `undefined`）。 */
export interface PoolFilter {
  /** 名前とテキストに含まれる文字。空白で区切ると、どれも含むカードが残る。 */
  readonly text: string
  readonly types: readonly CardType[]
  /** 色。`COLORLESS` は色を持たないカード。 */
  readonly colors: readonly string[]
  readonly levels: readonly number[]
  /** ＢＰの範囲。**区切ると、ＢＰを持たないカード（ユニット以外）は残らない。** */
  readonly bp: NumberRange
  /** ＳＰの範囲。ＢＰと同じく、ユニットだけが持つ。 */
  readonly sp: NumberRange
  readonly attributes: readonly string[]
  readonly stars: readonly StarChoice[]
  readonly moveIcons: readonly string[]
  /** トリガーアイコンに描かれたスクエアの呼び方（`view-model.ts` の `squareLabel`）。 */
  readonly triggerIcons: readonly string[]
  readonly expansions: readonly string[]
}

export function emptyFilter(): PoolFilter {
  return {
    text: '',
    types: [],
    colors: [],
    levels: [],
    bp: { min: undefined, max: undefined },
    sp: { min: undefined, max: undefined },
    attributes: [],
    stars: [],
    moveIcons: [],
    triggerIcons: [],
    expansions: [],
  }
}

/** 何か 1 つでも絞り込んでいるか。 */
export function isFiltering(filter: PoolFilter): boolean {
  const empty = emptyFilter()
  return JSON.stringify({ ...filter, text: filter.text.trim() }) !== JSON.stringify(empty)
}

/** 選んでいれば外し、選んでいなければ足す。 */
export function toggled<T>(values: readonly T[], value: T): readonly T[] {
  return values.includes(value) ? values.filter((each) => each !== value) : [...values, value]
}

/** 探す文字を比べられる形にする。全角と半角、大文字と小文字を区別しない。 */
function normalized(text: string): string {
  return text.normalize('NFKC').toLowerCase()
}

function inRange(value: number | undefined, range: NumberRange): boolean {
  if (range.min === undefined && range.max === undefined) return true
  if (value === undefined) return false

  return (range.min === undefined || value >= range.min) && (range.max === undefined || value <= range.max)
}

/** 選んだもののどれかを持っているか。何も選んでいなければ、どのカードも通す。 */
function anyOf(chosen: readonly string[], has: readonly string[]): boolean {
  return chosen.length === 0 || chosen.some((value) => has.includes(value))
}

function starChoicesOf(face: WireCardFace): readonly StarChoice[] {
  const choices: StarChoice[] = []
  if (face.stars > 0) choices.push('スターアイコンあり')
  if (face.reverseStars > 0) choices.push('リバーススターアイコンあり')
  if (choices.length === 0) choices.push('どちらも無し')

  return choices
}

function triggerLabelsOf(face: WireCardFace): readonly string[] {
  // 印刷された図の呼び方で比べる。先攻がその基準の向きである（`view-model.ts` の `printedSquareLabel`）。
  return face.type === 'トラップ' ? face.triggerIcon.map((square) => squareLabel('先攻', square)) : []
}

/** カード 1 種が条件に合うか。 */
export function matchesFilter(card: WirePoolCard, filter: PoolFilter): boolean {
  const { face } = card
  const terms = normalized(filter.text).split(/\s+/).filter((term) => term !== '')
  const searched = normalized([face.name, ...face.text].join('\n'))

  return (
    terms.every((term) => searched.includes(term)) &&
    (filter.types.length === 0 || filter.types.includes(face.type)) &&
    anyOf(filter.colors, face.colors.length === 0 ? [COLORLESS] : face.colors) &&
    (filter.levels.length === 0 || filter.levels.includes(face.level)) &&
    inRange(face.type === 'ユニット' ? face.bp : undefined, filter.bp) &&
    inRange(face.type === 'ユニット' ? face.sp : undefined, filter.sp) &&
    anyOf(filter.attributes, face.attributes) &&
    anyOf(filter.stars, starChoicesOf(face)) &&
    anyOf(filter.moveIcons, face.type === 'ユニット' ? face.moveIcon : []) &&
    anyOf(filter.triggerIcons, triggerLabelsOf(face)) &&
    // 古いサーバはエキスパンションを添えてこない。**届かなかったものを、在るものとして扱わない。**
    anyOf(filter.expansions, (card.expansions as readonly string[] | undefined) ?? [])
  )
}

/** 絞り込んだプール。並びは変えない。 */
export function filterPool(pool: readonly WirePoolCard[], filter: PoolFilter): readonly WirePoolCard[] {
  return pool.filter((card) => matchesFilter(card, filter))
}

/**
 * 絞り込みで選べるもの。**プールに実際にあるものだけを並べる。** 選んでも 1 枚も残らない値は出さない。
 *
 * 数え上げている順があるもの（種別・色・ムーブアイコン）はその順、数は小さい順、名前は五十音順に並べる。
 */
export interface FilterChoices {
  readonly types: readonly CardType[]
  readonly colors: readonly string[]
  readonly levels: readonly number[]
  readonly attributes: readonly string[]
  readonly stars: readonly StarChoice[]
  readonly moveIcons: readonly string[]
  readonly triggerIcons: readonly string[]
  readonly expansions: readonly string[]
}

function byName(values: Iterable<string>): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'ja'))
}

export function filterChoicesOf(pool: readonly WirePoolCard[]): FilterChoices {
  const faces = pool.map((card) => card.face)
  const colors = new Set(faces.flatMap((face): readonly string[] => (face.colors.length === 0 ? [COLORLESS] : face.colors)))
  const moves = new Set(faces.flatMap((face) => (face.type === 'ユニット' ? face.moveIcon : [])))
  const stars = new Set(faces.flatMap(starChoicesOf))
  // トリガーアイコンは、盤面の行・列の順（`Square`）で出す。同じ行のスクエアが隣り合う。
  const triggers = faces
    .flatMap((face) => (face.type === 'トラップ' ? face.triggerIcon : []))
    .sort((left, right) => left.row - right.row || left.column - right.column)
    .map((square) => squareLabel('先攻', square))

  return {
    types: CARD_TYPES.filter((type) => faces.some((face) => face.type === type)),
    colors: [...COLORS, COLORLESS].filter((color) => colors.has(color)),
    levels: [...new Set(faces.map((face) => face.level))].sort((left, right) => left - right),
    attributes: byName(faces.flatMap((face) => face.attributes)),
    stars: STAR_CHOICES.filter((choice) => stars.has(choice)),
    moveIcons: MOVE_DIRECTIONS.filter((direction) => moves.has(direction)),
    triggerIcons: [...new Set(triggers)],
    expansions: byName(pool.flatMap((card) => (card.expansions as readonly string[] | undefined) ?? [])),
  }
}
