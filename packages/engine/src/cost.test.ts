import { describe, expect, it } from 'vitest'
import { payEnergyCost, payPlanCost, satisfiesLevel } from './cost.js'
// エネルギーゾーンやスマッシュゾーンを組み立てるためだけに `putInZone` を使う。
// engine の中からゾーンを差し替えるための関数であり、公開する API ではない。
import { putInZone } from './duel.js'
import { cardsIn, defineStrategy, defineUnit, emptyDuelState, instantiate } from './index.js'
import type { CardInstance, Chooser, Color, DuelState, PlayerZone } from './index.js'

/** 選択を求められたら常に最初の候補を選ぶ。どれを選ぶかを問わないテストで使う。 */
const chooseFirst: Chooser = (candidates) => candidates[0]

/** レベル 4 の赤いカード（総合ルール 第2部 第20章 1-2 の【例】の「アプリコット・桜葉」）。 */
const redUnit = defineUnit({ name: 'テスト・赤レベル4', level: 4, colors: ['赤'], bp: 1000, sp: 1000 })

/** レベル 3 の無色のカード。 */
const colorlessStrategy = defineStrategy({ name: 'テスト・無色レベル3', level: 3 })

/** コストを必要としないカード（総合ルール 第1部 第2章 3-4）。 */
const freeStrategy = defineStrategy({ name: 'テスト・0エネルギー', level: 0 })

/** その色のカード 1 枚。エネルギーとして置くために使う。 */
function card(id: string, ...colors: readonly Color[]): CardInstance {
  return instantiate({
    id,
    card: defineUnit({ name: `テスト・${id}`, level: 1, colors, bp: 1000, sp: 1000 }),
    owner: '先攻',
  })
}

/** そのカードを先攻のゾーンに置いた盤面。 */
function zoned(zone: PlayerZone, ...cards: readonly CardInstance[]): DuelState {
  return putInZone(emptyDuelState(), '先攻', zone, cards)
}

/** そのカードがフリーズ状態になっているか。 */
function frozen(state: DuelState, zone: PlayerZone, id: string): boolean {
  return cardsIn(state, '先攻', zone).find((each) => each.id === id)?.orientation === 'フリーズ'
}

// 総合ルール 第1部 第2章 3-1（ADR-0006）
describe('レベルを満たす', () => {
  // 総合ルール 第2部 第20章 1-2 の【例】: レベル 4 で赤いカードをプレイする場合、
  // 自分のエネルギーゾーンに赤いカードを 1 枚以上含む 4 枚以上のカードがある必要がある。
  it('レベル以上の枚数と、同じ色のカード 1 枚以上がエネルギーゾーンにあれば満たす', () => {
    const state = zoned('エネルギーゾーン', card('e1', '赤'), card('e2', '青'), card('e3', '青'), card('e4', '青'))

    expect(satisfiesLevel(state, '先攻', redUnit)).toBe(true)
  })

  it('枚数が足りなければ満たさない', () => {
    const state = zoned('エネルギーゾーン', card('e1', '赤'), card('e2', '赤'), card('e3', '赤'))

    expect(satisfiesLevel(state, '先攻', redUnit)).toBe(false)
  })

  it('同じ色のカードが 1 枚も無ければ満たさない', () => {
    const state = zoned('エネルギーゾーン', card('e1', '青'), card('e2', '青'), card('e3', '青'), card('e4', '青'))

    expect(satisfiesLevel(state, '先攻', redUnit)).toBe(false)
  })

  it('無色のカードには色の条件がない', () => {
    const state = zoned('エネルギーゾーン', card('e1', '青'), card('e2', '青'), card('e3', '青'))

    expect(satisfiesLevel(state, '先攻', colorlessStrategy)).toBe(true)
  })

  // 3-1 が数えるのはエネルギーゾーンにあるカードの枚数であり、向きは問わない。
  // 向きが関わるのは、実際に支払う 3-2 のほうである。
  it('フリーズしているカードも枚数に数える', () => {
    const state = zoned(
      'エネルギーゾーン',
      { ...card('e1', '赤'), orientation: 'フリーズ' },
      { ...card('e2', '青'), orientation: 'フリーズ' },
      { ...card('e3', '青'), orientation: 'フリーズ' },
      { ...card('e4', '青'), orientation: 'フリーズ' },
    )

    expect(satisfiesLevel(state, '先攻', redUnit)).toBe(true)
  })

  // 総合ルール 第1部 第2章 3-3
  it('スマッシュゾーンにあるカードは数えない', () => {
    const state = zoned('スマッシュゾーン', card('s1', '赤'), card('s2', '赤'), card('s3', '赤'), card('s4', '赤'))

    expect(satisfiesLevel(state, '先攻', redUnit)).toBe(false)
  })
})

