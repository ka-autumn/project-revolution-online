import { Component, render } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'

/**
 * 画面の根の部品（ADR-0078）。`#board` の中身は Preact が持つ。ここを通さずに `#board` を
 * 書き換えると、Preact が覚えている中身と画面が食い違うので、画面を替える時は `showScreen` を呼ぶ。
 */

/** 組み立てられなかった時に表示する 1 行。 */
export const BUILD_FAILED = '画面を組み立てられませんでした。ページを再読み込みしてください'

/** 根に表示するもの。 */
export type Screen =
  | {
      readonly kind: 'かたまり'
      /**
       * かたまりの中身を組み立てる。Preact は中身に差分を当てないので、前の中身を捨てるのも
       * 組み立てる側がする。
       */
      readonly build: (chunk: HTMLElement) => void
    }
  | { readonly kind: '一行'; readonly text: string }

/**
 * `build` が組み立てる、Preact から中身の見えない 1 つのかたまり。
 *
 * 組み立ては `render` が返るまでに終わる（layout effect は差分を当てた直後に同期で走る）。
 * 呼ぶ側は、続けて寸法を測ってよい。
 */
function Chunk({ build }: { readonly build: (chunk: HTMLElement) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    build(ref.current!)
  })

  return <div ref={ref} class="screen-chunk" />
}

interface State {
  readonly screen: Screen | undefined
  readonly failed: boolean
}

/**
 * 組み立てで投げても、白い画面にしない。`BUILD_FAILED` を表示し、次に画面を渡されたら組み立て直す。
 *
 * 受け止めるのは、部品の描画と effect の中で投げたものだけである。Preact の外で呼ぶ処理は、
 * 呼ぶ側が受け止める（`index.ts` の `redraw`）。
 */
export class ScreenRoot extends Component<{ readonly screen: Screen }, State> {
  override state: State = { screen: undefined, failed: false }

  static override getDerivedStateFromProps(props: { readonly screen: Screen }, state: State): State | null {
    return props.screen === state.screen ? null : { screen: props.screen, failed: false }
  }

  static override getDerivedStateFromError(): Partial<State> {
    return { failed: true }
  }

  override componentDidCatch(error: unknown): void {
    console.error('画面を組み立てられませんでした:', error)
  }

  override render() {
    const { screen } = this.props
    if (this.state.failed) return <p class="status">{BUILD_FAILED}</p>
    if (screen.kind === '一行') return <p class="status">{screen.text}</p>

    return <Chunk build={screen.build} />
  }
}

/** `root`（`#board`）に表示するものを替える。 */
export function showScreen(root: HTMLElement, screen: Screen): void {
  render(<ScreenRoot screen={screen} />, root)
}
