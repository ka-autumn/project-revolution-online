import { createHash, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { SIGN_IN_PATH } from '@revolution/engine'
import type { ParticipantId } from './room.js'
import type { Store } from './store.js'

/**
 * Google のログインを受け取って、席に着ける人を決める（ADR-0019）。
 *
 * **預かるのは発行元と `sub`、そしてセッションだけである。** 求める scope は `openid` だけで、
 * メールアドレスも本名も写真も受け取らない。置き場が失われたときに漏れるものを、識別子だけに
 * 留めるための決定である（ADR-0018、ADR-0019）。
 *
 * **依存は増やさない。** ID トークンの署名は自前で検証しない——Google の token endpoint から
 * TLS で直に受け取るので、経路がそのまま出所の証明になる。確かめるのは `aud` が自分の
 * client_id であることだけである（ADR-0019）。`fetch` も `crypto` も Node に入っている。
 *
 * **秘密はここから外へ出さない。** client secret も、セッションの合言葉も、投げるエラーに
 * 含めない。置き場に入るのは合言葉そのものではなく、その要約である。
 */

/**
 * 身元の発行元（ADR-0019）。
 *
 * **2 つ目を足したときに既存の行が壊れないよう、`(発行元, sub)` の組で持つ。** Google は
 * `iss` を 2 通りの書き方で送ってくる（`https://` が付くものと付かないもの）ので、**どちらで
 * 来ても同じ発行元として畳む。** 生の `iss` をそのまま鍵にすると、同じ人が 2 行になる。
 */
export const GOOGLE = 'google'

const GOOGLE_ISSUERS: readonly string[] = ['https://accounts.google.com', 'accounts.google.com']
const AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

/** Google から戻ってくる口。**この道筋だけを Google に登録する。** */
export const CALLBACK_PATH = `${SIGN_IN_PATH}/callback`

/**
 * セッションの Cookie。
 *
 * **`Domain` を付けない**（ADR-0019）。付けると画面を配っている側にもセッションが送られる
 * ことになり、配り先に預ける理由が無い。属性を付けなければサーバのホストにだけ送られ、
 * そこには WebSocket の握手も含まれる。
 *
 * `SameSite=Lax` で足りる。画面とサーバは同じ登録可能ドメインの下に置く（同）ので、握手は
 * サイトをまたがない。Google からの折り返しはまたぐが、そちらは上からの移動なので Lax でも
 * 送られる。
 */
const SESSION_COOKIE = 'revolution_session'
/** 行きと帰りが同じ人のものであることを確かめるための、短命の Cookie（ADR-0019）。 */
const STATE_COOKIE = 'revolution_state'

/** 折り返してくるまでの猶予（秒）。Google の画面で迷っても足りる長さにしてある。 */
const STATE_LIFE_S = 600

/**
 * セッションが生きている長さ（ミリ秒）。
 *
 * **画面を閉じても戻れるようにするためのものである**（#177）ので、タブを閉じたら消える形には
 * しない。一方で、Cookie が漏れたときに使える期間でもあるため、無期限にはしない。
 *
 * **置き場の側でも同じ長さで切る。** Cookie の寿命はブラウザに預けたもので、送られてきた
 * 合言葉が古いかどうかを決めるのはこちらの仕事である。
 */
const SESSION_LIFE_MS = 30 * 24 * 60 * 60 * 1000

export interface SignInConfig {
  readonly clientId: string
  readonly clientSecret: string
  /** Google に登録する折り返し先。このサーバの絶対 URL（`CALLBACK_PATH` で終わる）。 */
  readonly callback: string
  /** 折り返した後に人を送り返す先（画面）。**URL で受け取らない**（ADR-0019）。 */
  readonly returnTo: string
}

/** ログインした人が誰であるか。 */
export interface Identity {
  readonly issuer: string
  readonly subject: string
}

export interface SignIn {
  /**
   * この要求を引き受けたか。引き受けたなら、返事は（後からでも）ここが返す。
   *
   * 引き受けなかったものは呼んだ側が断る。**ここが持つのはログインの道筋だけである。**
   */
  handle(request: IncomingMessage, response: ServerResponse): boolean
  /** 握手に付いてきた Cookie の持ち主。ログインしていなければ `undefined`。 */
  holderOf(cookie: string | undefined): ParticipantId | undefined
}

/**
 * 設定を環境変数から読む（ADR-0019）。**リポジトリに秘密を書かない。**
 *
 * 4 つとも無ければ `undefined` を返す。手元で立てたときはログインを持たず、`?participant=`
 * で名乗る形になる（`serve.ts`）。
 *
 * **半分だけ揃っている場合は落とす。** 足りないものを黙って無視すると、置き場に出したつもりで
 * 名乗りの口が開いたままになる。**開いているかどうかを別の旗で持たない**（ADR-0019）以上、
 * 揃っているかどうかがそのまま境目になるので、そこを曖昧にしない。
 */
export function signInConfigFrom(env: Readonly<Record<string, string | undefined>>): SignInConfig | undefined {
  const names = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SIGN_IN_CALLBACK', 'SIGN_IN_RETURN_TO'] as const
  const values = names.map((name) => {
    const value = env[name]
    return value === undefined || value === '' ? undefined : value
  })
  const [clientId, clientSecret, callback, returnTo] = values

  if (values.every((value) => value === undefined)) return undefined
  if (clientId === undefined || clientSecret === undefined || callback === undefined || returnTo === undefined) {
    const missing = names.filter((_, at) => values[at] === undefined)
    throw new Error(`ログインの設定が揃っていません: ${missing.join(', ')}`)
  }

  // **Google に登録する文字列とこのサーバが待つ道筋がずれていると、折り返しはそこで止まる。**
  // 立てた後に人が試すまで気付けないので、立ち上がるところで確かめる。
  if (new URL(callback).pathname !== CALLBACK_PATH) {
    throw new Error(`SIGN_IN_CALLBACK は ${CALLBACK_PATH} で終わる必要があります: ${callback}`)
  }

  return { clientId, clientSecret, callback, returnTo }
}

/** Google へ送る先。**求める scope は `openid` だけである**（ADR-0019）。 */
export function authorizeUrl(config: SignInConfig, state: string): string {
  const url = new URL(AUTHORIZE_ENDPOINT)
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.callback,
    response_type: 'code',
    scope: 'openid',
    state,
  }).toString()
  return url.toString()
}

