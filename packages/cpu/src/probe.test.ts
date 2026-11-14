import { describe, expect, it } from 'vitest'
import {
  abilityGranting,
  damagePlayer,
  defineUnit,
  discardOpponentHand,
  drawCards,
  dream,
  emptyDuelState,
  granting,
  instantiate,
  lookAtOpponentHandAndDiscard,
  mayDo,
  perspectiveOf,
  putOnSquare,
  randomFromSeed,
} from '@revolution/engine'
import type { CardInstance, DuelState, DuelView, Player, PlayerZone } from '@revolution/engine'
import { choiceViewOf } from './player.js'
import { probeEffectRun, scoreInstructions } from './probe.js'
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
  it('候補は「確認」の 1 つで、このターンに同じ問いへ答えていなければ「はい」（候補の 0 番）と答える', () => {
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

// ADR-0069。相手の手札を見て選ぶ命令は、空回しでは相手の手札が空でも止まらず、命令として並ぶ。
describe('相手の手札を見て選ぶ命令の空回し', () => {
  const setting = { perspective: perspectiveOf(emptyDuelState(), '先攻'), controller: '先攻' } as const

  it('命令が並び、後ろの命令も続けて並ぶ（効果には何も返らないので、止まらない）', () => {
    const run = probeEffectRun(setting, function* (duel) {
      yield* lookAtOpponentHandAndDiscard([{ axis: '種別', value: 'ユニット' }], { upTo: true })
      yield* drawCards(duel.controller, 1)
    })

    expect(run?.instructions.map((each) => each.kind)).toEqual(['相手の手札を見て選ぶ', 'カードを引く'])
  })

  it('損得は、相手に手札を 1 枚捨てさせる命令と同じ値になる', () => {
    const scoreOf = (effect: Parameters<typeof probeEffectRun>[1]): number | undefined => probeEffectRun(setting, effect)?.score
    const looking = scoreOf(function* () {
      yield* lookAtOpponentHandAndDiscard([], { upTo: false })
    })
    const discarding = scoreOf(function* () {
      yield* discardOpponentHand(1)
    })

    expect(looking).toBeDefined()
    expect(looking).toBe(discarding)
  })
})

// ADR-0070・ADR-0071。空回しのビューは、スクエアのユニットに与えられた能力と、変更後の移動方向を参照できる。
describe('継続効果を適用した後のユニットの空回し', () => {
  const ally = defineUnit({ name: 'テスト・味方', level: 1, bp: 1000, sp: 1000, moveIcon: ['左', '右'] })
  const granter = defineUnit({
    name: 'テスト・夢を与える',
    level: 1,
    bp: 1000,
    sp: 1000,
    abilities: [abilityGranting((duel) => duel.allies().map((each) => granting(each, dream)))],
  })

  /** 先攻の味方（`ally`）が 1 体いる盤面に、その味方の移動方向を置き換える継続効果がかかっている。 */
  const board = (extra: readonly string[] = []): DuelState => {
    const placed = putOnSquare(emptyDuelState(), { row: 0, column: 1 }, instantiate({ id: '味方', card: ally, owner: '先攻' }))
    return {
      ...placed,
      createdContinuousEffects: extra.length === 0 ? [] : [
        {
          target: '味方',
          change: { kind: '移動方向の変更', method: '置き換える', directions: ['上'] },
          until: 'ターンの終わりまで',
          controller: '先攻',
          createdIn: 1,
        },
      ],
    }
  }

  it('空回しのビューのユニットは、変更後の移動方向を持つ', () => {
    const seen: (readonly string[])[] = []
    const reading = function* (duel: DuelView) {
      seen.push(...duel.allies().map((each) => each.card.moveIcon))
    }

    probeEffectRun({ perspective: perspectiveOf(board(), '先攻'), controller: '先攻' }, reading)
    probeEffectRun({ perspective: perspectiveOf(board(['あり']), '先攻'), controller: '先攻' }, reading)

    expect(seen).toEqual([['左', '右'], ['上']])
  })

  it('空回しのビューは、常在型能力が与えたキーワード能力を「持つ」と返す', () => {
    const withGranter = putOnSquare(board(), { row: 0, column: 0 }, instantiate({ id: '与える側', card: granter, owner: '先攻' }))
    const answers: boolean[] = []
    const asking = function* (duel: DuelView) {
      for (const each of duel.allies()) answers.push(duel.hasKeyword(each, '夢'))
    }

    probeEffectRun({ perspective: perspectiveOf(board(), '先攻'), controller: '先攻' }, asking)
    probeEffectRun({ perspective: perspectiveOf(withGranter, '先攻'), controller: '先攻' }, asking)

    expect(answers).toEqual([false, true, true])
  })

  it('移動方向の置き換えは、味方に 1 つ与えても 0 点である', () => {
    const setting = { perspective: perspectiveOf(board(), '先攻'), controller: '先攻' } as const
    const instruction = {
      kind: '継続効果を作成する',
      duration: 'ターンの終わりまで',
      target: '味方',
      change: { kind: '移動方向の変更', method: '置き換える', directions: ['上'] },
    } as const

    expect(scoreInstructions(setting, [instruction])).toBe(0)
  })
})
