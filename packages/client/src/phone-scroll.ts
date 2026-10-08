/**
 * スマートフォンのデッキ構築で、ページのスクロールの位置を測る・置き直す（ADR-0034）。
 *
 * 何をいつ覚え、どこへ戻すかを決めるのは `phone.ts`（純粋）。ここは画面を測って値にする側と、描き直したあとに
 * 実際にスクロールさせる側だけを持つ。タブの帯は画面の上に付いて残るので、置き直した先で隠れないよう、
 * その高さの分だけ手前に止める。
 */
import type { PhoneScroll, ScrollSight } from './phone.js'

const TABS = '.deckbuild__tabs'
/** タブの帯の下から、中身の先頭までの隙間（`style.css` の `.deckbuild` の `gap` と同じ 0.5rem）。 */
const GAP_BELOW_TABS = 8

/** いまのページの見え方。タブの帯の上端が画面の上端に届いていれば、上に付いている。 */
export function builderSight(): ScrollSight {
  const tabs = document.querySelector<HTMLElement>(TABS)

  return { top: window.scrollY, stuck: tabs !== null && tabs.getBoundingClientRect().top <= 0.5 }
}

/** 描き直したあとに呼ぶ。置き直す先が画面に無ければ（デッキ構築を出していない）、何もしない。 */
export function settlePhoneScroll(root: HTMLElement, scroll: PhoneScroll | undefined): void {
  if (scroll === undefined) return

  const to = (top: number): void => window.scrollTo({ top: Math.max(0, top), behavior: 'instant' })
  if (scroll.kind === '位置へ') {
    to(scroll.top)
    return
  }

  const tabs = root.querySelector<HTMLElement>(TABS)
  if (tabs === null) return

  const below = tabs.getBoundingClientRect().height + GAP_BELOW_TABS
  const target = root.querySelector<HTMLElement>(scroll.kind === 'タブの帯の下へ' ? '.deckbuild .columns' : '.deckbuild .check')
  if (target === null) return

  to(target.getBoundingClientRect().top + window.scrollY - below)
}
