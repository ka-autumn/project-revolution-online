import { describe, expect, it } from 'vitest'
import { defineUnit } from '@revolution/engine'
import type { Card } from '@revolution/engine'
import { checkPresets, deckChoicesOf, deckSourceFrom, newSetup, readSupply } from './deck.js'
import type { CardPool, CardSupply } from './deck.js'

/**
 * 立てる時に渡してもらうものを、部屋に渡せる形にするところ（ADR-0021、#105）。
 *
 * **デッキの組み方は持たない。** 何がプールに入るかも、既製デッキに何を何枚積むかも渡す側が
 * 決めることで、ここが見るのは規定への適合だけである。実カードを名指しするのも渡す側（非公開）
 * なので、ここで使うのはエンジンの中で定義した架空のカードと、架空の識別子になる。
 */

function someCard(name: string): Card {
  return defineUnit({ name: `テスト・${name}`, level: 0, bp: 100, sp: 100 })
}

/** すべて違う名前のカードを `count` 種、番号で引ける形にしたもの。 */
function poolOf(prefix: string, count: number): CardPool {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [`${prefix}-${index}`, someCard(`${prefix}${index}`)]))
}

const POOL = poolOf('カード', 60)
const ALL_KEYS = Object.keys(POOL)

/** 構築戦の規定を満たす既製デッキ（総合ルール 第3部 第1章 3-1、60 枚以上）。 */
function supplyOf(overrides: Partial<CardSupply> = {}): CardSupply {
  return {
    pool: POOL,
    presets: [{ id: '既製1', name: 'ひとつめ', cards: ALL_KEYS }],
    restrictions: [],
    ...overrides,
  }
}

describe('渡されたものを読む', () => {
  it('プールと既製デッキと禁止／制限リストが揃っていれば通す', () => {
    const reading = readSupply({
      pool: POOL,
      presets: [{ id: '既製1', name: 'ひとつめ', cards: ALL_KEYS }],
      restrictions: [{ id: 'リスト1', name: '2026年版', limits: { [ALL_KEYS[0] as string]: 1 } }],
    })

    expect(reading.kind).toBe('通す')
  })

  /** リストは器として決まっただけで、中身は環境が動いてから決まる（ADR-0021）。 */
  it('禁止／制限リストは渡されなくてもよい', () => {
    const reading = readSupply({ pool: POOL, presets: [{ id: '既製1', name: 'ひとつめ', cards: ALL_KEYS }] })

    expect(reading.kind === '通す' && reading.supply.restrictions).toEqual([])
  })

  /** デッキを組む場所がまだ無いので、既製デッキが 1 つも無ければ誰も席に着けない。 */
  it('既製デッキが無ければ断る', () => {
    expect(readSupply({ pool: POOL, presets: [] }).kind).toBe('断る')
  })

  it('プールが無ければ断る', () => {
    expect(readSupply({ presets: [{ id: '既製1', name: 'ひとつめ', cards: [] }] }).kind).toBe('断る')
  })

  /**
   * プールに入っているかどうかが、そのまま「実装済み」である（ADR-0021）。外れているなら
   * 渡す側の取り違えなので、立てる時に分かるようにする。
   */
  it('プールに無いカードを積んだ既製デッキは断る', () => {
    const reading = readSupply({
      pool: POOL,
      presets: [{ id: '既製1', name: 'ひとつめ', cards: [...ALL_KEYS, '知らない番号'] }],
    })

    expect(reading.kind).toBe('断る')
  })

  /** 識別子が重なると、選ばれたのがどちらか決められない。 */
  it('既製デッキの識別子が重なっていれば断る', () => {
    const preset = { id: '同じ', name: 'ひとつめ', cards: ALL_KEYS }

    expect(readSupply({ pool: POOL, presets: [preset, { ...preset, name: 'ふたつめ' }] }).kind).toBe('断る')
  })

  it('枚数が数でない禁止／制限リストは断る', () => {
    const reading = readSupply({
      pool: POOL,
      presets: [{ id: '既製1', name: 'ひとつめ', cards: ALL_KEYS }],
      restrictions: [{ id: 'リスト1', name: '2026年版', limits: { [ALL_KEYS[0] as string]: '1 枚' } }],
    })

    expect(reading.kind).toBe('断る')
  })

  /**
   * リストは遊ばれている環境の側の言葉で、何が実装済みかとは別に決まる（ADR-0021）。
   * **プールに無いカードを名指していても断らない。**
   */
  it('禁止／制限リストは、プールに無いカードを名指していてもよい', () => {
    const reading = readSupply({
      pool: POOL,
      presets: [{ id: '既製1', name: 'ひとつめ', cards: ALL_KEYS }],
      restrictions: [{ id: 'リスト1', name: '2026年版', limits: { 知らない番号: 0 } }],
    })

    expect(reading.kind).toBe('通す')
  })
})

