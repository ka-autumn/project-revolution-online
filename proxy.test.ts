import { afterEach, describe, expect, it } from 'vitest'
import proxy from './proxy.js'

/**
 * 配った画面に掛ける鍵（ADR-0013）。
 *
 * **この 1 つだけリポジトリのルートに置いてある。** 配る側が入口をパッケージの中から拾えないため
 * （`vercel.json`）、実装がルートにあり、テストもそれと並べている。
 */

const before = process.env.BASIC_AUTH
const beforeEnv = process.env.VERCEL_ENV
afterEach(() => {
  process.env.BASIC_AUTH = before
  if (beforeEnv === undefined) delete process.env.VERCEL_ENV
  else process.env.VERCEL_ENV = beforeEnv
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


describe('検索に載せない印', () => {
  function robots(environment: string | undefined): string | null {
    if (environment === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = environment
    process.env.BASIC_AUTH = ''

    return proxy(new Request('https://example.com/')).headers.get('x-robots-tag')
  }

  it('preview には付ける', () => {
    expect(robots('preview')).toBe('noindex')
  })

  it('本番と手元には付けない', () => {
    expect(robots('production')).toBeNull()
    expect(robots('development')).toBeNull()
    expect(robots(undefined)).toBeNull()
  })

  it('鍵を通ったときにも付ける', () => {
    process.env.VERCEL_ENV = 'preview'
    process.env.BASIC_AUTH = 'me:secret'
    const response = proxy(new Request('https://example.com/', { headers: named('me:secret') }))
    expect(response.headers.get('x-robots-tag')).toBe('noindex')
  })
})