/** 送られてきた Cookie から 1 つ取り出す。無ければ `undefined`。 */
export function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const at = part.indexOf('=')
    if (at === -1) continue
    if (part.slice(0, at).trim() !== name) continue

    const value = part.slice(at + 1).trim()
    return value === '' ? undefined : value
  }

  return undefined
}

/**
 * ID トークンに書かれている身元（ADR-0019）。読めなければ `undefined`。
 *
 * **署名は検証しない。** Google の token endpoint から TLS で直に受け取ったものなので、経路が
 * そのまま出所の証明になる。ここに来るのは、こちらが投げた要求の返事そのものである。
 *
 * 確かめるのは `aud` が自分の client_id であることと、`iss` が Google であることの 2 つ。前者は
 * **ほかのアプリ向けに出されたトークンで入れないようにする**ためで、後者は発行元として何を
 * 覚えるかを決めるために要る。
 */
export function identityInIdToken(idToken: string, clientId: string): Identity | undefined {
  const payload = idToken.split('.')[1]
  if (payload === undefined) return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined

  const { iss, aud, sub } = parsed as { readonly iss?: unknown; readonly aud?: unknown; readonly sub?: unknown }
  if (typeof iss !== 'string' || !GOOGLE_ISSUERS.includes(iss)) return undefined
  if (aud !== clientId) return undefined
  if (typeof sub !== 'string' || sub === '') return undefined

  return { issuer: GOOGLE, subject: sub }
}

/** 推測できない合言葉を作る。Cookie に載せるので、そのまま書ける文字だけにする。 */
function newToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * 置き場に入れる形にした合言葉（ADR-0018）。
 *
 * **合言葉そのものを置かない。** 置き場に残るものは公開できないものとして扱う決まりだが、
 * 要約にしておけば、漏れてもその行から席には座れない。
 */
