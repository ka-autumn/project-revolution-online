/**
 * スマートフォンで、効果がエリアを選ばせている間の、スクエアを押したあとの動きを決める（ADR-0034、#278）。
 *
 * エリアの候補では、選べるエリアの行のユニット全員が光るスクエアの中にいて、タップすると答えが送られる。
 * これでは、どのエリアを選ぶかの材料になるユニットの詳細を読めず、誤タップも送る前に直せない。
 * そこで、スマートフォンでだけ、光っているスクエアを押したら答えを送らずにシートを出し、シートの
 * 「このエリアを選ぶ」を押して初めて答える。PC は右の列で詳細を読めるので変えない。
 *
 * ここは DOM を持たない。どのスクエアが押せて、どの番号で答えるかは、届いた候補から作った
 * `choicePicking` の結果だけから引き、ここで数え上げない（ADR-0010）。シートを作るのは `render.ts`、
 * 開いているシートを覚えるのは `phone.ts`。
 */
import type { Square, WireChoice, WirePerspective } from '@revolution/engine'
import { choicePicking } from './input-model.js'
import { areaLabel } from './view-model.js'

/** 光っているスクエアを押したあとの動き。 */
export type SquareTap = '答える' | 'エリアのシートを出す'

/**
 * 押せるスクエアを押したときの動き。エリアごと選んでいるスクエア（`wholeArea`）は、スマートフォンでだけ
 * シートを挟む。置き先やスクエアの候補は、スマートフォンでも 1 回のタップで答える。
 */
export function tapOfSquare(phone: boolean, pickable: { readonly wholeArea?: true } | undefined): SquareTap {
  return phone && pickable?.wholeArea === true ? 'エリアのシートを出す' : '答える'
}

/**
 * 開いているシートの覚え（`PhoneState.areaSheet`）。どのスクエアを押したかと、どの選択の最中だったか。
 *
 * 選択は参照で覚える。届いた選択ごとに別の値になるので、候補が入れ替わったかを、中身の比べ合いなしで見分けられる。
 */
export interface AreaSheetOpen {
  readonly square: Square
  readonly choice: WireChoice
}

/** 出すシートの中身。 */
export interface AreaSheetView {
  /** シートを出したスクエア。ユニットの詳細を引く。 */
  readonly square: Square
  /** 見る人から見たエリアの呼び名（「敵エリア」など）。 */
  readonly heading: string
  /** 「このエリアを選ぶ」で送る候補の番号（ADR-0008）。 */
  readonly answer: number
}

/**
 * 開いているシートを、いまも出してよいなら、その中身。出せないなら `undefined`（覚えは捨てる）。
 *
 * 出せなくなるのは、繋がりが切れた、選択が入れ替わった・無くなった、押したスクエアがもうエリアの候補でない、のとき。
 * 送った答えが受け入れられて選択が無くなったときも、これで閉じる。
 */
export function areaSheetOf(
  open: AreaSheetOpen | undefined,
  board: WirePerspective,
  choice: WireChoice | undefined,
  connected: boolean,
): AreaSheetView | undefined {
  if (open === undefined || choice === undefined || !connected || open.choice !== choice) return undefined

  const picking = choicePicking(board, choice)
  const area = picking.squares.find(
    (each) => each.wholeArea === true && each.square.row === open.square.row && each.square.column === open.square.column,
  )
  const answer = picking.answerOfSquare(open.square)
  if (area === undefined || answer === undefined) return undefined

  return { square: open.square, heading: areaLabel(board.viewer, open.square.row), answer }
}
