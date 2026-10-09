/**
 * スマートフォンの対戦画面で、盤面を画面に合わせて縮める（ADR-0034）。
 *
 * 盤面は PC の形のまま縮める。縮める率は、画面の幅と、盤面のほかの段を残した高さの、小さいほうに合わせる。
 * CSS だけでは「長さ ÷ 長さ」を割り出せないので、描いたあとに測って `--board-zoom` に置く。
 * 捨札・リムーブの引き出しのつまみ（`position: fixed`）も、盤面の段の位置を測って縦に合わせる。
 */

/** 盤面の自然な幅。`style.css` の `.duel .board` の列（6rem・1.8rem・10.5rem×3・6rem）と列の間（0.4rem×5）の合計。 */
export const BOARD_NATURAL_WIDTH_REM = 47.3

/** 外枠の段の数と、盤面・自分の手札の段の位置。`style.css` の `.duel` の `grid-template-rows` に合わせる。 */
export const DUEL_ROWS = 7
export const BOARD_ROW = 3
export const HAND_ROW = 4

/** 自分の手札の段の最低の高さ（rem）。`style.css` の `minmax(3.2rem, 1fr)`。手札は上半分だけを出す。 */
export const HAND_MIN_REM = 3.2

/** 段の高さが測れないときに、盤面のほかの段と余白に残す高さ（rem）。 */
export const FALLBACK_RESERVED_REM = 20.5

/** 画面の横に残す余白（px）。 */
const SIDE_MARGIN_PX = 16

/** 縮める率の下限。画面が極端に低いときでも、盤面を消さない。 */
export const MIN_ZOOM = 0.1

/** 盤面のほかの段の高さを測るときの、盤面を縮める率。どの画面でも外枠に収まる小ささにする。 */
const MEASURE_ZOOM = MIN_ZOOM

/** 高さに合わせて縮め直す回数の上限。 */
const FIT_STEPS = 5

/**
 * 盤面のほかの段と、段の間・外枠の余白に残す高さ（px）。盤面の段は含めず、自分の手札の段は最低の高さで数える
 * （手札の段は残りの高さを受け持つので、いまの高さは当てにならない）。段の数が合わなければ `undefined`。
 */
export function reservedHeight(rows: readonly number[], rowGap: number, padding: number, rem: number): number | undefined {
  if (rows.length !== DUEL_ROWS || rows.some((height) => !Number.isFinite(height))) return undefined

  const fixed = rows.reduce((sum, height, at) => (at === BOARD_ROW ? sum : sum + (at === HAND_ROW ? HAND_MIN_REM * rem : height)), 0)

  return fixed + rowGap * (rows.length - 1) + padding
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

/** 盤面の縮めと引き出しの縦の位置を、いまの画面の大きさに合わせる。スマートフォンの並べ方でなければ呼ばない。 */
export function settlePhoneBoard(root: HTMLElement): void {
  const duel = root.querySelector<HTMLElement>('.duel')
  const board = duel?.querySelector<HTMLElement>('.board')
  if (duel === null || duel === undefined || board === null || board === undefined) return

  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  // 盤面のほかの段の高さは、十分に縮めて外枠に収めてから測る。収まっていないと、段が内容より低く潰れて測れない。
  board.style.setProperty('--board-zoom', String(MEASURE_ZOOM))
  const style = getComputedStyle(duel)
  const reserved =
    reservedHeight(
      style.gridTemplateRows.split(' ').map(Number.parseFloat),
      Number.parseFloat(style.rowGap),
      Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom),
      rem,
    ) ?? FALLBACK_RESERVED_REM * rem

  const zoom = fittedZoom(widthZoom(window.innerWidth, rem), duel.clientHeight - reserved, (at) => {
    board.style.setProperty('--board-zoom', at.toFixed(3))

    return board.getBoundingClientRect().height
  })
  board.style.setProperty('--board-zoom', zoom.toFixed(3))

  for (const drawer of duel.querySelectorAll<HTMLElement>('.drawer')) {
    const strip = duel.querySelector<HTMLElement>(`.strip--${drawer.dataset.side ?? ''}`)
    if (strip === null) continue

    const rect = strip.getBoundingClientRect()
    drawer.style.minHeight = `${rect.height}px`
    drawer.style.top = `${drawerTop(rect, drawer.offsetHeight)}px`
  }
}
