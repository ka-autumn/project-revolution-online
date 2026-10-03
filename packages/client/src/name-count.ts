/** 表示名として受け取る長さの上限（`server` の `name.ts` の `NAME_LIMIT` と同じ）。 */
export const DISPLAY_NAME_LIMIT = 20

/** 打ち込んだ名前の数え方の結果。 */
export interface NameCount {
  readonly length: number
  /** 上限に届いているか。 */
  readonly full: boolean
}

/**
 * 名前の文字数を、サーバと同じ読み方で数える（`server` の `name.ts`）。
 *
 * 組み合わせ文字は 1 つにまとめ（NFC）、前後の空白は数えない。1 文字ずつ数えるので、絵文字は 1 字である。
 * ここで数えるのは目安で、通るかどうかを決めるのはサーバである（ADR-0010）。
 */
export function countName(value: string): NameCount {
  const length = [...value.normalize('NFC').trim()].length

  return { length, full: length >= DISPLAY_NAME_LIMIT }
}
