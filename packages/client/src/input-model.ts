import type {
  CardId,
  ChoicePurpose,
  LegalAction,
  PassOutcome,
  Player,
  Square,
  WireCandidate,
  WireChoice,
  WirePerspective,
} from '@revolution/engine'
import { indexOfSquare } from '@revolution/engine'
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
  /** 何を聞かれているか。見出しにそのまま出す。 */
  readonly asking: string
  /** 選ばないことを選べるか。 */
  readonly mayDecline: boolean
  /**
   * 直前に答えたものを取り消せるか。
   *
   * まだ 1 つも答えていなければ戻る先が無い。
   */
  readonly mayRewind: boolean
  /**
   * 行動そのものをやめられるか（#142）。
   *
   * **行動を始めてから新しく見えたものがあれば、やめられない。** 見てから取り消して別の手を
   * 打てることになるためで、決めるのはサーバである（`protocol.ts` の `WireChoice.mayGoBack`、
   * ADR-0010）。ここでは届いた答えをそのまま使い、**同じ判断を書かない。**
   */
  readonly mayCancel: boolean
  readonly candidates: readonly CandidateView[]
}

/**
 * 優先権を放棄する手の見出し（#130）。
 *
 * `優先権を放棄する` は総合ルールの語（第3部 第4章 4）そのままで、打っている側から見ると
 * **何が起きるのか分かりにくい。** デュエル中いちばん多く押すボタンでもある。
 *
 * 押すと何が起きるかは、サーバが数え上げて送ってくる（`progress.ts` の `passOutcome`、
 * ADR-0010）。**ここはそれを言葉にするだけで、どれになるかを決めない。** 振り分けは進行の
 * 規則そのものなので、写せば 2 か所になる。
 *
 * 何かが進行している間（バンク・バトル・スマッシュ判定・「ターンの終わり」の前）は、総合
 * ルールの語のままにする。終わるのがフェイズではないので、言い換えると嘘になる。
 */
function passLabel(outcome: PassOutcome | undefined): string {
  if (outcome === undefined) return '優先権を放棄する'

  switch (outcome.kind) {
    // 相手のターンに優先権を得るのは自分（非アクティブプレイヤー）なので、そこで放棄しても
    // 1 回目にしかならない。フェイズは終わらず、相手に返るだけである。
    case '相手に渡る':
      return 'パス'
    case 'フェイズが変わる':
      return `${outcome.next}に進む`
    case 'ターンが終わる':
      return 'ターンを終える'
    case 'バンクを解決する':
    case 'ステップが進む':
    case 'ターンの終わりの能力が誘発する':
      return '優先権を放棄する'
  }
}

