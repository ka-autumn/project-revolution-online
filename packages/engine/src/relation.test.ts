import { describe, expect, it } from 'vitest'
import { RELATIONS_FROM_PLAYER, RELATIONS_FROM_UNIT } from './index.js'
import type { RelationFromPlayer, RelationFromUnit } from './index.js'

// 総合ルール 第2部 第21章 8-2（ADR-0006）
describe('スクエアにあるユニットとの関係', () => {
  it('プレイヤーから見た関係は味方と敵', () => {
    expect(RELATIONS_FROM_PLAYER).toEqual(['味方', '敵'])
  })

  it('ユニットから見た関係は仲間と隣のユニット', () => {
    expect(RELATIONS_FROM_UNIT).toEqual(['仲間', '隣のユニット'])
  })

  it('仲間はユニットから見た関係であり、プレイヤーから見た関係としては扱えない', () => {
    // @ts-expect-error 仲間はあるユニットから見て支配者が同じユニットを指す
    const relation: RelationFromPlayer = '仲間'
    expect(RELATIONS_FROM_UNIT).toContain(relation)
  })

  it('味方はプレイヤーから見た関係であり、ユニットから見た関係としては扱えない', () => {
    // @ts-expect-error 味方はあるプレイヤーから見て自分のユニットを指す
    const relation: RelationFromUnit = '味方'
    expect(RELATIONS_FROM_PLAYER).toContain(relation)
  })
})
