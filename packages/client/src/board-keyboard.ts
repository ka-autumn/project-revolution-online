/**
 * 対戦画面の盤面をキーボードで操作する（Issue #251、ADR-0033）。クリックモードのときだけ配線する。
 *
 * 盤面は区画に分け、Tab は区画ごとに 1 回だけ止まる。区画の中は矢印キーで移る
 * （ロービング tabindex: 区画の中で `tabIndex=0` を持つのは 1 つだけで、残りは `-1`）。
 * カードやスクエアの要素は描き直すたびに作り直されるので、手を置いていた先は印
 * （`BoardFocus`）で覚えておき、描き直したあとに戻す。
 */

/**
 * `focus()` に渡す。既定のままだと、手を置いた要素が見えるところまでスクロールが起きる。手札の扇は画面の
 * 端から半分だけ出ているので、盤面の入れ物（`.duel`）が上へずれて、盤面全体が動いてしまう。
 */
export const NO_SCROLL: FocusOptions = { preventScroll: true }

/** 盤面の区画。Tab で止まる順に並べる。 */
export const REGIONS = ['opp', 'battle', 'own', 'hand'] as const
export type Region = (typeof REGIONS)[number]

/** 区画の目印を付ける要素の `data-region`。 */
export const REGION_ATTRIBUTE = 'region'
/** 識別子（カードの `data-card-id`）の無い止まる先に付ける、描き直しをまたいで同じものを見分ける印。 */
export const FOCUS_KEY_ATTRIBUTE = 'focusKey'

/** バトルスペース以外の区画で、矢印キーで移る先になるもの。外側のものだけを数える。 */
const ITEM = '.pile--開ける, .pile--押せる, .zone--置き先, .card[data-card-id], .card--back.card--押せる'
/** バトルスペースで、矢印キーで移る先になるもの。 */
const SQUARE = '.square'
/** いま押せるもの。区画に入ったときの手の置き先に選ぶ。 */
const PRESSABLE = '.card--押せる, .square--置き先, .zone--置き先, .pile--押せる'

/**
 * 手を置いていた先の印。描き直したあとに、同じ要素へ手を戻すために使う。
 *
 * `region` が区画の名前のときは、区画の止まる先（`key` は `keyOf` が決める。スクエアのときは、
 * 中のユニットにいたなら `unit` にその識別子）。そのほかは、区画に入らない要素（ADR-0033）。
 */
