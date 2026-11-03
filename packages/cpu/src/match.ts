import { applyWithAnswers, hasEnded, prepareDuel, splitRandom } from '@revolution/engine'
import type { ChoiceAnswer, Deck, DuelState, Player, Random, Seat } from '@revolution/engine'
import { actionViewOf, choiceViewOf } from './player.js'
import type { CpuPlayer } from './player.js'

/**
 * CPU 同士の勝率を測る仕組み（ADR-0060 の段階 1、#365）。
 *
 * **CPU を変える変更は、ここで前の CPU に勝ち越すことを確かめてから入れる**（ADR-0060）。
 *
 * 対戦の進め方は、部屋が人と CPU を打たせる道筋（`server` の `room.ts` の `advance`）と同じで
 * ある。行動を答えの並びで適用し（`applyWithAnswers`、ADR-0008）、選ぶことがあればその人に
 * 答えさせて、答えを 1 つ足して適用し直す。CPU に渡すものは必ず射影を通す（`player.ts`）。
 */

/** 1 つの席に着く CPU と、その CPU が使うデッキ。 */
export interface MatchSeat {
  readonly cpu: CpuPlayer
  readonly deck: Deck
}

export interface MatchOptions {
  /** 席の順に並べる。先攻・後攻はシードから決まる（`prepareDuel`）。 */
  readonly seats: readonly [MatchSeat, MatchSeat]
  /** シャッフル・先攻後攻・CPU が使う乱数のシード。 */
  readonly seed: number
  /**
   * 決着とみなさずに打ち切る、行った手の数の上限。選択への答えは数えない。
   *
   * 終わらない手順に落ちても止まるようにするためにある。届いたら決着していないものとして数える。
   */
  readonly maxActions: number
}

export type MatchResult =
  | {
      readonly kind: '決着'
      /** 勝った席。引き分けなら `undefined`。 */
      readonly winner: Seat | undefined
      /** 先攻になった席。 */
      readonly first: Seat
      readonly actionsTaken: number
    }
  | { readonly kind: '手数上限'; readonly first: Seat; readonly actionsTaken: number }

/** そのプレイヤー（先攻・後攻）が着いている席。 */
function seatOfPlayer(first: Seat, player: Player): Seat {
  return player === '先攻' ? first : first === 0 ? 1 : 0
}

/**
 * CPU 同士で 1 局を打つ。
 *
 * 同じ設定なら、必ず同じ結果になる。乱数はすべてシードから決まる。
 */
export function playCpuMatch(options: MatchOptions): MatchResult {
  const [seat0, seat1] = options.seats
  const prepared = prepareDuel({ decks: [seat0.deck, seat1.deck], seed: options.seed })
  if (prepared.kind !== '準備完了') {
    throw new Error(`デッキが構築戦の規定を満たしていません: ${JSON.stringify(prepared.violations)}`)
  }

  const { first } = prepared
  // CPU が手を選ぶ乱数列は、盤面の乱数列（シャッフル）とは別に、席ごとに切り出す。部屋で CPU が
  // 使う列も、盤面のものとは別である（`setup.ts` の `DuelPreparation.random`）。
  const firstRandom = splitRandom(prepared.random)
  const randoms: [Random, Random] = [firstRandom, splitRandom(firstRandom)]
  const cpuOf = (player: Player): { readonly seat: Seat; readonly cpu: CpuPlayer } => {
    const seat = seatOfPlayer(first, player)
    return { seat, cpu: options.seats[seat].cpu }
  }

  let state: DuelState = prepared.state
  let actionsTaken = 0
  while (!hasEnded(state)) {
    if (actionsTaken >= options.maxActions) return { kind: '手数上限', first, actionsTaken }

    const acting = cpuOf(state.turn.priority)
    const picked = acting.cpu.pickAction(actionViewOf(state, state.turn.priority), randoms[acting.seat])
    // 優先権を持つプレイヤーは、終わっていない限り必ず放棄できる（`legal-action.ts`）。
    if (picked === undefined) throw new Error('CPU が手を選ばなかった')
    randoms[acting.seat] = picked.random

    const answers: ChoiceAnswer[] = []
    for (;;) {
      const progress = applyWithAnswers(state, picked.action, answers)
      if (progress.kind === '進んだ') {
        state = progress.state
        break
      }

      const answering = cpuOf(progress.choice.player)
      const answered = answering.cpu.answer(choiceViewOf(progress.board, progress.choice), randoms[answering.seat])
      randoms[answering.seat] = answered.random
      answers.push(answered.answer)
    }
    actionsTaken += 1
  }

  const result = state.result
  const winner = result?.kind === '勝利' ? seatOfPlayer(first, result.winner) : undefined
  return { kind: '決着', winner, first, actionsTaken }
}

