import { describe, expect, it } from 'vitest'
import {
  applyLegalAction,
  cardsIn,
  defineTrap,
  defineUnit,
  legalActions,
  prepareDuel,
  randomChooser,
  randomFromSeed,
} from '@revolution/engine'
import type { Card, Deck, DuelState } from '@revolution/engine'
import { cpuCandidates, cpuParticipantOf, isCpu, pickCpuAction, pickCpuAnswer } from './cpu.js'

/**
 * 自動で打つ相手が、何を選ぶか（#175）。
 *
 * 合法手からランダムに選ぶだけ（ADR-0005）なので、確かめられるのは**候補に何を並べるか**で
 * ある。引く値そのものは乱数であって、決まりごとではない。
 */

const PASS = { kind: '優先権を放棄する' } as const

/**
 * 1 種類のカードだけでできたデッキ。
 *
 * **手札に何が来るかを問わないようにするため、全部同じ種別にする。** 構築戦では同じカード名を
 * 4 枚までしか入れられない（総合ルール 第3部 第1章 3-1）ので、名前だけを変えた 15 種類にする。
 */
function deckOf(kind: 'ユニット' | 'トラップ'): Deck {
  const cards: readonly Card[] = Array.from({ length: 15 }, (_, index) =>
    kind === 'トラップ'
      ? defineTrap({ name: `テスト・CPUのトラップ${index}`, level: 0 })
      : defineUnit({ name: `テスト・CPUのユニット${index}`, level: 0, bp: 100, sp: 100, moveIcon: ['上'] }),
  )

  return cards.flatMap((card) => Array.from({ length: 4 }, () => card))
}

/**
 * トラップとしてプレイできるところまで進めた盤面。
 *
 * 放棄しか行わないので、選ばせるものは通らない。トラップとしてプレイできるのは自分のメイン
 * フェイズでバンクが空の時（総合ルール 第2部 第20章 3-1）なので、そこまで放棄で進める。
 */
function untilTrapMayBeSet(state: DuelState): DuelState {
  const { chooser } = randomChooser(randomFromSeed(1))
  let current = state
  for (let step = 0; step < 100; step += 1) {
    if (legalActions(current).some((action) => action.kind === 'トラップとしてプレイする')) return current

    current = applyLegalAction(current, PASS, chooser)
  }
  throw new Error('トラップとしてプレイできるところまで進まなかった')
}

function readyToSetTrap(kind: 'ユニット' | 'トラップ'): DuelState {
  const prepared = prepareDuel({ decks: [deckOf(kind), deckOf(kind)], seed: 20260830 })
  if (prepared.kind !== '準備完了') throw new Error(`デッキが規定を満たしていない: ${JSON.stringify(prepared)}`)

  return untilTrapMayBeSet(prepared.state)
}

describe('CPU が選ぶ候補', () => {
  /**
   * トラップ以外のカードもトラップとしてプレイできる（総合ルール 第2部 第20章 3-1）が、
   * 発動条件を持たないので置いたら二度と使えない（同 3-6）。ほとんど行われない手なので、
   * 対戦相手としては選ばせない。
   */
  it('トラップ以外のカードは、トラップゾーンに置かない', () => {
    const state = readyToSetTrap('ユニット')

    // 合法手そのものは狭めていない。狭めるのは選ぶ候補だけである（ADR-0005）。
    expect(legalActions(state).some((action) => action.kind === 'トラップとしてプレイする')).toBe(true)
    expect(cpuCandidates(state).some((action) => action.kind === 'トラップとしてプレイする')).toBe(false)
  })

  it('トラップは、トラップゾーンに置く', () => {
    const state = readyToSetTrap('トラップ')

    expect(cpuCandidates(state).some((action) => action.kind === 'トラップとしてプレイする')).toBe(true)
  })

  /** 放棄は終わっていない限り必ず合法手にある（`legal-action.ts`）ので、候補が尽きることは無い。 */
  it('放棄は残る', () => {
    const state = readyToSetTrap('ユニット')

    expect(cpuCandidates(state)).toContainEqual(PASS)
  })
})

/**
 * カードをプレイできるかはエネルギーゾーンの枚数で決まり（総合ルール 第1部 第2章 3-1）、置ける
 * のはエネルギーフェイズに 1 枚だけである（同 第3部 第7章 1）。**置き損ねはそのまま取り返せない。**
 */
