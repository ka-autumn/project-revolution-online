import type { Deck, Player, Seat } from '@revolution/engine'
import { playCpuDuel } from './duel.js'
import type { CpuDuelResult } from './duel.js'
import type { CpuPlayer } from './player.js'

/**
 * 2 つの CPU を比べて、勝率を測る仕組み（ADR-0060 の段階 1、#365）。
 *
 * CPU を変更するときは、ここで前の CPU に勝ち越すことを確認してから入れる（ADR-0060）。勝ち越したと
 * 言える基準は ADR-0061 にある。
 */

/** 勝率を測る時に組ませるデッキの組み合わせ 1 つ。 */
export interface DeckPairing {
  /** 結果の内訳に出す名前。 */
  readonly name: string
  /**
   * 席 0 に置くデッキと、席 1 に置くデッキ。どちらの CPU が座っても、席に置くデッキは変更しない。
   * 1 組の 2 回のデュエルで CPU の席を入れ替えるので、挑む側はどちらのデッキでも 1 回ずつ打つ。
   */
  readonly decks: readonly [Deck, Deck]
}

export interface ComparisonOptions {
  /** 強くなったかを確認したい CPU。 */
  readonly challenger: CpuPlayer
  /** 比べる相手。ふつうは前の段階の CPU。 */
  readonly baseline: CpuPlayer
  /** 組ませるデッキの組み合わせ。1 組ごとに順に回す。 */
  readonly pairings: readonly DeckPairing[]
  /**
   * 打つデュエルの数。2 回のデュエルを 1 組にするので偶数にする。
   *
   * 1 組の 2 回は、同じシードと同じデッキで、CPU の席だけを入れ替えて打つ。山札の並びも先攻・後攻も
   * 同じになるので、2 回の違いは CPU だけになる。
   */
  readonly duels: number
  /** 最初の組のシード。組ごとに 1 ずつ進める。 */
  readonly seed: number
  readonly maxActions: number
}

/** 挑む側から見た勝ち負けの数。 */
export interface Tally {
  readonly wins: number
  readonly losses: number
  readonly draws: number
  /** 手数上限で打ち切ったデュエル。 */
  readonly unfinished: number
}

export interface ComparisonResult {
  readonly total: Tally
  /** 挑む側が先攻だったデュエルと、後攻だったデュエル。 */
  readonly byPosition: Readonly<Record<Player, Tally>>
  /** デッキの組み合わせごと。`pairings` と同じ並び。 */
  readonly byPairing: readonly { readonly name: string; readonly tally: Tally }[]
  readonly verdict: Verdict
}

/**
 * 勝ち越したかの判定（ADR-0061）。
 *
 * 決着したデュエルの勝率の 95% 信頼区間（Wilson）の下限が、50% を上回れば勝ち越しとする。デュエルの
 * 数が少ないと区間が広がるので、たまたま勝ち越しただけでは勝ち越しにならない。引き分けと手数上限は
 * 勝率に入れない。
 *
 * 1 組の 2 回は同じシードを使うので独立な試行ではないが、運で勝敗が決まった組は 1 勝 1 敗になり
 * 勝率を 50% に寄せるので、判定が甘くなることはない。
 */
export interface Verdict {
  readonly kind: '勝ち越し' | '勝ち越していない'
  /** 決着したデュエルの勝率。決着したデュエルが無ければ `undefined`。 */
  readonly winRate: number | undefined
  /** 勝率の 95% 信頼区間。決着したデュエルが無ければ `undefined`。 */
  readonly interval: { readonly lower: number; readonly upper: number } | undefined
}

/** 標準正規分布の 97.5% 点。両側 95% の区間に使う。 */
const Z_95 = 1.959963984540054

