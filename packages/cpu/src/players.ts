import type { CpuPlayer } from './player.js'
import { randomCpu } from './random-cpu.js'

/**
 * 勝率を測る時に名前で選べる CPU（`tools/cpu-compare.mjs`）。
 *
 * 段階を進めて新しい CPU を作成したら、ここに追加する。前の段階の CPU は、比べる相手として残す
 * （ADR-0060）。
 */
export const CPU_PLAYERS: Readonly<Record<string, CpuPlayer>> = {
  random: randomCpu,
}