describe('CPU がエネルギーを置く', () => {
  const ENERGY_TARGET = 7

  /** そのプレイヤーのエネルギーゾーンの枚数。 */
  function energyOf(state: DuelState): number {
    return cardsIn(state, state.turn.active, 'エネルギーゾーン').length
  }

  /**
   * エネルギーを置ける場面まで進めた盤面。**CPU の選び方で進める。**
   *
   * 置けるのは自分のエネルギーフェイズだけなので、そこまではほかに何も行わず放棄で進める。
   * 置ける場面に来たら CPU に選ばせ、`until` 枚に届いたところで、その場面を返す。
   */
  function untilEnergy(until: number): DuelState {
    const prepared = prepareDuel({ decks: [deckOf('ユニット'), deckOf('ユニット')], seed: 20260905 })
    if (prepared.kind !== '準備完了') throw new Error('デッキが規定を満たしていない')

    const { chooser } = randomChooser(randomFromSeed(2))
    let current = prepared.state
    let random = randomFromSeed(3)
    for (let step = 0; step < 400; step += 1) {
      const mayPlace = legalActions(current).some((action) => action.kind === 'エネルギーを置く')
      if (mayPlace && energyOf(current) >= until) return current

      const picked = mayPlace ? pickCpuAction(current, random) : undefined
      if (picked === undefined) {
        current = applyLegalAction(current, PASS, chooser)
        continue
      }

      random = picked.random
      current = applyLegalAction(current, picked.action, chooser)
    }
    throw new Error(`エネルギーが ${until} 枚になるまで進まなかった`)
  }

  it('足りていない間は、置く手しか選ばない', () => {
    const state = untilEnergy(0)

    expect(cpuCandidates(state)).not.toHaveLength(0)
    expect(cpuCandidates(state).every((action) => action.kind === 'エネルギーを置く')).toBe(true)
    // 放棄は合法手のままである。狭めているのは候補だけで、行える手ではない。
    expect(legalActions(state)).toContainEqual(PASS)
  })

  /** 置ける場面が来るたびに置くので、ターンが進めば貯まっていく。 */
  it('置ける場面が来るたびに置く', () => {
    expect(energyOf(untilEnergy(ENERGY_TARGET))).toBe(ENERGY_TARGET)
  })

  /** ここまで貯まれば大抵のカードはレベルを満たせる。以降は貯めることを優先しない。 */
  it('足りていれば、置く以外も選ぶ', () => {
    const state = untilEnergy(ENERGY_TARGET)

    expect(cpuCandidates(state)).toContainEqual(PASS)
    expect(cpuCandidates(state).some((action) => action.kind === 'エネルギーを置く')).toBe(true)
  })
})

describe('CPU が選択に答える', () => {
  const CHOICE = {
    player: '先攻',
    purpose: '効果の対象',
    mayDecline: false,
    answered: 0,
    mayGoBack: true,
    candidates: [
      { kind: '見えている', card: 'あ' },
      { kind: '見えている', card: 'い' },
    ],
  } as const

  it('候補の番号で答える', () => {
    const { answer } = pickCpuAnswer(CHOICE, randomFromSeed(7))

    expect(answer).toBeTypeOf('number')
    expect(answer).toBeGreaterThanOrEqual(0)
    expect(answer).toBeLessThan(CHOICE.candidates.length)
  })

  /**
   * 選ばないことが認められている場面では、それも 1 つの選択肢として引く（`self-play.ts` の
   * `randomChooser` と同じ）。**引き方が変わると答えの範囲も変わる**ので、選ばないが出る
   * シードがあることまで確かめる。
   */
  it('選ばないことも選べる場面では、選ばないこともある', () => {
    const declinable = { ...CHOICE, mayDecline: true }
    const answers = Array.from({ length: 30 }, (_, seed) => pickCpuAnswer(declinable, randomFromSeed(seed)).answer)

    expect(answers).toContain('選ばない')
    expect(answers).toContain(0)
  })

  it('答えるたびに乱数列が進む', () => {
    const first = pickCpuAnswer(CHOICE, randomFromSeed(3))
    const second = pickCpuAnswer(CHOICE, first.random)

    expect(second.random).not.toEqual(first.random)
  })
})

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
