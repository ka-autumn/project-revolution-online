/**
 * スマートフォンで、行き先を選んでいる間に出す低い詳細の帯の中身を決める（ADR-0034）。
 *
 * 行える手が「行き先を押して決まる 1 種類」だけのカードは、手を聞かずにすぐ行き先を光らせ、盤面を隠さない
 * 帯で詳細を見せる。ここは、帯を出すかどうかの判定と、帯に出す数値の札・案内の文を、届いた値だけから決める
 * 純粋な部分である。帯を作るのは `render.ts`、置き場所を測るのは `phone-board.ts`。
 *
 * **押せる手をここで作り足さない**（ADR-0010）。判定の材料は `input-model.ts` の `PickView.sheet`
 * （届いた手から作ったシートの並び）だけである。
 */
import type { AimKind, AskView } from './input-model.js'
import type { CardView } from './view-model.js'

/**
 * 帯を出すときの、行き先を絞る手の種類。出さないなら `undefined`。
 *
 * シートに並ぶ手がちょうど 1 件で、それが押すと送る手ではなく行き先を絞る手のとき。手が 2 種類以上あるとき、
 * 押すと送る手が 1 つだけのとき（確認）は、今までどおりシートで聞く。
 */
export function peekAimOf(sheet: AskView | undefined): AimKind | undefined {
  if (sheet === undefined || sheet.options.length !== 1) return undefined
  const [only] = sheet.options

  return only !== undefined && 'aim' in only ? only.aim : undefined
}

/**
 * 案内の文。移動なら移動先、置くなら置く場所を選ばせる。
 *
 * 2 行になるときに割ってよい位置（言葉の途中でなく、「を」の後ろ）で 2 つに分けて返す。つなげれば 1 つの文になる。
 */
export function peekGuide(aim: AimKind): readonly [string, string] {
  return aim === 'ユニットを移動する' ? ['移動先を', '選択してください'] : ['置く場所を', '選択してください']
}

/** 数値の札 1 つ。 */
export interface PeekStat {
  readonly label: 'Lv' | 'BP' | 'SP' | 'ダメージ'
  readonly value: number
  /**
   * 元の値からの変わり方。`上`・`下` はカードの絵と同じ決まり（上がったら赤と ▲、下がったら青と ▼）、
   * `受けている` は受けているダメージ（赤くするだけで ▲▼ は付けない）。変わっていなければ `undefined`。
   */
  readonly change: '上' | '下' | '受けている' | undefined
  /** 値の読み上げ。変わっていれば元の値も言う（色と ▲▼ だけに頼らない、#91）。 */
  readonly valueReading: string
}

/** 帯で見ているカードの居場所。スクエアのユニットか、それ以外（手札・プランゾーン）か。 */
export type PeekPlace = 'スクエア' | '手札など'

type FaceUp = CardView & { readonly kind: '表' }

/**
 * 数値の札。スクエアのユニットは BP・SP・ダメージ、手札のカードは Lv・BP・SP（BP・SP を持たないカードは持つ値だけ）。
 *
 * BP の変わり方は、PC のカードの絵と同じ判定（`view-model.ts` の `ModifiedData`、継続効果を適用した後の値と向き）を
 * そのまま使う。SP を変える継続効果は無いので、SP は元の値のまま。ここで修整を計算し直さない。
 */
export function peekStats(card: FaceUp, place: PeekPlace): readonly PeekStat[] {
  const stat = (
    label: PeekStat['label'],
    value: number,
    change: PeekStat['change'],
    base: number = value,
  ): PeekStat => ({
    label,
    value,
    change,
    valueReading: `${value}${change === '上' || change === '下' ? `（元は ${base}）` : ''}`,
  })

  const bp = card.bp === undefined ? [] : [stat('BP', card.modified?.bp ?? card.bp, card.modified?.bpDirection, card.bp)]
  const sp = card.sp === undefined ? [] : [stat('SP', card.sp, undefined)]
  if (place === 'スクエア') return [...bp, ...sp, stat('ダメージ', card.damage, card.damage > 0 ? '受けている' : undefined)]

  return [stat('Lv', card.level, undefined), ...bp, ...sp]
}

/** 帯の上端を、自分の手札の段の上端までに収めたときの高さの上限（px）。 */
export function peekMaxHeight(peekBottom: number, handTop: number): number {
  return Math.max(0, peekBottom - handTop)
}

/** カードの縦横は 3:2。帯の中身の高さに合わせたカードの幅（px）。小さくなりすぎないよう下限を持つ。 */
export const PEEK_CARD_MIN_WIDTH = 48

export function peekCardWidth(bodyHeight: number): number {
  return Math.max(PEEK_CARD_MIN_WIDTH, (bodyHeight * 2) / 3)
}
