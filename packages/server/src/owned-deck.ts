import { checkConstructedDeck } from '@revolution/engine'
import type { Card, DeckViolation, WireOwnedDeck } from '@revolution/engine'
import type { CardKey, CardPool } from './deck.js'
import { breaksDisplay } from './name.js'

/**
 * 持ち主が組んだデッキの決まり（ADR-0021）。
 *
 * **読み方を書く場所はここ 1 つである。** 送られてきたデッキは、置き場に入る前に必ずここを通る
 * （`serve.ts`）。置き場（`store.ts`）は、通ったものを預かって返すだけである。
 *
 * **ここにある上限は、規則ではなく防御である**（ADR-0021）。総合ルールに上限は無く、積めば
 * 積むほど自分が不利になるので、遊びの側に上限を要る理由が無い。**現実には誰も当たらない値に
 * して、置き場に際限なく書き込まれることだけを防ぐ。** 規則として名乗らないために、構築戦の
 * 規定（`checkConstructedDeck`）とは別に置いている。
 */

/** 1 つのデッキに入れられる枚数の上限。防御であって、構築戦の規定ではない。 */
export const DECK_CARD_LIMIT = 1000

/** 1 人が持てるデッキの数の上限。 */
export const OWNED_DECK_LIMIT = 100

/** デッキの名前の長さの上限。数えるのはコードポイント（`name.ts` と同じ）。 */
export const DECK_NAME_LIMIT = 40

/**
 * デッキの解説の長さの上限。数えるのはコードポイント。
 *
 * **書式はここでは決めない**（改行を許すか、など）。解説が人の目に触れるのは共有してからで、
 * 何をどう書けるかはそちらで決める（ADR-0022）。ここにあるのは防御の上限だけである。
 */
export const DECK_DESCRIPTION_LIMIT = 1000

/** 持ち主が組んだデッキ 1 つ。**通信に載せる形と同じである**——持ち主にそのまま返す。 */
export type OwnedDeck = WireOwnedDeck

/** 保存しようとしているデッキ。識別子はまだ無いか、置き場が持っている。 */
export type DeckDraft = Omit<OwnedDeck, 'id'>

/**
 * 読んだ結果。**なりうる形を数え上げる**——デッキと理由を別々に持つと、どちらも無い形や
 * 両方ある形が書けてしまう（`name.ts` の `NameReading` と同じ）。
 */
export type DeckReading =
  | { readonly kind: '決まった'; readonly deck: DeckDraft }
  | { readonly kind: '断る'; readonly reason: string }

function codePoints(text: string): number {
  return [...text].length
}

/**
 * カードを指す識別子の並びを、保存する並びに揃える（ADR-0021）。
 *
 * **揃える順は、識別子の文字列としての順である。** 総合ルールは「カードの順番を自分の思い通りに
 * 並べてはいけません」と書いていて（第3部 第1章 4）、どのみちシャッフルされる。揃えれば、同じ
 * 中身のデッキが 1 つに決まる。
 *
 * **識別子から何かを読み取っているのではない**（ADR-0021）。同じかどうかを比べられるようにする
 * ためだけの並べ方で、画面に並べる順ではない。
 */
export function sortCards(cards: readonly CardKey[]): readonly CardKey[] {
  // 既定の比べ方は UTF-16 のコード単位の順で、場所の設定に左右されない。**どこで揃えても同じに
  // なる**ことが要る。
  return [...cards].sort()
}

/**
 * 送られてきたものを、保存するデッキとして読む（ADR-0021）。
 *
 * **ここが外の値が入ってくる境目である。** 画面から来たものは型としては何でもありうるので、
 * 黙って信じずに読み方を書く。
 *
 * **構築戦の規定を満たしていなくても通す。** 60 枚に届くまで、組みかけは必ず規定を満たして
 * いない（ADR-0021）。断るのは防御の上限と、プールに無いカードだけである。
 *
 * **プールに無いカードを含むなら断る。** 画面から来た任意の文字列を置き場に入れないためである。
 * 取り下げられたカードを含むデッキは置き場から消えないが、そのカードを抜くまで上書きできない。
 */
