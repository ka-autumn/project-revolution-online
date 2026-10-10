import type {
  CardId,
  ChoicePurpose,
  LegalAction,
  PassOutcome,
  Player,
  Square,
  WireCandidate,
  WireCardInstance,
  WireCardPosition,
  WireChoice,
  WirePerspective,
} from '@revolution/engine'
import { indexOfSquare } from '@revolution/engine'
import type { Session } from './session.js'
import { areaLabel, drawnOnBoard, keyOfPosition, nameOf, namesIn, squareLabel } from './view-model.js'

/** エリアを構成するスクエアの列。 */
const SQUARE_COLUMNS = [0, 1, 2] as const

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
  /** 一番よく押す「フェイズ・ステップを進める」手か。金の地で目立たせる（ADR-0027）。 */
  readonly primary: boolean
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
  /**
   * 候補の並びに添える 1 行。要らなければ `undefined`（#150）。
   *
   * 盤面から押せる候補をボタンから外した結果、**ボタンが 1 つも残らない場面**で出す。
   * 何も出ないと、選ぶのを待たれているのに押すところが無いように見える。
   */
  readonly guide: string | undefined
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

  return actions.map((action) => ({
    action,
    label: labelOf(action, board.viewer, names, passOutcome),
    primary: isPrimaryAction(action),
  }))
}

/** 一番よく押す「フェイズ・ステップを進める」手か（ADR-0027）。優先権の放棄がそれにあたる。 */
function isPrimaryAction(action: LegalAction): boolean {
  return action.kind === '優先権を放棄する'
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
 * 決まる（同 第2部 第22章 4-1・6-1）ためである。エリアが候補になる場面（#278）も同じで、
 * 通信では盤面の行で届く（`protocol.ts` の `WireCandidate`）ので、受け取った側から見た呼び名にする。
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
    case 'エリア':
      return `${position}: ${areaLabel(viewer, candidate.row)}`
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
 * 効果が選ばせている場合は、**どのカードの効果かまでを言う**（#122）。何のための対象かは
 * カードのテキストが決めることで、行と能力の対応づけは通信に載っていない（#93）が、発生源が
 * 分かれば場面は絞れる。
 *
 * `source` は、発生源のカードの名前が引ける時だけ渡ってくる。**名前を作り出さない**（#95）
 * ので、引けない時は種類だけの言い回しに戻る。engine が発生源を落とす場合（選ぶ人から
 * 見えていない、`protocol.ts` の `WireChoice.source`）と、識別子は届いたが盤面にもログの
 * 名指しにも無い場合（`view-model.ts` の `namesIn`）の両方がここに来る。
 */
function askingFor(purpose: ChoicePurpose, source: string | undefined): string {
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
      return source === undefined ? '効果の対象を選んでください' : `${source} の効果の対象を選んでください`
  }
}

/**
 * 選んでほしいと言われたことを、画面に出す形にする。
 *
 * `picking` を渡すと、**盤面から押して答えられる候補はボタンにしない**（#150）。クリックで
 * 操作している間、同じ候補が盤面と操作パネルの 2 か所に出ているのをやめるためである。行える手
 * のほうは既にそうなっている（`pickView`、盤面の上で示せない手は、パネルの優先権の放棄と
 * ダイアログに出る）。
 *
 * **どれを外すかは `choicePicking` が決めたものをそのまま使う。** 押せるかどうかの判断をここに
 * 書き写すと、盤面が光る条件とボタンが消える条件が別々にずれていく。渡されない場面
 * （ボタンモード、演出が出ている間、`index.ts` の `clicking`）は今までどおり全部並ぶ。
 *
 * **番号は元のまま**である（ADR-0008）。答えるのは候補の番号なので、外した分は飛び番になる。
 *
 * 盤面から押せる候補は、キーボードでも押せる（ADR-0033）。ボタンの候補が減っても、クリックモードで
 * マウスなしに答えられなくなることは無い。行える手（#94）も同じ取引を呑んでいる。
 */
