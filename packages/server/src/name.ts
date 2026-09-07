/**
 * 表示名の決まり（ADR-0020）。
 *
 * **読み方を書く場所はここ 1 つである。** 受け取ったものが置き場に入る前に、必ずここを通る
 * （`serve.ts`）。決まりが 2 か所にあると、片方だけ直したときに「通ったのに置けない」名前が
 * できる。
 *
 * **決まりを見るのはサーバである**（ADR-0010）。画面にも上限は書いてあるが（`client` の
 * `render.ts`）、あれは打ち込みかけを切るためのもので、断るのはここである。
 */

/** 受け取った長さの上限。数えるのはコードポイント（ADR-0020）。 */
export const NAME_LIMIT = 20

/**
 * 表示を壊せる文字が入っているか。
 *
 * **番号で見る。** 文字そのものを書き並べると、この文書の中でも見えないものになる。
 *
 * 弾くのは制御文字と改行（U+0000–001F、U+007F）、そして**双方向制御文字**（U+202A–202E、
 * U+2066–2069）である。向きを操られると、名前の外に出ているものまで並びが変わる。**閉じ忘れた
 * 向きは、その後ろ全部にかかる。**
 *
 * **見た目が似た別の文字（ホモグリフ）は弾かない**（ADR-0020）。弾き始めると際限が無く、
 * それは迷惑対策である。
 */
function breaksDisplay(name: string): boolean {
  for (const character of name) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return true
    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) return true
  }

  return false
}

/**
 * 読んだ結果。**なりうる形を数え上げる**——名前と理由を別々に持つと、どちらも無い形や両方ある
 * 形が書けてしまう（`serve.ts` の `Seating` と同じ）。
 */
export type NameReading =
  | { readonly kind: '決まった'; readonly name: string }
  | { readonly kind: '断る'; readonly reason: string }

/**
 * 打ち込まれたものを表示名として読む（ADR-0020）。
 *
 * **正規化してから数える。** 濁点は 1 文字としても、素の字＋合成用濁点の 2 つとしても書ける。
 * 正規化しないと、見た目が同じ名前が置き場に 2 通りで入り、上限に当たるかどうかも書き方で
 * 変わる。
 *
 * **同じ名前の人がすでにいても通す**（ADR-0020）。人を指しているのは身元の行番号であって、
 * 表示名ではない。
 */
export function readName(raw: string): NameReading {
  // 前後の空白は落とす。全角の空白（U+3000）も `trim` が落とす。
  const name = raw.normalize('NFC').trim()
  if (name.length === 0) return { kind: '断る', reason: '名前を入れてください' }
  if (breaksDisplay(name)) return { kind: '断る', reason: '使えない文字が入っています' }

  // UTF-16 の長さで数えない。絵文字 1 つが 2 文字ぶんになると、上限が文字によって変わる。
  if ([...name].length > NAME_LIMIT) return { kind: '断る', reason: `名前は ${NAME_LIMIT} 文字までです` }

  return { kind: '決まった', name }
}
