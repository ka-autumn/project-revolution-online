import { CARD_TYPES, COLORS } from '@revolution/engine'
import type {
  DeckId,
  DeckViolation,
  RecipeKey,
  RecipeListOrder,
  ShareId,
  ToClient,
  WireCardFace,
  WireDeck,
  WireOwnedDeck,
  WirePoolCard,
} from '@revolution/engine'
import { emptyFilter } from './pool-filter.js'
import type { PoolFilter } from './pool-filter.js'
import type { SharingState } from './recipe.js'
import type { ChosenRules } from './render.js'
import { squareLabel, summaryOf } from './view-model.js'
import type { DetailRow } from './view-model.js'

/**
 * デッキを組むところ（ADR-0021、#193）。
 *
 * **ここにルールの判断は無い。** 規定を満たしているかを確かめるのはサーバで（`デッキを確かめる`）、
 * ここは届いた不備を読める形にするだけである。数えるのは「いま何枚入れているか」だけで、それは
 * 画面が自分で組んでいるものだからである。
 *
 * **識別子から何も読み取らない**（ADR-0021）。引く鍵としてだけ使い、並べる順はカードに印刷されて
 * いる項目で決める。
 */

/**
 * 組みかけのデッキ。**保存するまで、サーバの自分のデッキは変わらない。**
 *
 * 画面が持ち、読み込み直しても消えないようにブラウザにも置く（`index.ts`）。
 */
export interface DeckDraft {
  /** 上書きする自分のデッキ。まだ保存していない新しいデッキなら `undefined`。 */
  readonly deck: DeckId | undefined
  readonly name: string
  readonly description: string
  /** カードを指す識別子の並び。**同じ識別子を並べた数がその枚数**になる（`WireOwnedDeck` と同じ）。 */
  readonly cards: readonly string[]
}

/** 新しく作るデッキに、最初から付いている名前。サーバは名前の無いデッキを断る。 */
export const NEW_DECK_NAME = '新しいデッキ'

/**
 * デッキを組むところで、いまどこを見ているか（ADR-0022 で共有とレシピが増えた）。
 *
 * - `閉じている` — ロビーを出している
 * - `デッキを選ぶ` — 自分のデッキと既製デッキを並べ、どれを組むかを選ぶ
 * - `デッキを組む` — 組みかけ（`Builder.draft`）を組んでいる
 * - `自分の共有` — 自分が出した共有を並べ、公開の段階を変えたり取り消したりする
 * - `レシピの一覧` — 「一覧に載せる」共有があるレシピを並べる
 * - `レシピ` — 1 つのレシピ（`Builder.viewingRecipe`）を開き、共有ごとにコピーできる。
 *   `/recipe/<鍵>` を直に開いた時もここに来る
 */
export type BuilderScreen = '閉じている' | 'デッキを選ぶ' | 'デッキを組む' | '自分の共有' | 'レシピの一覧' | 'レシピ'

/**
 * 送ってまだ返事の来ていないもの。
 *
 * **数え上げられるので、列挙で持つ。** 保存とコピーを同時に待つことは無い（待っている間は押す口を
 * 出さない）。
 */
export type BuilderWaiting =
  | { readonly kind: '無し' }
  /** 保存の返事を待っている。`sent` は送った時の組みかけで、返ってきたものと見比べる。 */
  | { readonly kind: '保存'; readonly sent: DeckDraft }
  /** コピーの返事を待っている。 */
  | { readonly kind: 'コピー' }

/**
 * 押す前に尋ねていること。**戻せないことだけを尋ねる。**
 *
 * 画面の中に出す（`render.ts` の `confirmElement`）。ブラウザの確認ダイアログは使わない。画面は丸ごと
 * 描き直されるので、尋ねていることは状態として持つ。
 */
export type BuilderConfirm =
  /** 自分のデッキを消す。消したデッキは戻らない。 */
  | { readonly kind: 'デッキを消す'; readonly deck: DeckId; readonly name: string }
  /** 保存していない変更を捨てて、デッキの一覧に戻る。 */
  | { readonly kind: '変更を捨てる' }
  /** 自分の共有を取り消す（ADR-0022）。取り消した共有は取り消されたまま残り、復活しない。 */
  | { readonly kind: '共有を取り消す'; readonly share: ShareId; readonly name: string }