export function choiceView(board: WirePerspective, choice: WireChoice, picking?: ChoicePicking): ChoiceView {
  const names = namesIn(board)
  const candidates = choice.candidates.flatMap((candidate, index): readonly CandidateView[] =>
    picking !== undefined && picking.onBoard.includes(index)
      ? []
      : [{ index, label: candidateLabel(candidate, index, board.viewer, names) }],
  )

  return {
    asking: askingFor(choice.purpose, choice.source === undefined ? undefined : names.get(choice.source)),
    mayDecline: choice.mayDecline,
    mayRewind: choice.mayGoBack && choice.answered > 0,
    mayCancel: choice.mayGoBack,
    candidates,
    guide:
      picking !== undefined && candidates.length === 0 && choice.candidates.length > 0
        ? '盤面の光っているところを押して選んでください'
        : undefined,
  }
}

/**
 * 候補が全部能力の選択か（ADR-0031）。クリックモードでは、これをカードの一覧と同じ枠のダイアログで
 * 選ばせる（`render.ts` の `choosePickerElement`）。
 *
 * カードやスクエアが混じる場合は含めない。能力の札とカードの面を同じ一覧に並べる見た目は
 * 決めていない。今の選択の種類では混じらない（`protocol.ts` の `describeCandidate` が選択の
 * 種類で候補の形を決めている）ので、混じる選択が増えたときは、これまでどおり番号のボタンに
 * 戻る。
 */
export function isAbilityChoice(choice: WireChoice): boolean {
  return choice.candidates.length > 0 && choice.candidates.every((candidate) => candidate.kind === '能力')
}

/**
 * 能力の候補を、ダイアログの札に書く呼び名にする。候補と同じ並びで返す（番号が答えになる、ADR-0008）。
 *
 * 呼び名は発生源のカード名で「〇〇 の能力」。発生源を持たない、または選ぶ人から見えない能力は
 * 「発生源のない能力」とする。同じ呼び名が 2 つ以上並ぶときだけ、読み上げでも区別がつくよう、
 * 並びの順に「（1 つ目）」「（2 つ目）」を添える。
 */
export function abilityLabels(board: WirePerspective, choice: WireChoice): readonly string[] {
  const names = namesIn(board)
  const bases = choice.candidates.map((candidate) =>
    candidate.kind === '能力' && candidate.source !== undefined
      ? `${nameOf(names, candidate.source)} の能力`
      : '発生源のない能力',
  )
  const seen = new Map<string, number>()
  return bases.map((base) => {
    if (bases.filter((each) => each === base).length === 1) return base
    const nth = (seen.get(base) ?? 0) + 1
    seen.set(base, nth)
    return `${base}（${nth} つ目）`
  })
}

/**
 * 能力を選ぶ一覧（スマートフォン、ADR-0034）を開いた時点で、上の段に詳細を出すカード。
 *
 * 届いた選択が発生源を持っていればそれ、無ければ能力の候補の発生源が 1 つにそろっているときのそれ。
 * どちらも無ければ `undefined`（押すと詳細が出ることを案内する）。見えているかどうかは、呼ぶ側が
 * 盤面で引いて決める。
 */
export function abilityListSource(choice: WireChoice): CardId | undefined {
  if (choice.source !== undefined) return choice.source

  const sources = new Set<CardId | undefined>()
  for (const candidate of choice.candidates) sources.add(candidate.kind === '能力' ? candidate.source : undefined)
  const [only] = sources

  return sources.size === 1 ? only : undefined
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
  /**
   * そのスクエアのあるエリアごと選んでいる（効果がエリアを選ばせている場面、#278）。
   * 同じエリアの 3 つのスクエアが、同じ答えを持って並ぶ。描く側は、行単位で選んでいることが
   * 見えるよう、カーソルを載せたスクエアと同じエリアをまとめて強調する。
   */
  readonly wholeArea?: true
}

