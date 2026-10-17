import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 見せる一覧（山札を読んで選ぶ一覧、相手の手札の確認。ADR-0041・ADR-0042）のスクロールした位置が、
 * カードを押して描き直した後も保たれること。
 *
 * 位置を戻す仕組み（`index.ts` の `restoreScroll`）は、印（`render.ts` の `KEEP_SCROLL`）の付いた
 * 要素だけを引き継ぐ。ここは DOM が無い環境で動くので、描いた結果は見られない。確かめるのは、
 * 見せる一覧の組み立てが、スクロールする枠に印を付けていることだけである。
 */
describe('見せる一覧のスクロールした位置', () => {
  const source = readFileSync(new URL('./render.ts', import.meta.url), 'utf8')
  const start = source.indexOf('export function shownPickerElement(')
  const body = source.slice(start, source.indexOf('\n}\n', start))

  it('スクロールする枠（カードの並び）に、位置を引き継ぐ印を付けている', () => {
    expect(body).toMatch(/querySelector<HTMLElement>\('\.picker__cards'\)/)
    expect(body).toMatch(/dataset\[KEEP_SCROLL\]/)
  })
})
