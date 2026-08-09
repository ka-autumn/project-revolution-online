import { describe, expect, it } from 'vitest'
import { nextInt, randomFromSeed, shuffle } from './index.js'

const numbers = Array.from({ length: 20 }, (_, index) => index)

// 乱数そのものはルールではなく、シードから対戦を再生できるようにするための仕組み
// （ADR-0005）なので、条番号は付けない（ADR-0006）。
describe('シードから作る乱数列', () => {
  it('同じシードからは同じ並びが得られる', () => {
    const first = shuffle(numbers, randomFromSeed(20260809))
    const second = shuffle(numbers, randomFromSeed(20260809))

    expect(second.value).toEqual(first.value)
  })

  it('シードが違えば違う並びになる', () => {
    const first = shuffle(numbers, randomFromSeed(1))
    const second = shuffle(numbers, randomFromSeed(2))

    expect(second.value).not.toEqual(first.value)
  })

  it('乱数列は値なので、続きを使わずに取り出すと同じ値が出る', () => {
    const random = randomFromSeed(20260809)

    expect(nextInt(random, 100).value).toBe(nextInt(random, 100).value)
  })

  it('取り出した続きの乱数列からは別の値が出る', () => {
    const first = nextInt(randomFromSeed(20260809), 1000)
    const second = nextInt(first.random, 1000)

    expect(second.value).not.toBe(first.value)
  })

  it('取り出す整数は 0 以上 bound 未満に収まる', () => {
    let random = randomFromSeed(20260809)
    for (let i = 0; i < 1000; i++) {
      const next = nextInt(random, 9)
      expect(next.value).toBeGreaterThanOrEqual(0)
      expect(next.value).toBeLessThan(9)
      random = next.random
    }
  })
})

describe('シャッフル', () => {
  it('カードは増えも減りもしない', () => {
    const shuffled = shuffle(numbers, randomFromSeed(3))

    expect([...shuffled.value].sort((a, b) => a - b)).toEqual(numbers)
  })

  // ADR-0001: エンジンは「盤面 ＋ 行動 → 次の盤面」の純粋関数である
  it('元の並びは変わらない', () => {
    const before = [...numbers]
    shuffle(before, randomFromSeed(4))

    expect(before).toEqual(numbers)
  })

  it('どの位置のカードも、シードを変えればどの位置にも来る', () => {
    // 「不規則な順番になる」（総合ルール 第3部 第1章 4）ことの最低限の確認。
    // 先頭のカードが、シード次第で 20 通りのどの位置にも現れる。
    const positions = new Set(
      Array.from({ length: 200 }, (_, seed) => shuffle(numbers, randomFromSeed(seed)).value.indexOf(0)),
    )

    expect(positions.size).toBe(numbers.length)
  })
})