/** 光らせるスクエア 1 つと、そこを押した時に送る手。 */
export interface DestinationView extends PickableSquare {
  readonly action: LegalAction
}

/**
 * 光らせる自分のトラップゾーンと、そこを押した時に送る手（#249）。
 *
 * スクエアと違って行と列を持たない。置き先が自分のトラップゾーンに決まっている手
 * （`トラップとしてプレイする`）だけが指すので、ゾーンの名前は持たない。
 */
export interface TrapZoneView {
  readonly action: LegalAction
  readonly label: string
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
   * 山札を押せるか（#249）。プランする手が届いていて、プランゾーンにカードが無いとき。カードが
   * あるときは、山札の場所に見えているそのカードが `pickable` に入る。
   */
  readonly deckPickable: boolean
  /** いま山札を選んでいるか。 */
  readonly deck: boolean
  /**
   * 光らせるスクエア。選んだカードの手が指しているところだけ。
   *
   * 選んだカードに、置き先の無い手（確認が要るもの）や、押した場所だけでは決まらない手が
   * 混じるなら、先に `ask` で聞くので、聞き終えるまでは空である。
   */
  readonly destinations: readonly DestinationView[]
  /**
   * 光らせる自分のトラップゾーン。`トラップとしてプレイする` を行えるときだけ（#249）。
   * 光らせる条件は `destinations` と同じ（聞くことがあれば、聞き終えるまでは `undefined`）。
   */
  readonly trapZone: TrapZoneView | undefined
  /**
   * 聞くダイアログ。聞くことが無ければ `undefined`（#249）。
   *
   * 選んだカードで行える手が、盤面の行き先だけで決まらないときに出す。手が 1 つなら確認、
   * 2 つ以上なら選ばせる。手の並びは届いた手から作るだけで、押せない手は並ばない
   * （ADR-0010）。
   */
  readonly ask: AskView | undefined
  /**
   * 選んだカードで行える手を、まとめて出すシート（スマートフォン、ADR-0034）。選んだカードが無いとき、
   * 行き先を絞り終えたとき（`selection.aim`）は `undefined`。
   *
   * 聞くことがあるとき（`ask`）は、`ask` と同じ。聞くことが無く行き先を押して決まるだけの手も、スマートフォンでは
   * 先にシートで手を選ばせる（行き先は、手を選んでから光る）ので、その手を種類ごとに並べる。PC は読まない。
   */
  readonly sheet: AskView | undefined
  /**
   * カードに紐づかない手（優先権の放棄）。カードを選んでいない間だけ出す（#249）。
   * プランは山札を押して行うので、ここには入らない。
   *
   * 選んでいる間は、そのカードに関係ない手は出さない。画面に出すかどうかだけを変えていて、
   * 送れる手が減るわけではない（ADR-0010）。選択を外せば戻る。
   */
  readonly untargeted: readonly ActionView[]
  /**
   * パネルに出す案内文。出すことが無ければ `undefined`（ダイアログが聞いている間は、ダイアログ自身が
   * 聞いているので出さない）。
   */
  readonly guide: string | undefined
}

/** 案内文を添える前の `PickView`。 */
type PickBody = Omit<PickView, 'guide'>

/** 行き先を押して行う手の種類。聞くダイアログで「この手にする」と決めた後に、行き先を絞るのに使う。 */
export type AimKind = LegalAction['kind']

/** 聞くダイアログの選択肢 1 つ。押したら、手を送るか、行き先を光らせる。 */
export type AskOption =
  | { readonly label: string; readonly send: LegalAction }
  | { readonly label: string; readonly aim: AimKind }

/**
 * 聞くダイアログ（#249）。選択肢が 1 つなら確認、2 つ以上なら選ばせる。
 *
 * `heading` が何のカードの話かで、読み上げでは見出しに結び付く。`lead` は何を聞いているか。
 * `subject` は見出しが場所の名前（プランゾーン）のときに、そこにあるカードの名前を添える。
 */
export interface AskView {
  readonly heading: string
  readonly subject?: string | undefined
  readonly lead: string
  readonly options: readonly AskOption[]
}

