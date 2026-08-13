import type { Player } from './player.js'

/**
 * あるプレイヤーから見た、バトルスペースの横 1 列。3 つのスクエアからなる。
 *
 * ゾーンではない（総合ルール 第2部 第22章 1）。あるプレイヤーの味方エリアは相手の
 * 敵エリアになるため、同じ呼び名でも見るプレイヤーによって指すスクエアが変わる
 * （総合ルール 第2部 第22章 6）。どちらから見た呼び名かは、ルールならそのルールに
 * 従って行動するプレイヤー、カードや能力ならその支配者で決まる（同 6-1）。
 *
 * 総合ルール 第2部 第22章 5。
 */
export const AREAS = ['味方エリア', '中央エリア', '敵エリア'] as const

export type Area = (typeof AREAS)[number]

/**
 * あるプレイヤーから見た、バトルスペースの縦 1 列。3 つのスクエアからなる。
 *
 * ゾーンではない（総合ルール 第2部 第22章 1）。あるプレイヤーの右ラインは相手の
 * 左ラインになるため、同じ呼び名でも見るプレイヤーによって指すスクエアが変わる
 * （総合ルール 第2部 第22章 4）。どちらから見た呼び名かは、ルールならそのルールに
 * 従って行動するプレイヤー、カードや能力ならその支配者で決まる（同 4-1）。
 *
 * 総合ルール 第2部 第22章 3。
 */
export const LINES = ['左ライン', '中央ライン', '右ライン'] as const

export type Line = (typeof LINES)[number]

/** バトルスペースの行番号・列番号。3×3 なので 0・1・2 のいずれか。 */
export type SquareIndex = 0 | 1 | 2

const SQUARE_INDEXES = [0, 1, 2] as const satisfies readonly SquareIndex[]

/**
 * ユニットが 1 枚置かれる 1 マス。スクエアはそれぞれが単独のゾーンである
 * （総合ルール 第2部 第21章 1-1）。
 *
 * エリアとラインの呼び名は見るプレイヤーによって入れ替わる（総合ルール 第2部
 * 第22章 4・6）ため、スクエアそのものの識別には使えない。そこで盤面に固定した
 * 行・列で識別する。`row` と `column` は総合ルールの語ではなく、エリア・ラインの
 * 訳語でもない。横 1 列がエリア、縦 1 列がラインにあたるが、その列を味方エリアと
 * 呼ぶか敵エリアと呼ぶかは、どちらのプレイヤーから見るかと組にして初めて決まる。
 */
export interface Square {
  readonly row: SquareIndex
  readonly column: SquareIndex
}

/**
 * ユニットを置くことができる 9 つのスクエアの集まり。両方のプレイヤーで共有する。
 *
 * いくつかのスクエアをまとめてグループとしてとらえた場所の呼び方であって、
 * ゾーンではない（総合ルール 第2部 第22章 1）。
 *
 * 総合ルール 第2部 第22章 2。
 */
export const BATTLE_SPACE: readonly Square[] = SQUARE_INDEXES.flatMap((row) =>
  SQUARE_INDEXES.map((column): Square => ({ row, column })),
)

/**
 * 先攻のプレイヤーの味方エリアにあたる行。
 *
 * どちらの行を先攻の手前とするかは総合ルールが決めることではない。エリアの呼び名は
 * 見るプレイヤーによって入れ替わる（総合ルール 第2部 第22章 6）だけで、盤面のどちら側に
 * 座るかに意味は無いためである。行で識別する以上どちらかに決めておく必要があるので、
 * 0 を先攻の手前とする。
 */
const HOME_ROW_OF_FIRST: SquareIndex = 0

/** 中央エリアにあたる行。どちらのプレイヤーから見ても中央エリアである。 */
const CENTER_ROW: SquareIndex = 1

/**
 * そのプレイヤーから見た、そのスクエアのあるエリア（総合ルール 第2部 第22章 6）。
 *
 * あるプレイヤーの味方エリアは相手の敵エリアになるため、同じスクエアでも見るプレイヤーに
 * よって答えが変わる。ルールがエリアを指定する場合は、そのルールに従って行動する
 * プレイヤーから見て判断する（同 6-1）。
 */
export function areaOf(player: Player, square: Square): Area {
  if (square.row === CENTER_ROW) return '中央エリア'

  const home = player === '先攻' ? HOME_ROW_OF_FIRST : oppositeIndex(HOME_ROW_OF_FIRST)
  return square.row === home ? '味方エリア' : '敵エリア'
}

