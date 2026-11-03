import { scoredCpu } from '@revolution/cpu'
import type { CpuPlayer } from '@revolution/cpu'
import type { RoomCode } from '@revolution/engine'
import type { ParticipantId } from './room.js'

/**
 * 席に座って自動で打つ相手（#175）。
 *
 * どう打つかは `@revolution/cpu` が持つ（ADR-0060）。ここに置くのは、部屋に座る CPU が誰で
 * あるか（名乗り）と、部屋で打たせる CPU がどれかだけである。CPU には完全な盤面を渡さず、
 * 人の画面に届くものと同じ射影を渡す（`room.ts` の `cpuStep`）。
 *
 * 繋がっていない参加者である。部屋から見れば人と同じ 1 人（`ParticipantId`）だが、
 * ソケットを持たない。送られたものは届く先が無いので捨てられる（`room.ts` の `withCpu`）。
 *
 * 決まりごとと同じく、ここも純粋な関数だけを持つ（`room.ts`）。
 */

/**
 * CPU の名乗りの頭に付ける印。
 *
 * 人がこれを名乗って繋ぐのは断る（`serve.ts`）。名乗りは認証ではなく、知っている人が
 * その席に座れる合言葉である（ADR-0009）ため、名乗りの形が読めれば CPU の席に座れてしまう。
 */
export const CPU_PREFIX = 'cpu:'

/** その部屋に座る CPU の名乗り。部屋ごとに違う（同じ名乗りは 1 つの席しか持てない）。 */
export function cpuParticipantOf(code: RoomCode): ParticipantId {
  return `${CPU_PREFIX}${code}`
}

/** その名乗りが CPU のものか。 */
export function isCpu(participant: ParticipantId): boolean {
  return participant.startsWith(CPU_PREFIX)
}

/**
 * 部屋で打たせる CPU。
 *
 * いまは場面ごとに手へ点数を付けて選ぶものである（ADR-0060 の段階 2、#366）。前の CPU（合法手から
 * ランダムに選ぶもの、#175）に勝ち越したことを、CPU 同士の勝率を測る仕組み（`@revolution/cpu` の
 * `compareCpus`）で確認して替えた。強い CPU に替える時も、同じ仕組みで前の CPU に勝ち越すことを
 * 確認してから替える（ADR-0060・ADR-0061）。
 */
export const ROOM_CPU: CpuPlayer = scoredCpu