/**
 * ダイアログの選択肢に出す手の呼び名。何のカードかは見出しに出るので、カード名は添えない。
 *
 * 行き先で決まらない手（同じスクエアを指す手が 2 つ以上あるとき）は、行き先を添えて見分ける。
 */
function optionLabelOf(
  action: LegalAction,
  viewer: Player,
  withDestination: boolean,
  playLabel?: string | undefined,
): string {
  const where = (): string => {
    const square = destinationOf(action)
    return withDestination && square !== undefined ? `（${squareLabel(viewer, square)}へ）` : ''
  }
  switch (action.kind) {
    case 'エネルギーを置く':
      return 'エネルギーとして置く'
    case 'カードをプレイする':
      return `${playLabel ?? (action.declaration.square === undefined ? 'プレイする' : 'スクエアにプレイする')}${where()}`
    case 'ユニットを移動する':
      return `移動する${where()}`
    case '起動型能力を起動する':
      return `能力を起動する（${action.ability + 1} 個目）`
    case '優先権を放棄する':
    case 'プランする':
    case 'スマッシュする':
    case 'トラップを廃棄する':
    case 'トラップとしてプレイする':
    case 'トラップを発動する':
    case '「勇気」を起動する':
      return action.kind
  }
}

/**
 * 確認ダイアログで、その手を行うかを尋ねる文。手の呼び名（`optionLabelOf`）は言い切りの形で、
 * 「を行いますか」に当てはめると不自然になるので、手ごとに持つ。
 */
function confirmOf(action: LegalAction): string {
  switch (action.kind) {
    case 'エネルギーを置く':
      return 'エネルギーとして置きますか？'
    case 'カードをプレイする':
      return `${action.declaration.square === undefined ? '' : 'スクエアに'}プレイしますか？`
    case 'ユニットを移動する':
      return '移動しますか？'
    case '起動型能力を起動する':
      return `能力を起動しますか？（${action.ability + 1} 個目）`
    case '優先権を放棄する':
      return '優先権を放棄しますか？'
    case 'プランする':
      return 'プランしますか？'
    case 'スマッシュする':
      return 'スマッシュしますか？'
    case 'トラップを廃棄する':
      return 'トラップを廃棄しますか？'
    case 'トラップとしてプレイする':
      return 'トラップとしてプレイしますか？'
    case 'トラップを発動する':
      return 'トラップを発動しますか？'
    case '「勇気」を起動する':
      return '「勇気」を起動しますか？'
  }
}

/** 選びかけ。カードを選んでいるか、山札を選んでいるか。どちらでもなければ何も選んでいない。 */
export interface PickSelection {
  /** 選んでいるカード。 */
  readonly card?: CardId | undefined
  /**
   * 山札を選んでいる（#249）。プランゾーンにカードが無いときの、プランの入り口。プランゾーンに
   * カードがあるときは、そのカードが山札の場所に見えている（ADR-0027）ので、カードを選ぶ。
   */
  readonly deck?: boolean | undefined
  /** 聞くダイアログで「行き先を押して行う手」を選び終えた、その手の種類。 */
  readonly aim?: AimKind | undefined
}

/** 自分のプランゾーンにある、見えているカード。無ければ `undefined`。 */
function ownPlanInstanceOf(board: WirePerspective): WireCardInstance | undefined {
  const [first] = board.zones[board.viewer]['プランゾーン']

  return first?.kind === '見えている' ? first.instance : undefined
}

function ownPlanCardOf(board: WirePerspective): CardId | undefined {
  return ownPlanInstanceOf(board)?.id
}

/**
 * プランゾーンのカードをプレイする手の呼び名。種別（ユニット・ストラテジー）で呼ぶ。
 * プランゾーンのダイアログは、見出しが場所の名前でカード名が本文に出るので、ボタンでは何をプレイ
 * するのかを種別で言う。ユニットとストラテジー以外は、通常の呼び名のままにする（`undefined`）。
 */
