import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SIGN_IN_PATH } from '@revolution/engine'
import {
  CALLBACK_PATH,
  authorizeUrl,
  cookieValue,
  createSignIn,
  digest,
  identityInIdToken,
  signInConfigFrom,
} from './sign-in.js'
import type { SignIn, SignInConfig } from './sign-in.js'
import { openStore } from './store.js'
import type { Store } from './store.js'

/**
 * ログインの決めごと（ADR-0019）。
 *
 * Google と実際に遣り取りするところは差し替えて確かめる。**確かめたいのは、何を受け取ったら
 * 誰として通すかであって、Google が返す形ではない。**
 */

const CONFIG: SignInConfig = {
  clientId: 'テスト.apps.googleusercontent.com',
  clientSecret: 'ひみつ',
  callback: `https://duel.example.com${CALLBACK_PATH}`,
  returnTo: 'https://app.example.com/',
}

/** 署名を持たない ID トークン。**署名は検証しない**（ADR-0019）ので、これで足りる。 */
function idTokenOf(claims: Readonly<Record<string, unknown>>): string {
  return `ヘッダ.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.しるし`
}

const SIGNED_IN = idTokenOf({ iss: 'https://accounts.google.com', aud: CONFIG.clientId, sub: '10001' })

/** 返事を溜めておく、`ServerResponse` の代わり。 */
class Reply {
  status: number | undefined
  headers: Readonly<Record<string, string | readonly string[]>> = {}
  body = ''
  private readonly ended: Promise<void>
  private finish = (): void => {}

  constructor() {
    this.ended = new Promise((resolve) => {
      this.finish = resolve
    })
  }

  writeHead(status: number, headers?: Readonly<Record<string, string | readonly string[]>>): this {
    this.status = status
    this.headers = headers ?? {}
    return this
  }

  end(body?: string): void {
    this.body = body ?? ''
    this.finish()
  }

  /** 返事が返るまで待つ。折り返しは Google との遣り取りを挟むので、その場では終わらない。 */
  done(): Promise<void> {
    return this.ended
  }

  /** 書かれた `Set-Cookie` を、名前から引ける形にしたもの。 */
  cookies(): Map<string, string> {
    const written = this.headers['set-cookie'] ?? []
    const all = typeof written === 'string' ? [written] : written
    return new Map(all.map((one) => [one.slice(0, one.indexOf('=')), one]))
  }
}

/** 引き受けさせる要求。`IncomingMessage` のうち、ここが見るところだけ。 */
function request(url: string, cookie?: string): Parameters<SignIn['handle']>[0] {
  return { url, headers: cookie === undefined ? {} : { cookie } } as Parameters<SignIn['handle']>[0]
}

function replyTo(signIn: SignIn, url: string, cookie?: string): Reply {
  const reply = new Reply()
  expect(signIn.handle(request(url, cookie), reply as unknown as Parameters<SignIn['handle']>[1])).toBe(true)
  return reply
}

/** 折り返しの Cookie を、送り返す形の 1 行にする。 */
function sending(cookies: Map<string, string>, name: string): string {
  const written = cookies.get(name)
  if (written === undefined) throw new Error(`${name} が書かれていない`)

  return written.slice(0, written.indexOf(';'))
}

describe('設定', () => {
  it('4 つとも無ければ、ログインを持たない', () => {
    expect(signInConfigFrom({})).toBeUndefined()
  })

  it('半分だけ揃っていたら落とす。名乗りの口が開いたままになるより落ちるほうがよい', () => {
    expect(() => signInConfigFrom({ GOOGLE_CLIENT_ID: 'あ', SIGN_IN_RETURN_TO: 'https://app.example.com/' })).toThrow(
      /GOOGLE_CLIENT_SECRET, SIGN_IN_CALLBACK/,
    )
  })

  it('折り返し先の道筋が違えば落とす。立てた後に人が試すまで気付けないため', () => {
    expect(() =>
      signInConfigFrom({
        GOOGLE_CLIENT_ID: 'あ',
        GOOGLE_CLIENT_SECRET: 'い',
        SIGN_IN_CALLBACK: 'https://duel.example.com/もどり',
        SIGN_IN_RETURN_TO: 'https://app.example.com/',
      }),
    ).toThrow(new RegExp(CALLBACK_PATH))
  })

  it('揃っていれば読める', () => {
    expect(
      signInConfigFrom({
        GOOGLE_CLIENT_ID: CONFIG.clientId,
        GOOGLE_CLIENT_SECRET: CONFIG.clientSecret,
        SIGN_IN_CALLBACK: CONFIG.callback,
        SIGN_IN_RETURN_TO: CONFIG.returnTo,
      }),
    ).toEqual(CONFIG)
  })
})

