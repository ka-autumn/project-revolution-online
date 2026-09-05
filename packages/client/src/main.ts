import './style.css'
import { mount } from './index.js'

/**
 * ブラウザで開いた時の入口。`index.html` が読み込む。
 *
 * **開くだけで始められる**（#175）。誰であるかは画面が用意し、どの部屋に入るかはロビーで選ぶ。
 * URL に付けて指すこともできる。
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

/** 名乗りを覚えておく先の名前。 */
const PARTICIPANT_KEY = 'revolution.participant'

/**
 * この画面の名乗り（ADR-0009、#175）。無ければ作って覚える。
 *
 * **タブごとに別の人にする**（`sessionStorage`）。同じブラウザの 2 つのタブで打ち合えるのは、
 * 手元で試す時に要るからである。読み込み直しでは変わらないので、切れて入り直した時は同じ席に
 * 戻れる（ADR-0016）。
 *
 * 覚えられない場合（保存を断っているブラウザ）は、その場限りのものを使う。読み込み直すと別人に
 * なるが、**打てないよりはよい。** 席に戻りたい人は `?participant=` で名乗れる。
 */
function participantId(): string {
  const made = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  try {
    const remembered = sessionStorage.getItem(PARTICIPANT_KEY)
    if (remembered !== null && remembered !== '') return remembered

    sessionStorage.setItem(PARTICIPANT_KEY, made)
  } catch {
    return made
  }

  return made
}

const params = new URLSearchParams(location.search)
const root = document.getElementById('board')
if (root === null) throw new Error('#board が無い')

const named = params.get('participant')
const room = params.get('room')

mount(root, {
  url: serverUrl(params),
  participant: named === null || named === '' ? participantId() : named,
  // 指していなければロビーから始める。合言葉を知っている相手と待ち合わせる時だけ要る。
  ...(room === null || room === '' ? {} : { room }),
})