function planPlayLabelOf(card: WireCardInstance | undefined): string | undefined {
  switch (card?.card.type) {
    case 'ユニット':
      return 'ユニットをプレイする'
    case 'ストラテジー':
    case '超必殺ストラテジー！':
      return 'ストラテジーをプレイする'
    default:
      return undefined
  }
}

/**
 * クリックで操作する時の画面。`selection` が選びかけ（何も選んでいなければ空）。
 *
 * 段は 2 つである。カードを選ぶまでは押せるカードを示すだけで、選んだ後にその 1 枚で行える手
 * を出す。置き先を選ぶ手は盤面の上で示すので、そこは押すところが 2 か所（カード →
 * スクエア）になる。それ以外の手は、ダイアログで聞く（`ask`）。
 *
 * プランは、山札（プランゾーンにカードがあればそのカード）を押して始める（#249）。プランする手は
 * カードを指さないが、山札の場所に見えているものを押すので、そのカードの手の 1 つとして聞く。
 *
 * `selection.aim` は、聞くダイアログで「行き先を押して行う手」を選んだ後に、その種類を渡す。
 * 渡すと、その種類の行き先だけが光る。
 */
export function pickView(
  board: WirePerspective,
  actions: readonly LegalAction[],
  selection: PickSelection,
  passOutcome: PassOutcome | undefined,
): PickView {
  const body = arrange(board, actions, selection, passOutcome)

  return { ...body, guide: guideOf(body, board) }
}

/**
 * パネルの案内文。「押す」ではなく「選択」で書く。
 *
 * 押せるものが何も無いときに、相手が優先権を持っていれば、待っていることを言う。`board.turn.priority`
 * は届いた盤面の値を読んでいるだけで、優先権の判断はここでしない。
 */
function guideOf(view: PickBody, board: WirePerspective): string | undefined {
  if (view.ask !== undefined) return undefined
  if (view.picked !== undefined) {
    return view.destinations.length > 0 || view.trapZone !== undefined ? '置く場所を選択してください' : undefined
  }

  const cards = view.pickable.length > 0
  if (cards && view.deckPickable) return '操作するカードを選択してください。プランするには、山札を選択してください'
  if (cards) return '操作するカードを選択してください'
  if (view.deckPickable) return 'プランするには、山札を選択してください'

  return board.turn.priority === board.viewer ? '選択できるカードがありません' : '相手の操作を待っています'
}

