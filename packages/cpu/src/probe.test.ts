import { describe, expect, it } from 'vitest'
import { damagePlayer, defineUnit, drawCards, emptyDuelState, instantiate, mayDo, perspectiveOf, randomFromSeed } from '@revolution/engine'
import type { CardInstance, DuelState, Player, PlayerZone } from '@revolution/engine'
import { choiceViewOf } from './player.js'
import { probeEffectRun } from './probe.js'
import { scoredCpu } from './scored-cpu.js'

/**
 * 効果の空回し（ADR-0062）が、「してもよいか聞く」命令（ADR-0064）を、「はい」と「いいえ」の 2 通りとして
 * 回すか。盤面は架空のカードで組み立てる（ADR-0002）。
 */

function withZone(state: DuelState, player: Player, zone: PlayerZone, cards: readonly CardInstance[]): DuelState {
  return {
    ...state,
    zones: { ...state.zones, [player]: { ...state.zones[player], [zone]: [...state.zones[player][zone], ...cards] } },
  }
}

const strong = defineUnit({ name: 'テスト・強い', level: 5, bp: 6000, sp: 2000 })

describe('してもよいか聞く命令の空回し', () => {
  const state = withZone(emptyDuelState(), '先攻', '捨札', [instantiate({ id: '捨札の1枚', card: strong, owner: '先攻' })])
  const setting = { perspective: perspectiveOf(state, '先攻'), controller: '先攻' } as const

  it('「はい」なら、エンジンが実行する手札へ置く動きを、命令として並べる', () => {
    const run = probeEffectRun(setting, function* (duel) {
      const [card] = duel.discardPile()
      if (card === undefined) return

      yield* mayDo([card], '手札に加える')
    })

    expect(run?.instructions).toEqual([
      { kind: 'ゾーンへ置く', card: expect.objectContaining({ id: '捨札の1枚' }), to: '手札', orientation: 'リリース', position: '1番上' },
    ])
  })

  // 空回しは、損得の大きい答えを選ぶ。「はい」と「いいえ」の両方を回していなければ、どちらかしか選べない。
  it('「いいえ」のほうが得な効果では、「いいえ」の回の命令が並ぶ（手札へ置く動きは並ばない）', () => {
    const run = probeEffectRun(setting, function* (duel) {
      const [card] = duel.discardPile()
      if (card === undefined) return

      const yes = yield* mayDo([card], '手札に加える')
      if (yes) yield* damagePlayer(duel.controller, 3000)
      else yield* drawCards(duel.controller, 1)
    })

    expect(run?.instructions.map((each) => each.kind)).toEqual(['カードを引く'])
  })

  it('「はい」のほうが得な効果では、「はい」の回の命令が並ぶ（「いいえ」の続きは並ばない）', () => {
    const run = probeEffectRun(setting, function* (duel) {
      const [card] = duel.discardPile()
      if (card === undefined) return

      const yes = yield* mayDo([card], '手札に加える')
      if (!yes) yield* damagePlayer(duel.controller, 3000)
    })

    expect(run?.instructions.map((each) => each.kind)).toEqual(['ゾーンへ置く'])
  })

  it('対象が無ければ聞かずに「いいえ」として進む（効果は何も並べない）', () => {
    const run = probeEffectRun(setting, function* () {
      yield* mayDo([], '手札に加える')
    })

    expect(run?.instructions).toEqual([])
  })
})

// ADR-0065。対象を持たない動きは、対象が無くても聞き、「はい」なら動きの命令を並べる。
describe('対象を持たない「してもよい」の空回し', () => {
  const setting = { perspective: perspectiveOf(emptyDuelState(), '先攻'), controller: '先攻' } as const

  it('「1枚引く」は、「はい」なら、支配者が引く命令を並べる', () => {
    const run = probeEffectRun(setting, function* () {
      yield* mayDo([], '1枚引く')
    })

    expect(run?.instructions).toEqual([{ kind: 'カードを引く', player: '先攻', count: 1 }])
  })

  it('「山札の1番上のカードをエネルギーゾーンにフリーズして置く」は、「はい」なら、置く命令を並べる', () => {
    const run = probeEffectRun(setting, function* () {
      yield* mayDo([], '山札の1番上のカードをエネルギーゾーンにフリーズして置く')
    })

    expect(run?.instructions).toEqual([{ kind: '山札の1番上をゾーンへ置く', to: 'エネルギーゾーン', orientation: 'フリーズ' }])
  })

  it('CPU は、対象を持たない「してもよい」にも、「はい」（候補の 0 番）と答える', () => {
    const choice = {
      player: '先攻',
      purpose: 'してもよい',
      mayDecline: true,
      answered: 0,
      mayGoBack: false,
      mayCancel: false,
      candidates: [{ kind: '確認' }],
      may: { action: '1枚引く', targets: [] },
    } as const

    expect(scoredCpu.answer(choiceViewOf(emptyDuelState(), choice), randomFromSeed(1)).answer).toBe(0)
  })
})

describe('CPU が「してもよい」に答える', () => {
  it('候補は「確認」の 1 つで、いつも「はい」（候補の 0 番）と答える', () => {
    const state = withZone(emptyDuelState(), '先攻', '捨札', [instantiate({ id: '捨札の1枚', card: strong, owner: '先攻' })])
    const choice = {
      player: '先攻',
      purpose: 'してもよい',
      mayDecline: true,
      answered: 0,
      mayGoBack: false,
      mayCancel: false,
      candidates: [{ kind: '確認' }],
      may: { action: '手札に加える', targets: ['捨札の1枚'] },
    } as const

    expect(scoredCpu.answer(choiceViewOf(state, choice), randomFromSeed(1)).answer).toBe(0)
  })
})