export function readDeck(
  raw: { readonly name: unknown; readonly description: unknown; readonly cards: unknown },
  pool: CardPool,
): DeckReading {
  if (typeof raw.name !== 'string') return { kind: '断る', reason: 'デッキの名前が読めません' }
  // 前後の空白は落とす。正規化するのは表示名と同じ理由である（`name.ts` の `readName`）。
  const name = raw.name.normalize('NFC').trim()
  if (name.length === 0) return { kind: '断る', reason: 'デッキの名前を入れてください' }
  if (breaksDisplay(name)) return { kind: '断る', reason: 'デッキの名前に使えない文字が入っています' }
  if (codePoints(name) > DECK_NAME_LIMIT) {
    return { kind: '断る', reason: `デッキの名前は ${DECK_NAME_LIMIT} 文字までです` }
  }

  if (typeof raw.description !== 'string') return { kind: '断る', reason: 'デッキの解説が読めません' }
  const description = raw.description.normalize('NFC')
  if (codePoints(description) > DECK_DESCRIPTION_LIMIT) {
    return { kind: '断る', reason: `デッキの解説は ${DECK_DESCRIPTION_LIMIT} 文字までです` }
  }

  const cards = readCards(raw.cards, pool)
  if (cards.kind === '断る') return cards

  return { kind: '決まった', deck: { name, description, cards: sortCards(cards.cards) } }
}

/** カードの並びを読んだ結果。なりうる形を数え上げる（`DeckReading` と同じ）。 */
export type CardsReading =
  | { readonly kind: '決まった'; readonly cards: readonly CardKey[] }
  | { readonly kind: '断る'; readonly reason: string }

/**
 * 送られてきたものを、デッキに入れるカードの並びとして読む（ADR-0021）。
 *
 * 保存するとき（`readDeck`）と、保存せずに確かめるとき（`serve.ts`）の両方が通る。**確かめる
 * だけでも上限とプールを当てる**——当てなければ、置き場に入れられない並びがそちらからは通る。
 */
export function readCards(cards: unknown, pool: CardPool): CardsReading {
  if (!Array.isArray(cards) || !cards.every((card) => typeof card === 'string')) {
    return { kind: '断る', reason: 'デッキのカードが読めません' }
  }
  if (cards.length > DECK_CARD_LIMIT) {
    return { kind: '断る', reason: `デッキに入れられるのは ${DECK_CARD_LIMIT} 枚までです` }
  }
  // **`hasOwn` で引く。** `in` だと `toString` のような受け継いだ名前まで通ってしまう。
  if (!cards.every((card: string) => Object.hasOwn(pool, card))) {
    return { kind: '断る', reason: '使えないカードが入っています' }
  }

  return { kind: '決まった', cards: cards as readonly CardKey[] }
}

/**
 * デッキが構築戦の規定を満たしていない点（総合ルール 第3部 第1章 3-1、第2部 第7章 2・3）。
 *
 * **保存するときにも確かめるが、断らない**（ADR-0021）。不備の一覧を返すので、「あと何枚」を
 * そのまま出せる。
 *
 * 渡すのは `readDeck` を通った並びか、既製デッキの並びである。どちらもプールに無いカードを
 * 含まない（`deck.ts` の `readPresets`）ので、引けないカードはここでは起こらない。
 */
export function violationsOf(cards: readonly CardKey[], pool: CardPool): readonly DeckViolation[] {
  const deck: Card[] = []
  for (const key of cards) {
    const card = pool[key]
    if (card === undefined) throw new Error(`プールに無いカードを確かめようとしました: ${key}`)

    deck.push(card)
  }

  return checkConstructedDeck(deck)
}