/** 行き先とダイアログを組む。案内文は `pickView` が添える。 */
function arrange(
  board: WirePerspective,
  actions: readonly LegalAction[],
  selection: PickSelection,
  passOutcome: PassOutcome | undefined,
): PickBody {
  const names = namesIn(board)
  const view = (action: LegalAction): ActionView => ({
    action,
    label: labelOf(action, board.viewer, names, passOutcome),
    primary: isPrimaryAction(action),
  })

  const planAction = actions.find((action) => action.kind === 'プランする')
  const planCard = ownPlanCardOf(board)
  const targeted = actions.filter((action) => targetOf(action) !== undefined)
  // プランは山札の場所を押して行うので、ボタンとしては出さない。
  const untargeted = actions
    .filter((action) => targetOf(action) === undefined && action.kind !== 'プランする')
    .map(view)
  const pickable = [
    ...new Set([
      ...targeted.flatMap((action) => targetOf(action) ?? []),
      ...(planAction !== undefined && planCard !== undefined ? [planCard] : []),
    ]),
  ]
  const deckPickable = planAction !== undefined && planCard === undefined
  const idle: PickBody = {
    pickable,
    picked: undefined,
    deckPickable,
    deck: false,
    destinations: [],
    trapZone: undefined,
    ask: undefined,
    sheet: undefined,
    untargeted,
  }

  // 届いていないカードは選べない。選んだ後に手が届かなくなることは起こる（盤面が入れ替わる）
  // ので、その時は選んでいない状態と同じ扱いになる。
  const { card: picked, aim } = selection
  const deck = selection.deck === true && deckPickable
  if (!deck && (picked === undefined || !pickable.includes(picked))) return idle

  // 山札の場所を押したなら、プランする手も、選んだものの手になる。
  const pressesPlan = deck || (picked !== undefined && picked === planCard)
  const mine = [
    ...(deck ? [] : targeted.filter((action) => targetOf(action) === picked)),
    ...(pressesPlan && planAction !== undefined ? [planAction] : []),
  ]
  const placing = mine.filter((action) => destinationOf(action) !== undefined)
  // 同じスクエアを指す手が 2 つ以上あるなら、押した場所だけでは決まらない。
  const ambiguous = (action: LegalAction): boolean => {
    const square = destinationOf(action)
    return square !== undefined && placing.filter((other) => sameSquare(destinationOf(other), square)).length > 1
  }
  // 行き先を押して行える手（スクエアを指す手と、自分のトラップゾーンを指す手）。残りは、
  // ダイアログで聞く手。
  const aimable = mine.filter((action) =>
    action.kind === 'トラップとしてプレイする' ? true : placing.includes(action) && !ambiguous(action),
  )
  const asked = mine.filter((action) => !aimable.includes(action))

  // プランゾーンのカードを押して、プランする手も含めて聞くとき。ダイアログの見出しは場所の名前に
  // し、カード名は本文に出す。
  const planZoneCard = !deck && picked !== undefined && picked === planCard && planAction !== undefined ? picked : undefined
  const playLabelOf = (action: LegalAction): string | undefined =>
    planZoneCard !== undefined && action.kind === 'カードをプレイする' && action.declaration.card === planCard
      ? planPlayLabelOf(ownPlanInstanceOf(board))
      : undefined

  // 聞く選択肢。行き先を押して行う手は、種類ごとに 1 つにまとめる。届いた並びの順に出す。
  const options: AskOption[] = []
  for (const action of mine) {
    if (aimable.includes(action)) {
      if (!options.some((option) => 'aim' in option && option.aim === action.kind)) {
        options.push({ label: optionLabelOf(action, board.viewer, false, playLabelOf(action)), aim: action.kind })
      }
    } else {
      options.push({
        label: optionLabelOf(action, board.viewer, ambiguous(action), playLabelOf(action)),
        send: action,
      })
    }
  }

  const selected = { ...idle, picked: deck ? undefined : picked, deck, untargeted: [] }
  const light = (lit: readonly LegalAction[]): PickBody => {
    const trap = lit.find((action) => action.kind === 'トラップとしてプレイする')

    return {
      ...selected,
      destinations: lit.flatMap((action): readonly DestinationView[] => {
        const square = destinationOf(action)
        return square === undefined ? [] : [{ square, action, label: view(action).label }]
      }),
      trapZone: trap === undefined ? undefined : { action: trap, label: view(trap).label },
    }
  }

  // 行き先を押して行う手を選び終えていれば、その種類の行き先だけを光らせる（聞き直さない）。
  if (aim !== undefined && aimable.some((action) => action.kind === aim)) {
    return light(aimable.filter((action) => action.kind === aim))
  }

  const heading =
    planZoneCard !== undefined ? 'プランゾーン' : deck || picked === undefined ? '山札' : nameOf(names, picked)
  const subject = planZoneCard !== undefined ? { subject: nameOf(names, planZoneCard) } : {}
  const [only] = options
  const lead = options.length === 1 && only !== undefined && 'send' in only ? confirmOf(only.send) : 'どれにしますか？'
  const ask: AskView = { heading, ...subject, lead, options }

  // 聞くことが無ければ、行き先を全部光らせる。スマートフォンのシートだけは、手を種類ごとに並べて先に選ばせる。
  if (asked.length === 0) return { ...light(aimable), sheet: { ...ask, lead: SHEET_LEAD } }

  return { ...selected, ask, sheet: ask }
}