/** 盤面の反対側の行または列。 */
function oppositeIndex(index: SquareIndex): SquareIndex {
  return index === 0 ? 2 : index === 2 ? 0 : 1
}

/**
 * そのスクエアが `BATTLE_SPACE` の何番目か。
 *
 * スクエアごとの情報を `BATTLE_SPACE` と同じ並びの配列で持つ側が、行・列との対応づけを
 * それぞれで書かずに済むように、並べ方を知っているこのファイルに置いている。
 */
export function indexOfSquare(square: Square): number {
  return square.row * SQUARE_INDEXES.length + square.column
}

/**
 * ムーブアイコンに描かれた矢印の向き（総合ルール 第2部 第11章、第3部 第8章 2-5）。
 *
 * 総合ルールは矢印が上下左右斜めいずれの方向も取り得るとしている（同 2-5）が、斜めの
 * ムーブアイコンを持つカードを実装するまでは参照する必要が無いので、4 方向だけを持つ
 * （`card.ts` の属性・トリガーアイコンと同じ考え方）。
 */
export const MOVE_DIRECTIONS = ['上', '下', '左', '右'] as const

export type MoveDirection = (typeof MOVE_DIRECTIONS)[number]

/**
 * そのスクエアから見て、そのプレイヤーにとってムーブアイコンの方向にあり隣接するスクエア
 * （総合ルール 第4部 第6章 2-1）。バトルスペースの外に出るスクエアは無いので `undefined`。
 *
 * 上下だけでなく左右も支配者から見て判断する。あるプレイヤーの右ラインは相手の左ラインに
 * なる（同 第2部 第22章 4）のと同じ理由で、盤面に固定した行・列とプレイヤーから見た
 * 方向の対応は、どちらのプレイヤーかによって入れ替わる（`areaOf` の行の扱いと同じ）。
 */
export function squareInDirection(player: Player, square: Square, direction: MoveDirection): Square | undefined {
  const forward = player === '先攻' ? 1 : -1
  const [rowDelta, columnDelta] = deltaOf(direction, forward)

  const row = square.row + rowDelta
  const column = square.column + columnDelta
  return isSquareIndex(row) && isSquareIndex(column) ? { row, column } : undefined
}

function deltaOf(direction: MoveDirection, forward: 1 | -1): readonly [number, number] {
  switch (direction) {
    case '上':
      return [forward, 0]
    case '下':
      return [-forward, 0]
    case '左':
      return [0, -forward]
    case '右':
      return [0, forward]
  }
}

function isSquareIndex(value: number): value is SquareIndex {
  return value === 0 || value === 1 || value === 2
}

/**
 * そのスクエアの左右に接するスクエア（総合ルール 第5部 第4章 2）。盤面の端なら 1 つ。
 *
 * 左ライン・右ラインの呼び名は見るプレイヤーによって入れ替わる（総合ルール 第2部 第22章 4）
 * が、左右の両側をまとめたこの 1〜2 マスはどちらから見ても同じ集まりになる。そのため
 * `squareInDirection` と違ってプレイヤーを受け取らない。
 */
export function squaresBeside(square: Square): readonly Square[] {
  return [square.column - 1, square.column + 1]
    .filter(isSquareIndex)
    .map((column) => ({ row: square.row, column }))
}

/**
 * 印刷された図として描かれたスクエア（トリガーアイコンなど）を、そのプレイヤーから見て
 * 解釈した、盤面に固定した行・列のスクエアに変換する。
 *
 * カード 1 枚につき印刷は 1 通りしかないが、ムーブアイコンの矢印の向きが支配者から見て
 * 解釈される（`squareInDirection` 参照）のと同じ理由で、印刷された図に描かれた位置も
 * 支配者の手前を基準にしていると見なす。先攻を基準の向きとして受け取った図をそのまま返し、
 * 後攻から見る場合は縦・横とも反対側に折り返す（あるプレイヤーの右ラインは相手の左ライン、
 * 味方エリアは相手の敵エリアになる、総合ルール 第2部 第22章 4・6 と同じ入れ替わり方）。
 */
export function squareFromView(player: Player, printed: Square): Square {
  if (player === '先攻') return printed
  return { row: oppositeIndex(printed.row), column: oppositeIndex(printed.column) }
}
