import { afterEach, describe, expect, it } from 'vitest'
import proxy from './proxy.js'

/**
 * 配った画面に掛ける鍵（ADR-0013）。
 *
 * **この 1 つだけリポジトリのルートに置いてある。** 配る側が入口をパッケージの中から拾えないため
 * （`vercel.json`）、実装がルートにあり、テストもそれと並べている。
 */

const before = process.env.BASIC_AUTH
afterEach(() => {
  process.env.BASIC_AUTH = before
})

/** ブラウザが送る形。合言葉を UTF-8 のバイト列にしてから base64 に直す。 */
function named(value: string): Headers {
  return new Headers({ authorization: `Basic ${Buffer.from(value, 'utf8').toString('base64')}` })
}

function opened(headers?: Headers): number {
  return proxy(new Request('https://example.com/', { headers })).status
}

describe('画面に掛ける鍵', () => {
  it('鍵が渡されていなければ素通しする', () => {
    process.env.BASIC_AUTH = ''
    expect(opened()).toBe(200)
  })

  it('鍵が渡されていて名乗らなければ、名乗りを求める', () => {
    process.env.BASIC_AUTH = 'あ:ひらけごま'
    expect(opened()).toBe(401)
  })

  it('合言葉が合っていれば通す', () => {
    process.env.BASIC_AUTH = 'あ:ひらけごま'
    expect(opened(named('あ:ひらけごま'))).toBe(200)
  })

  it('合言葉が違えば通さない', () => {
    process.env.BASIC_AUTH = 'あ:ひらけごま'
    expect(opened(named('あ:ちがう'))).toBe(401)
  })

  // ASCII でない合言葉をこちらから base64 に直すと、その場で落ちて全部が 500 になる。
  it('日本語の合言葉でも落ちない', () => {
    process.env.BASIC_AUTH = 'まもり:あいことば'
    expect(opened(named('まもり:あいことば'))).toBe(200)
    expect(opened(named('まもり:ちがう'))).toBe(401)
  })

  it('読めない名乗りは通さない', () => {
    process.env.BASIC_AUTH = 'me:secret'
    expect(opened(new Headers({ authorization: 'Basic !!!!' }))).toBe(401)
    expect(opened(new Headers({ authorization: 'Bearer token' }))).toBe(401)
  })
})
