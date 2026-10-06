/**
 * 対戦画面の盤面をキーボードで操作する（Issue #251、ADR-0033）。
 *
 * 盤面は区画に分け、Tab は区画ごとに 1 回だけ止まる。区画の中は矢印キーで移る
 * （ロービング tabindex: 区画の中で `tabIndex=0` を持つのは 1 つだけで、残りは `-1`）。
 * カードやスクエアの要素は描き直すたびに作り直されるので、手を置いていた先は印
 * （`BoardFocus`）で覚えておき、描き直したあとに戻す。
 */

/** 盤面の区画。Tab で止まる順に並べる。 */
export const REGIONS = ['opp', 'battle', 'own', 'hand'] as const
export type Region = (typeof REGIONS)[number]

/** 区画の目印を付ける要素の `data-region`。 */
export const REGION_ATTRIBUTE = 'region'

/** バトルスペース以外の区画で、矢印キーで移る先になるもの。外側のものだけを数える。 */
const ITEM =
  '.pile--開ける, .pile--押せる, .zone--置き先, .card[data-card-id], .card--back.card--押せる'
/** バトルスペースで、矢印キーで移る先になるもの。 */
const SQUARE = '.square'
/** いま押せるもの。区画に入ったときの手の置き先に選ぶ。 */
const PRESSABLE = '.card--押せる, .square--置き先, .zone--置き先, .pile--押せる'

/** 手を置いていた先の印。描き直したあとに、同じ要素へ手を戻すために使う。 */
export interface BoardFocus {
  /** 区画の名前。区画の中に手を置ける先が無くて盤面の入れ物に置いていたときは `center`。 */
  readonly region: Region | 'center'
  readonly key: string
}

/** 矢印キーなどで動く先。動かないときは `undefined`（端で止まる）。 */
export function linearTarget(count: number, from: number, key: string): number | undefined {
  if (count === 0) return undefined
  const last = count - 1
  let to: number
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowUp':
      to = from - 1
      break
    case 'ArrowRight':
    case 'ArrowDown':
      to = from + 1
      break
    case 'Home':
      to = 0
      break
    case 'End':
      to = last
      break
    default:
      return undefined
  }
  if (to < 0 || to > last || to === from) return undefined

  return to
}

/** 格子の上で動く先。画面で見える向きのまま上下左右に隣のセルへ移る。 */
export function gridTarget(
  cells: readonly { readonly row: number; readonly col: number }[],
  from: number,
  key: string,
): number | undefined {
  const origin = cells[from]
  if (origin === undefined) return undefined
  if (key === 'Home') return from === 0 ? undefined : 0
  if (key === 'End') return from === cells.length - 1 ? undefined : cells.length - 1

  const step = (
    { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] } as Record<string, [number, number]>
  )[key]
  if (step === undefined) return undefined
  const found = cells.findIndex((cell) => cell.row === origin.row + step[0] && cell.col === origin.col + step[1])

  return found < 0 ? undefined : found
}

interface Wired {
  readonly items: ReadonlyMap<Region, readonly HTMLElement[]>
  readonly center: HTMLElement
}

const wiredBy = new WeakMap<HTMLElement, Wired>()

const isElement = (target: EventTarget | null): target is HTMLElement => target instanceof HTMLElement

function isPressable(item: HTMLElement): boolean {
  return item.matches(PRESSABLE) || item.querySelector(PRESSABLE) !== null
}

function byDocumentOrder(a: HTMLElement, b: HTMLElement): number {
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
}

function itemsOf(root: HTMLElement, region: Region): HTMLElement[] {
  const selector = region === 'battle' ? SQUARE : ITEM
  const found = new Set<HTMLElement>()
  for (const holder of root.querySelectorAll<HTMLElement>(`[data-${REGION_ATTRIBUTE}="${region}"]`)) {
    if (holder.matches(selector)) found.add(holder)
    for (const node of holder.querySelectorAll<HTMLElement>(selector)) found.add(node)
  }

  // 入れ子になっているものは、外側だけを矢印キーで移る先にする（束の一番上のカードなど）。
  return [...found].filter((node) => node.parentElement?.closest(selector) == null).sort(byDocumentOrder)
}

