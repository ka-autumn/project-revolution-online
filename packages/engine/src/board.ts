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
 * そのスクエアが `BATTLE_SPACE` の何番目か。
 *
 * スクエアごとの情報を `BATTLE_SPACE` と同じ並びの配列で持つ側が、行・列との対応づけを
 * それぞれで書かずに済むように、並べ方を知っているこのファイルに置いている。
 */
export function indexOfSquare(square: Square): number {
  return square.row * SQUARE_INDEXES.length + square.column
}
