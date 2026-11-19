import { describe, expect, it } from 'vitest'

import { MAY_ACTIONS, ZONE_PLACE_ACTIONS } from '@revolution/engine'

import { mayDoneLine } from './may-wording.js'
import { ZONE_PLACE_WORDING } from './place-wording.js'

describe('「してもよい」と置く命令の言い方（ADR-0064・ADR-0076）', () => {
  // 動きの値の一覧は別々に持つが、同じ値が両方にあれば、同じ動きなので同じ文で言う。
  const shared = MAY_ACTIONS.filter((action) => (ZONE_PLACE_ACTIONS as readonly string[]).includes(action))

  it('両方の一覧にある値が、少なくとも 1 つある（無くなったら、このテストの前提を見直す）', () => {
    expect(shared.length).toBeGreaterThan(0)
  })

  it.each(shared)('「%s」は、「はい」の行と置いた行で、同じ文になる', (action) => {
    const placing = ZONE_PLACE_WORDING[action as keyof typeof ZONE_PLACE_WORDING]

    expect(mayDoneLine(action, ['テスト・名'], '自分の')).toBe(`テスト・名を自分の${placing.zone}${placing.predicate}`)
  })
})
