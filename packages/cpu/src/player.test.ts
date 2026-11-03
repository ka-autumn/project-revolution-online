import { describe, expect, it } from 'vitest'
import { defineUnit, legalActions, prepareDuel, randomFromSeed } from '@revolution/engine'
import type { Card, Deck, DuelState } from '@revolution/engine'
import { actionViewOf } from './player.js'
import { randomCpu } from './random-cpu.js'

/**
 * CPU が受け取るもの（ADR-0060）。
 *
 * **CPU は自分の席から見た射影の盤面だけを受け取る。** 相手の手札・山札の並び・盤面の乱数列は
 * 非公開情報で（総合ルール 第2部 第23章 2-1）、人の画面にも届かない。
 */

function deck(): Deck {
  const cards: readonly Card[] = Array.from({ length: 15 }, (_, index) =>
    defineUnit({ name: `テスト・視点のユニット${index}`, level: 0, bp: 100, sp: 100, moveIcon: ['上'] }),
  )
  return cards.flatMap((card) => Array.from({ length: 4 }, () => card))
}

function prepared(): DuelState {
  const preparation = prepareDuel({ decks: [deck(), deck()], seed: 20261103 })
  if (preparation.kind !== '準備完了') throw new Error('デッキが規定を満たしていない')
  return preparation.state
}

describe('CPU が受け取るもの', () => {
  it('完全な盤面を渡すと、型検査で止まる', () => {
    const state = prepared()
    const view = { perspective: state, actions: legalActions(state), passOutcome: undefined }

    // @ts-expect-error CPU は射影した盤面だけを受け取る。完全な盤面（`DuelState`）は渡せない（ADR-0060）。
    expect(() => randomCpu.pickAction(view, randomFromSeed(1))).not.toThrow()
  })

  // 総合ルール 第2部 第23章 2-1。手札と山札は非公開情報である。
  it('相手の手札も、山札も見えない', () => {
    const state = prepared()
    const viewer = state.turn.priority
    const opponent = viewer === '先攻' ? '後攻' : '先攻'
    const { perspective } = actionViewOf(state, viewer)

    expect(perspective.zones[opponent]['手札'].length).toBeGreaterThan(0)
    expect(perspective.zones[opponent]['手札'].every((card) => card.kind === '見えていない')).toBe(true)
    expect(perspective.zones[viewer]['山札'].every((card) => card.kind === '見えていない')).toBe(true)
    // 盤面の乱数列（この先のシャッフルを決める）も載らない。
    expect('random' in perspective).toBe(false)
  })

  it('自分の手札は見える', () => {
    const state = prepared()
    const viewer = state.turn.priority
    const { perspective } = actionViewOf(state, viewer)

    expect(perspective.zones[viewer]['手札'].length).toBeGreaterThan(0)
    expect(perspective.zones[viewer]['手札'].every((card) => card.kind === '見えている')).toBe(true)
  })

  /** カードのプレイや能力の起動は優先権を持つプレイヤーの権利である（総合ルール 第4部 第5章 1）。人の画面と同じく空で届く。 */
  it('優先権を持っていなければ、行える行動は空で届く', () => {
    const state = prepared()
    const waiting = state.turn.priority === '先攻' ? '後攻' : '先攻'

    expect(actionViewOf(state, waiting).actions).toEqual([])
    expect(actionViewOf(state, state.turn.priority).actions).toEqual(legalActions(state))
  })
})