/** 勝ちの数と試行の数から、勝率の 95% 信頼区間（Wilson のスコア区間）を出す。 */
export function wilsonInterval(wins: number, trials: number): { readonly lower: number; readonly upper: number } {
  if (trials === 0) return { lower: 0, upper: 1 }

  const p = wins / trials
  const z2 = Z_95 * Z_95
  const center = p + z2 / (2 * trials)
  const spread = Z_95 * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))
  const denominator = 1 + z2 / trials

  return { lower: (center - spread) / denominator, upper: (center + spread) / denominator }
}

/** 勝ち負けの数から、勝ち越したかを判定する。 */
export function verdictOf(tally: Tally): Verdict {
  const decided = tally.wins + tally.losses
  if (decided === 0) return { kind: '勝ち越していない', winRate: undefined, interval: undefined }

  const interval = wilsonInterval(tally.wins, decided)
  return {
    kind: interval.lower > 0.5 ? '勝ち越し' : '勝ち越していない',
    winRate: tally.wins / decided,
    interval,
  }
}

const EMPTY_TALLY: Tally = { wins: 0, losses: 0, draws: 0, unfinished: 0 }

/** 1 回のデュエルの結果を、挑む側から見た数に追加する。 */
function counted(tally: Tally, result: CpuDuelResult, challengerSeat: Seat): Tally {
  if (result.kind === '手数上限') return { ...tally, unfinished: tally.unfinished + 1 }
  if (result.winner === undefined) return { ...tally, draws: tally.draws + 1 }
  return result.winner === challengerSeat ? { ...tally, wins: tally.wins + 1 } : { ...tally, losses: tally.losses + 1 }
}

/**
 * 2 つの CPU を打ち合わせて、挑む側が勝ち越したかを確認する。
 *
 * 組（2 回のデュエル）ごとにデッキの組み合わせを順に回し、シードを 1 つ進める。1 組の 2 回では、
 * 挑む側が 1 回目は席 0（そのデッキの組み合わせの 1 つ目のデッキ）、2 回目は席 1 に着く。どちらの
 * デュエルでも、席 0 には 1 つ目のデッキ、席 1 には 2 つ目のデッキを置く。
 *
 * 同じ設定なら、必ず同じ結果になる。
 */
export function compareCpus(options: ComparisonOptions): ComparisonResult {
  if (options.pairings.length === 0) throw new Error('デッキの組み合わせが 1 つも渡されていません')
  if (options.duels <= 0 || options.duels % 2 !== 0) {
    throw new Error(`デュエルの数は正の偶数にしてください: ${options.duels}`)
  }

  let total = EMPTY_TALLY
  const byPosition: Record<Player, Tally> = { 先攻: EMPTY_TALLY, 後攻: EMPTY_TALLY }
  const byPairing = options.pairings.map((pairing) => ({ name: pairing.name, tally: EMPTY_TALLY }))

  for (let group = 0; group < options.duels / 2; group += 1) {
    const pairingIndex = group % options.pairings.length
    const pairing = options.pairings[pairingIndex]
    const entry = byPairing[pairingIndex]
    if (pairing === undefined || entry === undefined) throw new Error('デッキの組み合わせを取得できなかった')

    for (const challengerSeat of [0, 1] as const) {
      const cpus: readonly [CpuPlayer, CpuPlayer] =
        challengerSeat === 0 ? [options.challenger, options.baseline] : [options.baseline, options.challenger]
      const result = playCpuDuel({
        seats: [
          { cpu: cpus[0], deck: pairing.decks[0] },
          { cpu: cpus[1], deck: pairing.decks[1] },
        ],
        seed: options.seed + group,
        maxActions: options.maxActions,
      })

      const position: Player = result.first === challengerSeat ? '先攻' : '後攻'
      total = counted(total, result, challengerSeat)
      byPosition[position] = counted(byPosition[position], result, challengerSeat)
      entry.tally = counted(entry.tally, result, challengerSeat)
    }
  }

  return { total, byPosition, byPairing, verdict: verdictOf(total) }
}