// 総合ルール 第1部 第2章 3-2（ADR-0006）
describe('エネルギーによるコストの支払い', () => {
  it('色付きのコストは、同じ色のエネルギーを 1 枚フリーズして支払う', () => {
    const state = zoned('エネルギーゾーン', card('青', '青'), card('赤', '赤'))

    const paid = payEnergyCost(state, '先攻', redUnit, chooseFirst)

    expect(paid).toBeDefined()
    expect(frozen(paid as DuelState, 'エネルギーゾーン', '赤')).toBe(true)
    expect(frozen(paid as DuelState, 'エネルギーゾーン', '青')).toBe(false)
  })

  it('無色のコストは、任意の色のエネルギーを 1 枚フリーズして支払う', () => {
    const state = zoned('エネルギーゾーン', card('青', '青'))

    const paid = payEnergyCost(state, '先攻', colorlessStrategy, chooseFirst)

    expect(frozen(paid as DuelState, 'エネルギーゾーン', '青')).toBe(true)
  })

  // 無色のコストの「任意の色」は、色を問わないという意味に取る。そう読まないと、
  // 無色のカードだけをエネルギーに置いたプレイヤーが無色のコストすら支払えない。
  it('無色のコストは、無色のエネルギーでも支払える', () => {
    const state = zoned('エネルギーゾーン', card('無色エネ'))

    expect(frozen(payEnergyCost(state, '先攻', colorlessStrategy, chooseFirst) as DuelState, 'エネルギーゾーン', '無色エネ')).toBe(
      true,
    )
  })

  // 総合ルール 第2部 第20章 1-3・2-3・3-10: 支払うのは「エネルギーを 1 枚フリーズ」で
  // あって、色の数だけフリーズするのではない。
  it('複数の色を持つカードでも、フリーズするのは 1 枚だけである', () => {
    const twoColored = defineStrategy({ name: 'テスト・赤青', level: 2, colors: ['赤', '青'] })
    const state = zoned('エネルギーゾーン', card('赤', '赤'), card('青', '青'))

    const paid = payEnergyCost(state, '先攻', twoColored, chooseFirst)

    expect(cardsIn(paid as DuelState, '先攻', 'エネルギーゾーン').filter((each) => each.orientation === 'フリーズ')).toHaveLength(1)
  })

  it('複数の色を持つカードは、そのいずれかの色のエネルギーで支払える', () => {
    const twoColored = defineStrategy({ name: 'テスト・赤青', level: 1, colors: ['赤', '青'] })
    const state = zoned('エネルギーゾーン', card('青', '青'))

    expect(frozen(payEnergyCost(state, '先攻', twoColored, chooseFirst) as DuelState, 'エネルギーゾーン', '青')).toBe(true)
  })

  // 総合ルール 第2部 第24章 1-1: フリーズ状態のカードをフリーズすることはできない。
  it('フリーズしているエネルギーでは支払えない', () => {
    const state = zoned('エネルギーゾーン', { ...card('赤', '赤'), orientation: 'フリーズ' })

    expect(payEnergyCost(state, '先攻', redUnit, chooseFirst)).toBeUndefined()
  })

  it('同じ色のリリース状態のエネルギーが無ければ支払えない', () => {
    const state = zoned('エネルギーゾーン', card('青', '青'))

    expect(payEnergyCost(state, '先攻', redUnit, chooseFirst)).toBeUndefined()
  })

  // 総合ルール 第1部 第2章 3-3
  it('無色のコストであってもスマッシュゾーンのカードでは支払えない', () => {
    const state = zoned('スマッシュゾーン', card('s1', '青'))

    expect(payEnergyCost(state, '先攻', colorlessStrategy, chooseFirst)).toBeUndefined()
  })

  // 総合ルール 第1部 第2章 3-4
  it('0 エネルギーのカードは何もフリーズしない', () => {
    const state = zoned('エネルギーゾーン', card('赤', '赤'))

    expect(payEnergyCost(state, '先攻', freeStrategy, chooseFirst)).toEqual(state)
  })

  // 総合ルール 第1部 第3章 1-1: コストとして向きの変化を要求される場合、支払う
  // プレイヤーのゾーンにあるカードでしか支払えない。
  it('相手のエネルギーでは支払えない', () => {
    const state = putInZone(emptyDuelState(), '後攻', 'エネルギーゾーン', [card('赤', '赤')])

    expect(payEnergyCost(state, '先攻', redUnit, chooseFirst)).toBeUndefined()
  })
})

// 総合ルール 第3部 第8章 2-3（ADR-0006）
describe('プランするためのコストの支払い', () => {
  it('エネルギーを 1 枚フリーズして支払える', () => {
    const state = zoned('エネルギーゾーン', card('青', '青'))

    expect(frozen(payPlanCost(state, '先攻', chooseFirst) as DuelState, 'エネルギーゾーン', '青')).toBe(true)
  })

  // 総合ルール 第2部 第21章 7-5、第1部 第2章 3-3: プランはスマッシュで支払える例外。
  it('スマッシュを 1 枚フリーズして支払える', () => {
    const state = zoned('スマッシュゾーン', card('s1', '青'))

    expect(frozen(payPlanCost(state, '先攻', chooseFirst) as DuelState, 'スマッシュゾーン', 's1')).toBe(true)
  })

  it('リリース状態のエネルギーもスマッシュも無ければ支払えない', () => {
    const state = zoned('エネルギーゾーン', { ...card('青', '青'), orientation: 'フリーズ' })

    expect(payPlanCost(state, '先攻', chooseFirst)).toBeUndefined()
  })
})
