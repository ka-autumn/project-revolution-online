/**
 * 対戦画面のダイアログ（行える手の選択・カードの一覧・能力の一覧）と盤面の手の置き場所を、
 * 描き直しのあいだ受け渡す（Issue #251、ADR-0033）。
 *
 * 画面は描き直すたびに全部作り直される。手を置く先は、描き直す前に印を取っておき（`focusBefore`）、
 * 描き直したあとに戻す（`settleFocus`）。ダイアログは、開いたときの 1 回だけ中へ手を移し、
 * 開いている間は外を `inert` にして外へ出させず、閉じたら元の押せるものへ戻す。
 */
import {
  type BoardFocus,
  boardFocusOf,
  focusFirstPressable,
  focusRegionEntrance,
  restoreBoardFocus,
} from './board-keyboard.js'

/** ダイアログの層。行える手を聞くもの（`.dialog`）と、カードの一覧（`.picker`）。 */
const LAYERS = ':scope > .dialog, :scope > .picker'
/** ダイアログの中で手を置ける先。手を置ける箱（`role="dialog"`）自身は含めない。 */
const FOCUSABLE = 'button, [tabindex]:not([role="dialog"])'
/** 描き直しても右の列は動かせるままにする（カードの詳細、ADR-0027）。 */
const STAYS = '.duel__right'

/** 描き直す前の、ダイアログと盤面の手の置き場所。 */
export interface FocusBefore {
  readonly board: BoardFocus | undefined
  readonly dialog: { readonly key: string; readonly index: number } | undefined
}

/** 開いたもとの要素。ダイアログを開いている間だけ持つ。 */
let opener: BoardFocus | undefined
/** ダイアログが閉じる理由。「キャンセル」で閉じたときだけ、開いたもとへ戻す。 */
let closing: 'キャンセル' | undefined

/** 次に描き直したときの戻し先を、「キャンセルで閉じた」ものとして覚える。 */
export function closedByCancel(): void {
  closing = 'キャンセル'
}

/** 手を置ける箱。ダイアログの層自身が箱のときと、層の中に箱があるときがある。 */
function holderOf(layer: HTMLElement): HTMLElement {
  return layer.matches('[role="dialog"]') ? layer : (layer.querySelector<HTMLElement>('[role="dialog"]') ?? layer)
}

/** 同じダイアログかどうかを見分ける印。見出しとボタンの名前で決める。 */
function dialogKeyOf(layer: HTMLElement): string {
  const title = layer.querySelector('h2')?.textContent ?? ''
  const buttons = [...layer.querySelectorAll('button')].map((each) => each.textContent ?? '').join('/')

  return `${layer.className}|${title}|${buttons}`
}

function focusablesOf(layer: HTMLElement): HTMLElement[] {
  return [...layer.querySelectorAll<HTMLElement>(FOCUSABLE)]
}

function layerOf(duel: HTMLElement | null): HTMLElement | undefined {
  if (duel === null) return undefined

  return [...duel.querySelectorAll<HTMLElement>(LAYERS)].at(-1)
}

/** 描き直す前に呼ぶ。 */
export function focusBefore(root: HTMLElement): FocusBefore {
  const duel = root.querySelector<HTMLElement>('.duel')
  const layer = layerOf(duel)
  if (layer === undefined) return { board: boardFocusOf(duel), dialog: undefined }

  const active = document.activeElement
  const index = active === holderOf(layer) ? -1 : focusablesOf(layer).findIndex((each) => each === active)

  return { board: boardFocusOf(duel), dialog: { key: dialogKeyOf(layer), index } }
}

/** ダイアログを開いている間、その外を操作できなくする。右の列だけは残す。 */
function blockOutside(duel: HTMLElement, layers: readonly HTMLElement[]): void {
  for (const child of duel.children) {
    if (!(child instanceof HTMLElement)) continue
    child.inert = !layers.includes(child) && !child.matches(STAYS)
  }
  // 右の列の中のログは、手を置く先に加えない。
  const log = duel.querySelector<HTMLElement>('.log')
  if (log !== null) log.inert = true
}

/** ダイアログの中で、最初に手を置く先。 */
function initialFocus(layer: HTMLElement): void {
  const target =
    layer.querySelector<HTMLElement>('.dialog__actions button, .dialog__row .button--primary') ??
    layer.querySelector<HTMLElement>('[tabindex]:not([role="dialog"]), button:not([disabled])') ??
    holderOf(layer)
  target.focus()
}

/** 描き直したあとに呼ぶ。手を置き直し、ダイアログが開いていれば外を操作できなくする。 */
export function settleFocus(root: HTMLElement, before: FocusBefore): void {
  const duel = root.querySelector<HTMLElement>('.duel')
  if (duel === null) {
    opener = undefined
    closing = undefined
    return
  }
  const reason = closing
  closing = undefined

  const layers = [...duel.querySelectorAll<HTMLElement>(LAYERS)]
  const layer = layers.at(-1)

  if (layer !== undefined) {
    blockOutside(duel, layers)
    const was = before.dialog
    if (was === undefined) {
      // 開いたとき。手は、押したもの（盤面の要素）にあった。閉じたらそこへ戻す。
      opener = before.board
      initialFocus(layer)
    } else if (was.key === dialogKeyOf(layer)) {
      // 描き直しただけ。手を同じ位置の要素へ戻す。先頭へは戻さない。
      const again = was.index >= 0 ? focusablesOf(layer)[was.index] : undefined
      if (again !== undefined && !(again instanceof HTMLButtonElement && again.disabled)) again.focus()
      else holderOf(layer).focus()
    } else {
      initialFocus(layer)
    }
    return
  }

  // ダイアログが開いていない。
  if (before.dialog !== undefined) {
    // いま閉じた。「キャンセル」なら開いたもとへ。もとが無くなっていたら、押せるものの先頭へ。
    const back = reason === 'キャンセル' ? opener : undefined
    opener = undefined
    if (back !== undefined && restoreBoardFocus(duel, back)) return
    focusFirstPressable(duel)
    return
  }

  opener = undefined
  if (before.board !== undefined && !restoreBoardFocus(duel, before.board)) {
    focusRegionEntrance(duel, before.board.region)
  }
}