function keyOf(item: HTMLElement, index: number): string {
  if (item.dataset.cardId !== undefined) return `c:${item.dataset.cardId}`
  if (item.dataset.screenRow !== undefined) return `s:${item.dataset.screenRow}-${item.dataset.screenColumn}`

  return `i:${index}`
}

function makeCurrent(items: readonly HTMLElement[], current: HTMLElement): void {
  for (const item of items) item.tabIndex = item === current ? 0 : -1
}

/** 区画に入ったときに手を置く先。押せるものがあれば先頭のそれ、無ければ先頭。 */
function entranceOf(items: readonly HTMLElement[]): HTMLElement | undefined {
  return items.find(isPressable) ?? items[0]
}

/** スクエアの中にいる、押せるユニット。 */
function pressableUnitsIn(square: HTMLElement): HTMLElement[] {
  return [...square.querySelectorAll<HTMLElement>('.card--押せる')].filter((card) => card.closest('.square') === square)
}

function activate(target: HTMLElement): void {
  if (target.classList.contains('square')) {
    if (target.classList.contains('square--置き先')) {
      target.click()
      return
    }
    const units = pressableUnitsIn(target)
    const only = units[0]
    if (units.length === 1 && only !== undefined) only.click()
    // 押せるユニットが 2 体以上いるときは、どちらを押すのかをここでは決められない。スクエアの中へ入る。
    else if (only !== undefined) only.focus()
    return
  }
  if (target.classList.contains('card--押せる')) target.click()
}

/**
 * 盤面の要素にキーボードの操作を配線する。`duel` は対戦画面の根（`.duel`）で、組み終えたあとに呼ぶ。
 * 区画に入る要素は `data-region` で目印を付けておく（`render.ts` の `boardGridElement`）。
 */
export function wireBoardKeyboard(duel: HTMLElement): void {
  // まず、区画の中のものはすべて Tab の止まる先から外す。止まる先は、区画ごとの現在の 1 つだけにする。
  for (const holder of duel.querySelectorAll(`[data-${REGION_ATTRIBUTE}]`)) {
    for (const node of holder.querySelectorAll('[tabindex]')) node.setAttribute('tabindex', '-1')
    if (holder.hasAttribute('tabindex')) holder.setAttribute('tabindex', '-1')
  }

  const items = new Map<Region, readonly HTMLElement[]>()
  for (const region of REGIONS) {
    const each = itemsOf(duel, region)
    items.set(region, each)
    const entrance = entranceOf(each)
    if (entrance !== undefined) makeCurrent(each, entrance)
  }

  // 盤面の入れ物。区画の中に手を置ける先が無いときの、最後の戻し先。
  const center = duel.querySelector<HTMLElement>('.duel__center')
  if (center === null) return
  wiredBy.set(duel, { items, center })

  // スクエアにフォーカスしたら、そこにいるユニットの詳細を右の列に出す（カードの詳細の配線を借りる）。
  for (const square of items.get('battle') ?? []) {
    const unit = square.querySelector<HTMLElement>('.card[data-card-id]')
    if (unit === null) continue
    square.addEventListener('focus', () => unit.dispatchEvent(new Event('focus')))
    square.addEventListener('blur', () => unit.dispatchEvent(new Event('blur')))
  }

  duel.addEventListener('keydown', (event) => {
    const target = event.target
    if (!isElement(target) || event.altKey || event.ctrlKey || event.metaKey) return
    // ダイアログ・一覧の中のものは、それぞれが自分で扱う。
    if (target.closest('.picker, .dialog') !== null) return

    const activates = event.key === 'Enter' || event.key === ' '

    // 2 体以上の押せるユニットがいるスクエアの中。左右でユニットを移り、Esc でスクエアへ戻る。
    const inside = target.parentElement?.closest<HTMLElement>('.square') ?? null
    if (inside !== null && target.classList.contains('card--押せる') && target.parentElement === inside) {
      const units = pressableUnitsIn(inside)
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        inside.focus()
        return
      }
      if (activates) {
        event.preventDefault()
        target.click()
        return
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const to = linearTarget(units.length, units.indexOf(target), event.key)
        if (to !== undefined) units[to]?.focus()
      }
      return
    }

    const region = REGIONS.find((name) => items.get(name)?.includes(target))
    if (region !== undefined) {
      const list = items.get(region) ?? []
      const from = list.indexOf(target)
      const to =
        region === 'battle'
          ? gridTarget(
              list.map((square) => ({ row: Number(square.dataset.screenRow), col: Number(square.dataset.screenColumn) })),
              from,
              event.key,
            )
          : linearTarget(list.length, from, event.key)
      const next = to === undefined ? undefined : list[to]
      const handled = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
      if (handled) {
        // 端では動かない。ただし、ページを動かさないよう、矢印は受けたままにする。
        event.preventDefault()
        if (next !== undefined) {
          makeCurrent(list, next)
          next.focus()
        }
        return
      }
    }

    // 束・トラップゾーン・山札は自分で Enter・Space を受けている。カードとスクエアだけをここで押す。
    if (activates && (target.classList.contains('card') || target.classList.contains('square'))) {
      event.preventDefault()
      activate(target)
    }
  })
}

