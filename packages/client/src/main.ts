import './style.css'
import { mount } from './index.js'

/**
 * ブラウザで開いた時の入口。`index.html` が読み込む。
 *
 * 誰であるかと、どの部屋に入るかは URL の `?` で渡す。最初の完走（#17）ではアカウント認証を
 * 作らない（ADR-0009）ので、ここで名乗ったものがそのまま席になる。
 *
 *     /?participant=わたし&room=あいことば
 *
 * サーバの場所は既定で同じホストの 8787 番。`?server=` で変えられる。
 */

const DEFAULT_SERVER_PORT = 8787

function serverUrl(params: URLSearchParams): string {
  const named = params.get('server')
  if (named !== null && named !== '') return named

  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${location.hostname}:${DEFAULT_SERVER_PORT}`
}

const params = new URLSearchParams(location.search)
const root = document.getElementById('board')
if (root === null) throw new Error('#board が無い')

const participant = params.get('participant') ?? ''
const room = params.get('room') ?? ''

// 名乗らずに繋ぐとサーバに切られる（`serve.ts`）。切られてから気づくより、先に言う。
if (participant === '' || room === '') {
  root.textContent = '?participant=（あなたの合言葉）&room=（部屋の合言葉）を付けて開いてください'
} else {
  mount(root, { url: serverUrl(params), participant, room })
}
