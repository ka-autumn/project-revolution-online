import type { CardId, LegalAction, Player, WireCandidate, WireChoice, WirePerspective } from '@revolution/engine'
import type { Session } from './session.js'
import { nameOf, namesIn, squareLabel } from './view-model.js'

/**
 * 行える手と選ぶ候補から、画面に出す値を作る（#14）。
 *
 * **並べるだけで、選ぶ資格を判断しない**（ADR-0010）。行える手はサーバが盤面と一緒に送って
 * くるものをそのまま並べ、候補は送られてきた並びのまま番号を振る。ここに「この手は押せない」
 * という判断は無く、押せない手はそもそも届かない。
 */

/** 押せるボタン 1 つ。 */
export interface ActionView {
  /** 押したときにサーバへ送る手。届いたものをそのまま返す。 */
  readonly action: LegalAction
  readonly label: string
}

/** 選ぶ候補 1 つ。 */
export interface CandidateView {
  /** 候補の何番目か。**答えるのはこの番号である**（ADR-0008）。 */
  readonly index: number
  readonly label: string
}

/** 答えを待たれている選択。 */
export interface ChoiceView {
  /** 選ばないことを選べるか。 */
  readonly mayDecline: boolean
  /**
   * 直前に答えたものを取り消せるか。
   *
   * まだ 1 つも答えていなければ戻る先が無い。その場合でも行動そのものは取り消せる
   * （盤面はまだ動いていない、ADR-0008）ので、やめる側はいつでも押せる。
   */
  readonly mayRewind: boolean
  readonly candidates: readonly CandidateView[]
}

function labelOf(action: LegalAction, viewer: Player, names: ReadonlyMap<CardId, string>): string {
  switch (action.kind) {
    case '優先権を放棄する':
    case 'プランする':
      return action.kind
    case 'エネルギーを置く':
    case 'トラップを廃棄する':
    case 'トラップとしてプレイする':
    case 'トラップを発動する':
    case '「勇気」を起動する':
      return `${action.kind}: ${nameOf(names, action.card)}`
    case 'スマッシュする':
      return `スマッシュする: ${nameOf(names, action.unit)}`
    case 'カードをプレイする': {
      const where = action.declaration.square === undefined ? '' : `（${squareLabel(viewer, action.declaration.square)}へ）`
      return `プレイする: ${nameOf(names, action.declaration.card)}${where}`
    }
    case 'ユニットを移動する':
      return `移動する: ${nameOf(names, action.unit)} → ${squareLabel(viewer, action.destination)}`
    // 1 枚が 2 つ以上持つことがありうるので、何個目かを添える（`legal-action.ts`）。
    case '起動型能力を起動する':
      return `能力を起動する: ${nameOf(names, action.unit)}（${action.ability + 1} 個目）`
  }
}

/**
 * 行える手を、押せるボタンの並びにする。
 *
 * 届いた並びのまま並べる。**間引かない。** どれを行えるかを決めているのはサーバで、ここが
 * 減らせば行える手が画面から消える（ADR-0010）。
 */
export function actionViews(board: WirePerspective, actions: readonly LegalAction[]): readonly ActionView[] {
  const names = namesIn(board)

  return actions.map((action) => ({ action, label: labelOf(action, board.viewer, names) }))
}

/**
 * 人に押させずに送ってよい手。無ければ `undefined`（ADR-0010）。
 *
 * **放棄しか行えない場面だけ**を自動にする。選ぶ余地が無いので、押させても盤面は同じところへ
 * 進む。放棄しか行えない場面はデュエル中に何度も来る（フェイズの始めに非アクティブプレイヤーへ
 * 優先権が発生する、総合ルール 第3部 第7章 1・第8章 1）ので、そのたびに押させると打つ手の
 * ある場面が埋もれる。
 *
 * **これはルールの判断ではない。** 何を行えるかを決めているのはサーバで、ここが見ているのは
 * 届いた並びの中身だけである。並びが空でも、放棄以外が混じっていても、何も送らない。
 *
 * 選ぶのを待たれている間は送らない。サーバも `選ぶのを待っている` として断る（`room.ts` の
 * `act`）。届いた手はその時点で空になっている（`session.ts`）が、二重の関門にしている。
 *
 * **返答の速さが情報になる**（#97）。手を持っていない場面だけが即座に返るので、相手からは
 * それと分かる。先送りにしている。
 */
export function automaticAction(session: Session): LegalAction | undefined {
  const stage = session.stage
  if (stage.kind !== '打っている' || stage.choice !== undefined) return undefined

  const [only, ...rest] = stage.actions
  if (only === undefined || rest.length > 0) return undefined

  return only.kind === '優先権を放棄する' ? only : undefined
}

/**
 * 候補 1 つの出し方。
 *
 * **見えないものもそのまま候補になる。** プランのコストとして自分の裏向きのスマッシュを
 * フリーズできる（総合ルール 第2部 第21章 7-5）が、スマッシュはどちらのプレイヤーにも
 * 見えない（同 7-3）。何であるかを出せないので、**位置で示す**。
 */
function candidateLabel(candidate: WireCandidate, index: number, names: ReadonlyMap<CardId, string>): string {
  const position = `${index + 1} 番目`
  return candidate.kind === '見えている' ? `${position}: ${nameOf(names, candidate.card)}` : `${position}（裏向き）`
}

/** 選んでほしいと言われたことを、画面に出す形にする。 */
export function choiceView(board: WirePerspective, choice: WireChoice): ChoiceView {
  const names = namesIn(board)

  return {
    mayDecline: choice.mayDecline,
    mayRewind: choice.answered > 0,
    candidates: choice.candidates.map((candidate, index) => ({
      index,
      label: candidateLabel(candidate, index, names),
    })),
  }
}
