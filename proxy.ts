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

export default function proxy(request: Request): Response {
  const expected = process.env.BASIC_AUTH
  if (expected === undefined || expected === '') return next()

  const given = request.headers.get('authorization')
  if (given === `Basic ${btoa(expected)}`) return next()

  return new Response('合言葉が要ります', {
    status: 401,
    headers: { 'www-authenticate': 'Basic realm="revolution", charset="UTF-8"' },
  })
}
