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
 * `/recipe/<鍵>` を直に開いた時の鍵（ADR-0022）。指していなければ `undefined`。
 *
 * **画面の側のパスである**——対戦サーバの道筋（`?room=` のような問い合わせ文字列）とは別で、
 * `location.pathname` を読む。静的ホストがこのパスで `index.html` を返すことは `vercel.json` の
 * rewrite（手元では Vite の既定の SPA フォールバック）が担っている。
 *
 * `main.ts` の起動時と、`index.ts` のブラウザの「戻る」（`popstate`）の両方から呼ぶので、ここに
 * 1 か所だけ置く。
 */
export function recipeKeyFromPath(pathname: string): RecipeKey | undefined {
  const match = /^\/recipe\/([^/]+)\/?$/.exec(pathname)
  if (match?.[1] === undefined) return undefined

  // `recipePathOf` と同じ形（`encodeURIComponent`）で戻す。
  return decodeURIComponent(match[1])
}

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

/**
 * レシピの画面を開く時に積む URL（`index.ts` の `history.pushState`）。
 *
 * **問い合わせ文字列（`location.search`）は残す。** README が `?server=`・`?participant=` を
 * 現役の手段として案内している——レシピ画面を開いて閉じた後に読み込み直すと、別のサーバに
 * 繋ぎに行ったり別の名乗りになったりしてしまう。
 */
export function recipeUrlOf(key: RecipeKey, search: string): string {
  return `${recipePathOf(key)}${search}`
}

/** レシピの画面を閉じる時に戻す URL。`recipeUrlOf` と同じ理由で問い合わせ文字列を残す。 */
export function closedRecipeUrlOf(search: string): string {
  return `/${search}`
}

/**
 * `sessionStorage` の代わりに受け取れる最小限の形（ADR-0022）。
 *
 * **テストでは、実物の代わりに中身を持つだけの偽物を渡す。** ブラウザの外（vitest は Node で
 * 走る）には無いもので、ここに直接依存すると純粋な関数として確かめられなくなる。
 */
export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** 未ログインで `/recipe/<鍵>` を開こうとした鍵を預ける先の名前。 */
const PENDING_RECIPE_KEY = 'revolution.pendingRecipe'

/**
 * 未ログインで `/recipe/<鍵>` を開こうとした鍵を、ログインへ送る前に預ける（ADR-0022）。
 *
 * **ログインの折り返し先（`server` の `sign-in.ts`）は触らない。** サーバは戻り先の URL を
 * 設定から決めており（ADR-0019）、開こうとしていたレシピを渡す口を持たない。画面はログインの
 * 前後で作り直される（Google の画面を経由する別ページなので、JS のメモリは残らない）ため、
 * 覚えておく先はブラウザの `sessionStorage` になる。
 *
 * 使えないブラウザでも落ちない（`index.ts` の `goToSignIn` と同じ作法）。**預けられなくても、
 * ログインへ送ることは止めない**——戻ってきた時にロビーへ出るだけで、以前の振る舞いより悪くは
 * ならない。
 */
export function rememberPendingRecipe(storage: KeyValueStorage, key: RecipeKey): void {
  try {
    storage.setItem(PENDING_RECIPE_KEY, key)
  } catch {
    // 覚えられなかった。ログインへ送ることはできる。
  }
}

/**
 * 預けておいた鍵を取り出して忘れる（ADR-0022）。無ければ `undefined`。
 *
 * **取り出したら消す。** 次にログインが要る場面（無関係にセッションが切れた時など）で、古い鍵を
 * 誤って開かないようにするためである。
 */
export function takePendingRecipe(storage: KeyValueStorage): RecipeKey | undefined {
  try {
    const key = storage.getItem(PENDING_RECIPE_KEY)
    if (key === null) return undefined

    storage.removeItem(PENDING_RECIPE_KEY)
    return key
  } catch {
    return undefined
  }
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
  /**
   * 確かめた形式とリストを、読める 1 行にしたもの（ADR-0022）。例:「構築戦・○○リストで確かめて
   * 共有」。**書き込むだけで読み出す経路が無かった**ので、レシピの画面に出す。
   */
  readonly rulesLabel: string
}

/** 確かめた形式とリストを、読める 1 行にする。制限なしで確かめたなら、そう出す。 */
function rulesLabelOf(share: WireShare): string {
  const restriction = share.restriction === undefined ? '制限なし' : share.restriction.name
  return `${share.format}・${restriction}で確かめて共有`
}

/** レシピにぶら下がる共有を、画面に並べる形にする。**届いた順（新着順）のまま並べる。** */
export function shareRowsOf(recipe: WireRecipe): readonly ShareRow[] {
  return recipe.shares.map((share) => ({
    id: share.id,
    sharer: share.sharer,
    name: share.name,
    description: share.description,
    rulesLabel: rulesLabelOf(share),
  }))
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