/** 勝率を測る時に組ませるデッキ 1 組。 */
export interface DeckPairing {
  /** 結果の内訳に出す名前。 */
  readonly name: string
  /**
   * 席 0 に置くデッキと、席 1 に置くデッキ。**どちらの CPU が座っても、席に置くデッキは変えない。**
   * 1 組の 2 局で CPU の席を入れ替えるので、挑む側はどちらのデッキでも 1 局ずつ打つ。
   */
  readonly decks: readonly [Deck, Deck]
}

export interface ComparisonOptions {
  /** 強くなったかを確かめたい CPU。 */
  readonly challenger: CpuPlayer
  /** 比べる相手。ふつうは前の段階の CPU。 */
  readonly baseline: CpuPlayer
  /** 組ませるデッキ。1 組ずつ順に回す。 */
  readonly pairings: readonly DeckPairing[]
  /**
   * 打つ局数。**2 局を 1 組にする**ので偶数にする。
   *
   * 1 組の 2 局は、同じシードと同じデッキで、CPU の席だけを入れ替えて打つ。山札の並びも先攻・後攻も
   * 同じになるので、2 局の違いは CPU だけになる。
   */
  readonly games: number
  /** 最初の組のシード。組ごとに 1 ずつ進める。 */
  readonly seed: number
  readonly maxActions: number
}

/** 挑む側から見た勝ち負けの数。 */
export interface Tally {
  readonly wins: number
  readonly losses: number
  readonly draws: number
  /** 手数上限で打ち切った局。 */
  readonly unfinished: number
}

export interface ComparisonResult {
  readonly total: Tally
  /** 挑む側が先攻だった局と、後攻だった局。 */
  readonly byPosition: Readonly<Record<Player, Tally>>
  /** デッキの組ごと。`pairings` と同じ並び。 */
  readonly byPairing: readonly { readonly name: string; readonly tally: Tally }[]
  readonly verdict: Verdict
}

/**
 * 勝ち越したかの判定（#365）。
 *
 * **決着した局の勝率の 95% 信頼区間（Wilson）の下限が、50% を上回れば勝ち越しとする。** 局数が
 * 少ないと区間が広がるので、たまたま勝ち越しただけでは勝ち越しにならない。引き分けと手数上限は
 * 勝率に入れない。
 */
export interface Verdict {
  readonly kind: '勝ち越し' | '勝ち越していない'
  /** 決着した局の勝率。決着した局が無ければ `undefined`。 */
  readonly winRate: number | undefined
  /** 勝率の 95% 信頼区間。決着した局が無ければ `undefined`。 */
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

/** 1 局の結果を、挑む側から見た数に足す。 */
function counted(tally: Tally, result: MatchResult, challengerSeat: Seat): Tally {
  if (result.kind === '手数上限') return { ...tally, unfinished: tally.unfinished + 1 }
  if (result.winner === undefined) return { ...tally, draws: tally.draws + 1 }
  return result.winner === challengerSeat ? { ...tally, wins: tally.wins + 1 } : { ...tally, losses: tally.losses + 1 }
}

/**
 * 2 つの CPU を打ち合わせて、挑む側が勝ち越したかを確かめる。
 *
 * 組（2 局）ごとにデッキの組を順に回し、シードを 1 つ進める。1 組の 2 局では、挑む側が 1 局目は
 * 席 0（そのデッキの組の 1 つ目のデッキ）、2 局目は席 1 に着く。どちらの局でも、席 0 には 1 つ目の
 * デッキ、席 1 には 2 つ目のデッキを置く。
 *
 * 同じ設定なら、必ず同じ結果になる。
 */
export function compareCpus(options: ComparisonOptions): ComparisonResult {
  if (options.pairings.length === 0) throw new Error('デッキの組が 1 つも渡されていません')
  if (options.games <= 0 || options.games % 2 !== 0) throw new Error(`局数は正の偶数にしてください: ${options.games}`)

  let total = EMPTY_TALLY
  const byPosition: Record<Player, Tally> = { 先攻: EMPTY_TALLY, 後攻: EMPTY_TALLY }
  const byPairing = options.pairings.map((pairing) => ({ name: pairing.name, tally: EMPTY_TALLY }))

  for (let group = 0; group < options.games / 2; group += 1) {
    const pairingIndex = group % options.pairings.length
    const pairing = options.pairings[pairingIndex]
    const entry = byPairing[pairingIndex]
    if (pairing === undefined || entry === undefined) throw new Error('デッキの組を引けなかった')

    for (const challengerSeat of [0, 1] as const) {
      const cpus: readonly [CpuPlayer, CpuPlayer] =
        challengerSeat === 0 ? [options.challenger, options.baseline] : [options.baseline, options.challenger]
      const result = playCpuMatch({
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
