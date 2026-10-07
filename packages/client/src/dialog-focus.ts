/**
 * 対戦画面のダイアログ（行える手の選択・カードの一覧・能力の一覧）と盤面の手の置き場所を、
 * 描き直しのあいだ受け渡す（Issue #251、ADR-0033）。
 *
 * 画面は描き直すたびに全部作り直される。手を置く先は、描き直す前に印を取り（`focusBefore`）、
 * 描き直したあとに戻す（`settleFocus`）。ダイアログは、開いたときの 1 回だけ中へ手を移し、
 * 開いている間は一番上の層以外を `inert` にして外へ出させず、閉じたら元の押せるものへ戻す。
 *
 * 手の置き直しは、直前の操作がキーボードのときだけ行う。マウスで操作している人に、描き直しのたびに
 * 手を置き直すと、フォーカスに連動して差し替わる右の列の詳細が、乗せていないカードに替わる。
 */
import {
  type BoardFocus,
  NO_SCROLL,
  boardFocusOf,
  focusFirstPressable,
  restoreBoardFocus,
  restoreBoardFocusNearby,
} from './board-keyboard.js'

/** ダイアログの層。行える手を聞くもの（`.dialog`）と、カードの一覧（`.picker`）。 */
const LAYERS = ':scope > .dialog, :scope > .picker'
/** ダイアログの中で手を置ける先。手を置ける箱（`role="dialog"`）自身は含めない。 */
const FOCUSABLE = 'button, [tabindex]:not([role="dialog"])'
/** 描き直しても右の列は動かせるままにする（カードの詳細、ADR-0027）。 */
const STAYS = '.duel__right'
/** 層に付ける、開いたダイアログを見分ける印の属性（`markDialog`）。 */
const DIALOG_ID = 'dialogId'

/* ---------- 直前の操作 ---------- */

let lastInput: 'キーボード' | 'ポインタ' = 'ポインタ'

if (typeof window !== 'undefined') {
  // 捕捉段で受ける。途中の処理が伝わりを止めても、見落とさない。
  window.addEventListener('keydown', () => (lastInput = 'キーボード'), true)
  window.addEventListener('pointerdown', () => (lastInput = 'ポインタ'), true)
}

/* ---------- ダイアログの見分け ---------- */

const identities = new WeakMap<object, string>()
let issued = 0

/**
 * 層に、開いた単位の印を付ける。`source` は、そのダイアログが開いている間は同じ参照で、別の
 * ダイアログに替わると別の参照になるもの（開いている「見る」一覧の状態、届いた選択、選びかけ）。
 * 見出しやボタンの文字では見分けない。続けて届いた選択の一覧は、文字が同じになりうる。
 */
export function markDialog(layer: HTMLElement, source: object): HTMLElement {
  let id = identities.get(source)
  if (id === undefined) {
    id = String(++issued)
    identities.set(source, id)
  }
  layer.dataset[DIALOG_ID] = id

  return layer
}

const idOf = (layer: HTMLElement): string => layer.dataset[DIALOG_ID] ?? layer.className

/* ---------- Esc ---------- */

const escapes = new WeakMap<HTMLElement, () => void>()

/** 層で Esc を押したときの動きを覚えさせる。 */
export function onLayerEscape(layer: HTMLElement, run: () => void): void {
  escapes.set(layer, run)
}

/**
 * Esc を一番上の層へ回す。層が開いていれば `true`（動きが無くても、選びかけの解除には回さない）。
 * 手がどこにあっても（右の列・`body`）同じ結果になる。
 */
export function escapeTopLayer(root: HTMLElement): boolean {
  const layer = layersOf(root.querySelector<HTMLElement>('.duel')).at(-1)
  if (layer === undefined) return false
  escapes.get(layer)?.()

  return true
}

