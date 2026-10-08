/**
 * スマートフォンのシートの、手の置き場所と外の止め方（ADR-0034）。
 *
 * 画面は描き直すたびに全部作り直される。描き直したあとに呼び、次の 2 つを行う。
 *
 * - シートが開いている間は、シートと暗い背面の外を `inert` にする。Tab とスクリーンリーダーが外へ出ないように
 *   する（`aria-modal` だけでは Tab は止まらない）。作り直した要素に付けるので、閉じれば自然に消える。
 * - 開いた直後は手をシートの中へ、閉じた直後は開いた元の押せるものへ移す。それ以外の描き直しでは動かさない
 *   （シートの中の手は `KEEP_FOCUS` が戻す）。
 */
import { PHONE_BACKDROP, PHONE_OPENER, PHONE_SHEET, type PhonePending } from './phone.js'

const SHEET = `[data-${dashed(PHONE_SHEET)}]`
const OPENER = `[data-${dashed(PHONE_OPENER)}]`

/** `dataset` の名前（camelCase）を、属性の名前（`data-` の後ろ）にする。 */
function dashed(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}

/** シートとその背面だけを残して、同じ画面の残りを操作できなくする。 */
function blockBehind(sheet: HTMLElement): void {
  const screen = sheet.closest<HTMLElement>('.lobby, .deckbuild')
  if (screen === null) return

  let on: HTMLElement = sheet
  while (on !== screen && on.parentElement !== null) {
    for (const sibling of on.parentElement.children) {
      if (sibling !== on && sibling instanceof HTMLElement && !sibling.classList.contains(PHONE_BACKDROP)) sibling.inert = true
    }
    on = on.parentElement
  }
}

/** 開いた直後に手を置く先。選んでいるデッキの行があればそこ、無ければシートそのもの。 */
function firstFocusIn(sheet: HTMLElement): HTMLElement {
  return sheet.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ?? sheet
}

export function settlePhoneFocus(root: HTMLElement, pending: PhonePending | undefined): void {
  const sheet = root.querySelector<HTMLElement>(SHEET)
  if (sheet !== null) blockBehind(sheet)

  if (pending === undefined) return

  if (pending.kind === 'シートの中へ') {
    if (sheet !== null) firstFocusIn(sheet).focus({ preventScroll: true })
    return
  }

  // 開いた元が無くなっていたら（絞り込みで一覧から外れたカードなど）、何もしない。
  const opener = [...root.querySelectorAll<HTMLElement>(OPENER)].find((node) => node.dataset[PHONE_OPENER] === pending.opener)
  opener?.focus({ preventScroll: true })
}
