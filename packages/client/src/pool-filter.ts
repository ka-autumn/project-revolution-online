import { CARD_TYPES, COLORS } from '@revolution/engine'
import type { CardType, MoveDirection, WireCardFace, WirePoolCard } from '@revolution/engine'

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

/**
 * レベルで絞り込む時の値（ADR-0028）。プールの中身に関わらず 1〜8 を固定で並べる
 * ——色・属性のような開いた語彙と違い、レベルは範囲が決まっているため。
 */
export const LEVELS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8]

/** 数の範囲。どちらかが `undefined` なら、その側は区切らない。 */
export interface NumberRange {
  readonly min: number | undefined
  readonly max: number | undefined
}

/**
 * スターアイコンで絞り込む時の値（ADR-0028。選択肢と当たり方を変えた）。
 *
 * 「★1」「★2」はそれぞれの数をぴったり持つカードに絞る（3 つ以上を束ねる選択肢は無い
 * ——今のプールに 3 つ以上のスターを持つカードは無い）。1 枚が複数の値に当たることがある
 * （例：スター 1 つとリバーススターの両方を持つカード）。
 */
export type StarChoice = 'なし' | '★1' | '★2' | 'リバーススター'

export const STAR_CHOICES: readonly StarChoice[] = ['なし', '★1', '★2', 'リバーススター']

/**
 * 移動方向（ムーブ）で絞り込む時の形（ADR-0028）。カードのムーブアイコンが、向きの組が
 * ぴったり一致するものだけに絞る——「上」を含むかどうかではなく、形そのもので比べる。
 * プールの中身に関わらず、この 4 つを固定で並べる。名前は読み上げにそのまま使う。
 */
export interface MoveShape {
  readonly label: string
  readonly directions: readonly MoveDirection[]
}

export const MOVE_SHAPES: readonly MoveShape[] = [
  { label: '上のみ', directions: ['上'] },
  { label: '上下のみ', directions: ['上', '下'] },
  { label: '上・右・左', directions: ['上', '右', '左'] },
  { label: '上下左右', directions: ['上', '下', '左', '右'] },
]

/**
 * トラップの発動条件で絞り込む時の値（ADR-0028）。プールの中身に関わらず固定で並べる。
 *
 * いまカードの表記から見分けられるのは「侵入された時」（トリガーアイコンを 1 つ以上持つ
 * トラップ）だけである。ほかの発動条件は、カードの表記に載せてから足す（#232）。
 */
export type TriggerCondition = '侵入された時'

export const TRIGGER_CONDITIONS: readonly TriggerCondition[] = ['侵入された時']

/**
 * 種別を画面に出す時の短い呼び方（ADR-0028）。超必殺ストラテジー！は「超必殺」と出す。読み上げと
 * 絞り込みの値は正式な種別名のまま（`aria-label` に `type` を使う）。
 */
export function typeShownAs(type: CardType): string {
  return type === '超必殺ストラテジー！' ? '超必殺' : type
}

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
  /** トラップの発動条件。トラップ以外のカードはどれにも当たらない。 */
  readonly triggerConditions: readonly TriggerCondition[]
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
    triggerConditions: [],
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
  if (face.stars === 0 && face.reverseStars === 0) choices.push('なし')
  if (face.stars === 1) choices.push('★1')
  if (face.stars === 2) choices.push('★2')
  if (face.reverseStars > 0) choices.push('リバーススター')

  return choices
}

/** カードのムーブアイコンの形に一致する `MOVE_SHAPES` の名前。ユニット以外は持たない。 */
function moveShapeLabelsOf(face: WireCardFace): readonly string[] {
  if (face.type !== 'ユニット') return []
  const directions = new Set(face.moveIcon)

  return MOVE_SHAPES.filter(
    (shape) => shape.directions.length === directions.size && shape.directions.every((direction) => directions.has(direction)),
  ).map((shape) => shape.label)
}

/** カードが当たる発動条件。「侵入された時」はトリガーアイコンを持つトラップ（`TRIGGER_CONDITIONS`）。 */
function triggerConditionsOf(face: WireCardFace): readonly TriggerCondition[] {
  return face.type === 'トラップ' && face.triggerIcon.length > 0 ? ['侵入された時'] : []
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
    anyOf(filter.moveIcons, moveShapeLabelsOf(face)) &&
    anyOf(filter.triggerConditions, triggerConditionsOf(face)) &&
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
 * ただし種別・レベル・スター・移動方向・発動条件は、プールの中身に関わらず全部並べる（ADR-0028）。
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
  readonly triggerConditions: readonly TriggerCondition[]
  readonly expansions: readonly string[]
}

function byName(values: Iterable<string>): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'ja'))
}

export function filterChoicesOf(pool: readonly WirePoolCard[]): FilterChoices {
  const faces = pool.map((card) => card.face)
  const colors = new Set(faces.flatMap((face): readonly string[] => (face.colors.length === 0 ? [COLORLESS] : face.colors)))

  return {
    // 種別は 4 つとも並べる。超必殺ストラテジー！に当たるカードが無いプールでも、ボタンは出る
    // （押すと 0 件になる）。
    types: CARD_TYPES,
    colors: [...COLORS, COLORLESS].filter((color) => colors.has(color)),
    // レベル・スター・移動方向・発動条件は、プールの中身に関わらず全部並べる（ADR-0028、`LEVELS` 等の定義を参照）。
    levels: LEVELS,
    attributes: byName(faces.flatMap((face) => face.attributes)),
    stars: STAR_CHOICES,
    moveIcons: MOVE_SHAPES.map((shape) => shape.label),
    triggerConditions: TRIGGER_CONDITIONS,
    expansions: byName(pool.flatMap((card) => (card.expansions as readonly string[] | undefined) ?? [])),
  }
}