/**
 * キーリピートの Enter・Space を層の中のものに届かせない。押しっぱなしにすると、ダイアログが開いた
 * 直後に最初の手のボタンへ届き、手が送られる。捕捉段で止めて、ボタンの押下も起こさせない。
 */
export function ignoreKeyRepeat(layer: HTMLElement): void {
  layer.addEventListener(
    'keydown',
    (event) => {
      if (!event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return
      event.preventDefault()
      event.stopPropagation()
    },
    true,
  )
}

/* ---------- 層の中の手の置き場所 ---------- */

/** 手を置ける箱。ダイアログの層自身が箱のときと、層の中に箱があるときがある。 */
function holderOf(layer: HTMLElement): HTMLElement {
  return layer.matches('[role="dialog"]') ? layer : (layer.querySelector<HTMLElement>('[role="dialog"]') ?? layer)
}

function focusablesOf(layer: HTMLElement): HTMLElement[] {
  return [...layer.querySelectorAll<HTMLElement>(FOCUSABLE)]
}

/**
 * 層の中の手の置き先を、描き直しをまたいで見分ける印。同じものとみなすのは、次のとおり（ADR-0033）。
 *
 * - ボタン: 文字。
 * - カード（識別子のあるもの）: 識別子。
 * - 能力の札・裏向きの候補など、識別子の無いもの: 識別子の無い止まる先のうちの何番目か。
 *
 * ボタンやカードの並びの位置では覚えない。一覧の枚数が変わると、別の要素を指してしまう。
 */
function keyIn(layer: HTMLElement, node: HTMLElement): string | undefined {
  const list = focusablesOf(layer)
  if (!list.includes(node)) return undefined
  if (node instanceof HTMLButtonElement) return `b:${node.textContent ?? ''}`
  if (hasCardKey(node)) return `c:${node.dataset.cardId}`

  return `n:${list.filter((each) => !(each instanceof HTMLButtonElement) && !hasCardKey(each)).indexOf(node)}`
}

/** 識別子で見分けられる止まる先。能力の札は、同じカードの能力が 2 つ並ぶことがあるので含めない。 */
function hasCardKey(node: HTMLElement): boolean {
  return node.dataset.cardId !== undefined && !node.classList.contains('picker__ability')
}

function findIn(layer: HTMLElement, key: string): HTMLElement | undefined {
  return focusablesOf(layer).find((each) => keyIn(layer, each) === key && !(each instanceof HTMLButtonElement && each.disabled))
}

function focusInLayer(layer: HTMLElement, key: string | undefined): void {
  const found = key === undefined ? undefined : findIn(layer, key)
  if (found !== undefined) found.focus(NO_SCROLL)
  else holderOf(layer).focus(NO_SCROLL)
}

/** ダイアログの中で、最初に手を置く先。 */
function initialFocus(layer: HTMLElement): void {
  const target =
    layer.querySelector<HTMLElement>('.dialog__actions button, .dialog__row .button--primary') ??
    layer.querySelector<HTMLElement>('[tabindex]:not([role="dialog"]), button:not([disabled])') ??
    holderOf(layer)
  target.focus(NO_SCROLL)
}

/* ---------- 描き直しの前後 ---------- */

/** ダイアログを開く直前に手があった先。閉じたときに戻す。 */
type Opener =
  | { readonly kind: '盤面'; readonly focus: BoardFocus }
  | { readonly kind: '層'; readonly id: string; readonly key: string | undefined }

/** 描き直す前の、ダイアログと盤面の手の置き場所。 */
export interface FocusBefore {
  readonly board: BoardFocus | undefined
  /** 開いていた層の印。下から順。 */
  readonly layers: readonly string[]
  /** 一番上の層と、その中で手のあった先の印（`undefined` は箱）。 */
  readonly top: { readonly id: string; readonly key: string | undefined } | undefined
}

/** 層ごとの開いたもと。 */
const openers = new Map<string, Opener>()
/** ダイアログが閉じる理由。「キャンセル」で閉じたときだけ、開いたもとへ戻す。 */
let closing: 'キャンセル' | undefined

/** 次に描き直したときの戻し先を、「キャンセルで閉じた」ものとして覚える。 */
export function closedByCancel(): void {
  closing = 'キャンセル'
}

function layersOf(duel: HTMLElement | null): HTMLElement[] {
  return duel === null ? [] : [...duel.querySelectorAll<HTMLElement>(LAYERS)]
}

/** 描き直す前に呼ぶ。 */
export function focusBefore(root: HTMLElement): FocusBefore {
  const duel = root.querySelector<HTMLElement>('.duel')
  const layers = layersOf(duel)
  const top = layers.at(-1)
  const board = boardFocusOf(duel)
  if (top === undefined) return { board, layers: [], top: undefined }

  const active = document.activeElement
  const key = active instanceof HTMLElement ? keyIn(top, active) : undefined

  return { board, layers: layers.map(idOf), top: { id: idOf(top), key } }
}

/** ダイアログを開いている間、一番上の層と右の列以外を操作できなくする。下に残る層も含む。 */
function blockOutside(duel: HTMLElement, top: HTMLElement): void {
  for (const child of duel.children) {
    if (!(child instanceof HTMLElement)) continue
    child.inert = child !== top && !child.matches(STAYS)
  }
  // 右の列の中のログは、手を置く先に加えない。
  const log = duel.querySelector<HTMLElement>('.log')
  if (log !== null) log.inert = true
}

/** 描き直したあとに呼ぶ。手を置き直し、ダイアログが開いていれば外を操作できなくする。 */
export function settleFocus(root: HTMLElement, before: FocusBefore): void {
  const duel = root.querySelector<HTMLElement>('.duel')
  const reason = closing
  closing = undefined
  if (duel === null) {
    openers.clear()
    return
  }

  const layers = layersOf(duel)
  const top = layers.at(-1)
  const ids = layers.map(idOf)
  const previous = before.top

  if (top !== undefined) {
    blockOutside(duel, top)
    const id = idOf(top)
    if (previous?.id === id) {
      // 同じダイアログの描き直し。手を同じ要素へ戻す。先頭へは戻さない。
      focusInLayer(top, previous.key)
    } else if (before.layers.includes(id)) {
      // 上の層が閉じて、下の層が出てきた。「キャンセル」なら、上の層を開く前の手の位置へ戻す。
      const opener = previous === undefined ? undefined : openers.get(previous.id)
      if (reason === 'キャンセル' && opener?.kind === '層' && opener.id === id) focusInLayer(top, opener.key)
      else initialFocus(top)
    } else {
      // 新しい層。手のあった先（盤面、下の層、閉じた層の開いたもと）を、閉じたときの戻し先にする。
      const opener: Opener | undefined =
        previous === undefined
          ? before.board === undefined
            ? undefined
            : { kind: '盤面', focus: before.board }
          : ids.includes(previous.id)
            ? { kind: '層', id: previous.id, key: previous.key }
            : openers.get(previous.id)
      if (opener !== undefined) openers.set(id, opener)
      initialFocus(top)
    }
    for (const key of [...openers.keys()]) if (!ids.includes(key)) openers.delete(key)
    return
  }

  // ダイアログが開いていない。
  const opener = previous === undefined ? undefined : openers.get(previous.id)
  openers.clear()
  // マウスで操作している間は、手を置き直さない（上のコメント）。
  if (lastInput !== 'キーボード') return

  if (previous !== undefined) {
    // いま閉じた。「キャンセル」なら開いたもとへ。もとが無くなっていたら、押せるものの先頭へ。
    if (reason === 'キャンセル' && opener?.kind === '盤面' && restoreBoardFocus(duel, opener.focus)) return
    focusFirstPressable(duel)
    return
  }

  if (before.board !== undefined) restoreBoardFocusNearby(duel, before.board)
}
