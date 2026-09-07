import { describe, expect, it } from 'vitest'
import { NAME_LIMIT, readName } from './name.js'

/**
 * 表示名の決まり（ADR-0020）。
 *
 * **文字そのものを書き並べない。** 弾きたいのは目に見えない文字なので、テストの中で書くと
 * 何を確かめているのかが読めなくなる。番号から作る。
 */
function charAt(code: number): string {
  return String.fromCodePoint(code)
}

/** その長さちょうどの名前。中身は問わない。 */
function letters(count: number): string {
  return 'あ'.repeat(count)
}

describe('表示名を読む', () => {
  it('そのまま通る', () => {
    expect(readName('かずお')).toEqual({ kind: '決まった', name: 'かずお' })
  })

  it('前後の空白は落とす', () => {
    expect(readName('  かずお  ')).toEqual({ kind: '決まった', name: 'かずお' })
  })

  /** 全角の空白でも同じである。**打ち込んだ人には見分けが付かない。** */
  it('全角の空白も落とす', () => {
    expect(readName(`${charAt(0x3000)}かずお${charAt(0x3000)}`)).toEqual({ kind: '決まった', name: 'かずお' })
  })

  it('間の空白は残る', () => {
    expect(readName('か ず お')).toEqual({ kind: '決まった', name: 'か ず お' })
  })

  it('空なら断る', () => {
    expect(readName('')).toEqual({ kind: '断る', reason: '名前を入れてください' })
  })

  it('空白だけなら断る', () => {
    expect(readName(`  ${charAt(0x3000)} `)).toEqual({ kind: '断る', reason: '名前を入れてください' })
  })
})

describe('長さ', () => {
  it(`${NAME_LIMIT} 文字までは通る`, () => {
    expect(readName(letters(NAME_LIMIT))).toEqual({ kind: '決まった', name: letters(NAME_LIMIT) })
  })

  it('それを超えたら断る', () => {
    expect(readName(letters(NAME_LIMIT + 1))).toEqual({ kind: '断る', reason: `名前は ${NAME_LIMIT} 文字までです` })
  })

  /**
   * **数えるのはコードポイントである**（ADR-0020）。UTF-16 の長さで数えると、絵文字 1 つが
   * 2 文字ぶんになり、上限が文字によって変わる。
   */
  it('絵文字も 1 文字として数える', () => {
    const name = '🃏'.repeat(NAME_LIMIT)

    expect(name.length).toBe(NAME_LIMIT * 2)
    expect(readName(name)).toEqual({ kind: '決まった', name })
  })
})

describe('使えない文字', () => {
  it('制御文字は断る', () => {
    expect(readName(`か${charAt(0x00)}ずお`)).toEqual({ kind: '断る', reason: '使えない文字が入っています' })
  })

  /** 改行は落とさずに断る。**落とすと、打った人の意図と違うものが置かれる。** */
  it('改行は断る', () => {
    expect(readName('かず\nお')).toEqual({ kind: '断る', reason: '使えない文字が入っています' })
  })

  it('削除の文字（U+007F）は断る', () => {
    expect(readName(`かずお${charAt(0x7f)}`)).toEqual({ kind: '断る', reason: '使えない文字が入っています' })
  })

  /**
   * ADR-0020。**閉じ忘れた向きは、その後ろ全部にかかる。** 名前の外に出ているものまで並びが
   * 変わるので、名前の中に閉じ込められない。
   */
  it('双方向制御文字は断る', () => {
    for (const code of [0x202a, 0x202e, 0x2066, 0x2069]) {
      expect(readName(`かず${charAt(code)}お`)).toEqual({ kind: '断る', reason: '使えない文字が入っています' })
    }
  })

  /** **弾き始めると際限が無く、それは迷惑対策である**（ADR-0020）。 */
  it('見た目が似た別の文字は弾かない', () => {
    // キリル文字の а（U+0430）。ラテン文字の a と見分けが付かない。
    expect(readName(`k${charAt(0x430)}zuo`)).toEqual({ kind: '決まった', name: `k${charAt(0x430)}zuo` })
  })
})

/**
 * ADR-0020。**正規化してから置く。** 濁点は 1 文字としても、素の字＋合成用濁点の 2 つとしても
 * 書ける。正規化しないと、見た目が同じ名前が置き場に 2 通りで入る。
 */
describe('正規化', () => {
  const composed = 'が'
  const decomposed = `か${charAt(0x3099)}`

  it('分けて書かれた濁点は畳まれる', () => {
    expect(decomposed).not.toBe(composed)
    expect(readName(decomposed)).toEqual({ kind: '決まった', name: composed })
  })

  /** 畳んでから数えるので、書き方で上限に当たるかどうかが変わらない。 */
  it('畳んでから数える', () => {
    const name = decomposed.repeat(NAME_LIMIT)

    expect([...name].length).toBe(NAME_LIMIT * 2)
    expect(readName(name).kind).toBe('決まった')
  })
})
