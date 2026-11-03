import { describe, expect, it } from 'vitest'
import { cpuParticipantOf, isCpu } from './cpu.js'

/**
 * 部屋に座る CPU が誰であるか（#175）。
 *
 * どう打つかは `@revolution/cpu` が持つ（ADR-0060）。そのテストは `packages/cpu` にある。
 */

describe('CPU の名乗り', () => {
  /** 名乗りは席に座れる合言葉である（ADR-0009）。人が名乗れると CPU の席に座れてしまう。 */
  it('CPU のものだと見分けられる', () => {
    expect(isCpu(cpuParticipantOf('あいことば'))).toBe(true)
    expect(isCpu('あ')).toBe(false)
  })

  it('部屋ごとに違う', () => {
    expect(cpuParticipantOf('ひとつめ')).not.toBe(cpuParticipantOf('ふたつめ'))
  })
})