/** 聞くことが無い手を、シートに並べるときの問いの文。 */
const SHEET_LEAD = 'このカードで行える手'

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
  /** 押せる裏向きのカードの置き場所（#127）。裏向きの候補が並ばない場面では空になる。 */
  readonly hidden: readonly WireCardPosition[]
  /** その置き場所の札を押した時に答える番号。押せない置き場所なら `undefined`。 */
  readonly answerOfHidden: (at: WireCardPosition) => number | undefined
  /**
   * 盤面から押して答えられる候補の番号（#150）。
   *
   * ボタンを二重に出さないために `choiceView` が読む。**押せるかどうかを 2 か所で決めない**
   * ようにするための言い直しで、上の 3 つと同じものを番号の並びとして見せているだけである。
   * 番号は昇順で、同じ番号は 1 度だけ並ぶ（エリアの候補は 3 つのスクエアが同じ番号を持つ）。
   */
  readonly onBoard: readonly number[]
}

/**
 * 選ぶ候補のうち、盤面の上で押せるものを結び付ける。
 *
 * 候補を番号のボタンで並べる（`choiceView`）だけだと、エネルギーゾーンに見えているカードや、
 * 効果が置き先に選ばせているスクエアを選ぶのに、盤面ではなく番号の並びを見ることになる。
 * **盤面に出ている候補は、盤面のそこを押しても答えられる**ようにする。答えるのは番号のまま
 * なので、通信は変わらない。
 *
 * 押せるのは、見えているカード（`見えている`）、スクエア（#113）、エリア（#278。そのエリアの 3 つの
 * スクエアのどれを押しても同じ答えになる）、そして**盤面のどこにあるかが
 * 分かっている裏向きのカード**（#127）である。裏向きのカードも候補になる（プランのコスト、
 * 総合ルール 第2部 第21章 7-5）が、識別子は届かない。かわりに置き場所（`protocol.ts` の
 * `WireCardPosition`）で結び付ける。**能力の候補だけはボタンのまま**で、押す先が盤面に無い。
 *
 * **押せるのは、盤面が実際に描いているものだけである**（`view-model.ts` の `drawnOnBoard`、
 * #150）。候補は届いたものから作るので、リゾルブゾーンにあるカードのように**見えてはいるが
 * 盤面には描かれない**ものが混じりうる。それを押せる扱いにすると、光る先が画面のどこにも無い
 * まま、ボタンだけが消えることになる。
 */
export function choicePicking(board: WirePerspective, choice: WireChoice): ChoicePicking {
  const drawn = drawnOnBoard(board)
  const answers = new Map<CardId, number>()
  // スクエアは行と列の組なので、そのままでは鍵にできない。盤面の並びの番号に直して引く。
  const bySquare = new Map<number, { readonly view: PickableSquare; readonly answer: number }>()
  // 置き場所も組なので、同じように 1 つの鍵に直して引く。
  const byPosition = new Map<string, { readonly at: WireCardPosition; readonly answer: number }>()
  choice.candidates.forEach((candidate, index) => {
    // 同じものが 2 度並ぶことは無いが、並んだとしても先に出たほうを答えにする。
    if (candidate.kind === '見えている' && drawn.ids.has(candidate.card) && !answers.has(candidate.card)) {
      answers.set(candidate.card, index)
    }
    if (candidate.kind === '見えていない' && candidate.at !== undefined) {
      const key = keyOfPosition(candidate.at)
      if (drawn.positions.has(key) && !byPosition.has(key)) byPosition.set(key, { at: candidate.at, answer: index })
    }
    if (candidate.kind === 'スクエア') {
      const key = indexOfSquare(candidate.square)
      if (bySquare.has(key)) return
      // 呼び名は見る人によって入れ替わる（総合ルール 第2部 第22章 4・6）ので、受け取った
      // 側から見た呼び名にする（`choiceView` の候補と同じ）。
      const label = `${squareLabel(board.viewer, candidate.square)}を選ぶ`
      bySquare.set(key, { view: { square: candidate.square, label }, answer: index })
    }
    if (candidate.kind === 'エリア') {
      // エリアは盤面の行で届く。そのエリアの 3 つのスクエアのどれを押しても、この候補が答えになる。
      // 光らせる行は、届いた候補の行そのものである（ADR-0010）。
      const label = `${areaLabel(board.viewer, candidate.row)}を選ぶ`
      for (const column of SQUARE_COLUMNS) {
        const square: Square = { row: candidate.row, column }
        const key = indexOfSquare(square)
        if (!bySquare.has(key)) bySquare.set(key, { view: { square, label, wholeArea: true }, answer: index })
      }
    }
  })

  return {
    pickable: [...answers.keys()],
    answerOf: (card) => answers.get(card),
    squares: [...bySquare.values()].map((each) => each.view),
    answerOfSquare: (square) => bySquare.get(indexOfSquare(square))?.answer,
    hidden: [...byPosition.values()].map((each) => each.at),
    answerOfHidden: (at) => byPosition.get(keyOfPosition(at))?.answer,
    // エリアの候補は 3 つのスクエアに同じ番号が付くので、重ねずに 1 度だけ数える。
    onBoard: [
      ...new Set([
        ...answers.values(),
        ...[...bySquare.values()].map((each) => each.answer),
        ...[...byPosition.values()].map((each) => each.answer),
      ]),
    ].sort((a, b) => a - b),
  }
}

