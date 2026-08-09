import { describe, expect, it } from 'vitest'
// 山札を組み立てるためだけに `putInZone` を使う。engine の中からゾーンを差し替える
// ための関数であり、公開する API ではないので `index.js` からは取らない。
import { putInZone } from './duel.js'
import {
  BATTLE_SPACE,
  PLAYER_ZONES,
  cardsIn,
  cardsOn,
  defineUnit,
  draw,
  emptyDuelState,
  instantiate,
  putOnSquare,
} from './index.js'
import type { Square } from './index.js'

const testUnit = defineUnit({ name: 'テストユニット', level: 1, colors: ['赤'], bp: 1000, sp: 1000 })

const someSquare: Square = { row: 2, column: 1 }
const anotherSquare: Square = { row: 2, column: 0 }

// デュエルの準備（デッキを山札にする、初手を引く）はまだ実装していないため、ここで
// 検証するのは盤面の入れ物としての振る舞いだけで、ルールの挙動ではない。そのため
// 条番号を付けない（ADR-0006）。
describe('空の盤面', () => {
  it('すべてのスクエアにカードがない', () => {
    const state = emptyDuelState()
    for (const square of BATTLE_SPACE) {
      expect(cardsOn(state, square)).toEqual([])
    }
  })

  it('プレイヤーごとのゾーンがどちらのプレイヤーにも空で存在する', () => {
    const state = emptyDuelState()
    for (const zone of PLAYER_ZONES) {
      expect(cardsIn(state, '先攻', zone)).toEqual([])
      expect(cardsIn(state, '後攻', zone)).toEqual([])
    }
  })
})

describe('スクエアに置く', () => {
  it('置いたカードがそのスクエアから取り出せる', () => {
    const unit = instantiate({ id: 'u1', card: testUnit, owner: '先攻' })
    const state = putOnSquare(emptyDuelState(), someSquare, unit)

    expect(cardsOn(state, someSquare)).toEqual([unit])
  })

  // 総合ルール 第2部 第21章 1-1（ADR-0006）
  it('スクエアはそれぞれが別のゾーンなので、他のスクエアには影響しない', () => {
    const unit = instantiate({ id: 'u1', card: testUnit, owner: '先攻' })
    const state = putOnSquare(emptyDuelState(), someSquare, unit)

    expect(cardsOn(state, anotherSquare)).toEqual([])
  })

  // 総合ルール 第4部 第14章 4-7
  it('すでにユニットがいるスクエアにも置ける。後から置かれたものが後ろに並ぶ', () => {
    // 同じプレイヤーのユニットが重なった時に後から置かれたほうを捨札に置くのは
    // ルールエフェクトの仕事であり、置くこと自体は起こる。
    const first = instantiate({ id: 'u1', card: testUnit, owner: '先攻' })
    const second = instantiate({ id: 'u2', card: testUnit, owner: '先攻' })
    const state = putOnSquare(putOnSquare(emptyDuelState(), someSquare, first), someSquare, second)

    expect(cardsOn(state, someSquare)).toEqual([first, second])
  })

  // ADR-0001: エンジンは「盤面 ＋ 行動 → 次の盤面」の純粋関数である
  it('元の盤面は変わらない', () => {
    const before = emptyDuelState()
    putOnSquare(before, someSquare, instantiate({ id: 'u1', card: testUnit, owner: '先攻' }))

    expect(cardsOn(before, someSquare)).toEqual([])
  })
})

// 総合ルール 第2部 第21章 1-5（ADR-0006）
describe('引く', () => {
  const top = instantiate({ id: 'l1', card: testUnit, owner: '先攻' })
  const second = instantiate({ id: 'l2', card: testUnit, owner: '先攻' })
  const library = putInZone(emptyDuelState(), '先攻', '山札', [top, second])

  it('山札の 1 番上のカードが手札に加わる', () => {
    const drawn = draw(library, '先攻')

    expect(cardsIn(drawn, '先攻', '手札')).toEqual([top])
    expect(cardsIn(drawn, '先攻', '山札')).toEqual([second])
  })

  it('すでに手札があるなら、その後ろに加わる', () => {
    const held = instantiate({ id: 'h1', card: testUnit, owner: '先攻' })
    const drawn = draw(putInZone(library, '先攻', '手札', [held]), '先攻')

    expect(cardsIn(drawn, '先攻', '手札')).toEqual([held, top])
  })

  it('引いたプレイヤーのゾーンだけが変わる', () => {
    const drawn = draw(library, '先攻')

    expect(cardsIn(drawn, '後攻', '山札')).toEqual([])
    expect(cardsIn(drawn, '後攻', '手札')).toEqual([])
  })

  // 総合ルール 第3部 第3章 2: 山札が 0 枚になったプレイヤーの敗北は、引けないこととは
  // 別のルールエフェクトである。
  it('山札が空なら何も起こらない', () => {
    expect(draw(emptyDuelState(), '先攻')).toEqual(emptyDuelState())
  })

  // 総合ルール 第2部 第21章 3-1・3-3
  it('プランゾーンにカードがあれば、それが山札の 1 番上なのでそれを引く', () => {
    const plan = instantiate({ id: 'p1', card: testUnit, owner: '先攻' })
    const planned = putInZone(library, '先攻', 'プランゾーン', [plan])

    const drawn = draw(planned, '先攻')

    expect(cardsIn(drawn, '先攻', '手札')).toEqual([plan])
    // プランゾーンはなくなり、次に現れる山札の 1 番上のカードは裏向きのままになる。
    expect(cardsIn(drawn, '先攻', 'プランゾーン')).toEqual([])
    expect(cardsIn(drawn, '先攻', '山札')).toEqual([top, second])
  })
})

describe('カードインスタンス', () => {
  it('支配者を指定しなければ持ち主が支配する', () => {
    const unit = instantiate({ id: 'u1', card: testUnit, owner: '先攻' })

    expect(unit.owner).toBe('先攻')
    expect(unit.controller).toBe('先攻')
  })

  it('持ち主と支配者は食い違うことがある', () => {
    const unit = instantiate({ id: 'u1', card: testUnit, owner: '先攻', controller: '後攻' })

    expect(unit.owner).toBe('先攻')
    expect(unit.controller).toBe('後攻')
  })

  // 総合ルール 第2部 第21章 6-3・7-3・9-3: カードは通常リリース状態で置かれる。
  it('向きを指定しなければリリース状態になる', () => {
    expect(instantiate({ id: 'u1', card: testUnit, owner: '先攻' }).orientation).toBe('リリース')
  })
})