/**
 * 尋ねる文と、2 つのボタンの見出し。
 *
 * **見出しは、押すと何が起きるかをそのまま書く。** 「はい」「いいえ」では、文を読み返さないと
 * どちらを押せばよいかが分からない。
 */
export interface ConfirmView {
  readonly message: string
  /** 進める側。戻せないことをする。 */
  readonly confirmLabel: string
  /** やめる側。何もせずに閉じる。 */
  readonly cancelLabel: string
}

export function confirmView(confirm: BuilderConfirm): ConfirmView {
  switch (confirm.kind) {
    case 'デッキを消す':
      return {
        message: `「${confirm.name}」を削除しますか？ 削除したデッキは戻せません`,
        confirmLabel: '削除する',
        cancelLabel: 'やめる',
      }
    case '変更を捨てる':
      return {
        message: '保存していない変更があります。保存せずに、デッキの一覧に戻りますか？',
        confirmLabel: '保存せずに戻る',
        cancelLabel: '編集を続ける',
      }
    case '共有を取り消す':
      return {
        message: `「${confirm.name}」の共有を取り消しますか？ すでにコピーした人のデッキは残ります`,
        confirmLabel: '取り消す',
        cancelLabel: 'やめる',
      }
  }
}

/** デッキを組むところの状態。**サーバから届いたものは持たない**——それは `Session` にある。 */
export interface Builder {
  readonly screen: BuilderScreen
  /** 組みかけ。組んでいなければ `undefined`。 */
  readonly draft: DeckDraft | undefined
  /**
   * 確かめる時に当てるルール（ADR-0021）。**ロビーで部屋を作る時に選ぶものとは別に持つ。**
   *
   * 選ばなければサーバが既定を当てる。部屋を作る時と同じ既定である（`server` の `room.ts` の
   * `rulesFor`）。
   */
  readonly rules: ChosenRules
  /** 詳しく出したままにしているカード。クリックで決める。 */
  readonly pinned: string | undefined
  readonly waiting: BuilderWaiting
  /**
   * 確かめてほしいと送って、まだ返事の来ていない数。**0 なら、出ている結果がいまの組みかけのもの**
   * である。返事は送った順に届く（`protocol.ts` の `デッキを確かめた`）。
   */
  readonly checking: number
  /** 直前に断られた理由。`Session.refusal` はロビーが届くたびに消えるので、組むところで別に持つ。 */
  readonly refusal: string | undefined
  /** 尋ねていること。尋ねていなければ `undefined`。 */
  readonly confirming: BuilderConfirm | undefined
  /**
   * プールの絞り込み（`pool-filter.ts`）。**別のデッキを開いても外さない**——同じ条件で探し続ける
   * ことが多い。
   */
  readonly filter: PoolFilter
  /** 詳しく絞り込むところを開いているか。 */
  readonly filterOpen: boolean
  /**
   * 共有する下書き（ADR-0022）。尋ねていなければ `undefined`。
   *
   * `confirming` と同じ理由でここに持つ——画面は丸ごと描き直されるので、打ち込みかけを状態として
   * 持つ。
   */
  readonly sharing: SharingState | undefined
  /** `レシピの一覧` で選んでいる並べ方（ADR-0022）。 */
  readonly recipeOrder: RecipeListOrder
  /** `レシピ` で開いているレシピの鍵（ADR-0022）。開いていなければ `undefined`。 */
  readonly viewingRecipe: RecipeKey | undefined
  /**
   * `viewingRecipe` を尋ねて、まだ返事が届いていないか（ADR-0022）。
   *
   * **`デッキを確かめる` の `checking` と同じ理由でここに持つ。** `レシピ` の返事はどの鍵を尋ねたかを
   * 添えない（送った順に届く前提、`protocol.ts`）ので、違う鍵を続けて開いた時に前の答えを出さない
   * ためにここで待っているかを覚える。
   */
  readonly viewingRecipeLoading: boolean
}

