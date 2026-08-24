import { next } from '@vercel/functions'

/**
 * 置いた画面に鍵を掛ける（ADR-0013）。
 *
 * **これは対戦の認証ではない。** 誰がどの席に座るかは相変わらず名乗り（`?participant=`）だけで
 * 決まる（ADR-0009）。ここで防いでいるのは、動作を確かめるために置いただけのものが、通りすがりに
 * 開かれることだけである。
 *
 * 合言葉は `BASIC_AUTH` に `名前:合言葉` の形で渡す。**渡されていなければ素通しする**ので、
 * 手元でビルドしたものを開く分には何も要らない。
 *
 * 対戦サーバの側は塞がない。あちらは WebSocket 1 本を受けるだけの口で、Basic 認証を挟む場所が
 * 無い（ADR-0009）。**URL を知っている人は自分で書いた画面から繋げる。**
 */

export const config = { runtime: 'nodejs' }

/**
 * `Authorization` で名乗られた `名前:合言葉`。名乗っていない・読めない場合は `undefined`。
 *
 * **バイト列に戻してから UTF-8 として読む。** ブラウザは合言葉を UTF-8 のバイト列にしてから
 * base64 に直す（`charset="UTF-8"` を返しているため）ので、1 文字 1 バイトのまま繋ぐと
 * 日本語の合言葉が壊れる。逆向き（こちらの値を base64 にして比べる）にすると、
 * ASCII でない文字でその場で落ちる。
 */
function credentials(header: string | null): string | undefined {
  if (header === null || !header.startsWith('Basic ')) return undefined

  try {
    const bytes = Uint8Array.from(atob(header.slice('Basic '.length)), (letter) => letter.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return undefined
  }
}

export default function proxy(request: Request): Response {
  const expected = process.env.BASIC_AUTH
  if (expected === undefined || expected === '') return next()

  if (credentials(request.headers.get('authorization')) === expected) return next()

  return new Response('合言葉が要ります', {
    status: 401,
    headers: { 'www-authenticate': 'Basic realm="revolution", charset="UTF-8"' },
  })
}
