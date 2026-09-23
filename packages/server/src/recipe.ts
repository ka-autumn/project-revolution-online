import { createHash } from 'node:crypto'
import type {
  PublicShare,
  PublicShareCard,
  RecipeKey,
  RecipeListOrder,
  ShareKey,
  ShareVisibility,
  WirePoolCard,
  WireRecipeSummary,
  WireShare,
} from '@revolution/engine'
import type { CardKey, RestrictionList } from './deck.js'
import { DECK_DESCRIPTION_LIMIT, DECK_NAME_LIMIT, sortCards } from './owned-deck.js'
import { breaksDisplay } from './name.js'
import type { Names, ParticipantId } from './room.js'

/**
 * レシピと共有の決まり（ADR-0022）。
 *
 * **レシピと共有は別のものである。** レシピは中身と、中身から決まる鍵だけを持つ不変のもので、
 * 誰のものでもない。共有は「ある人が、あるレシピを、ある名前・解説・公開の段階で出したこと」で、
 * **レシピ 1 つに共有がいくつもぶら下がる。** 置き場（`store.ts`）は 2 つの表に分けて持つ。
 */

/**
 * デッキの中身から、レシピの鍵を決める（ADR-0022）。
 *
 * **鍵の作り方はここ 1 か所に閉じる。** 後から作り方を変えると、いま出回っている既存のレシピの
 * 鍵がずれ、`/recipe/<鍵>` の先が別の中身を指すことになる。**変えるときは、ここにその旨を書き
 * 残すこと。**
 *
 * サーバ側なので `node:crypto` を使ってよい（engine には足さない、ADR-0001）。
 */
export function recipeKeyOf(cards: readonly CardKey[]): RecipeKey {
  // 並びを保存する時の揃え方（`owned-deck.ts` の `sortCards`）に合わせてから鍵にする。並びが
  // 違うだけの同じ中身を同じ鍵にするためで、ここで独自に並べ替えると、揃え方が変わった時に
  // 2 か所を直し忘れる恐れがある。
  //
  // **JSON にしてからハッシュを取る。** 識別子はただの文字列で、区切り文字をそのまま含みうる
  // （ADR-0021）。単純に繋げると `['ab', 'c']` と `['a', 'bc']` が同じ鍵になってしまう。
  const sorted = sortCards(cards)
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex')
}

/** 送られてきたものを、共有の下書きとして読んだ結果（`owned-deck.ts` の `DeckReading` と同じ形）。 */
export type ShareReading =
  | { readonly kind: '決まった'; readonly name: string; readonly description: string; readonly visibility: ShareVisibility }
  | { readonly kind: '断る'; readonly reason: string }

/**
 * 公開の段階として読める値か（ADR-0022）。
 *
 * **共有する時（`readShareRequest`）と、あとから変える時（`serve.ts` の
 * `共有の公開範囲を変える`）の両方で使う。** 決め方を 2 か所に書くと、片方だけ緩めた時に
 * `shares.visibility` 列へ 2 値以外の文字列が書けるようになる（ADR-0010）。
 */
export function isShareVisibility(raw: unknown): raw is ShareVisibility {
  return raw === 'リンクを知っている人だけ' || raw === '一覧に載せる'
}

/** 一覧の並べ方として読める値か（ADR-0022）。`レシピの一覧を見る` の `order` を確かめるのに使う。 */
export function isRecipeListOrder(raw: unknown): raw is RecipeListOrder {
  return raw === '新着' || raw === 'コピー数'
}

/**
 * 1 人が持てる共有の数の上限（ADR-0022）。
 *
 * **規則ではなく防御である**（`owned-deck.ts` の `OWNED_DECK_LIMIT` と同じ考え方）。共有を
 * 取り消してから同じレシピを共有し直すと、その分は新しい行になる（`store.ts` の `addShare`）
 * ので、上限が無いと際限なく積み増せる。現実には誰も当たらない値にしてある。
 */
export const SHARE_LIMIT = 1000

/**
 * 送られてきたものを、共有の下書きとして読む（ADR-0022）。
 *
 * **名前と解説の決まりは、デッキのものをそのまま使う**（`owned-deck.ts`）。共有する時の初期値は
 * そのデッキの名前と解説であり、上限も書式も変える理由が無い。
 */
export function readShareRequest(raw: {
  readonly name: unknown
  readonly description: unknown
  readonly visibility: unknown
}): ShareReading {
  if (typeof raw.name !== 'string') return { kind: '断る', reason: '共有する名前が読めません' }
  const name = raw.name.normalize('NFC').trim()
  if (name.length === 0) return { kind: '断る', reason: '共有する名前を入れてください' }
  if (breaksDisplay(name)) return { kind: '断る', reason: '共有する名前に使えない文字が入っています' }
  if ([...name].length > DECK_NAME_LIMIT) {
    return { kind: '断る', reason: `共有する名前は ${DECK_NAME_LIMIT} 文字までです` }
  }

  if (typeof raw.description !== 'string') return { kind: '断る', reason: '共有する解説が読めません' }
  const description = raw.description.normalize('NFC')
  if ([...description].length > DECK_DESCRIPTION_LIMIT) {
    return { kind: '断る', reason: `共有する解説は ${DECK_DESCRIPTION_LIMIT} 文字までです` }
  }

  if (!isShareVisibility(raw.visibility)) return { kind: '断る', reason: '公開の段階が読めません' }

  return { kind: '決まった', name, description, visibility: raw.visibility }
}