function labelOf(
  action: LegalAction,
  viewer: Player,
  names: ReadonlyMap<CardId, string>,
  passOutcome: PassOutcome | undefined,
): string {
  switch (action.kind) {
    case '優先権を放棄する':
      return passLabel(passOutcome)
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
export function actionViews(
  board: WirePerspective,
  actions: readonly LegalAction[],
  passOutcome: PassOutcome | undefined,
): readonly ActionView[] {
  const names = namesIn(board)

  return actions.map((action) => ({ action, label: labelOf(action, board.viewer, names, passOutcome) }))
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
 *
 * 能力は、どのカードから出たかで指す。何をする能力かは出せない（効果は関数なので通信に
 * 載らない）。発生源を持たない能力（作成された誘発型能力）もあるので、その時は位置だけになる。
 *
 * スクエアが候補になる場面（効果が置き先を選ばせる場合）は、**そのスクエアの呼び名**を出す。
 * 呼び名は見る人によって入れ替わる（総合ルール 第2部 第22章 4・6）。選択は選ぶプレイヤーに
 * だけ届く（ADR-0008）ので、受け取った側から見た呼び名がそのまま答えになる。選ぶのは能力の
 * 支配者であり（同 第4部 第8章 2-3）、カードや能力が指すエリア・ラインもその支配者から見て
 * 決まる（同 第2部 第22章 4-1・6-1）ためである。
 */
function candidateLabel(
  candidate: WireCandidate,
  index: number,
  viewer: Player,
  names: ReadonlyMap<CardId, string>,
): string {
  const position = `${index + 1} 番目`
  switch (candidate.kind) {
    case '見えている':
      return `${position}: ${nameOf(names, candidate.card)}`
    case '能力':
      return candidate.source === undefined
        ? `${position}（発生源のない能力）`
        : `${position}: ${nameOf(names, candidate.source)} の能力`
    case 'スクエア':
      return `${position}: ${squareLabel(viewer, candidate.square)}`
    case '見えていない':
      return `${position}（裏向き）`
  }
}

/**
 * 何を聞かれているかの言い回し。
 *
 * **engine が持つのは種類だけ**（`resolve.ts` の `ChoicePurpose`）で、言葉にするのはこちらの
 * 仕事である。engine は表示を持たない（ADR-0001）。
 *
 * 効果が選ばせている場合は「効果の対象」までしか言えない。何のための対象かはカードのテキストが
 * 決めることで、テキストは通信に載っていない（#93）。
 */
function askingFor(purpose: ChoicePurpose): string {
  switch (purpose) {
    case 'プレイのコスト':
      return 'プレイのコストとしてフリーズするエネルギーを選んでください'
    case 'プランのコスト':
      return 'プランのコストとしてフリーズするカードを選んでください'
    case '移動のコスト':
      return '移動のコストとしてフリーズするエネルギーを選んでください'
    case '起動のコスト':
      return '起動のコストとしてフリーズするエネルギーを選んでください'
    case '解決する能力':
      return '解決する能力を選んでください'
    case 'プランの置き換え':
      return 'プランのめくりを置き換える能力を選んでください'
    case '効果の対象':
      return '効果の対象を選んでください'
  }
}

/** 選んでほしいと言われたことを、画面に出す形にする。 */
export function choiceView(board: WirePerspective, choice: WireChoice): ChoiceView {
  const names = namesIn(board)

  return {
    asking: askingFor(choice.purpose),
    mayDecline: choice.mayDecline,
    mayRewind: choice.mayGoBack && choice.answered > 0,
    mayCancel: choice.mayGoBack,
    candidates: choice.candidates.map((candidate, index) => ({
      index,
      label: candidateLabel(candidate, index, board.viewer, names),
    })),
  }
}

/**
 * 盤面をクリックして操作する（#94）。
 *
 * **ルールの判断は増やさない**（ADR-0010）。どのカードを押せるか、どこを光らせるかは、
 * サーバから届いた手が指しているところだけで決まる。「ここに置けるはず」をここで計算しない。
 *
 * 通信の形式は変わらない。`LegalAction` はカードを識別子で、スクエアを行と列で指している
 * （`legal-action.ts`）ので、届いた手を「どのカードの話か」で振り分けるだけで足りる。
 */

/** その手が指しているカード。カードに紐づかない手なら `undefined`。 */
export function targetOf(action: LegalAction): CardId | undefined {
  switch (action.kind) {
    case '優先権を放棄する':
    case 'プランする':
      return undefined
    case 'エネルギーを置く':
    case 'トラップを廃棄する':
    case 'トラップとしてプレイする':
    case 'トラップを発動する':
    case '「勇気」を起動する':
      return action.card
    case 'スマッシュする':
    case 'ユニットを移動する':
    case '起動型能力を起動する':
      return action.unit
    case 'カードをプレイする':
      return action.declaration.card
  }
}

/** その手が置き先として指しているスクエア。置き先を持たない手なら `undefined`。 */
export function destinationOf(action: LegalAction): Square | undefined {
  switch (action.kind) {
    case 'カードをプレイする':
      return action.declaration.square
    case 'ユニットを移動する':
      return action.destination
    default:
      return undefined
  }
}

/**
 * 盤面の上で押せるスクエア 1 つ。
 *
 * **押した時に何を送るかはここに無い。** 置き先なら手を送り（`DestinationView`）、効果が
 * 選ばせているなら候補の番号で答える（`ChoicePicking`）。描く側はどちらでも同じ形で扱える。
 */
export interface PickableSquare {
  readonly square: Square
  readonly label: string
}

/** 光らせるスクエア 1 つと、そこを押した時に送る手。 */
export interface DestinationView extends PickableSquare {
  readonly action: LegalAction
}

/** クリックで操作する時に、画面に出すもの。 */
export interface PickView {
  /**
   * 押せるカード。**選んでいる間も、ほかのカードは押せるままにする。**
   *
   * 選び直すたびに、いま選んでいるカードをもう一度押して外させると、1 枚選ぶのに 2 回押す
   * ことになる。押したカードがそのまま次の選択になるほうが手数が少ない。どこまで絞れて
   * いるかは `picked` で示す（`style.css` の `.card--選択中`）。
   */
  readonly pickable: readonly CardId[]
  /** いま選んでいるカード。選んでいなければ `undefined`。 */
  readonly picked: CardId | undefined
  /**
   * 選んだカードで行える手のうち、置き先を持たないもの。ボタンとして出す。
   *
   * 置き先を持つ手でも、同じスクエアを指す手が 2 つ以上あるならここに入る。押した場所だけ
   * では、どちらの手かが決まらないためである。
   */
  readonly direct: readonly ActionView[]
  /** 光らせるスクエア。選んだカードの手が指しているところだけ。 */
  readonly destinations: readonly DestinationView[]
  /** カードに紐づかない手（優先権の放棄・プラン）。いつでも押せる。 */
  readonly untargeted: readonly ActionView[]
}

/**
 * クリックで操作する時の画面。`picked` が選んでいるカード（`undefined` なら選んでいない）。
 *
 * 段は 2 つである。カードを選ぶまでは押せるカードを示すだけで、選んだ後にその 1 枚で行える手
 * だけを出す。**置き先を選ぶ手は盤面の上で示す**ので、そこは押すところが 2 か所（カード →
 * スクエア）になる。
 */
export function pickView(
  board: WirePerspective,
  actions: readonly LegalAction[],
  picked: CardId | undefined,
  passOutcome: PassOutcome | undefined,
): PickView {
  const names = namesIn(board)
  const view = (action: LegalAction): ActionView => ({
    action,
    label: labelOf(action, board.viewer, names, passOutcome),
  })

  const targeted = actions.filter((action) => targetOf(action) !== undefined)
  const untargeted = actions.filter((action) => targetOf(action) === undefined).map(view)
  const pickable = [...new Set(targeted.flatMap((action) => targetOf(action) ?? []))]
  // 届いていないカードは選べない。選んだ後に手が届かなくなることは起こる（盤面が入れ替わる）
  // ので、その時は選んでいない状態と同じ扱いになる。
  if (picked === undefined || !pickable.includes(picked)) {
    return { pickable, picked: undefined, direct: [], destinations: [], untargeted }
  }

  const mine = targeted.filter((action) => targetOf(action) === picked)
  const placing = mine.filter((action) => destinationOf(action) !== undefined)
  // 同じスクエアを指す手が 2 つ以上あるなら、押した場所だけでは決まらない。
  const ambiguous = (square: Square): boolean =>
    placing.filter((action) => sameSquare(destinationOf(action), square)).length > 1

  const destinations = placing.flatMap((action): readonly DestinationView[] => {
    const square = destinationOf(action)
    if (square === undefined || ambiguous(square)) return []
    return [{ square, action, label: view(action).label }]
  })
  const decided = destinations.map((each) => each.action)

  return {
    pickable,
    picked,
    direct: mine.filter((action) => !decided.includes(action)).map(view),
    destinations,
    untargeted,
  }
}

function sameSquare(square: Square | undefined, other: Square): boolean {
  return square !== undefined && square.row === other.row && square.column === other.column
}

/** 選ぶのを待たれている間に、盤面から押せるもの（#94）。 */
export interface ChoicePicking {
  readonly pickable: readonly CardId[]
  /** そのカードを押した時に答える番号（ADR-0008）。押せないカードなら `undefined`。 */
  readonly answerOf: (card: CardId) => number | undefined
  /** 押せるスクエア。効果がスクエアを選ばせている場面（#113）だけ並ぶ。 */
  readonly squares: readonly PickableSquare[]
  /** そのスクエアを押した時に答える番号。押せないスクエアなら `undefined`。 */
  readonly answerOfSquare: (square: Square) => number | undefined
}

/**
 * 選ぶ候補のうち、盤面の上で押せるものを結び付ける。
 *
 * 候補を番号のボタンで並べる（`choiceView`）だけだと、エネルギーゾーンに見えているカードや、
 * 効果が置き先に選ばせているスクエアを選ぶのに、盤面ではなく番号の並びを見ることになる。
 * **盤面に出ている候補は、盤面のそこを押しても答えられる**ようにする。答えるのは番号のまま
 * なので、通信は変わらない。
 *
 * 押せるのは、見えているカード（`見えている`）と、スクエア（#113）である。**裏向きの
 * スマッシュは押せない。** 候補になる（プランのコスト、総合ルール 第2部 第21章 7-5）が、
 * 通信に載るのは見えていないということだけで（`protocol.ts` の `WireCandidate`）、盤面の
 * どの札のことかを結び付けられない（#127）。能力の候補も、押す先が盤面に無い。**それらは
 * ボタンのまま**である。
 */
export function choicePicking(board: WirePerspective, choice: WireChoice): ChoicePicking {
  const answers = new Map<CardId, number>()
  // スクエアは行と列の組なので、そのままでは鍵にできない。盤面の並びの番号に直して引く。
  const bySquare = new Map<number, { readonly view: PickableSquare; readonly answer: number }>()
  choice.candidates.forEach((candidate, index) => {
    // 同じものが 2 度並ぶことは無いが、並んだとしても先に出たほうを答えにする。
    if (candidate.kind === '見えている' && !answers.has(candidate.card)) answers.set(candidate.card, index)
    if (candidate.kind === 'スクエア') {
      const key = indexOfSquare(candidate.square)
      if (bySquare.has(key)) return
      // 呼び名は見る人によって入れ替わる（総合ルール 第2部 第22章 4・6）ので、受け取った
      // 側から見た呼び名にする（`choiceView` の候補と同じ）。
      const label = `${squareLabel(board.viewer, candidate.square)}を選ぶ`
      bySquare.set(key, { view: { square: candidate.square, label }, answer: index })
    }
  })

  return {
    pickable: [...answers.keys()],
    answerOf: (card) => answers.get(card),
    squares: [...bySquare.values()].map((each) => each.view),
    answerOfSquare: (square) => bySquare.get(indexOfSquare(square))?.answer,
  }
}