/**
 * 選ぶのを待たれている候補に、そのプレイヤーのエネルギー・スマッシュのカードが入っているか。
 *
 * スマートフォンでは、エネルギー・スマッシュは一覧で開く（ADR-0034）。コストの選択中に開いた一覧は
 * 払うカードを選ぶ一覧で、選び終えたら閉じる。その見分けに使う。押せるかどうかは `choicePicking` が
 * すでに決めているので、ここでは候補と置き場所を突き合わせるだけにする。
 */
export function choosesFromZone(
  board: WirePerspective,
  choice: WireChoice,
  player: Player,
  zone: 'エネルギーゾーン' | 'スマッシュゾーン',
): boolean {
  const picking = choicePicking(board, choice)

  return board.zones[player][zone].some((card, index) =>
    card.kind === '見えている'
      ? picking.pickable.includes(card.instance.id)
      : picking.hidden.some((at) => keyOfPosition(at) === keyOfPosition({ player, zone, index })),
  )
}

/** 選ぶ候補のうち、盤面から押せないもの。`picking` が渡されなければ全部が該当する。 */
export function offBoardCandidates(
  choice: WireChoice,
  picking: ChoicePicking | undefined,
): readonly { readonly index: number; readonly candidate: WireCandidate }[] {
  return choice.candidates.flatMap((candidate, index) =>
    picking !== undefined && picking.onBoard.includes(index) ? [] : [{ index, candidate }],
  )
}

/**
 * カードの一覧（`render.ts` の `pickerElement` の「選ぶ」、ADR-0027）を出すべきか。
 *
 * ADR の「盤面に見えていない置き場から選ぶときだけ使う」のとおり、候補が 1 つでも盤面から
 * 押せるなら出さない。盤面の候補と一覧の候補が混ざると、盤面の候補を押す場所が一覧に
 * 覆われてしまう（#207）。混ざる場合は、これまでどおり番号のボタンで並べる
 * （盤面から押せる分は `choiceView` が二重に出さない、#150）。
 *
 * 候補が全部盤面の外にあるとしても、能力・スクエア・エリアが混じる場面は番号のボタンのままにする。
 * 一覧はカードの面を並べるためのものなので、カードではない候補を描く先が無い。
 */
export function showsChoicePicker(
  choice: WireChoice,
  offBoard: readonly { readonly candidate: WireCandidate }[],
): boolean {
  return (
    offBoard.length > 0 &&
    offBoard.length === choice.candidates.length &&
    offBoard.every(({ candidate }) => candidate.kind === '見えている' || candidate.kind === '見えていない')
  )
}