describe('既製デッキの不備を確かめる', () => {
  it('規定を満たしていれば、不備は無い', () => {
    expect(checkPresets(supplyOf())).toEqual([])
  })

  // 総合ルール 第3部 第1章 3-1
  it('枚数が足りなければ、どの既製デッキかが分かる', () => {
    const supply = supplyOf({
      presets: [
        { id: '足りている', name: 'ひとつめ', cards: ALL_KEYS },
        { id: '足りない', name: 'ふたつめ', cards: ALL_KEYS.slice(0, 10) },
      ],
    })

    const violations = checkPresets(supply)

    expect(violations).toHaveLength(1)
    expect(violations[0]?.deck).toBe('足りない')
    expect(violations[0]?.violation.kind).toBe('枚数不足')
  })

  /**
   * 総合ルール 第3部 第1章 3-1。同名のカードはデッキに 4 枚まで。
   *
   * **枚数だけを見ているのではない**ことを、60 枚あるが同名が多すぎるデッキで確かめる。
   */
  it('同名が多すぎれば、枚数が足りていても不備になる', () => {
    const one = ALL_KEYS[0] as string
    const supply = supplyOf({ presets: [{ id: '同名だらけ', name: 'ひとつめ', cards: Array.from({ length: 60 }, () => one) }] })

    expect(checkPresets(supply).map((each) => each.violation.kind)).toContain('同名の入れすぎ')
  })

  /**
   * どのリストを使うかは部屋ごとに決まる（ADR-0021）ので、既製デッキがどのリストの下でも
   * 通るとは限らない。**立てる時にリストを当てない。**
   */
  it('禁止／制限リストに触れていても、立てる時には不備にしない', () => {
    const supply = supplyOf({
      restrictions: [{ id: 'リスト1', name: '2026年版', limits: Object.fromEntries(ALL_KEYS.map((key) => [key, 0])) }],
    })

    expect(checkPresets(supply)).toEqual([])
  })
})

describe('席に持ち込めるデッキ', () => {
  const supply = supplyOf({
    presets: [
      { id: '既製1', name: 'ひとつめ', cards: ALL_KEYS },
      { id: '既製2', name: 'ふたつめ', cards: ALL_KEYS },
    ],
  })

  it('識別子で引ける', () => {
    const brought = deckSourceFrom(supply).of('既製2')

    expect(brought?.cards).toHaveLength(60)
    expect(brought?.keys).toEqual(ALL_KEYS)
  })

  it('知らない識別子では引けない', () => {
    expect(deckSourceFrom(supply).of('知らないデッキ')).toBeUndefined()
  })

  /** 選ばずに座った人も席に着ける。**60 枚を選び切るまで対戦できない入口にしない**（ADR-0021）。 */
  it('既定は最初の既製デッキである', () => {
    expect(deckSourceFrom(supply).fallback).toBe('既製1')
  })

  /** 記録に残っているのは識別子の並びで、そこから打ち直す（`room.ts` の `restore`）。 */
  it('識別子の並びから組み直せる', () => {
    const rebuilt = deckSourceFrom(supply).from(ALL_KEYS.slice(0, 3))

    expect(rebuilt?.cards).toEqual([POOL[ALL_KEYS[0] as string], POOL[ALL_KEYS[1] as string], POOL[ALL_KEYS[2] as string]])
  })

  /** 取り下げられたカードを含むデッキは、使えないものとして扱う（ADR-0021）。 */
  it('プールから引けないカードが混ざっていれば組み直せない', () => {
    expect(deckSourceFrom(supply).from([...ALL_KEYS, '知らない番号'])).toBeUndefined()
  })

  /** 画面に出るのは名前で、指すのは識別子である。**渡された順のまま並べる。** */
  it('選べるデッキは、渡された順に名前付きで並ぶ', () => {
    expect(deckChoicesOf(supply)).toEqual([
      { id: '既製1', name: 'ひとつめ' },
      { id: '既製2', name: 'ふたつめ' },
    ])
  })
})

describe('部屋ごとに引くもの', () => {
  /**
   * 呼ぶたびに違うシードを返す（ADR-0005）。同じシードを返すと、どの部屋も同じ山札の並びに
   * なる。**たまたま同じ値が 2 回続くことはありうる**ので、何度か引いて 1 つでも違えばよい。
   */
  it('呼ぶたびにシードが変わる', () => {
    const seeds = new Set(Array.from({ length: 20 }, () => newSetup().seed))

    expect(seeds.size).toBeGreaterThan(1)
  })

  /** 合言葉は URL にも載る（`?room=`）ので、英数字だけにする。 */
  it('合言葉は英数字だけからできている', () => {
    expect(newSetup().code).toMatch(/^[0-9a-z]+$/)
  })
})