export function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Cookie を 1 つ書く。`Domain` は付けない（ADR-0019）。 */
function cookie(name: string, value: string, path: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Path=${path}; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`
}

/**
 * 受け取った code を Google の token endpoint で ID トークンに換える。
 *
 * **返ってきた中身をエラーに載せない。** 失敗の詳しい理由よりも、秘密が混ざったものをログに
 * 残さないことを採る。
 */
async function exchangeAtGoogle(config: SignInConfig, code: string): Promise<string> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.callback,
      grant_type: 'authorization_code',
    }),
  })
  if (!response.ok) throw new Error(`Google の token endpoint が ${response.status} を返しました`)

  const body: unknown = await response.json()
  const idToken = (body as { readonly id_token?: unknown }).id_token
  if (typeof idToken !== 'string') throw new Error('返事に id_token がありません')

  return idToken
}

export interface SignInOptions {
  readonly config: SignInConfig
  /** 身元とセッションを置く先（ADR-0018）。**ログインを持つなら置き場も要る。** */
  readonly store: Store
  /** code を ID トークンに換えるところ。テストで差し替えるために開けてある。 */
  readonly exchange?: (config: SignInConfig, code: string) => Promise<string>
}

/** 一言だけ返して終える。**中で何が起きたかは書かない。** */
function fail(response: ServerResponse, status: number, reason: string): void {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  response.end(reason)
}

/** ログインの口を作る（ADR-0019）。 */
export function createSignIn(options: SignInOptions): SignIn {
  const { config, store } = options
  const exchange = options.exchange ?? exchangeAtGoogle

  function start(response: ServerResponse): void {
    const state = newToken()
    response.writeHead(302, {
      location: authorizeUrl(config, state),
      // 折り返してくる道筋にだけ送られればよい。ほかの要求に付いて回る理由が無い。
      'set-cookie': cookie(STATE_COOKIE, state, CALLBACK_PATH, STATE_LIFE_S),
    })
    response.end()
  }

  async function finish(url: URL, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const expected = cookieValue(request.headers.cookie, STATE_COOKIE)
    // **行きと帰りが同じ人のものであることを確かめる**（ADR-0019）。合わなければ、こちらが
    // 始めたログインではない。
    if (code === null || state === null || expected === undefined || state !== expected) {
      return fail(response, 400, 'ログインの折り返しが確かめられませんでした')
    }

    let identity: Identity | undefined
    try {
      identity = identityInIdToken(await exchange(config, code), config.clientId)
    } catch (error) {
      // 秘密が混ざりうるものは出さない。何が起きたかだけ残す。
      console.error('Google との遣り取りに失敗しました:', error instanceof Error ? error.message : '理由不明')
      return fail(response, 502, 'Google と遣り取りできませんでした')
    }
    if (identity === undefined) return fail(response, 400, '身元が確かめられませんでした')

    const participant = store.identify(identity.issuer, identity.subject)
    const token = newToken()
    store.openSession(digest(token), participant)

    response.writeHead(302, {
      location: config.returnTo,
      'set-cookie': [
        cookie(SESSION_COOKIE, token, '/', SESSION_LIFE_MS / 1000),
        // 使い終わった突き合わせは消す。残しても次のログインで書き換わるが、要らないものを
        // ブラウザに置いたままにしない。
        cookie(STATE_COOKIE, '', CALLBACK_PATH, 0),
      ],
    })
    response.end()
  }

  return {
    handle: (request, response) => {
      // ホストは見ない。**戻り先は設定から取る**（ADR-0019）ので、要求に書かれたホストを
      // 信じる場面がそもそも無い。道筋と問い合わせだけを読む。
      const url = new URL(request.url ?? '/', 'http://placeholder')
      if (url.pathname === SIGN_IN_PATH) {
        start(response)
        return true
      }
      if (url.pathname === CALLBACK_PATH) {
        void finish(url, request, response)
        return true
      }

      return false
    },
    holderOf: (header) => {
      const token = cookieValue(header, SESSION_COOKIE)
      return token === undefined ? undefined : store.sessionHolder(digest(token), Date.now() - SESSION_LIFE_MS)
    },
  }
}
