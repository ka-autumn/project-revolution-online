/**
 * スマートフォンの対戦画面で、盤面を画面に合わせて縮める（ADR-0034）。
 *
 * 盤面は PC の形のまま縮める。縮める率は、画面の幅と、盤面のほかの段を残した高さの、小さいほうに合わせる。
 * CSS だけでは「長さ ÷ 長さ」を割り出せないので、描いたあとに測って `--board-zoom` に置く。高さは、いま見えている
 * 高さ（ブラウザのアドレスバーが出入りすれば変わる。`window.visualViewport`）で測り、変わるたびに測り直す。
 *
 * 操作の帯は画面の下端に固定する（`style.css` の `.controls`）。段の高さの測り方には頼らず、上の段は、帯の高さぶんの
 * 余白（`--controls-height`）を下に取る。上の段が収まらないときは、`.duel` だけが縦に送られ、帯は動かない。
 * 捨札・リムーブの引き出しのつまみ（`.duel` の中の絶対配置）と、行き先を選んでいる間の帯（`.peek`、画面に固定）も、
 * 測った位置に合わせる。
 */
import { peekCardWidth, peekMaxHeight } from './phone-peek.js'

/** 盤面の自然な幅。`style.css` の `.duel .board` の列（6rem・1.8rem・10.5rem×3・6rem）と列の間（0.4rem×5）の合計。 */
export const BOARD_NATURAL_WIDTH_REM = 47.3

/**
 * 外枠の段の数と、盤面・自分の手札の段の位置。`style.css` の `.duel` の `grid-template-rows` に合わせる。
 * 操作の帯は画面に固定するので、段には数えない。
 */
export const DUEL_ROWS = 6
export const BOARD_ROW = 3
export const HAND_ROW = 4

/** 自分の手札の段の最低の高さ（rem）。`style.css` の `minmax(3.2rem, 1fr)`。手札は上半分だけを出す。 */
export const HAND_MIN_REM = 3.2

/** 段の高さが測れないときに、盤面のほかの段と余白（操作の帯の余白を除く）に残す高さ（rem）。 */
export const FALLBACK_RESERVED_REM = 14

/** 操作の帯の高さが測れず、前に測った値も無いときに、帯の分として空けておく高さ（rem）。 */
export const FALLBACK_CONTROLS_REM = 4.8

/** 画面の横に残す余白（px）。 */
const SIDE_MARGIN_PX = 16

/** 縮める率の下限。画面が極端に低いときでも、盤面を消さない。 */
export const MIN_ZOOM = 0.1

/** 盤面のほかの段の高さを測るときの、盤面を縮める率。どの画面でも外枠に収まる小ささにする。 */
const MEASURE_ZOOM = MIN_ZOOM

/** 高さに合わせて縮め直す回数の上限。 */
const FIT_STEPS = 5

/** いま見えている高さの測り方に使う、`window.visualViewport` の一部。 */
export interface VisibleViewport {
  readonly height: number
  /** ピンチで拡大していれば 1 を超える。 */
  readonly scale: number
}

/**
 * いま見えている高さ（レイアウトの px）。アドレスバーが出ていれば、その分だけ低い。`visualViewport` が無い
 * ブラウザ（または測れない値）では `innerHeight`。ピンチで拡大している間は、見えている範囲が狭くなるだけなので、
 * 拡大の率を掛け戻して、盤面を縮めすぎないようにする。
 */
export function visibleHeight(viewport: VisibleViewport | undefined, innerHeight: number): number {
  if (viewport === undefined || !(viewport.height > 0)) return innerHeight

  return viewport.height * (viewport.scale > 0 ? viewport.scale : 1)
}

/**
 * 操作の帯の分として、上の段の下に空ける高さ（px）。いま測れた高さを使い、シートが開いていて帯が測れない間は
 * 前に測った高さ、どちらも無ければ決め打ちの高さ。帯の高さが変わる（選択中で高くなる、など）たびに、上の段の余白が
 * 追随する。
 */