export function closedBuilder(draft: DeckDraft | undefined = undefined): Builder {
  return {
    screen: '閉じている',
    draft,
    rules: { format: undefined, restriction: undefined },
    pinned: undefined,
    waiting: { kind: '無し' },
    checking: 0,
    refusal: undefined,
    confirming: undefined,
    filter: emptyFilter(),
    filterOpen: false,
    sharing: undefined,
    recipeOrder: '新着',
    viewingRecipe: undefined,
    viewingRecipeLoading: false,
  }
}

/** 空の新しいデッキ。 */
export function newDraft(): DeckDraft {
  return { deck: undefined, name: NEW_DECK_NAME, description: '', cards: [] }
}

/** 自分のデッキを組み直す時の組みかけ。 */
export function draftOf(deck: WireOwnedDeck): DeckDraft {
  return { deck: deck.id, name: deck.name, description: deck.description, cards: deck.cards }
}

/** 識別子ごとの枚数。 */
export function countsOf(cards: readonly string[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const card of cards) counts.set(card, (counts.get(card) ?? 0) + 1)

  return counts
}

/** 1 枚入れる。 */
export function withCard(draft: DeckDraft, key: string): DeckDraft {
  return { ...draft, cards: [...draft.cards, key] }
}

/** 1 枚抜く。入っていなければそのまま。 */
export function withoutCard(draft: DeckDraft, key: string): DeckDraft {
  const index = draft.cards.lastIndexOf(key)
  if (index === -1) return draft

  return { ...draft, cards: draft.cards.filter((_, at) => at !== index) }
}

/** 同じ識別子を同じ枚数ずつ持っているか。**並びは比べない**——サーバは揃えて残す。 */
function sameCards(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false

  const counts = countsOf(left)
  const others = countsOf(right)
  return [...counts].every(([key, count]) => others.get(key) === count)
}

function sameDraft(left: DeckDraft, right: DeckDraft): boolean {
  return (
    left.deck === right.deck &&
    left.name === right.name &&
    left.description === right.description &&
    sameCards(left.cards, right.cards)
  )
}

/**
 * 保存していない変更があるか。
 *
 * 見比べる先は、届いている自分のデッキである。**上書きする先がもう無い**（ほかの画面で消した）
 * なら、残っているのは組みかけだけなので、変更があるものとして扱う。
 */
export function hasUnsavedChanges(draft: DeckDraft, owned: readonly WireOwnedDeck[]): boolean {
  if (draft.deck === undefined) return !sameDraft(draft, newDraft())

  const saved = owned.find((deck) => deck.id === draft.deck)
  return saved === undefined || !sameDraft(draft, draftOf(saved))
}

/**
 * 送る前の組みかけ。**上書きする先がもう無ければ、新しいデッキとして保存する。**
 *
 * 置いておくと、サーバが「そのデッキはありません」と断り続けて、組みかけを残す手立てが無くなる。
 */
export function draftToSave(draft: DeckDraft, owned: readonly WireOwnedDeck[]): DeckDraft {
  if (draft.deck === undefined || owned.some((deck) => deck.id === draft.deck)) return draft

  return { ...draft, deck: undefined }
}

/**
 * 届いたものを、組むところの状態に畳む。
 *
 * **返事は送った順に届く**ので、何を待っているか（`waiting`・`checking`）を覚えておけば、届いた
 * ものがどれへの返事かが分かる。断られた（`行えなかった`）ら、待っていたものは全部やめる——どれを
 * 断られたかは添えられていないが、どれも、もう返事は来ない。
 *
 * **`デッキを保存した` は中身をまるごと添えて届く**（ADR-0026）ので、`自分のデッキ` を待たずに
 * ここで組みかけへ反映できる。
 */
