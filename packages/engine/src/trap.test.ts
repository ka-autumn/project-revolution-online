import { describe, expect, it } from 'vitest'
import { putInZone } from './duel.js'
import { checkIntrusion, loseTrapRightOnPass } from './trap.js'
import { defineTrap, emptyDuelState, instantiate } from './index.js'
import type { DuelState, Player, Square } from './index.js'

const targetSquare: Square = { row: 0, column: 1 }
const otherSquare: Square = { row: 2, column: 2 }
/** `targetSquare` の反対側のスクエア（行・列とも折り返した位置）。 */
const mirroredSquare: Square = { row: 2, column: 1 }

/** トリガーアイコンに `targetSquare` を持つトラップ。 */
const trapWithIcon = defineTrap({ name: 'テスト・トリガーアイコン持ち', level: 1, triggerIcon: [targetSquare] })

/** トリガーアイコンを持たないトラップ。 */
const trapWithoutIcon = defineTrap({ name: 'テスト・トリガーアイコン無し', level: 1 })

/** そのトラップが、指定したプレイヤー（省略時は先攻）のトラップゾーンにある盤面。 */
function withTrap(card = trapWithIcon, owner: Player = '先攻'): DuelState {
  const trap = instantiate({ id: 'トラップ', card, owner })
  return putInZone(emptyDuelState(), owner, 'トラップゾーン', [trap])
}

// 総合ルール 第2部 第20章 3-6・3-8・3-8-a（ADR-0006）
describe('侵入', () => {
  it('相手のユニットがトリガーアイコンのスクエアに置かれると、発動する権利を得る', () => {
    const after = checkIntrusion(withTrap(), '後攻', targetSquare)

    expect(after.trapRights).toEqual(['トラップ'])
  })

  it('トリガーアイコンに描かれていないスクエアに置かれても権利を得ない', () => {
    const after = checkIntrusion(withTrap(), '後攻', otherSquare)

    expect(after.trapRights).toEqual([])
  })

  // 「相手のユニットが」なので、置いた本人が支配するトラップは対象にならない。
  it('自分のユニットがそのスクエアに置かれても権利を得ない', () => {
    const after = checkIntrusion(withTrap(), '先攻', targetSquare)

    expect(after.trapRights).toEqual([])
  })

  it('トリガーアイコンを持たないカードは侵入で権利を得ない', () => {
    const after = checkIntrusion(withTrap(trapWithoutIcon), '後攻', targetSquare)

    expect(after.trapRights).toEqual([])
  })

  it('すでに権利を得ているなら重複しない', () => {
    const already: DuelState = { ...withTrap(), trapRights: ['トラップ'] }

    const after = checkIntrusion(already, '後攻', targetSquare)

    expect(after.trapRights).toEqual(['トラップ'])
  })
})

// トリガーアイコンはムーブアイコンの矢印の向きと同じ理由で、支配者から見た向きで印刷されて
// いる（`board.ts` の `squareFromView`）（ADR-0006）。
describe('トリガーアイコンは支配者から見た向きで解釈される', () => {
  it('後攻のトラップでは、印刷されたスクエアが反対側の絶対スクエアに対応する', () => {
    const after = checkIntrusion(withTrap(trapWithIcon, '後攻'), '先攻', mirroredSquare)

    expect(after.trapRights).toEqual(['トラップ'])
  })

  it('印刷されたスクエアそのものの絶対位置に置かれても、後攻のトラップでは反応しない', () => {
    const after = checkIntrusion(withTrap(trapWithIcon, '後攻'), '先攻', targetSquare)

    expect(after.trapRights).toEqual([])
  })
})

// 総合ルール 第2部 第20章 3-8「１度でも優先権をパスすると...権利を失います」（ADR-0006）
describe('優先権のパスによる権利の喪失', () => {
  it('権利を得ているプレイヤーが優先権をパスすると、権利を失う', () => {
    const state: DuelState = { ...withTrap(), trapRights: ['トラップ'] }

    const after = loseTrapRightOnPass(state, '先攻')

    expect(after.trapRights).toEqual([])
  })

  it('相手が優先権をパスしても、自分のトラップの権利は失われない', () => {
    const state: DuelState = { ...withTrap(), trapRights: ['トラップ'] }

    const after = loseTrapRightOnPass(state, '後攻')

    expect(after.trapRights).toEqual(['トラップ'])
  })
})
