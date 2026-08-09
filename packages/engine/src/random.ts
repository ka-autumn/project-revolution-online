/**
 * シードから決まる乱数列。
 *
 * 乱数はシード指定できなければならない（ADR-0005）。失敗した自己対戦をシードから
 * そのまま再生できることが、ランダム自己対戦をエンジンの検証手段にする前提になる。
 *
 * 盤面と同じく値であって、使っても変化しない。乱数を 1 つ取り出す関数は、取り出した値と
 * 「その次の乱数列」を返す。同じ乱数列を 2 回使えば 2 回とも同じ値が出る。
 */
export interface Random {
  /** 次の値を決める内部状態。この値の意味に依存してはいけない。 */
  readonly state: number
}

/** そのシードから始まる乱数列。同じシードからは常に同じ列が得られる。 */
export function randomFromSeed(seed: number): Random {
  return { state: seed | 0 }
}

interface Next<T> {
  readonly value: T
  /** 続きの乱数列。同じ乱数列を使い回すと同じ値が出るため、次はこちらを使う。 */
  readonly random: Random
}

/** 0 以上 `bound` 未満の整数を 1 つ取り出す。`bound` が 1 以下なら常に 0。 */
export function nextInt(random: Random, bound: number): Next<number> {
  const state = (random.state + 0x6d2b79f5) | 0
  if (bound <= 1) return { value: 0, random: { state } }
  return { value: Math.floor(unitInterval(state) * bound), random: { state } }
}

/**
 * 並びを不規則に並べ替える（総合ルール 第3部 第1章 4）。元の並びは変えない。
 *
 * 残りから 1 つずつ引いて前から並べていく。どの並べ替えも同じ確率で起こる。
 */
export function shuffle<T>(items: readonly T[], random: Random): Next<readonly T[]> {
  const remaining = [...items]
  const shuffled: T[] = []
  let current = random
  while (remaining.length > 0) {
    const next = nextInt(current, remaining.length)
    current = next.random
    shuffled.push(...remaining.splice(next.value, 1))
  }
  return { value: shuffled, random: current }
}

/**
 * 内部状態から 0 以上 1 未満の実数を作る（mulberry32）。
 *
 * エンジンは実行時依存を持てない（ADR-0001）ため、乱数生成器も自前で持つ。暗号用途では
 * ないので、シードから再現できることと偏りが目立たないことだけを満たせばよい。
 */
function unitInterval(state: number): number {
  let t = state
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
