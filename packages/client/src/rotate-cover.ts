/**
 * 横向きのスマートフォンでの「縦向きにしてください」の案内（ADR-0034）。
 *
 * 覆う見た目は CSS（`.rotate-cover`）が決める。ここは、覆っている間だけ下の画面を操作できなく
 * する。マウスや指は覆いが受け止めるが、Tab とスクリーンリーダーは下の画面へ届いてしまうため、
 * `inert` で止める。状態には触らない。縦に戻したら、覆う前に手があった場所へ手を戻す。
 */

/** `style.css` の `.rotate-cover` が出る条件と同じ。食い違うと、覆いが見えないのに画面が止まる。 */
const LANDSCAPE_SHORT = '(orientation: landscape) and (max-height: 500px)'

export function watchRotateCover(root: HTMLElement): void {
  const query = window.matchMedia(LANDSCAPE_SHORT)
  let resting: Element | null = null

  const sync = (): void => {
    if (query.matches) {
      resting = document.activeElement
      root.inert = true
      return
    }

    root.inert = false
    // 描き直しで作り直されて、もう無いこともある。そのときは何もしない。
    // 限界として受け入れている（#269）: 覆っている間に描き直されると元の要素が無くなり、手は
    // どこにも戻らない。入力欄の打ちかけの文字は残る。
    if (resting instanceof HTMLElement && resting.isConnected) resting.focus({ preventScroll: true })
    resting = null
  }

  query.addEventListener('change', sync)
  sync()
}