export function controlsReserve(measured: number | undefined, remembered: number | undefined, rem: number): number {
  if (measured !== undefined && measured > 0) return measured
  if (remembered !== undefined && remembered > 0) return remembered

  return FALLBACK_CONTROLS_REM * rem
}

/**
 * 盤面のほかの段と、段の間・外枠の余白に残す高さ（px）。盤面の段は含めず、自分の手札の段は最低の高さで数える
 * （手札の段は残りの高さを受け持つので、いまの高さは当てにならない）。`padding` は外枠の上下の余白で、下の余白には
 * 操作の帯の分（`controlsReserve`）が入っている。段の数が合わなければ `undefined`。
 */
export function reservedHeight(rows: readonly number[], rowGap: number, padding: number, rem: number): number | undefined {
  if (rows.length !== DUEL_ROWS || rows.some((height) => !Number.isFinite(height))) return undefined

  const fixed = rows.reduce((sum, height, at) => (at === BOARD_ROW ? sum : sum + (at === HAND_ROW ? HAND_MIN_REM * rem : height)), 0)

  return fixed + rowGap * (rows.length - 1) + padding
}

/** 盤面に使える高さ（px）。見えている高さから、ほかの段と余白を引く。 */
export function boardAvailableHeight(visible: number, reserved: number): number {
  return visible - reserved
}

/** 画面の幅に収まる縮める率。1 を超えて拡大はしない。 */
export function widthZoom(width: number, rem: number): number {
  return Math.min(1, (width - SIDE_MARGIN_PX) / (BOARD_NATURAL_WIDTH_REM * rem))
}

/**
 * 盤面が `available`（px）の高さに収まるまで、縮める率を縮め直す。
 *
 * 縮めた高さは、縮める率に比例しない（ブラウザが文字の大きさに下限を持つので、小さくするほど相対的に
 * 高くなる）。そのため、割り出した率で測り直し、まだ収まらなければ、測った高さから率を割り出し直す。
 * `heightAt` は、その率に縮めたときの盤面の高さ（px）を測って返す。
 */
export function fittedZoom(first: number, available: number, heightAt: (zoom: number) => number): number {
  let zoom = Math.max(first, MIN_ZOOM)
  for (let step = 0; step < FIT_STEPS; step++) {
    const height = heightAt(zoom)
    if (height <= available || height <= 0 || zoom <= MIN_ZOOM) break

    zoom = Math.max(zoom * (available / height), MIN_ZOOM)
  }

  return zoom
}

/** 引き出しのつまみの上端。段の高さの真ん中に、つまみの真ん中を合わせる。 */
export function drawerTop(strip: { readonly top: number; readonly height: number }, drawerHeight: number): number {
  return strip.top + strip.height / 2 - drawerHeight / 2
}

/**
 * 画面の座標で測った段の上端を、`.duel` の中身の座標（送られた分を足した、上端からの位置）にする。
 * つまみは `.duel` の中の絶対配置なので、`.duel` が縦に送られても段に付いてくる。
 */
export function topInContent(stripTop: number, containerTop: number, scrollTop: number): number {
  return stripTop - containerTop + scrollTop
}

/** 前に測れた操作の帯の高さ。シートが開いて帯が操作パネルそのものになっている間の、余白の目安にする。 */
let rememberedControls: number | undefined