/** 手が盤面の区画の中にあれば、その印。 */
export function boardFocusOf(duel: HTMLElement | null): BoardFocus | undefined {
  if (duel === null) return undefined
  const wired = wiredBy.get(duel)
  const active = document.activeElement
  if (wired === undefined || !isElement(active)) return undefined
  if (active === wired.center) return { region: 'center', key: '' }

  // スクエアの中のユニットに手があるときは、そのスクエアを覚える。
  const target = active.closest<HTMLElement>('.square') ?? active
  for (const region of REGIONS) {
    const list = wired.items.get(region) ?? []
    const index = list.indexOf(target)
    if (index >= 0) return { region, key: keyOf(target, index) }
  }

  return undefined
}

/** 印の要素に手を戻す。見つからなければ `false`。 */
export function restoreBoardFocus(duel: HTMLElement, focus: BoardFocus): boolean {
  const wired = wiredBy.get(duel)
  if (focus.region === 'center') {
    wired?.center.focus()
    return wired !== undefined
  }
  const list = wired?.items.get(focus.region) ?? []
  const index = list.findIndex((item, at) => keyOf(item, at) === focus.key)
  const found = list[index]
  if (found === undefined) return false

  makeCurrent(list, found)
  found.focus()

  return true
}

/** 区画の入口（押せるものの先頭）に手を置く。区画に何も無ければ、次の区画へ送る。 */
export function focusRegionEntrance(duel: HTMLElement, region: Region | 'center'): boolean {
  const wired = wiredBy.get(duel)
  if (wired === undefined) return false
  const start = region === 'center' ? 0 : REGIONS.indexOf(region)
  for (const name of [...REGIONS.slice(start), ...REGIONS.slice(0, start)]) {
    const entrance = entranceOf(wired.items.get(name) ?? [])
    if (entrance === undefined) continue
    entrance.focus()
    return true
  }
  wired.center.focus()

  return false
}

/** いま押せるもののうち、区画の順で先頭のものに手を置く。無ければ盤面の入れ物に置く。 */
export function focusFirstPressable(duel: HTMLElement): void {
  const wired = wiredBy.get(duel)
  if (wired === undefined) return
  for (const region of REGIONS) {
    const found = (wired.items.get(region) ?? []).find(isPressable)
    if (found === undefined) continue
    makeCurrent(wired.items.get(region) ?? [], found)
    found.focus()
    return
  }
  wired.center.focus()
}