describe('Google へ送る先', () => {
  it('求める scope は openid だけである（ADR-0019）', () => {
    const url = new URL(authorizeUrl(CONFIG, 'じょうたい'))
    expect(url.searchParams.get('scope')).toBe('openid')
    expect(url.searchParams.get('client_id')).toBe(CONFIG.clientId)
    expect(url.searchParams.get('redirect_uri')).toBe(CONFIG.callback)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe('じょうたい')
  })
})

describe('Cookie を読む', () => {
  it('名前で引ける', () => {
    expect(cookieValue('a=1; revolution_session=あいことば; b=2', 'revolution_session')).toBe('あいことば')
  })

  it('前後の空白があっても引ける', () => {
    expect(cookieValue('revolution_session=あ', 'revolution_session')).toBe('あ')
  })

  it('無ければ undefined', () => {
    expect(cookieValue('a=1', 'revolution_session')).toBeUndefined()
    expect(cookieValue(undefined, 'revolution_session')).toBeUndefined()
    expect(cookieValue('revolution_session=', 'revolution_session')).toBeUndefined()
  })

  it('名前の一部が同じだけのものは引かない', () => {
    expect(cookieValue('other_revolution_session=あ', 'revolution_session')).toBeUndefined()
  })
})

describe('ID トークンを読む', () => {
  it('aud が自分の client_id なら通す（ADR-0019）', () => {
    expect(identityInIdToken(SIGNED_IN, CONFIG.clientId)).toEqual({ issuer: 'google', subject: '10001' })
  })

  it('ほかのアプリ向けに出されたものでは入れない', () => {
    expect(identityInIdToken(SIGNED_IN, 'べつのアプリ')).toBeUndefined()
  })

  it('iss が 2 通りのどちらでも、同じ発行元に畳む', () => {
    const short = idTokenOf({ iss: 'accounts.google.com', aud: CONFIG.clientId, sub: '10001' })
    expect(identityInIdToken(short, CONFIG.clientId)).toEqual(identityInIdToken(SIGNED_IN, CONFIG.clientId))
  })

  it('知らない発行元は断る', () => {
    const elsewhere = idTokenOf({ iss: 'https://example.invalid', aud: CONFIG.clientId, sub: '10001' })
    expect(identityInIdToken(elsewhere, CONFIG.clientId)).toBeUndefined()
  })

  it('sub が無ければ断る。身元にならない', () => {
    expect(identityInIdToken(idTokenOf({ iss: 'accounts.google.com', aud: CONFIG.clientId }), CONFIG.clientId)).toBeUndefined()
  })

  it('読めないものは断る', () => {
    expect(identityInIdToken('よめない', CONFIG.clientId)).toBeUndefined()
    expect(identityInIdToken('あ.いい.う', CONFIG.clientId)).toBeUndefined()
  })
})

