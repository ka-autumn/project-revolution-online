import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 見せる一覧（山札を読んで選ぶ一覧、相手の手札の確認。ADR-0041・ADR-0042）のスクロールした位置が、
 * カードを押して描き直した後も保たれること。
 *
 * 位置を戻す仕組み（`index.ts` の `restoreScroll`）は、印（`render.ts` の `KEEP_SCROLL`）の付いた
 * 要素だけを引き継ぐ。ここは DOM が無い環境で動くので、描いた結果は見られない。確かめるのは、
 * 見せる一覧の組み立てが、スクロールする枠に印を付けていることと、その枠を共通の部品が作って
 * いることだけである。
 */
describe('見せる一覧のスクロールした位置', () => {
  const source = readFileSync(new URL('./render.ts', import.meta.url), 'utf8')
  const bodyOf = (signature: string): string => {
    const start = source.indexOf(signature)
    return source.slice(start, source.indexOf('\n}\n', start))
  }

  it('スクロールする枠（カードの並び）に、位置を引き継ぐ印を付けている', () => {
    const body = bodyOf('export function shownPickerElement(')

    expect(body).toMatch(/querySelector<HTMLElement>\('\.picker__cards'\)/)
    expect(body).toMatch(/dataset\[KEEP_SCROLL\]/)
  })

  // 見せる一覧の組み立ては、共通の `pickerElement` が作る枠（`.picker__cards`）を探して印を付ける。枠の
  // クラス名が変わると、印は黙って付かなくなるので、枠を作っていることも照らし合わせる。
  it('共通の部品が、スクロールする枠を同じクラス名で作っている', () => {
    expect(bodyOf('function pickerElement(')).toMatch(/element\('div', 'picker__cards'\)/)
  })
})
