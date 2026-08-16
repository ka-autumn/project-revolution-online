import { areaOf, indexOfSquare, lineOf, squareFromView } from '@revolution/engine'
import type {
  Area,
  BattleStep,
  CardId,
  Orientation,
  Player,
  PlayerZone,
  Square,
  SquareIndex,
  WireCardFace,
  WireCardInstance,
  WirePerspective,
  WireVisibleCard,
} from '@revolution/engine'

/**
 * 届いた盤面から、画面に出す値を作る（#14）。
 *
 * **ここが唯一のテストできる層である。** DOM を触るところ（`render.ts`）はこれを読んで書くだけ
 * にして、画面に何が出るかの判断はすべてここに寄せている。
 *
 * **隠す判断は持たない。** 見えていないカードは `見えていない` として届く（ADR-0004）ので、
 * ここでできるのは届いたものを描く形に直すことだけである。届いていないものは、描きようがない
 * から画面に出ない。
 */

/** カードの詳細に出す 1 行。 */
export interface DetailRow {
  readonly label: string
  readonly value: string
}

/** 画面に出す 1 枚。 */
export type CardView =
  | {
      /** 表側が見えている。 */
      readonly kind: '表'
      readonly id: CardId
      readonly name: string
      /**
       * 支配者が見る人自身か、相手か（総合ルール 第4部 第7章 1）。
       *
       * **持ち主ではなく支配者で決める。** スクエアにいるユニットが「味方」か「敵」かを分ける
       * のは支配者である（同 第2部 第21章 8-2）。持ち主と支配者は食い違いうる（`duel.ts` の
       * `instantiate`）ので、食い違っていれば詳細のほうに両方出る。
       *
       * **1 枚ごとに持つ。** バトル中は支配者の違う 2 体が同じスクエアに並ぶ（同 第3部 第11章 1）
       * ので、スクエア単位では決まらない。
       */
      readonly controlledBy: '自分' | '相手'
      /** 小さいカードに添える 1 行。「Lv1 赤 BP1000 SP1000」のような形。 */
      readonly summary: string
      /** 詳しく見たときに出す全部。**能力テキストは持たない**（通信に載っていない、#93）。 */
      readonly details: readonly DetailRow[]
      readonly orientation: Orientation
      /** 乗っているダメージ（総合ルール 第2部 第16章）。 */
      readonly damage: number
    }
  | {
      /**
       * 表側が見えていない。
       *
       * **識別子を持たない。** 識別子はシャッフル前のデッキでの番号から作られている
       * （`setup.ts` の `library`）ので、自分のデッキの並びを知っていればそれがカードの正体に
       * なる。そもそも届いていない（`perspective.ts` の `VisibleCard`）。
       */
      readonly kind: '裏'
      readonly orientation: Orientation
    }

/** 画面に出すスクエア 1 つ。 */
export interface SquareView {
  /** 盤面に固定した位置。行動を送るときに使う（`board.ts` の `Square`）。 */
  readonly square: Square
  /** 見る人から見たエリア（総合ルール 第2部 第22章 6）。 */
  readonly area: Area
  readonly cards: readonly CardView[]
}

/** 画面に出すゾーン 1 つ。 */
export interface ZoneView {
  readonly zone: PlayerZone
  /** 枚数。公開情報である（総合ルール 第2部 第23章 1-1）。 */
  readonly count: number
  /**
   * 並べるカード。**山札だけは空になる。**
   *
   * 山札は持ち主であっても中身を見てはならない（総合ルール 第2部 第21章 2-2）ので、届くのは
   * 裏向きばかりである。1 枚ずつ並べても見分けが付かず、意味があるのは枚数だけである。
   */
  readonly cards: readonly CardView[]
}

/** 画面に出す、片方のプレイヤーの持ち物。 */
export interface SideView {
  readonly player: Player
  /** 見る人自身か、相手か。 */
  readonly whose: '自分' | '相手'
  /** 受けているダメージ（総合ルール 第2部 第17章）。 */
  readonly damage: number
  /** 並べる順に並んだゾーン。 */
  readonly zones: readonly ZoneView[]
}

/**
 * 解決を待っている能力 1 つ（総合ルール 第2部 第21章 11）。
 *
 * **何をする能力かは出せない。** 効果は関数なので射影の時点で落としてある
 * （`perspective.ts` の `VisibleAbility`）。出せるのは誰の能力で、どのカードから出たかまで。
 * それでも「バンクに何か積まれている」はスマッシュを行えるかを左右する（`priority.ts` の
 * `activePlayerMayAct`）ので、見えるだけで判断に効く。
 */
export interface AbilityView {
  readonly whose: '自分' | '相手'
  /** 発生源のカードの名前。作成された誘発型能力など、指せないものは `undefined`。 */
  readonly source: string | undefined
}

/** 発生しているバトル（総合ルール 第3部 第11章）。 */
export interface BattleView {
  /** 見る人から見たスクエアの呼び名。 */
  readonly where: string
  readonly step: BattleStep
  /** 攻撃したユニットの名前（総合ルール 第3部 第11章 4）。 */
  readonly attacker: string
  /** 攻撃されたユニットの名前（同 4）。 */
  readonly attacked: string
}

