/**
 * エリアを選んでいる間の、強調するエリアの決め方（ADR-0031、#278）。
 *
 * エリアは行単位で選ぶので、カーソルを載せた（またはフォーカスした）スクエアと同じエリアの 3 つを
 * まとめて強調する。手を置いている所はカーソルとキーボードの 2 つあり、別のエリアにあることもある。
 * 強調するのは、後から動いたほうのエリアだけにする。後から動いたほうが離れたら、もう一方がまだ
 * 押せるエリアのスクエアにあれば、そちらのエリアに戻る。
 *
 * ここは DOM を持たない。どのスクエアが押せるかは、届いた候補から作った値（`PickableSquare`）を
 * そのまま受け取り、ここで数え上げない（ADR-0010）。描く側（`render.ts`）は、結果を class に写すだけにする。
 *
 * 状態は描き直しをまたいで持つ（`index.ts` の `mount` が 1 つ持つ）。描き直すとスクエアは作り直され、
 * カーソルの下の要素に `mouseenter` が出直すとは限らないので、要素ではなく「どのスクエアにあるか」を覚える。
 */
import type { Square } from '@revolution/engine'

/** 手を置いている所のうち、後から動いたもの。 */
export type PointerKind = 'カーソル' | 'フォーカス'

/** カーソルとフォーカスがあるスクエア。どちらも無ければ `undefined`。 */
export interface AreaPointer {
  readonly cursor?: Square
  readonly focus?: Square
  /** どちらが後に動いたか。どちらもまだ動いていなければ `undefined`。 */
  readonly latest?: PointerKind
}

export const NO_POINTER: AreaPointer = {}

export type AreaPointerEvent =
  | { readonly kind: '入った'; readonly pointer: PointerKind; readonly square: Square }
  | { readonly kind: '出た'; readonly pointer: PointerKind }

/** 出来事を受けた後の状態。 */
export function settleAreaPointer(state: AreaPointer, event: AreaPointerEvent): AreaPointer {
  const square = event.kind === '入った' ? event.square : undefined
  const cursor = event.pointer === 'カーソル' ? square : state.cursor
  const focus = event.pointer === 'フォーカス' ? square : state.focus
  // 出たときは、出たほうを後に動いたことにしない。もう一方が残っていれば、そちらを後のものとして扱う。
  const other: PointerKind = event.pointer === 'カーソル' ? 'フォーカス' : 'カーソル'
  const remaining = other === 'カーソル' ? cursor : focus
  const latest = event.kind === '入った' ? event.pointer : remaining === undefined ? undefined : other

  return {
    ...(cursor === undefined ? {} : { cursor }),
    ...(focus === undefined ? {} : { focus }),
    ...(latest === undefined ? {} : { latest }),
  }
}

/**
 * 描き直しをまたいで持つ入れ物。`mount` が 1 つ作り、描く側に渡す。エリアを選ぶ場面が終わったら
 * （エリアの候補が無くなったら）`clear` で捨てる。
 */
export interface AreaPointerStore {
  readonly read: () => AreaPointer
  readonly send: (event: AreaPointerEvent) => void
  readonly clear: () => void
}

export function areaPointerStore(): AreaPointerStore {
  let state = NO_POINTER

  return {
    read: () => state,
    send: (event) => {
      state = settleAreaPointer(state, event)
    },
    clear: () => {
      state = NO_POINTER
    },
  }
}

function sameSquare(square: Square, other: Square): boolean {
  return square.row === other.row && square.column === other.column
}

/**
 * 強調するスクエア。押せるエリアのスクエアに手がある所のうち、後から動いたほうのエリアの、押せるスクエア全部。
 * どちらも無ければ空。
 *
 * `areaSquares` は、エリアごと選んでいる場面で押せるスクエア（`PickableSquare` のうち `wholeArea` のもの）。
 *
 * スマートフォンで「このエリアを選ぶ」のシートが開いている間は、`sheet`（シートを出したスクエア）のエリアを、
 * カーソルとフォーカスより優先して強調する。どのエリアを選ぼうとしているかを、シートの上に見せ続けるため。
 * 押せるエリアのスクエアでなければ（選択が替わった）、シートは無いものとして扱う。
 */
export function highlightedSquares(
  state: AreaPointer,
  areaSquares: readonly Square[],
  sheet?: Square,
): readonly Square[] {
  const inArea = (square: Square | undefined): square is Square =>
    square !== undefined && areaSquares.some((each) => sameSquare(each, square))
  const ordered =
    state.latest === 'フォーカス' ? [sheet, state.focus, state.cursor] : [sheet, state.cursor, state.focus]
  const found = ordered.find(inArea)
  if (found === undefined) return []

  return areaSquares.filter((each) => each.row === found.row)
}
