import { createHash } from 'node:crypto'
import type { RecipeKey, ShareVisibility, WireRecipeSummary, WireShare } from '@revolution/engine'
import type { CardKey } from './deck.js'
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

  if (raw.visibility !== 'リンクを知っている人だけ' && raw.visibility !== '一覧に載せる') {
    return { kind: '断る', reason: '公開の段階が読めません' }
  }

  return { kind: '決まった', name, description, visibility: raw.visibility }
}

/** 置き場に残す共有 1 つ（`store.ts` の行そのもの）。 */
export interface StoredShare {
  readonly id: string
  readonly recipe: RecipeKey
  readonly owner: ParticipantId
  readonly name: string
  readonly description: string
  readonly visibility: ShareVisibility
  readonly sharedAt: number
  readonly revoked: boolean
}

/** 一覧に並ぶレシピの要約（`store.ts` の集計そのもの）。 */
export interface StoredRecipeSummary {
  readonly key: RecipeKey
  readonly name: string
  readonly description: string
  readonly copies: number
}

/**
 * 置き場の共有を、通信に載せる形にする（ADR-0022）。
 *
 * **表示名は見るたびに引き直す。** 共有した時点の名前を焼き付ける仕組みは、まだ作っていない
 * （ADR-0022 の「ここでは決めないこと」）。
 */
export function wireShareOf(share: StoredShare, names: Names): WireShare {
  return {
    id: share.id,
    recipe: share.recipe,
    sharer: names(share.owner),
    name: share.name,
    description: share.description,
    visibility: share.visibility,
    revoked: share.revoked,
  }
}

/** 置き場の要約を、通信に載せる形にする。 */
export function wireRecipeSummaryOf(summary: StoredRecipeSummary): WireRecipeSummary {
  return { key: summary.key, name: summary.name, description: summary.description, copies: summary.copies }
}
