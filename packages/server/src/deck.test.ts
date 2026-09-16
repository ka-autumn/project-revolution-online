import { describe, expect, it } from 'vitest'
import { defineStrategy, defineTrap, defineUnit } from '@revolution/engine'
import type { Card } from '@revolution/engine'
import {
  checkPresets,
  deckChoicesOf,
  deckSourceFrom,
  newSetup,
  poolFacesOf,
  readSupply,
  restrictionChoicesOf,
} from './deck.js'
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
      restrictions: [{ id: 'リスト1', name: '2026年版', limits: { 'テスト・カード0': 1 } }],
    })

    expect(reading.kind).toBe('通す')
  })

  /** リストは器として決まっただけで、中身は環境が動いてから決まる（ADR-0021）。 */
  it('禁止／制限リストは渡されなくてもよい', () => {
    const reading = readSupply({ pool: POOL, presets: [{ id: '既製1', name: 'ひとつめ', cards: ALL_KEYS }] })

    expect(reading.kind === '通す' && reading.supply.restrictions).toEqual([])
  })

  /** #193。エキスパンションは絞り込みに使うだけで、無くても組める。 */
  it('エキスパンションは渡されなくてもよい', () => {
    const reading = readSupply({ pool: POOL, presets: [{ id: '既製1', name: 'ひとつめ', cards: ALL_KEYS }] })

    expect(reading.kind === '通す' && reading.supply.expansions).toEqual([])
  })

  /** 収録されていることと、実装済みであることは別に決まる。 */
  it('エキスパンションは、プールに無いカードを含んでいてもよい', () => {
    const reading = readSupply({
      pool: POOL,
      presets: [{ id: '既製1', name: 'ひとつめ', cards: ALL_KEYS }],
      expansions: [{ name: 'テストの第1弾', cards: ['カード-0', 'まだ実装していない番号'] }],
    })

    expect(reading.kind).toBe('通す')
  })

  /** 画面は名前で絞り込む。重なると、どちらのことか決められない。 */
  it('名前が重なるエキスパンションは断る', () => {
    const expansion = { name: 'テストの第1弾', cards: ['カード-0'] }
    const reading = readSupply({
      pool: POOL,
      presets: [{ id: '既製1', name: 'ひとつめ', cards: ALL_KEYS }],
      expansions: [expansion, { ...expansion, cards: ['カード-1'] }],
    })

    expect(reading).toEqual({ kind: '断る', reason: 'エキスパンションの名前が重なっています: テストの第1弾' })
  })

  it('収録カードが識別子の並びでないエキスパンションは断る', () => {
    const reading = readSupply({
      pool: POOL,
      presets: [{ id: '既製1', name: 'ひとつめ', cards: ALL_KEYS }],
      expansions: [{ name: 'テストの第1弾', cards: 'カード-0' }],
    })

    expect(reading.kind).toBe('断る')
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
      restrictions: [{ id: 'リスト1', name: '2026年版', limits: { 'テスト・カード0': '1 枚' } }],
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
      restrictions: [{ id: 'リスト1', name: '2026年版', limits: { 'テスト・プールに無いカード': 0 } }],
    })

    expect(reading.kind).toBe('通す')
  })

  /** 部屋はリストを識別子で覚える（`room.ts`）。重なると、どちらを当てているか決められない。 */
  it('識別子が重なる禁止／制限リストは断る', () => {
    const list = { id: 'リスト1', name: '2026年版', limits: {} }
    const reading = readSupply({
      pool: POOL,
      presets: [{ id: '既製1', name: 'ひとつめ', cards: ALL_KEYS }],
      restrictions: [list, { ...list, name: '2027年版' }],
    })

    expect(reading).toEqual({ kind: '断る', reason: '禁止／制限リストの識別子が重なっています: リスト1' })
  })

  /** 空白を無視して比べると空になり、どのカードも指さない（engine の `sameNameKey`）。 */
  it('名前が空白だけのカードを名指す禁止／制限リストは断る', () => {
    const reading = readSupply({
      pool: POOL,
      presets: [{ id: '既製1', name: 'ひとつめ', cards: ALL_KEYS }],
      restrictions: [{ id: 'リスト1', name: '2026年版', limits: { '　': 0 } }],
    })

    expect(reading).toEqual({ kind: '断る', reason: '禁止／制限リスト リスト1 に名前の無いカードが入っています' })
  })
})

describe('選べる禁止／制限リスト', () => {
  it('渡された順のまま、識別子と名前だけを並べる。中身は出さない', () => {
    const supply = supplyOf({
      restrictions: [
        { id: 'リスト2', name: '2027年版', limits: { 'テスト・カード0': 0 } },
        { id: 'リスト1', name: '2026年版', limits: {} },
      ],
    })

    expect(restrictionChoicesOf(supply)).toEqual([
      { id: 'リスト2', name: '2027年版' },
      { id: 'リスト1', name: '2026年版' },
    ])
  })
})

describe('配るカードプール', () => {
  it('識別子と、カードに書かれていることを組にして並べる。テキストは載り、効果は載らない', () => {
    const pool: CardPool = {
      'テスト-S': defineStrategy({
        name: 'テスト・ストラテジー',
        level: 2,
        colors: ['赤'],
        text: ['カードを1枚引く。'],
        // 効果は関数なので、配る形には載らない。載っていないことを見るために書いておく。
        *effect() {},
      }),
      'テスト-T': defineTrap({ name: 'テスト・トラップ', level: 1, triggerIcon: [{ row: 0, column: 1 }] }),
    }

    expect(poolFacesOf({ pool })).toEqual([
      {
        key: 'テスト-S',
        expansions: [],
        face: {
          type: 'ストラテジー',
          name: 'テスト・ストラテジー',
          level: 2,
          colors: ['赤'],
          stars: 0,
          reverseStars: 0,
          attributes: [],
          text: ['カードを1枚引く。'],
        },
      },
      {
        key: 'テスト-T',
        expansions: [],
        face: {
          type: 'トラップ',
          name: 'テスト・トラップ',
          level: 1,
          colors: [],
          stars: 0,
          reverseStars: 0,
          attributes: [],
          text: [],
          triggerIcon: [{ row: 0, column: 1 }],
        },
      },
    ])
  })

  /** #193。1 枚が複数のエキスパンションに入りうる。名前は渡された並びの順に添える。 */
  it('収録されているエキスパンションの名前を、渡された順に添える', () => {
    const faces = poolFacesOf({
      pool: poolOf('収録', 3),
      expansions: [
        { name: 'テストの第2弾', cards: ['収録-1', '収録-2'] },
        { name: 'テストの第1弾', cards: ['収録-0', '収録-1'] },
      ],
    })

    expect(faces.map((card) => [card.key, card.expansions])).toEqual([
      ['収録-0', ['テストの第1弾']],
      ['収録-1', ['テストの第2弾', 'テストの第1弾']],
      ['収録-2', ['テストの第2弾']],
    ])
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
    const banningAll = Object.fromEntries(Object.values(POOL).map((card) => [card.name, 0]))
    const supply = supplyOf({ restrictions: [{ id: 'リスト1', name: '2026年版', limits: banningAll }] })

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
