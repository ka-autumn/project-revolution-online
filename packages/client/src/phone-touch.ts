/**
 * スマートフォンで、指が重なっている手札のカードを目立たせる（ADR-0034）。
 *
 * PC でマウスを乗せたときの浮き上がりにあたる。手札の段を指でなぞって横に送っている間も、いま指の下にある
 * カードを手前に出し、押せるものの色の光で囲む（見た目は `style.css` の `.card--指の下`）。押した・離した
 * の判定は変えない——ここは class を付け外すだけで、タップ（その場で離す）もなぞり（段を送る）も妨げない
 * （リスナーは passive で、`preventDefault` を呼ばない）。
 *
 * 状態の進め方（`trackFinger`）は純粋で、DOM に触れる部分（`wireFingerOnHand`）は薄く保つ。
 */

/** 指の下のカードに付ける class。 */
export const UNDER_FINGER = 'card--指の下'

const OWN_HAND = '.hand--自分'
const OWN_HAND_CARD = '.hand--自分 .card'

export interface Finger<T> {
  /** 自分の手札に指が触れているあいだ真。 */
  readonly active: boolean
  /** いま指の下にあるカード。 */
  readonly under: T | undefined
}

export type FingerEvent<T> =
  /** 指が触れた。`inHand` は、触れたのが自分の手札の中か。`under` は、そのときの指の下のカード。 */
  | { readonly kind: '触れた'; readonly inHand: boolean; readonly under: T | undefined }
  /** 指が動いた。手札の外へ出ても、触れている間は追い続ける（段を送っている間はブラウザが指を追う）。 */
  | { readonly kind: '動いた'; readonly under: T | undefined }
  /** 指が離れた・取り消された。 */
  | { readonly kind: '離れた' }

export function noFinger<T>(): Finger<T> {
  return { active: false, under: undefined }
}

/** 状態を進める。手札の外で触れ始めた指は追わない。 */
export function trackFinger<T>(state: Finger<T>, event: FingerEvent<T>): Finger<T> {
  switch (event.kind) {
    case '触れた':
      return event.inHand ? { active: true, under: event.under } : noFinger()
    case '動いた':
      return state.active ? { active: true, under: event.under } : state
    case '離れた':
      return noFinger()
  }
}

/**
 * `root` の中の自分の手札に触れた指を追って、指の下のカードに class を付け外す。
 *
 * リスナーは `root` に 1 度だけ付ける。画面は描き直すたびに中身を作り直すが、`root` は残るので、描き直したあとも
 * 付いたままになる。戻り値を呼ぶと外れる。`enabled` が偽の間（PC の並べ方）は何もしない。
 */
export function wireFingerOnHand(root: HTMLElement, enabled: () => boolean): () => void {
  let state: Finger<HTMLElement> = noFinger()

  const cardAt = (touch: Touch | undefined): HTMLElement | undefined =>
    touch === undefined ? undefined : (document.elementFromPoint(touch.clientX, touch.clientY)?.closest<HTMLElement>(OWN_HAND_CARD) ?? undefined)

  const apply = (next: Finger<HTMLElement>): void => {
    if (next.under !== state.under) {
      state.under?.classList.remove(UNDER_FINGER)
      next.under?.classList.add(UNDER_FINGER)
    }
    state = next
  }

  const onTouch = (event: TouchEvent): void => {
    if (!enabled()) return
    const touch = event.touches[0]
    if (event.type === 'touchstart') {
      const inHand = event.target instanceof Element && event.target.closest(OWN_HAND) !== null
      apply(trackFinger(state, { kind: '触れた', inHand, under: inHand ? cardAt(touch) : undefined }))
    } else {
      apply(trackFinger(state, { kind: '動いた', under: cardAt(touch) }))
    }
  }
  const onEnd = (): void => apply(trackFinger(state, { kind: '離れた' }))

  // 指でなぞって段を送るのを妨げないよう、passive にする。
  const options: AddEventListenerOptions = { passive: true }
  root.addEventListener('touchstart', onTouch, options)
  root.addEventListener('touchmove', onTouch, options)
  root.addEventListener('touchend', onEnd, options)
  root.addEventListener('touchcancel', onEnd, options)

  return () => {
    root.removeEventListener('touchstart', onTouch, options)
    root.removeEventListener('touchmove', onTouch, options)
    root.removeEventListener('touchend', onEnd, options)
    root.removeEventListener('touchcancel', onEnd, options)
    onEnd()
  }
}
