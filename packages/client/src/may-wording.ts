import type { MayAction } from '@revolution/engine'

/**
 * 「してもよい」の動きごとの言い方（ADR-0064）。ダイアログの聞く文と、ログの 2 つの行が、ここから文を取得する。
 *
 * 動詞を活用させる仕組みは持たず、値ごとに言い方を丸ごと書く。テキストの動詞（「加える」など）に
 * そろえるために、動きの値が動詞まで含んでいる。`satisfies Record<MayAction, ...>` で、動きの値を追加して
 * 行を書き忘れると、型検査で失敗する。
 */
interface MayWording {
  /** 聞く文の述語。「〈名前〉を」に続ける。 */
  readonly ask: string
  /**
   * 「はい」の時のログの述語。対象を持たない動きは、動きの命令が自分の行を積む（「引いた：〈名前〉」など）ので、
   * ここでは言わない（ADR-0065）。
   */
  readonly done: string | undefined
  /** 「いいえ」の時のログの述語。 */
  readonly skipped: string
  /** 対象を持たない動き。聞く文とログの行は、対象の「〜を」を入れない（ADR-0065）。 */
  readonly untargeted?: true
}

const MAY_WORDING = {
  手札に加える: { ask: '手札に加えますか', done: '手札に加えた', skipped: '手札に加えなかった' },
  '1枚引く': { ask: '1枚引きますか', done: undefined, skipped: '1枚引かなかった', untargeted: true },
  山札の1番上のカードをエネルギーゾーンにフリーズして置く: {
    ask: '山札の1番上のカードをエネルギーゾーンにフリーズして置きますか',
    done: undefined,
    skipped: '山札の1番上のカードをエネルギーゾーンにフリーズして置かなかった',
    untargeted: true,
  },
} as const satisfies Record<MayAction, MayWording>

/**
 * 対象の名前を並べる。名前に「・」を含むカードがある（「テスト・A」のような名前）ので、区切りに使わない。
 * 名前が 1 つも分からなければ `undefined` を返し、対象を言わない文にする。
 */
function namesOf(names: readonly string[]): string | undefined {
  return names.length === 0 ? undefined : names.join('と')
}

/** 聞く文。「見張りの猫を手札に加えますか？」。対象の名前が無ければ、述語だけ。 */
export function mayQuestion(action: MayAction, names: readonly string[]): string {
  const subject = namesOf(names)
  return `${subject === undefined ? '' : `${subject}を`}${MAY_WORDING[action].ask}？`
}

/** 「はい」の時のログの行。対象の名前が無ければ、`undefined`（行を出力しない）。 */
export function mayDoneLine(action: MayAction, names: readonly string[]): string | undefined {
  const { done } = MAY_WORDING[action]
  const subject = namesOf(names)
  return done === undefined || subject === undefined ? undefined : `${subject}を${done}`
}

/** 「いいえ」の時のログの行。対象の名前が無ければ、`undefined`（行を出力しない）。 */
export function maySkippedLine(action: MayAction, names: readonly string[]): string | undefined {
  const wording: MayWording = MAY_WORDING[action]
  if (wording.untargeted === true) return wording.skipped

  const subject = namesOf(names)
  return subject === undefined ? undefined : `${subject}を${wording.skipped}`
}
