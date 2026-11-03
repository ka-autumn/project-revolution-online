import { legalActions, passOutcome, perspectiveOf } from '@revolution/engine'
import type {
  ChoiceAnswer,
  DuelPerspective,
  DuelState,
  LegalAction,
  PassOutcome,
  Player,
  Random,
  WireChoice,
} from '@revolution/engine'

/**
 * CPU が手を選ぶ時に受け取るもの（ADR-0060）。
 *
 * 人の画面に届く「盤面」と同じものである（`protocol.ts` の `ToClient` の `盤面`）。射影した
 * 盤面と、いま行える行動と、優先権を放棄したら何が起きるか。完全な盤面（`DuelState`）は
 * 持たない。相手の手札も、山札の並びも、この先のシャッフルを決定する乱数列も、人と同じく見えない
 * （総合ルール 第2部 第23章 2-1）。
 *
 * 行える行動を CPU が自分で数え上げないのも、人の画面と同じ理由である。`legalActions` は完全な
 * 盤面が要る（ADR-0010）。
 */
export interface ActionView {
  readonly perspective: DuelPerspective
  /** いま行える行動。CPU は必ずこの中から選ぶ。 */
  readonly actions: readonly LegalAction[]
  readonly passOutcome: PassOutcome | undefined
}

/**
 * CPU が選択に答える時に受け取るもの（ADR-0060）。
 *
 * 人の画面に届く「選んでほしい」と、その時に届く盤面と同じもの。盤面はその選択が起きている
 * 盤面の射影で、行動を始める前の盤面ではない（#142）。
 */
export interface ChoiceView {
  readonly perspective: DuelPerspective
  readonly choice: WireChoice
}

/**
 * 自動で打つ相手 1 人（ADR-0060）。
 *
 * 手を選ぶメソッドと、選択に答えるメソッドの 2 つだけを持つ。対戦の部屋で打つ時も（`server` の
 * `room.ts`）、CPU 同士の勝率を測る時も（`compare.ts`）、この 2 つを通す。通り道が分かれると、
 * 片方だけで起きる違いが生まれる（ADR-0017）。
 *
 * 決まりごとと同じく純粋な関数である。乱数は値として受け取り、使った分だけ進めて返す
 * （`random.ts`）。
 */
export interface CpuPlayer {
  /** 次に行う手。`view.actions` が空なら `undefined`。 */
  readonly pickAction: (
    view: ActionView,
    random: Random,
  ) => { readonly action: LegalAction; readonly random: Random } | undefined
  /** 選択への答え。候補の番号か `選ばない` で返す（ADR-0008）。 */
  readonly answer: (view: ChoiceView, random: Random) => { readonly answer: ChoiceAnswer; readonly random: Random }
}

/**
 * 完全な盤面から、そのプレイヤーが手を選ぶ時に受け取るものを作成する。
 *
 * CPU に渡すものは、必ずここを通す。射影するのはここだけで、CPU の側は完全な盤面を受け取る
 * メソッドを持たない。人の画面へ送る盤面（`room.ts` の `boards`）と同じ作成方法である。
 *
 * 優先権を持っていないプレイヤーには、行える行動が空で届く（人の画面と同じ）。
 */
export function actionViewOf(state: DuelState, player: Player): ActionView {
  return {
    perspective: perspectiveOf(state, player),
    actions: player === state.turn.priority ? legalActions(state) : [],
    passOutcome: passOutcome(state),
  }
}

/**
 * 選択が起きている盤面から、答える人が受け取るものを作成する。
 *
 * `board` はその選択が起きている盤面（`applyWithAnswers` が返す `選んでほしい` の `board`）を
 * 渡す。射影するのは、答えるプレイヤー（`choice.player`）の視点である。
 */
export function choiceViewOf(board: DuelState, choice: WireChoice): ChoiceView {
  return { perspective: perspectiveOf(board, choice.player), choice }
}
