import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * カードを選ぶ一覧の足もとに、何枚目かを出すのは `series` がある選択（N 枚をまとめて選ぶ一覧）だけであること
 * （ADR-0055）。
 *
 * `series` が無い選択で数えられるのは、この行動の中で続けて答えた数（`WireChoice.answered`）にすぎず、
 * コストのエネルギーを選んだ答えも含むので、実際の枚数とずれる（#347）。ここは DOM が無い環境で動くので、
 * 描いた結果は見られない。確認するのは、次の 3 つの関数の本体が、何枚目かの文を作っているかどうかだけである。
 * ほかの関数から足もとへ数を足し直しても、このテストでは捕まらない。
 */
describe('カードを選ぶ一覧の足もとの枚数', () => {
  const source = readFileSync(new URL('./render.ts', import.meta.url), 'utf8')
  const bodyOf = (signature: string): string => {
    const start = source.indexOf(signature)
    // 関数の名前を変えた時に、何も見ないまま通ってしまわないよう、見つからなければ失敗させる。
    if (start < 0) throw new Error(`${signature} が render.ts に無い`)

    return source.slice(start, source.indexOf('\n}\n', start))
  }

  it('series が無い選択の一覧（カード・見せる一覧）は、何枚目を選んでいるかを出さない', () => {
    for (const signature of ['export function choosePickerElement(', 'export function shownPickerElement(']) {
      const body = bodyOf(signature)

      expect(body, signature).not.toContain('枚目を選んでいます')
      expect(body, signature).not.toContain('picker__count')
    }
  })

  it('series が無い選択の一覧は、続けて答えた数を受け取らない', () => {
    for (const signature of ['export function choosePickerElement(', 'export function shownPickerElement(']) {
      const parameters = bodyOf(signature).split('): HTMLElement {')[0]

      expect(parameters, signature).not.toMatch(/answered/)
    }
  })

  it('series がある選択の一覧は、印を付けた数と N 枚を出す', () => {
    const body = bodyOf('export function seriesPickerElement(')

    expect(body).toContain('picker__count')
    expect(body).toMatch(/\/ \$\{count\} 枚/)
  })
})
