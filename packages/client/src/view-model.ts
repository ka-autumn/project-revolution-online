import { areaOf, indexOfSquare, squareFromView } from '@revolution/engine'
import type {
  Area,
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

/** 画面に出す 1 枚。 */
export type CardView =
  | {
      /** 表側が見えている。 */
      readonly kind: '表'
      readonly id: CardId
      readonly name: string
      /** 名前に添える 1 行。「Lv1 赤 BP1000 SP1000」のような形。 */
      readonly detail: string
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

/** 画面に出す盤面ひととおり。 */
export interface BoardView {
  readonly seat: Player
  /** 「第 3 ターン・メインフェイズ・自分の優先権」のような 1 行。 */
  readonly turn: string
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

/** カードに書かれていることを 1 行にする。 */
function detailOf(face: WireCardFace): string {
  const colors = face.colors.length === 0 ? '無色' : face.colors.join('・')
  const body = face.type === 'ユニット' ? `BP${face.bp} SP${face.sp}` : face.type
  const attributes = face.attributes.length === 0 ? '' : ` 《${face.attributes.join('・')}》`

  return `Lv${face.level} ${colors} ${body}${attributes}`
}

function faceUpView(instance: WireCardInstance): CardView {
  return {
    kind: '表',
    id: instance.id,
    name: instance.card.name,
    detail: detailOf(instance.card),
    orientation: instance.orientation,
    damage: instance.damage,
  }
}

function cardView(card: WireVisibleCard): CardView {
  return card.kind === '見えている' ? faceUpView(card.instance) : { kind: '裏', orientation: card.orientation }
}

function zoneView(board: WirePerspective, owner: Player, zone: PlayerZone): ZoneView {
  const cards = board.zones[owner][zone]

  return {
    zone,
    count: cards.length,
    cards: COUNTED_ZONES.includes(zone) ? [] : cards.map(cardView),
  }
}

function sideView(board: WirePerspective, player: Player): SideView {
  return {
    player,
    whose: player === board.viewer ? '自分' : '相手',
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
        cards: board.squares[indexOfSquare(square)]?.map(faceUpView) ?? [],
      }
    }),
  )
}

/** ターンの様子を 1 行にする。 */
function turnLine(board: WirePerspective): string {
  const whose = (player: Player): string => (player === board.viewer ? '自分' : '相手')

  return `第 ${board.turn.number} ターン・${whose(board.turn.active)}のターン・${board.turn.phase}・${whose(
    board.turn.priority,
  )}の優先権`
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

  return {
    seat: board.viewer,
    turn: turnLine(board),
    opponent: sideView(board, opponent),
    own: sideView(board, board.viewer),
    squares: squareViews(board),
    result: resultLine(board),
  }
}