/** 置き場に残す共有 1 つ（`store.ts` の行そのもの）。 */
export interface StoredShare {
  readonly id: string
  /** ログインしていない人にも渡せる、この共有の URL の鍵（ADR-0022、#197）。`id` とは別に持つ。 */
  readonly key: ShareKey
  readonly recipe: RecipeKey
  readonly owner: ParticipantId
  readonly name: string
  readonly description: string
  readonly visibility: ShareVisibility
  readonly sharedAt: number
  readonly revoked: boolean
  /** 共有する時に確かめた形式（ADR-0022）。 */
  readonly format: string
  /** 共有する時に当てた禁止／制限リストの識別子。`制限なし` で確かめたなら `undefined`。 */
  readonly restriction: string | undefined
}

/** 一覧に並ぶレシピの要約（`store.ts` の集計そのもの）。 */
export interface StoredRecipeSummary {
  readonly key: RecipeKey
  readonly name: string
  readonly description: string
  readonly copies: number
}

/**
 * 共有が当てた禁止／制限リストの識別子を、名前まで添えた形にする（ADR-0022）。
 *
 * **中身（何が何枚までか）は載せない**——`WireRoomRules` と同じく、選ぶ・見るのに要るのは
 * 識別子と名前だけである。**渡された `restrictions` に無ければ `undefined` にする。** 立てる時に
 * リストを差し替えた後、古い識別子を指したままの共有がありうる（ADR-0021 の `rulesRestored` と
 * 同じ状況）ので、知らない識別子を無いものとして扱う。
 */
function wireRestrictionOf(
  id: string | undefined,
  restrictions: readonly RestrictionList[],
): { readonly id: string; readonly name: string } | undefined {
  if (id === undefined) return undefined

  const list = restrictions.find((each) => each.id === id)
  return list === undefined ? undefined : { id: list.id, name: list.name }
}

/**
 * 置き場の共有を、通信に載せる形にする（ADR-0022）。
 *
 * **表示名は見るたびに引き直す。** 共有した時点の名前を焼き付ける仕組みは、まだ作っていない
 * （ADR-0022 の「ここでは決めないこと」）。
 *
 * **確かめた形式とリストも出す。** 書き込むだけで読み出す経路が無いと、残っていることを
 * 確かめる手立てが無い。`restrictions` は立てる時に渡されたもの（`options.decks.restrictions`）
 * で、識別子から名前を引くのに使う。
 */
export function wireShareOf(share: StoredShare, names: Names, restrictions: readonly RestrictionList[]): WireShare {
  return {
    id: share.id,
    key: share.key,
    recipe: share.recipe,
    sharer: names(share.owner),
    name: share.name,
    description: share.description,
    visibility: share.visibility,
    revoked: share.revoked,
    format: share.format as WireShare['format'],
    restriction: wireRestrictionOf(share.restriction, restrictions),
  }
}

/** 置き場の要約を、通信に載せる形にする。 */
export function wireRecipeSummaryOf(summary: StoredRecipeSummary): WireRecipeSummary {
  return { key: summary.key, name: summary.name, description: summary.description, copies: summary.copies }
}

/**
 * 共有 1 つを、`/share/<鍵>` が返す公開ページの形にする（ADR-0022、#197）。
 *
 * **決まりごとだけで、I/O を持たない。** その共有が取り消されているかどうかは呼ぶ側
 * （`store.ts` の `shareByPublicKey`）がすでに確かめている——ここに来た時点で生きている共有だと
 * 前提してよい。**ログインしているかどうかも呼ぶ側が決める**（Cookie を見るのは `serve.ts` の
 * 仕事である、ADR-0002）。`authenticated` の値どおりに `detail` を出すか出さないかを分けるだけ
 * である。
 *
 * **未ログインに渡す量は、この形そのものが決める。** `PublicShareCard` はカード名・枚数・色・
 * レベル・種別を常に持ち、能力テキストとその他の表記は `detail`（`authenticated` の時だけ入る）
 * にしか無い（ADR-0022 の「未ログインに開く口は、識別子からカード名まで」を、色・レベル・種別
 * まで緩めた線）。
 */
export function publicShareOf(
  share: StoredShare,
  cards: readonly string[],
  pool: readonly WirePoolCard[],
  names: Names,
  restrictions: readonly RestrictionList[],
  authenticated: boolean,
): PublicShare {
  const faces = new Map(pool.map((card) => [card.key, card.face] as const))
  const counts = new Map<string, number>()
  for (const card of cards) counts.set(card, (counts.get(card) ?? 0) + 1)

  const cardRows: PublicShareCard[] = [...counts]
    .map(([key, count]) => {
      const face = faces.get(key)
      return {
        count,
        name: face?.name ?? '（取り下げられたカード）',
        type: face?.type,
        level: face?.level ?? 0,
        colors: face?.colors ?? [],
        detail: authenticated ? face : undefined,
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'ja'))

  return {
    sharer: names(share.owner),
    name: share.name,
    description: share.description,
    format: share.format as PublicShare['format'],
    restriction: wireRestrictionOf(share.restriction, restrictions),
    cards: cardRows,
    authenticated,
  }
}