export function applyToBuilder(builder: Builder, message: ToClient): Builder {
  const { waiting } = builder
  switch (message.kind) {
    case 'デッキを保存した':
      if (waiting.kind === '保存') {
        const idAssigned =
          builder.draft === undefined ? undefined : { ...builder.draft, deck: message.deck.id }
        // **送った後に手を加えていなければ、残ったものに合わせる。** サーバは名前の前後の空白を
        // 落とすので、合わせないと保存した直後から変更があるように見える。手を加えていれば、
        // 新しく作ったデッキの識別子だけ受け取り、組みかけはそのまま残す——次からは上書きになる。
        const synced =
          idAssigned !== undefined && sameDraft(idAssigned, { ...waiting.sent, deck: message.deck.id })
            ? draftOf(message.deck)
            : idAssigned
        return { ...builder, draft: synced, waiting: { kind: '無し' } }
      }
      if (waiting.kind === 'コピー') {
        // コピーした時点では組みかけを触れないので、届いたものをそのまま組み始める。
        return { ...builder, screen: 'デッキを組む', draft: draftOf(message.deck), pinned: undefined, waiting: { kind: '無し' } }
      }
      return builder
    case 'デッキを確かめた':
      return { ...builder, checking: Math.max(0, builder.checking - 1) }
    case '共有した':
      // 待っていたのがこの下書きへの返事である時だけ、共有できた画面に切り替える。
      return builder.sharing?.kind === '打ち込み中' && builder.sharing.sending
        ? { ...builder, sharing: { kind: '共有した', share: message.share } }
        : builder
    case 'レシピ':
      // どの鍵への返事かは添えられていない（送った順に届く前提）ので、待っていたことだけを覚える。
      return { ...builder, viewingRecipeLoading: false }
    case '行えなかった': {
      // **尋ねている最中の共有があれば、そこにも理由を出す。** 下に出る `refusal`（画面の外）とは
      // 別に、ダイアログの中に出す必要がある——重なった画面の裏に断られた理由が隠れてしまう。
      const sharing =
        builder.sharing?.kind === '打ち込み中' && builder.sharing.sending
          ? { ...builder.sharing, sending: false, refusal: message.reason }
          : builder.sharing
      return { ...builder, waiting: { kind: '無し' }, checking: 0, refusal: message.reason, sharing }
    }
    default:
      return builder
  }
}

/** プールのカード 1 種を、組むところに並べる形。 */
export interface PoolRow {
  readonly key: string
  readonly name: string
  /** 「Lv1 赤 BP1000 SP1000」のような 1 行（盤面の小さいカードと同じ）。 */
  readonly summary: string
  /** いまデッキに入れている枚数。 */
  readonly count: number
}

/** デッキに入っているカード 1 種。 */
export type DeckRow =
  | ({ readonly kind: '使える' } & PoolRow)
  /**
   * プールに無いカード（取り下げられたもの）。**消さずに並べる**（ADR-0021）——抜くまで、確かめる
   * ことも保存することもできない（`server` の `owned-deck.ts`）。
   */
  | { readonly kind: '使えない'; readonly key: string; readonly count: number }

/**
 * 並べる順（#193）。**種別 → 色 → レベル → 名前。**
 *
 * どれもカードに印刷されている項目で、識別子は使わない（ADR-0021）。種別と色の順は engine が
 * 数え上げている順（`CARD_TYPES`・`COLORS`）で、無色は色のあるカードの後に置く。色を 2 つ以上
 * 持つカードは、持っている色を順に比べる。
 */
export function comparePrinted(left: WireCardFace, right: WireCardFace): number {
  return (
    CARD_TYPES.indexOf(left.type) - CARD_TYPES.indexOf(right.type) ||
    compareColors(left.colors, right.colors) ||
    left.level - right.level ||
    left.name.localeCompare(right.name, 'ja')
  )
}

function compareColors(left: readonly string[], right: readonly string[]): number {
  const rank = (colors: readonly string[]): readonly number[] =>
    colors.length === 0 ? [COLORS.length] : colors.map((color) => COLORS.indexOf(color as (typeof COLORS)[number]))
  const [a, b] = [rank(left), rank(right)]
  for (let at = 0; at < Math.min(a.length, b.length); at += 1) {
    const difference = (a[at] ?? 0) - (b[at] ?? 0)
    if (difference !== 0) return difference
  }

  return a.length - b.length
}

