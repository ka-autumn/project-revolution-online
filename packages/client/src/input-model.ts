import { areaOf, lineOf } from '@revolution/engine'
import type {
  CardId,
  LegalAction,
  Player,
  Square,
  WireCandidate,
  WireChoice,
  WirePerspective,
} from '@revolution/engine'

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
  readonly candidates: readonly CandidateView[]
}

/** 表側が見えているカードを、識別子で引ける表にする。 */
function namesById(board: WirePerspective): ReadonlyMap<CardId, string> {
  const visible = [
    ...board.squares.flat(),
    ...board.resolveZone,
    ...Object.values(board.zones).flatMap((zones) =>
      Object.values(zones).flatMap((cards) =>
        cards.flatMap((card) => (card.kind === '見えている' ? [card.instance] : [])),
      ),
    ),
  ]

  return new Map(visible.map((instance) => [instance.id, instance.card.name]))
}

/**
 * その識別子のカードの名前。見えていなければ、名前ではなく見えていないことを返す。
 *
 * 行える手が指すカードは、行うプレイヤーからは見えているはずである（自分の手札・自分の
 * トラップ・スクエアにいるユニット）。見えないものが指されていたら、それは名前を作り出す
 * ところではないので、そのまま「見えていないカード」と出す。
 */
function nameOf(names: ReadonlyMap<CardId, string>, id: CardId): string {
  return names.get(id) ?? '見えていないカード'
}

/** 見る人から見たスクエアの呼び方（総合ルール 第2部 第22章 4・6）。 */
function squareLabel(viewer: Player, square: Square): string {
  return `${areaOf(viewer, square)}の${lineOf(viewer, square)}`
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
  const names = namesById(board)

  return actions.map((action) => ({ action, label: labelOf(action, board.viewer, names) }))
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
  const names = namesById(board)

  return {
    mayDecline: choice.mayDecline,
    candidates: choice.candidates.map((candidate, index) => ({
      index,
      label: candidateLabel(candidate, index, names),
    })),
  }
}
