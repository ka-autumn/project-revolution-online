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
 * サーバの場所は 3 つの順で決まる。手元では何も要らず、離れた場所に置いた画面では
 * 毎回打たなくてよいようにするため。
 */

const DEFAULT_SERVER_PORT = 8787

/**
 * 繋ぎに行く先。
 *
 * 1. `?server=` — その場で差し替えたい時。ビルドし直さずに向き先を変えられる
 * 2. ビルド時に渡された `VITE_SERVER_URL` — 画面とサーバを別々の場所に置いた時
 * 3. 同じホストの 8787 番 — 手元で両方立てている時
 *
 * **画面とサーバは同じ場所に無くてよい**（ADR-0013）。WebSocket 1 本を直に張るだけで
 * （ADR-0009）、画面はただの静的なファイルだからである。
 */
function serverUrl(params: URLSearchParams): string {
  const named = params.get('server')
  if (named !== null && named !== '') return named

  const built = import.meta.env.VITE_SERVER_URL
  if (built !== undefined && built !== '') return built

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