describe('ログインの道筋', () => {
  let store: Store
  let signIn: SignIn
  let asked: string[]
  /** Google が次に誰であると言ってくるか。**入れ替えるのは人だけで、道筋は変えない。** */
  let subject: string

  beforeEach(() => {
    store = openStore(':memory:')
    asked = []
    subject = '10001'
    signIn = createSignIn({
      config: CONFIG,
      store,
      exchange: (_config, code) => {
        asked.push(code)
        return Promise.resolve(idTokenOf({ iss: 'https://accounts.google.com', aud: CONFIG.clientId, sub: subject }))
      },
    })
  })

  afterEach(() => store.close())

  /** ログインを通しで済ませて、送り返す形のセッション Cookie を返す。 */
  async function signedInAs(who: string): Promise<string> {
    subject = who
    const started = replyTo(signIn, SIGN_IN_PATH)
    const state = new URL(String(started.headers.location)).searchParams.get('state')
    const back = replyTo(
      signIn,
      `${CALLBACK_PATH}?code=もらった&state=${state ?? ''}`,
      sending(started.cookies(), 'revolution_state'),
    )
    await back.done()

    return sending(back.cookies(), 'revolution_session')
  }

  it('知らない道筋は引き受けない', () => {
    const reply = new Reply()
    expect(signIn.handle(request('/よそ'), reply as unknown as Parameters<SignIn['handle']>[1])).toBe(false)
  })

  it('始めると Google へ送られ、突き合わせの Cookie が書かれる', () => {
    const reply = replyTo(signIn, SIGN_IN_PATH)

    expect(reply.status).toBe(302)
    expect(String(reply.headers.location)).toContain('accounts.google.com')
    const state = reply.cookies().get('revolution_state')
    expect(state).toMatch(/HttpOnly/)
    expect(state).toMatch(/SameSite=Lax/)
    // **`Domain` は付けない**（ADR-0019）。付けると画面を配っている側にも送られる。
    expect(state).not.toMatch(/Domain=/)
  })

  it('行きと帰りが同じ人のものでなければ断る（ADR-0019）', async () => {
    const started = replyTo(signIn, SIGN_IN_PATH)
    const state = new URL(String(started.headers.location)).searchParams.get('state')

    const wrong = replyTo(signIn, `${CALLBACK_PATH}?code=もらった&state=${state ?? ''}`, 'revolution_state=べつ')
    await wrong.done()

    expect(wrong.status).toBe(400)
    // Google に code を渡す手前で止まる。
    expect(asked).toEqual([])
  })

  it('突き合わせの Cookie が無ければ断る', async () => {
    const reply = replyTo(signIn, `${CALLBACK_PATH}?code=もらった&state=じょうたい`)
    await reply.done()

    expect(reply.status).toBe(400)
  })

  it('通れば席に着ける人になり、そのセッションで繋げる', async () => {
    const started = replyTo(signIn, SIGN_IN_PATH)
    const state = new URL(String(started.headers.location)).searchParams.get('state')

    const back = replyTo(
      signIn,
      `${CALLBACK_PATH}?code=もらった&state=${state ?? ''}`,
      sending(started.cookies(), 'revolution_state'),
    )
    await back.done()

    expect(asked).toEqual(['もらった'])
    expect(back.status).toBe(302)
    // **戻り先は設定に持つ**（ADR-0019）。URL で受け取らない。
    expect(back.headers.location).toBe(CONFIG.returnTo)

    const session = sending(back.cookies(), 'revolution_session')
    expect(signIn.holderOf(session)).toBe(store.identify('google', '10001'))
  })

  it('同じ人が入り直しても、同じ席の人のままである', async () => {
    const first = await signedInAs('10001')
    const again = await signedInAs('10001')

    expect(first).not.toBe(again)
    expect(signIn.holderOf(again)).toBe(signIn.holderOf(first))
  })

  it('別の sub は別の人になる', async () => {
    const one = await signedInAs('10001')
    const other = await signedInAs('20002')

    expect(signIn.holderOf(other)).not.toBe(signIn.holderOf(one))
  })

  it('知らない合言葉では誰でもない', () => {
    expect(signIn.holderOf('revolution_session=でたらめ')).toBeUndefined()
    expect(signIn.holderOf(undefined)).toBeUndefined()
  })

  it('合言葉そのものは置き場に残らない（ADR-0018）', async () => {
    const session = await signedInAs('10001')
    const token = session.slice(session.indexOf('=') + 1)

    // 置き場に入っているのは要約のほうである。
    expect(store.sessionHolder(token, 0)).toBeUndefined()
    expect(store.sessionHolder(digest(token), 0)).toBe(store.identify('google', '10001'))
  })

  it('寿命を過ぎたセッションでは入れない。Cookie の寿命はブラウザに預けたものでしかない', async () => {
    const session = await signedInAs('10001')
    const token = session.slice(session.indexOf('=') + 1)

    expect(store.sessionHolder(digest(token), Date.now() + 1)).toBeUndefined()
  })
})