function sortedPool(pool: readonly WirePoolCard[]): readonly WirePoolCard[] {
  return [...pool].sort((left, right) => comparePrinted(left.face, right.face))
}

/** プールの一覧。**並ぶのはプールにあるものだけ**（ADR-0021）。 */
export function poolRows(pool: readonly WirePoolCard[], draft: DeckDraft): readonly PoolRow[] {
  const counts = countsOf(draft.cards)

  return sortedPool(pool).map((card) => ({
    key: card.key,
    name: card.face.name,
    summary: summaryOf(card.face),
    count: counts.get(card.key) ?? 0,
  }))
}

/** デッキの中身。プールと同じ順に並べ、使えないカードは最後に置く。 */
export function deckRows(pool: readonly WirePoolCard[], draft: DeckDraft): readonly DeckRow[] {
  const counts = countsOf(draft.cards)
  const usable: DeckRow[] = poolRows(pool, draft)
    .filter((row) => row.count > 0)
    .map((row) => ({ kind: '使える', ...row }))
  const known = new Set(pool.map((card) => card.key))
  // 使えないカードは表記が無く、印刷されている項目で並べようがない。入れた順のまま置く。
  const unusable: DeckRow[] = [...counts]
    .filter(([key]) => !known.has(key))
    .map(([key, count]) => ({ kind: '使えない', key, count }))

  return [...usable, ...unusable]
}

/** 使えないカードが入っているか。入っていれば、確かめることも保存することもできない。 */
export function hasUnusableCards(pool: readonly WirePoolCard[], draft: DeckDraft): boolean {
  const known = new Set(pool.map((card) => card.key))

  return draft.cards.some((key) => !known.has(key))
}

/** 詳しく出すカード 1 種。 */
export interface CardDetail {
  readonly name: string
  readonly rows: readonly DetailRow[]
  /** 印刷されているテキスト。改行ごとに 1 行（`view-model.ts` の `CardView` と同じ）。 */
  readonly text: readonly string[]
}

/** プールから引いて、詳しく出す形にする。プールに無ければ `undefined`。 */
export function cardDetailOf(pool: readonly WirePoolCard[], key: string): CardDetail | undefined {
  const card = pool.find((each) => each.key === key)
  if (card === undefined) return undefined

  return { name: card.face.name, rows: printedDetailsOf(card.face), text: card.face.text }
}

/**
 * カードに書かれていることの全部（詳しく出すところ）。
 *
 * 印刷されている表記だけを持つ。盤面に置かれて初めて決まるもの——支配者・向き・ダメージ・
 * 修整——は持たない。持っていない項目は行ごと出さない。
 */
export function printedDetailsOf(face: WireCardFace): readonly DetailRow[] {
  const rows: DetailRow[] = [
    { label: '種別', value: face.type },
    { label: 'レベル', value: String(face.level) },
    { label: '色', value: face.colors.length === 0 ? '無色' : face.colors.join('・') },
  ]
  if (face.type === 'ユニット') {
    rows.push({ label: 'ＢＰ', value: String(face.bp) }, { label: 'ＳＰ', value: String(face.sp) })
    if (face.moveIcon.length > 0) rows.push({ label: 'ムーブアイコン', value: face.moveIcon.join('・') })
  }
  if (face.type === 'トラップ' && face.triggerIcon.length > 0) {
    rows.push({ label: 'トリガーアイコン', value: face.triggerIcon.map((square) => squareLabel('先攻', square)).join('・') })
  }
  if (face.stars > 0) rows.push({ label: 'スター', value: String(face.stars) })
  if (face.reverseStars > 0) rows.push({ label: 'リバーススター', value: String(face.reverseStars) })
  if (face.attributes.length > 0) rows.push({ label: '属性', value: face.attributes.join('・') })

  return rows
}

/**
 * 確かめた結果の出し方。
 *
 * **数え上げられるので、列挙で持つ。** 「まだ分からない」と「満たしている」を空の並びで兼ねると、
 * 返事を待っている間に満たしているように見える。
 */
