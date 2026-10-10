import { describe, expect, it } from 'vitest'
import { INITIAL_FOCUS_ATTRIBUTE, INITIAL_FOCUS_SELECTORS } from './dialog-focus.js'

/**
 * ダイアログを開いた直後に、最初に手を置く先を探す順（ADR-0033）。
 *
 * 要素に手を置くところは DOM が要るので、ここで確かめるのは探す順だけ。印を付けたボタンを先に探し、
 * 印の無い既存のダイアログは、今までの順（手のボタン、次に止まる先）のままであること。
 */
describe('最初に手を置く先を探す順', () => {
  it('印を付けた先が一番先で、その後ろは今までの順', () => {
    expect(INITIAL_FOCUS_SELECTORS).toEqual([
      `[${INITIAL_FOCUS_ATTRIBUTE}]:not(:disabled)`,
      '.dialog__actions button, .dialog__row .button--primary',
      '[tabindex]:not([role="dialog"]), button:not([disabled])',
    ])
  })

  it('印は、押せなくなったボタンには効かない（送ったあとの描き直しで、無効なボタンに手を置かない）', () => {
    expect(INITIAL_FOCUS_SELECTORS[0]).toContain(':not(:disabled)')
  })
})