/** 画面に出す盤面ひととおり。 */
export interface BoardView {
  readonly seat: Player
  /** 「第 3 ターン・メインフェイズ・自分の優先権」のような 1 行。 */
  readonly turn: string
  /** 発生しているバトル。無ければ `undefined`。 */
  readonly battle: BattleView | undefined
  /** バンクで解決を待っている能力（総合ルール 第2部 第21章 11-1）。 */
  readonly bank: readonly AbilityView[]
  /** 誘発したが、まだバンクに置かれていない能力（同 第4部 第3章 3）。 */
  readonly triggered: readonly AbilityView[]
  /** 相手の持ち物。画面の上に出す。 */
  readonly opponent: SideView
  /** 自分の持ち物。画面の下に出す。 */
  readonly own: SideView
  /**
   * 3×3 のスクエア。**見る人の向きに直してある**（上が敵エリア、下が味方エリア）。
   *
   * 外側が上から下の行、内側が左から右の列である。
   */
  readonly squares: readonly (readonly SquareView[])[]
  /** 決着していれば、その 1 行。 */
  readonly result: string | undefined
}

/** ゾーンを並べる順。届く順ではなく、画面での置き場所である。 */
const ZONE_ORDER: readonly PlayerZone[] = [
  '手札',
  'エネルギーゾーン',
  'トラップゾーン',
  'スマッシュゾーン',
  'プランゾーン',
  '捨札',
  '山札',
  'リムーブゾーン',
  'パートナーゾーン',
]

/** 中身を並べず、枚数だけを出すゾーン。 */
const COUNTED_ZONES: readonly PlayerZone[] = ['山札']

const SQUARE_INDEXES: readonly SquareIndex[] = [0, 1, 2]

/**
 * 表側が見えているカードを、識別子で名前が引ける表にする。
 *
 * 行える手（`input-model.ts`）もバトルもバンクも、カードを識別子で指してくる。名前に直せるのは
 * 盤面に載っているものだけである。
 */
