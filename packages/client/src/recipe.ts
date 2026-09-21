import type {
  DeckId,
  DuelFormat,
  RecipeKey,
  RecipeListOrder,
  RestrictionChoice,
  ShareId,
  ShareVisibility,
  WireOwnedDeck,
  WirePoolCard,
  WireRecipe,
  WireRecipeSummary,
  WireShare,
} from '@revolution/engine'

/**
 * レシピと共有を扱うところ（ADR-0022）。
 *
 * **ここにルールの判断は無い。** 規定を満たしているかを確かめるのはサーバであり
 * （`デッキを共有する`、ADR-0010）、ここは届いたものを画面に出す形にするだけである。
 */

/** レシピを指す鍵から、画面の側のパスを作る（ADR-0022）。 */
export function recipePathOf(key: RecipeKey): string {
  return `/recipe/${encodeURIComponent(key)}`
}

/**
 * 共有した人が渡すリンク（ADR-0022）。**画面がここで組み立てる**——アドレスバーをコピーさせない。
 * `?participant=` が付いてくると、席に座れる合言葉を渡すことになるためである。
 */
export function recipeLinkOf(origin: string, key: RecipeKey): string {
  return `${origin}${recipePathOf(key)}`
}

/** 共有する時に打ち込む下書き。**初期値はそのデッキの名前と解説**（ADR-0022）。 */
export interface ShareDraft {
  readonly deck: DeckId
  readonly name: string
  readonly description: string
  readonly visibility: ShareVisibility
  readonly format: DuelFormat | undefined
  readonly restriction: RestrictionChoice | undefined
}

/** 共有しようとしているデッキから、下書きの初期値を作る。 */
export function shareDraftOf(deck: WireOwnedDeck): ShareDraft {
  return {
    deck: deck.id,
    name: deck.name,
    description: deck.description,
    // **既定は「リンクを知っている人だけ」。** 一覧に流すかどうかは、共有する人が選び直す。
    visibility: 'リンクを知っている人だけ',
    format: undefined,
    restriction: undefined,
  }
}

/** 共有する下書きを打ち込んでいるところの状態（`index.ts` が持つ）。 */
export type SharingState =
  | { readonly kind: '打ち込み中'; readonly draft: ShareDraft; readonly sending: boolean; readonly refusal: string | undefined }
  /** 共有できた。**リンクを組み立てて出す。** */
  | { readonly kind: '共有した'; readonly share: WireShare }

/** レシピの画面に並べる、共有 1 つ。 */
export interface ShareRow {
  readonly id: ShareId
  readonly sharer: string
  readonly name: string
  readonly description: string
}

/** レシピにぶら下がる共有を、画面に並べる形にする。**届いた順（新着順）のまま並べる。** */
export function shareRowsOf(recipe: WireRecipe): readonly ShareRow[] {
  return recipe.shares.map((share) => ({ id: share.id, sharer: share.sharer, name: share.name, description: share.description }))
}

/** レシピの中身 1 種。カードの姿はプールを引いて出す——レシピ自身は識別子しか持たない。 */
export interface RecipeCardRow {
  readonly name: string
  readonly count: number
}

/**
 * レシピの中身を、プールを引いて「何が何枚」の並びにする。
 *
 * **プールに無い識別子もありうる。** 取り下げられたカードを含むレシピは、そのまま残る
 * （ADR-0021 の「取り下げられたカードを含むデッキ」と同じ扱い）。名前が引けない分は、それと
 * 分かる形で出す。
 */
export function recipeCardRows(pool: readonly WirePoolCard[], cards: readonly string[]): readonly RecipeCardRow[] {
  const counts = new Map<string, number>()
  for (const card of cards) counts.set(card, (counts.get(card) ?? 0) + 1)

  const faces = new Map(pool.map((card) => [card.key, card.face.name] as const))
  return [...counts]
    .map(([key, count]) => ({ name: faces.get(key) ?? '（取り下げられたカード）', count }))
    .sort((left, right) => left.name.localeCompare(right.name, 'ja'))
}

/** 自分の共有を管理する画面に並べる 1 行。 */
export interface MyShareRow {
  readonly id: ShareId
  readonly recipe: RecipeKey
  readonly name: string
  readonly description: string
  readonly visibility: ShareVisibility
  readonly revoked: boolean
}

/** 自分の共有全部を、管理する画面に並べる形にする。**取り消したものも出す**——取り消した本人には見えたままでよい。 */
export function myShareRows(shares: readonly WireShare[]): readonly MyShareRow[] {
  return shares.map((share) => ({
    id: share.id,
    recipe: share.recipe,
    name: share.name,
    description: share.description,
    visibility: share.visibility,
    revoked: share.revoked,
  }))
}

/** 一覧に並べる 1 行。**届いた順（サーバが並べた順）のまま並べる。** */
export interface RecipeSummaryRow {
  readonly key: RecipeKey
  readonly name: string
  readonly description: string
  readonly copies: number
}

export function recipeSummaryRows(recipes: readonly WireRecipeSummary[]): readonly RecipeSummaryRow[] {
  return recipes.map((recipe) => ({ key: recipe.key, name: recipe.name, description: recipe.description, copies: recipe.copies }))
}