export type CheckView =
  | { readonly kind: '確かめている' }
  | { readonly kind: '確かめられない'; readonly reason: string }
  | { readonly kind: '満たしている' }
  | { readonly kind: '満たしていない'; readonly lines: readonly string[] }

/**
 * 確かめた結果を、組むところに出す形にする。
 *
 * `checking` は、いまの組みかけへの返事をまだ待っているか。送った数（`Builder.checking`）だけで
 * なく、**送る前に間を置いている間も待っている**（`index.ts`）。
 */
export function checkView(
  draft: DeckDraft,
  checking: boolean,
  checked: readonly DeckViolation[] | undefined,
  pool: readonly WirePoolCard[],
): CheckView {
  if (hasUnusableCards(pool, draft)) {
    return { kind: '確かめられない', reason: '使えないカードが入っています。抜くと確かめられます' }
  }
  if (checking || checked === undefined) return { kind: '確かめている' }
  if (checked.length === 0) return { kind: '満たしている' }

  return { kind: '満たしていない', lines: checked.map(violationLine) }
}

/** 不備 1 つを読める文にする。**「あと何枚」をそのまま出す**（ADR-0021）。 */
export function violationLine(violation: DeckViolation): string {
  switch (violation.kind) {
    case '枚数不足':
      return `あと ${violation.minimum - violation.count} 枚足りません（${violation.minimum} 枚以上）`
    case '同名の入れすぎ':
      return `「${violation.name}」が ${violation.count} 枚入っています（${violation.maximum} 枚まで）`
    case 'スターアイコンの入れすぎ':
      return `スターアイコンが ${violation.stars} 個あります（${violation.maximum} 個まで）`
    case '禁止／制限の入れすぎ':
      return violation.maximum === 0
        ? `禁止カード「${violation.name}」が入っています`
        : `制限カード「${violation.name}」が ${violation.count} 枚入っています（${violation.maximum} 枚まで）`
  }
}

/** 自分のデッキを選ぶところに並べる 1 つ。 */
export interface OwnedDeckRow {
  readonly id: DeckId
  readonly name: string
  readonly count: number
}

/** 自分のデッキの一覧。**届いた順のまま並べる。** */
export function ownedDeckRows(decks: readonly WireOwnedDeck[]): readonly OwnedDeckRow[] {
  return decks.map((deck) => ({ id: deck.id, name: deck.name, count: deck.cards.length }))
}

/**
 * 席に着く時に選べるデッキ（ADR-0021、#194）。**並ぶのは自分のデッキである。**
 *
 * 既製デッキは並ばない。コピーして自分のデッキにしてから使う（ADR-0022）。
 *
 * **自分のデッキが届いていなければ、既製デッキを並べる。** 届かないのは、デッキを持てない
 * 立て方だからである（ログインが無い、ADR-0021）。そこで何も並べないと、手元で 2 人ぶん試す時に
 * 両方の席が同じデッキに固定される。**サーバもその人には既製デッキを引かせる**ので、出るものと
 * 座れるものがずれない。
 */
export function seatableDecks(
  decks: readonly WireOwnedDeck[] | undefined,
  presets: readonly WireDeck[],
): readonly WireDeck[] {
  return decks === undefined ? presets : decks.map((deck) => ({ id: deck.id, name: deck.name }))
}

/**
 * ロビーで選んだ状態にするデッキ（#194）。**もう無いデッキは選ばない。**
 *
 * 自分で選んだものを優先し、選んでいなければサーバが決めた既定（`ロビー` の `chosen`）を使う。
 * どちらも、**いま並んでいるもの**（`seatableDecks`）の中にある時だけ選ぶ——消したデッキを
 * 選んだ状態のままにすると、座れないものが選ばれて見える。デッキを消した後にロビーが届き直すまでの
 * 間がそれにあたる。
 */
export function seatedChoice(
  shown: readonly WireDeck[],
  picked: DeckId | undefined,
  standing: DeckId | undefined,
): DeckId | undefined {
  const alive = (id: DeckId | undefined): boolean => id !== undefined && shown.some((deck) => deck.id === id)
  if (alive(picked)) return picked

  return alive(standing) ? standing : undefined
}