export function namesIn(board: WirePerspective): ReadonlyMap<CardId, string> {
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
 * **名前を作り出さない。** 届いていないカードが指されたら、そのまま見えていないと出す。
 */
export function nameOf(names: ReadonlyMap<CardId, string>, id: CardId): string {
  return names.get(id) ?? '見えていないカード'
}

/** 見る人から見たスクエアの呼び方（総合ルール 第2部 第22章 4・6）。 */
export function squareLabel(viewer: Player, square: Square): string {
  return `${areaOf(viewer, square)}の${lineOf(viewer, square)}`
}

/**
 * 印刷された図に描かれたスクエアの呼び方（トリガーアイコン）。
 *
 * 印刷は支配者の手前を基準にしている（`board.ts` の `squareFromView`）。先攻がその基準の向き
 * なので、先攻から見た呼び名がそのまま「カードに描かれている位置」の呼び名になる。**盤面の
 * どこかを指しているのではない**ので、見る人が誰かとは関係しない。
 */
function printedSquareLabel(printed: Square): string {
  return squareLabel('先攻', printed)
}

const COLORLESS = '無色'

function colorsOf(face: WireCardFace): string {
  return face.colors.length === 0 ? COLORLESS : face.colors.join('・')
}

/** カードに書かれていることを 1 行にする。 */
function summaryOf(face: WireCardFace): string {
  const body = face.type === 'ユニット' ? `BP${face.bp} SP${face.sp}` : face.type
  const attributes = face.attributes.length === 0 ? '' : ` 《${face.attributes.join('・')}》`

  return `Lv${face.level} ${colorsOf(face)} ${body}${attributes}`
}

/**
 * 詳しく見たときに出す全部。
 *
 * 持っていない項目は行ごと出さない（スターを持たないカードに「スター 0」と書かない）。
 * **能力テキストはここに無い。** 通信に載っていないためで、載せるのは #93。
 */
function detailsOf(instance: WireCardInstance, viewer: Player): readonly DetailRow[] {
  const face = instance.card
  const rows: DetailRow[] = [
    { label: '種別', value: face.type },
    { label: 'レベル', value: String(face.level) },
    { label: '色', value: colorsOf(face) },
    { label: '支配者', value: whoseLabel(viewer, instance.controller) },
  ]

  // 持ち主と支配者は食い違いうる。同じなら 1 行で足りる。
  if (instance.owner !== instance.controller) {
    rows.push({ label: '持ち主', value: whoseLabel(viewer, instance.owner) })
  }

  if (face.type === 'ユニット') {
    rows.push({ label: 'ＢＰ', value: String(face.bp) }, { label: 'ＳＰ', value: String(face.sp) })
    if (face.moveIcon.length > 0) rows.push({ label: 'ムーブアイコン', value: face.moveIcon.join('・') })
  }
  if (face.type === 'トラップ' && face.triggerIcon.length > 0) {
    rows.push({ label: 'トリガーアイコン', value: face.triggerIcon.map(printedSquareLabel).join('・') })
  }
  if (face.stars > 0) rows.push({ label: 'スター', value: String(face.stars) })
  if (face.reverseStars > 0) rows.push({ label: 'リバーススター', value: String(face.reverseStars) })
  if (face.attributes.length > 0) rows.push({ label: '属性', value: face.attributes.join('・') })

  rows.push({ label: '向き', value: instance.orientation })
  if (instance.damage > 0) rows.push({ label: 'ダメージ', value: String(instance.damage) })

  return rows
}

function faceUpView(instance: WireCardInstance, viewer: Player): CardView {
  return {
    kind: '表',
    id: instance.id,
    name: instance.card.name,
    controlledBy: whoseLabel(viewer, instance.controller),
    summary: summaryOf(instance.card),
    details: detailsOf(instance, viewer),
    orientation: instance.orientation,
    damage: instance.damage,
  }
}

function cardView(card: WireVisibleCard, viewer: Player): CardView {
  return card.kind === '見えている'
    ? faceUpView(card.instance, viewer)
    : { kind: '裏', orientation: card.orientation }
}

function zoneView(board: WirePerspective, owner: Player, zone: PlayerZone): ZoneView {
  const cards = board.zones[owner][zone]

  return {
    zone,
    count: cards.length,
    cards: COUNTED_ZONES.includes(zone) ? [] : cards.map((card) => cardView(card, board.viewer)),
  }
}

/** そのプレイヤーが見る人自身か、相手か。 */
function whoseLabel(viewer: Player, player: Player): '自分' | '相手' {
  return player === viewer ? '自分' : '相手'
}

/** 見る人自身のものか、相手のものか。 */
function whoseOf(board: WirePerspective, player: Player): '自分' | '相手' {
  return whoseLabel(board.viewer, player)
}

function sideView(board: WirePerspective, player: Player): SideView {
  return {
    player,
    whose: whoseOf(board, player),
    damage: board.damage[player],
    zones: ZONE_ORDER.map((zone) => zoneView(board, player, zone)),
  }
}

/**
 * 見る人の向きに直したスクエアの並び。
 *
 * 盤面はどちらのプレイヤーから見ても同じ行・列で届く（`board.ts` の `Square`）が、画面では
 * **見る人の味方エリアを下に**置きたい。行と列を見る人から見た向きに折り返すのは
 * `squareFromView` がすでに知っているので、それを使う。折り返した後の行 0 が見る人の手前
 * なので、画面では上下を逆にして並べる。
 */
function squareViews(board: WirePerspective): readonly (readonly SquareView[])[] {
  const seen = (row: SquareIndex, column: SquareIndex): Square => squareFromView(board.viewer, { row, column })

  return [...SQUARE_INDEXES].reverse().map((row) =>
    SQUARE_INDEXES.map((column): SquareView => {
      const square = seen(row, column)
      return {
        square,
        area: areaOf(board.viewer, square),
        cards: board.squares[indexOfSquare(square)]?.map((card) => faceUpView(card, board.viewer)) ?? [],
      }
    }),
  )
}

/** ターンの様子を 1 行にする。 */
function turnLine(board: WirePerspective): string {
  const whose = (player: Player): string => whoseOf(board, player)

  return `第 ${board.turn.number} ターン・${whose(board.turn.active)}のターン・${board.turn.phase}・${whose(
    board.turn.priority,
  )}の優先権`
}

/** 発生しているバトル。 */
function battleView(board: WirePerspective, names: ReadonlyMap<CardId, string>): BattleView | undefined {
  const battle = board.battle
  if (battle === undefined) return undefined

  return {
    where: squareLabel(board.viewer, battle.square),
    step: battle.step,
    attacker: nameOf(names, battle.attacker),
    attacked: nameOf(names, battle.attacked),
  }
}

/** 解決を待っている能力の並び。 */
function abilityViews(
  board: WirePerspective,
  abilities: readonly { readonly controller: Player; readonly source: CardId | undefined }[],
  names: ReadonlyMap<CardId, string>,
): readonly AbilityView[] {
  return abilities.map((ability) => ({
    whose: whoseOf(board, ability.controller),
    source: ability.source === undefined ? undefined : nameOf(names, ability.source),
  }))
}

/** 決着していれば、その 1 行。 */
function resultLine(board: WirePerspective): string | undefined {
  const result = board.result
  if (result === undefined) return undefined
  if (result.kind === '引き分け') return '引き分け'

  return result.winner === board.viewer ? '勝ち' : '負け'
}

/** 届いた盤面を、画面に出す形にする。 */
export function boardView(board: WirePerspective): BoardView {
  const opponent = board.viewer === '先攻' ? '後攻' : '先攻'
  const names = namesIn(board)

  return {
    seat: board.viewer,
    turn: turnLine(board),
    battle: battleView(board, names),
    bank: abilityViews(board, board.bank, names),
    triggered: abilityViews(board, board.triggered, names),
    opponent: sideView(board, opponent),
    own: sideView(board, board.viewer),
    squares: squareViews(board),
    result: resultLine(board),
  }
}