export interface BoardFocus {
  readonly region: Region | 'center' | 'partner' | 'button'
  readonly key: string
  readonly unit?: string
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

/** ダイアログ・一覧の層の中か。層の中のものは、それぞれの層が自分で扱う。 */
const inLayer = (node: Element): boolean => node.closest('.picker, .dialog') !== null

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

/**
 * 区画の止まる先を、描き直しをまたいで見分ける印。同じものとみなすのは、次のとおり（ADR-0033）。
 *
 * - 束・山札・トラップゾーン・押せる裏向きのカード: 持ち主と置き場（置き場所）。`render.ts` が付ける。
 * - カード: 識別子。
 * - スクエア: 画面での位置。
 *
 * 並びの位置では覚えない。前に並ぶものの数が変わると、別の要素を指してしまう。
 */
function keyOf(item: HTMLElement, index: number): string {
  const key = item.dataset[FOCUS_KEY_ATTRIBUTE]
  if (key !== undefined) return key
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

/**
 * 押したあと、同じキーの keyup が、そのとき手を置いた先のボタンを押したことにしないようにする。
 * Space は keyup でボタンが押される。keydown でダイアログが開いて手がボタンへ移ると、そのまま
 * 手が送られかねない（ADR-0033）。
 */
function swallowNextKeyup(key: string): void {
  if (key !== ' ') return
  const swallow = (event: KeyboardEvent): void => {
    if (event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    window.removeEventListener('keyup', swallow, true)
  }
  window.addEventListener('keyup', swallow, true)
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
    else if (only !== undefined) only.focus(NO_SCROLL)
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

  // 溢れてスクロールする一覧（バンク・誘発した能力、カードの文字欄）を、ブラウザが Tab の止まる先にしない
  // ようにする。右の列の詳細は、長い文を読むのに要るので外さない（ADR-0033）。
  for (const node of duel.querySelectorAll('.duel__center .waiting__list, .duel__center .card__lines')) {
    node.setAttribute('tabindex', '-1')
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

  const regionOf = (node: Node): Region | undefined =>
    REGIONS.find((name) => items.get(name)?.some((item) => item === node || item.contains(node)))

  // 区画から手が出たら、入口を押せるものの先頭へ置き直す。区画へ入るときは、いつも先頭から始まる。
  duel.addEventListener('focusout', (event) => {
    if (!isElement(event.target)) return
    const region = regionOf(event.target)
    if (region === undefined) return
    const list = items.get(region) ?? []
    const to = event.relatedTarget
    if (to instanceof Node && regionOf(to) === region) return
    const entrance = entranceOf(list)
    if (entrance !== undefined) makeCurrent(list, entrance)
  })

  // 押しっぱなしのキーリピートは受けない。Enter を押しっぱなしにすると、開いたダイアログの
  // 最初の手に、そのまま届いてしまう（ADR-0033）。ボタンの押下は、ダイアログの層が自分で止める。
  duel.addEventListener(
    'keydown',
    (event) => {
      if (!event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return
      if (!isElement(event.target) || event.target instanceof HTMLButtonElement || inLayer(event.target)) return
      event.preventDefault()
      event.stopPropagation()
    },
    true,
  )

  duel.addEventListener('keydown', (event) => {
    const target = event.target
    if (!isElement(target) || event.altKey || event.ctrlKey || event.metaKey) return
    // ダイアログ・一覧の中のものは、それぞれが自分で扱う。
    if (inLayer(target)) return

    const activates = event.key === 'Enter' || event.key === ' '

    // 2 体以上の押せるユニットがいるスクエアの中。左右でユニットを移り、Esc でスクエアへ戻る。
    const inside = target.parentElement?.closest<HTMLElement>('.square') ?? null
    if (inside !== null && target.classList.contains('card--押せる') && target.parentElement === inside) {
      const units = pressableUnitsIn(inside)
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        inside.focus(NO_SCROLL)
        return
      }
      if (activates) {
        event.preventDefault()
        swallowNextKeyup(event.key)
        target.click()
        return
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const to = linearTarget(units.length, units.indexOf(target), event.key)
        if (to !== undefined) units[to]?.focus(NO_SCROLL)
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
          next.focus(NO_SCROLL)
        }
        return
      }
    }

    // 束・トラップゾーン・山札は自分で Enter・Space を受けている。カードとスクエアだけをここで押す。
    // 押せないものでは何も起きない（選びかけを外すのは Esc だけ、ADR-0033）。
    if (activates && (target.classList.contains('card') || target.classList.contains('square'))) {
      event.preventDefault()
      swallowNextKeyup(event.key)
      activate(target)
    }
  })
}

/** 左の列のパートナーのカード。区画には入らないが、フォーカスの覚え先にはする。 */
const PARTNER = '.player__partner .card[data-card-id]'

/** 層の外にあるボタンのうち、その文字のもの。 */
function buttonLabeled(duel: HTMLElement, label: string): HTMLElement | undefined {
  return [...duel.querySelectorAll<HTMLElement>('button')].find((each) => !inLayer(each) && each.textContent === label)
}

/** 手が盤面（区画・盤面の入れ物・パートナー・盤面と左の列のボタン）にあれば、その印。 */
export function boardFocusOf(duel: HTMLElement | null): BoardFocus | undefined {
  if (duel === null) return undefined
  const wired = wiredBy.get(duel)
  const active = document.activeElement
  if (wired === undefined || !isElement(active) || !duel.contains(active) || inLayer(active)) return undefined
  if (active === wired.center) return { region: 'center', key: '' }

  // スクエアの中のユニットに手があるときは、そのスクエアと、ユニットの識別子を覚える。
  const square = active.closest<HTMLElement>('.square')
  const target = square ?? active
  for (const region of REGIONS) {
    const list = wired.items.get(region) ?? []
    const index = list.indexOf(target)
    if (index < 0) continue
    const unit = square !== null && active !== square ? active.dataset.cardId : undefined

    return { region, key: keyOf(target, index), ...(unit === undefined ? {} : { unit }) }
  }

  if (active.matches(PARTNER)) return { region: 'partner', key: active.dataset.cardId ?? '' }
  if (active instanceof HTMLButtonElement) return { region: 'button', key: active.textContent ?? '' }

  return undefined
}

/** 印の要素に手を戻す。見つからなければ `false`。 */
export function restoreBoardFocus(duel: HTMLElement, focus: BoardFocus): boolean {
  const wired = wiredBy.get(duel)
  if (wired === undefined) return false

  if (focus.region === 'center') {
    wired.center.focus(NO_SCROLL)
    return true
  }
  if (focus.region === 'partner') {
    const found = [...duel.querySelectorAll<HTMLElement>(PARTNER)].find((each) => each.dataset.cardId === focus.key)
    found?.focus(NO_SCROLL)
    return found !== undefined
  }
  if (focus.region === 'button') {
    const found = buttonLabeled(duel, focus.key)
    found?.focus(NO_SCROLL)
    return found !== undefined
  }

  const list = wired.items.get(focus.region) ?? []
  const found = list.find((item, at) => keyOf(item, at) === focus.key)
  if (found === undefined) return false

  makeCurrent(list, found)
  found.focus(NO_SCROLL)
  // 2 体のユニットがいたスクエアの中にいたなら、同じユニットがまだ押せる状態でいれば、そこへ戻す。
  if (focus.unit !== undefined) {
    const units = pressableUnitsIn(found)
    if (units.length >= 2) units.find((each) => each.dataset.cardId === focus.unit)?.focus(NO_SCROLL)
  }

  return true
}

/**
 * 描き直したあとに、手を戻す。もとの要素が無ければ、区画の入口へ。区画に入らないもの（パートナー・
 * ボタン）が無くなっていたら、押せるものの先頭へ。
 */
export function restoreBoardFocusNearby(duel: HTMLElement, focus: BoardFocus): void {
  if (restoreBoardFocus(duel, focus)) return
  if (focus.region === 'partner' || focus.region === 'button' || focus.region === 'center') focusFirstPressable(duel)
  else focusRegionEntrance(duel, focus.region)
}

/** 区画の入口（押せるものの先頭）に手を置く。区画に何も無ければ、次の区画へ送る。 */
export function focusRegionEntrance(duel: HTMLElement, region: Region): boolean {
  const wired = wiredBy.get(duel)
  if (wired === undefined) return false
  const start = REGIONS.indexOf(region)
  for (const name of [...REGIONS.slice(start), ...REGIONS.slice(0, start)]) {
    const entrance = entranceOf(wired.items.get(name) ?? [])
    if (entrance === undefined) continue
    entrance.focus(NO_SCROLL)
    return true
  }
  wired.center.focus(NO_SCROLL)

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
    found.focus(NO_SCROLL)
    return
  }
  wired.center.focus(NO_SCROLL)
}