/** 盤面の縮めと引き出しの縦の位置、行き先を選ぶ帯の大きさを、いまの画面の大きさに合わせる。スマートフォンの並べ方でなければ呼ばない。 */
export function settlePhoneBoard(root: HTMLElement): void {
  const duel = root.querySelector<HTMLElement>('.duel')
  const board = duel?.querySelector<HTMLElement>('.board')
  if (duel === null || duel === undefined || board === null || board === undefined) return

  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)

  // 操作の帯の高さ。帯が操作パネルそのもののシートになっている間は、帯ではなくシートの高さなので測らない。
  const controls = duel.querySelector<HTMLElement>('.controls')
  const asSheet = controls?.classList.contains('phone-sheet--open') === true
  const measured = controls === null || controls === undefined || asSheet ? undefined : controls.getBoundingClientRect().height
  const reserve = controlsReserve(measured, rememberedControls, rem)
  if (measured !== undefined && measured > 0) rememberedControls = measured
  duel.style.setProperty('--controls-height', `${reserve.toFixed(1)}px`)

  // 盤面のほかの段の高さは、十分に縮めて外枠に収めてから測る。収まっていないと、段が内容より低く潰れて測れない。
  board.style.setProperty('--board-zoom', String(MEASURE_ZOOM))
  const style = getComputedStyle(duel)
  const reserved =
    reservedHeight(
      style.gridTemplateRows.split(' ').map(Number.parseFloat),
      Number.parseFloat(style.rowGap),
      Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom),
      rem,
    ) ?? FALLBACK_RESERVED_REM * rem + reserve

  const visible = visibleHeight(window.visualViewport ?? undefined, window.innerHeight)
  const zoom = fittedZoom(widthZoom(window.innerWidth, rem), boardAvailableHeight(visible, reserved), (at) => {
    board.style.setProperty('--board-zoom', at.toFixed(3))

    return board.getBoundingClientRect().height
  })
  board.style.setProperty('--board-zoom', zoom.toFixed(3))

  const duelRect = duel.getBoundingClientRect()
  for (const drawer of duel.querySelectorAll<HTMLElement>('.drawer')) {
    const strip = duel.querySelector<HTMLElement>(`.strip--${drawer.dataset.side ?? ''}`)
    if (strip === null) continue

    const rect = strip.getBoundingClientRect()
    drawer.style.minHeight = `${rect.height}px`
    drawer.style.top = `${drawerTop({ top: topInContent(rect.top, duelRect.top, duel.scrollTop), height: rect.height }, drawer.offsetHeight)}px`
  }

  settlePeek(duel, rem)
}

/**
 * 行き先を選んでいる間の帯の大きさ。上は自分の手札の段の上端までしか伸ばさず（盤面に重ねない）、カードの絵は
 * 右の中身の高さに合わせる。帯が無ければ何もしない。
 */
function settlePeek(duel: HTMLElement, rem: number): void {
  const peek = duel.querySelector<HTMLElement>('.peek')
  const hand = duel.querySelector<HTMLElement>('.hand--自分')
  if (peek === null || hand === null) return

  // 手札の段が画面の外へ送られていても、帯の中身（ボタン）は押せる高さを残す。
  const limit = Math.max(peekMaxHeight(peek.getBoundingClientRect().bottom, hand.getBoundingClientRect().top), 7 * rem)
  peek.style.maxHeight = `${limit}px`

  // カードの縦横は 3:2。先に小さくして、右の中身だけの高さを測り、それに合わせる。
  const mini = peek.querySelector<HTMLElement>(':scope > .card')
  const body = peek.querySelector<HTMLElement>('.peek__body')
  if (mini === null || body === null) return

  mini.style.setProperty('--card-width', '0px')
  mini.style.setProperty('--card-width', `${peekCardWidth(body.offsetHeight)}px`)
}

/**
 * 操作の帯の高さが変わったら、`onChange` を呼ぶ（上の段の余白と縮める率を、測り直すため）。描き直さなくても
 * 変わりうる（文字の大きさ、折り返し）。戻り値を呼ぶと止まる。描き直すたびに、新しい帯に付け直す。
 */
export function watchControls(root: HTMLElement, onChange: () => void): () => void {
  const controls = root.querySelector<HTMLElement>('.duel .controls')
  if (controls === null || typeof ResizeObserver === 'undefined') return () => undefined

  const observer = new ResizeObserver(onChange)
  // 測っているのは枠まで含めた高さ（`getBoundingClientRect`）なので、枠まで含めた大きさの変わり方を見る。
  observer.observe(controls, { box: 'border-box' })

  return () => observer.disconnect()
}
