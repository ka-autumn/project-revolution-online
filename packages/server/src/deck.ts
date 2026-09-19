import { checkConstructedDeck, faceOf } from '@revolution/engine'
import type {
  Card,
  CardLimits,
  Deck,
  DeckId,
  DeckViolation,
  RestrictionListId,
  WireDeck,
  WirePoolCard,
  WireRestrictionList,
} from '@revolution/engine'
import type { OwnedDeck } from './owned-deck.js'
import type { DeckSource, ParticipantId, RoomSetup, SeatedDeck, SeatedDeckReading } from './room.js'

/**
 * 立てる時に渡してもらうものを、部屋に渡せる形にする（ADR-0021、#105）。
 *
 * **カードを知らないし、デッキの組み方も持たない。** 受け取るのは識別子で引けるカードのまとまり
 * （プール）と、識別子の並びでできた既製デッキと、禁止／制限リストである。何がプールに入るかも、
 * 既製デッキに何を何枚積むかも渡す側が決めることで、サーバの関心事ではない。サーバがカードの
 * 実装に依存すると、カードを持たない環境（ADR-0002）で組み立てられなくなる。
 *
 * **識別子から何も読み取らない。** 公開側にとってはただの文字列で、何を指すかも知らない。鍵として
 * 引くだけで、並べ替えにも絞り込みにも使わない（ADR-0021）。
 */

/**
 * プールの中でカード 1 種を指す識別子（ADR-0021）。
 *
 * **カードの同一性はこれで決まる。** 同じ日本語版のカード名を持つ別のカードがありうる（総合ルール
 * 第3部 第1章 3-1 が同名の数え方を規則にしている）ので、名前ではカードを指せない。
 */
export type CardKey = string

/** 識別子で引けるカードのまとまり。渡す側が、実装済みのカードだけを入れる（ADR-0021）。 */
export type CardPool = Readonly<Record<CardKey, Card>>

/**
 * 渡してもらう既製デッキ 1 つ（ADR-0021）。
 *
 * 中身は識別子の並びで、**同じ識別子を並べた数がその枚数**になる。何をどの枚数入れるかは渡す側が
 * 決めることで、公開側は積み方の取り決めを持たない（#105）。
 */
export interface PresetDeck {
  readonly id: DeckId
  /** 選ぶ人に見せる名前。**指すのは識別子のほうである**（`WireDeck`）。 */
  readonly name: string
  readonly cards: readonly CardKey[]
}

/**
 * 禁止カード・制限カードのリスト 1 つ（ADR-0021）。
 *
 * 総合ルールは禁止／制限の中身をフロアルールへ投げていて（第3部 第1章 3-1）、公開リポジトリは
 * その先を持っていない。**どのカードかを名指しするリストは、渡す側から受け取る**——公開リポジトリで
 * カードを名指ししている場所を作らないためである（ADR-0002）。
 *
 * **禁止と制限を分けずに、1 枚あたりの上限で持つ。** 禁止は上限 0 枚であって、別の種類のものでは
 * ない。判定が 1 本で済み、「禁止かつ制限」という書けてしまう形も無くなる。
 *
 * **リストは、いまプールに無いカードを名指していてもよい。** リストは遊ばれている環境の側の言葉で、
 * 何が実装済みかとは別に決まる。
 *
 * **名指すのは識別子ではなくカード名である。** 制限は同名のカードに掛かる（フロアルール Version 1.12
 * 第2部 第1章 1-1）。識別子で名指すと、同じ名前の再録カードがプールにあり、名指した識別子が
 * プールに無いときに、名前を引けずに上限が当たらなくなる。
 */
export interface RestrictionList {
  readonly id: RestrictionListId
  readonly name: string
  /** カード名ごとの、デッキに入れてよい枚数。`0` が禁止カード。**載っていないカードに上限は無い。** */
  readonly limits: CardLimits
}

/**
 * 立てる時に渡してもらうもの一式（ADR-0021）。
 *
 * これが非公開側との受け渡しの契約そのものである。**渡すモジュールは、この 3 つを export する。**
 * エキスパンション（`expansions`）は渡さなくてもよい。
 */
export interface CardSupply {
  readonly pool: CardPool
  /** 誰でも使える既製デッキ。**少なくとも 1 つ要る**——デッキを組む場所がまだ無い（ADR-0021）。 */
  readonly presets: readonly PresetDeck[]
  /**
   * 名前の付いた禁止／制限リスト。**空でよい。**
   *
   * どのリストを使うかは部屋ごとに決まる（ADR-0021、`room.ts`）。**並び順がそのままロビーの並びに
   * なり、先頭のものが、何も選ばずに作られた部屋の既定になる。**
   */
  readonly restrictions: readonly RestrictionList[]
  /**
   * カードがどのエキスパンションに収録されているか（#193）。**渡されなければ、どのカードも持たない。**
   *
   * デッキを組む画面で絞り込むのに使う。ルールには関わらない。
   */
  readonly expansions?: readonly Expansion[]
}

/**
 * エキスパンション 1 つ（#193）。カードが収録されている商品の単位で、**名前と、収録されているカードの
 * 識別子**を持つ。
 *
 * **公開側は識別子からエキスパンションを読み取らない**（ADR-0021）。どのカードがどこに入っているかは
 * 渡す側が決め、画面へは名前として届く。**同じカードが複数のエキスパンションに入ってよい。**
 *
 * **プールに無いカードを含んでよい。** 収録されていることと実装済みであることは別に決まる。
 */
export interface Expansion {
  /** 画面に出す名前。**エキスパンションはこれで指す**ので、重ならない。 */
  readonly name: string
  readonly cards: readonly CardKey[]
}

/** 渡されたものを読んだ結果。**なりうる形を数え上げる**——読めたのに理由もある形を書けなくする。 */
export type SupplyReading =
  | { readonly kind: '通す'; readonly supply: CardSupply }
  | { readonly kind: '断る'; readonly reason: string }

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** カードとして通す形か。**中身までは見ない**——engine の `Card` を組み立て直すのはここの仕事ではない。 */
function isCard(value: unknown): value is Card {
  return isObject(value) && typeof value['name'] === 'string'
}

function readPool(value: unknown): CardPool | string {
  if (!isObject(value)) return 'pool が識別子で引けるカードのまとまりではありません'
  const entries = Object.entries(value)
  if (entries.length === 0) return 'pool が空です'
  for (const [key, card] of entries) {
    if (!isCard(card)) return `pool の ${key} がカードではありません`
  }

  return value as CardPool
}

function readPresets(value: unknown, pool: CardPool): readonly PresetDeck[] | string {
  if (!Array.isArray(value) || value.length === 0) return 'presets が既製デッキの配列ではありません'
  const presets: PresetDeck[] = []
  const seen = new Set<DeckId>()
  for (const preset of value as readonly unknown[]) {
    if (!isObject(preset)) return 'presets に既製デッキでないものが入っています'
    const { id, name, cards } = preset
    if (typeof id !== 'string' || id === '') return 'presets に識別子の無い既製デッキが入っています'
    // **識別子が重なると、どちらを指しているか決められない。** 選ぶのは識別子のほうである。
    if (seen.has(id)) return `既製デッキの識別子が重なっています: ${id}`
    if (typeof name !== 'string' || name === '') return `既製デッキ ${id} に名前がありません`
    if (!Array.isArray(cards) || !cards.every((card) => typeof card === 'string')) {
      return `既製デッキ ${id} の cards が識別子の並びではありません`
    }
    // **プールに無いカードは積めない。** プールに入っているかどうかがそのまま「実装済み」で
    // ある（ADR-0021）ので、外れているなら渡す側の取り違えである。
    for (const card of cards as readonly CardKey[]) {
      if (!Object.hasOwn(pool, card)) return `既製デッキ ${id} に、プールに無いカードが入っています`
    }
    seen.add(id)
    presets.push({ id, name, cards: cards as readonly CardKey[] })
  }

  return presets
}

function readRestrictions(value: unknown): readonly RestrictionList[] | string {
  if (!Array.isArray(value)) return 'restrictions がリストの配列ではありません'
  const lists: RestrictionList[] = []
  const seen = new Set<RestrictionListId>()
  for (const list of value as readonly unknown[]) {
    if (!isObject(list)) return 'restrictions にリストでないものが入っています'
    const { id, name, limits } = list
    if (typeof id !== 'string' || id === '') return 'restrictions に識別子の無いリストが入っています'
    // 部屋はリストを識別子で覚える（`room.ts`）。重なると、どちらを当てているか決められない。
    if (seen.has(id)) return `禁止／制限リストの識別子が重なっています: ${id}`
    if (typeof name !== 'string' || name === '') return `禁止／制限リスト ${id} に名前がありません`
    if (!isObject(limits)) return `禁止／制限リスト ${id} の limits が枚数の表ではありません`
    for (const [card, limit] of Object.entries(limits)) {
      // 空白だけの名前は、空白を無視して比べると空になり、どのカードも指さない（engine の `sameNameKey`）。
      if (card.trim() === '') return `禁止／制限リスト ${id} に名前の無いカードが入っています`
      if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 0) {
        return `禁止／制限リスト ${id} の ${card} の枚数が 0 以上の整数ではありません`
      }
    }
    seen.add(id)
    lists.push({ id, name, limits: limits as CardLimits })
  }

  return lists
}

function readExpansions(value: unknown): readonly Expansion[] | string {
  if (!Array.isArray(value)) return 'expansions がエキスパンションの配列ではありません'
  const expansions: Expansion[] = []
  const seen = new Set<string>()
  for (const expansion of value as readonly unknown[]) {
    if (!isObject(expansion)) return 'expansions にエキスパンションでないものが入っています'
    const { name, cards } = expansion
    if (typeof name !== 'string' || name === '') return 'expansions に名前の無いエキスパンションが入っています'
    // 画面は名前で絞り込む。重なると、どちらのことか決められない。
    if (seen.has(name)) return `エキスパンションの名前が重なっています: ${name}`
    if (!Array.isArray(cards) || !cards.every((card) => typeof card === 'string')) {
      return `エキスパンション ${name} の cards が識別子の並びではありません`
    }
    seen.add(name)
    expansions.push({ name, cards: cards as readonly CardKey[] })
  }

  return expansions
}

/**
 * 渡されたモジュールを、受け渡しの契約として読む。
 *
 * **ここが外から値が入ってくる境目である。** 渡すモジュールは実行時に受け取るもので型検査を
 * 通らない（`tools/bundle-server.mjs`）ので、黙って信じずに読み方を書く。**通らなければ、どこが
 * 違うのかを 1 行で言う**——立てた人がその場で直せるようにするためである。
 */
export function readSupply(module: unknown): SupplyReading {
  if (!isObject(module)) return { kind: '断る', reason: '渡されたモジュールを読めません' }

  const pool = readPool(module['pool'])
  if (typeof pool === 'string') return { kind: '断る', reason: pool }

  const presets = readPresets(module['presets'], pool)
  if (typeof presets === 'string') return { kind: '断る', reason: presets }

  const restrictions = readRestrictions(module['restrictions'] ?? [])
  if (typeof restrictions === 'string') return { kind: '断る', reason: restrictions }

  const expansions = readExpansions(module['expansions'] ?? [])
  if (typeof expansions === 'string') return { kind: '断る', reason: expansions }

  return { kind: '通す', supply: { pool, presets, restrictions, expansions } }
}

/** 既製デッキ 1 つ分の不備。どのデッキかが分かるように、識別子を添える。 */
export interface PresetDeckViolation {
  readonly deck: DeckId
  readonly violation: DeckViolation
}

/**
 * 渡された既製デッキが構築戦の規定を満たしているか（総合ルール 第3部 第1章 3）。満たしていれば空。
 *
 * **立てる時に確かめるためにある。** 確かめずに立てても、席に着く時に `prepareDuel` が同じことを
 * 見つける（`room.ts` の `start`）が、それでは対戦しようとした人が断られて初めて分かる。
 *
 * **禁止／制限リストは当てない。** どのリストを使うかは部屋ごとに決まる（ADR-0021）ので、既製
 * デッキがどのリストの下でも通るとは限らない。通らない部屋で断るのは、席に着く時の仕事である。
 */
export function checkPresets(supply: CardSupply): readonly PresetDeckViolation[] {
  return supply.presets.flatMap((preset) => {
    const deck = cardsOf(supply.pool, preset.cards)

    return deck === undefined
      ? []
      : checkConstructedDeck(deck).map((violation): PresetDeckViolation => ({ deck: preset.id, violation }))
  })
}

/** 識別子の並びを、カードの並びに直す。1 つでも引けなければ `undefined`。 */
function cardsOf(pool: CardPool, keys: readonly CardKey[]): Deck | undefined {
  const cards: Card[] = []
  for (const key of keys) {
    const card = pool[key]
    if (card === undefined) return undefined

    cards.push(card)
  }

  return cards
}

function seatedDeckOf(pool: CardPool, keys: readonly CardKey[]): SeatedDeck | undefined {
  const cards = cardsOf(pool, keys)
  return cards === undefined ? undefined : { cards, keys }
}

/**
 * あるデッキの中身を、席に持ち込めるかどうかとして読む（`room.ts` の `SeatedDeckReading`）。
 *
 * **識別子で引けたデッキにしか使わない。** ここまで来て引けないのは、プールから取り下げられた
 * カードを含む場合だけである（ADR-0021）。
 */
function readingOf(pool: CardPool, keys: readonly CardKey[]): SeatedDeckReading {
  const deck = seatedDeckOf(pool, keys)
  return deck === undefined ? { kind: '使えないカードがある' } : { kind: '引けた', deck }
}

/**
 * 渡されたものから、部屋がデッキを引くところを作る（`room.ts` の `DeckSource`）。
 *
 * **引けるのは既製デッキだけである。** 自分のデッキは持ち主ごとに預かっているもので、渡された
 * ものからは引けない——足すのは `withOwnedDecks` である。
 *
 * **既定は最初の既製デッキである。** 自分のデッキを持てない立て方（ADR-0021）でも、デッキが
 * 無いまま席に着くことはない。
 */
export function deckSourceFrom(supply: CardSupply): DeckSource {
  const presets = new Map(supply.presets.map((preset) => [preset.id, preset] as const))
  const [first] = supply.presets
  if (first === undefined) throw new Error('既製デッキが 1 つも渡されていません')

  return {
    // 既製デッキは誰のものでもないので、誰が座るかを見ない。
    of: (_participant, id) => {
      const preset = presets.get(id)
      return preset === undefined ? { kind: '無い' } : readingOf(supply.pool, preset.cards)
    },
    fallbackFor: () => first.id,
    from: (keys) => seatedDeckOf(supply.pool, keys),
    restrictions: supply.restrictions,
  }
}

/**
 * 預かっている自分のデッキを引くところ（ADR-0021）。**ログインを持たない立て方では渡されない。**
 *
 * **置き場そのものではなく、引くところだけを受け取る。** デッキを引くのに要るのはこの 2 つで、
 * 書く手立ては要らない。
 */
export interface OwnedDeckSource {
  /**
   * その人が持っているデッキ。作った順に並ぶ。**持っていなければ空。**
   *
   * **身元を持たない参加者（CPU、`cpu.ts`）が渡されても投げてはならない。** 部屋は席にいる人を
   * 区別せずにここへ渡す（`room.ts` の `start`）ので、置き場に直に繋ぐなら、呼ぶ側が先に外す。
   */
  readonly decksOf: (participant: ParticipantId) => readonly OwnedDeck[]
  /** その人が前に席に着く時に選んだデッキ。まだ選んでいなければ `undefined`。`decksOf` と同じ約束。 */
  readonly lastChosenOf: (participant: ParticipantId) => DeckId | undefined
}

/**
 * 既製デッキしか引けないところに、自分のデッキを足す（ADR-0021、#194）。
 *
 * **自分のデッキを先に引く。** 識別子はどちらもただの文字列で、重なりうる（既製デッキの識別子を
 * 決めるのは渡す側、自分のデッキの識別子を決めるのは置き場である）。**座る人のものを優先する**
 * ——自分のデッキを選んだつもりで既製デッキに座らされるほうが分かりにくい。
 *
 * **既定は、前に選んだデッキがあるかどうかで分かれる**（#194）。
 *
 * - 前に選んだデッキが残っていれば、それ
 * - **前に選んだデッキが消えていれば、既定は決まらない**（`undefined`）。選び直すまで席に着けない
 *   ——選んだ覚えのないデッキで相手の前に座らせない。**覚えているほうを消す時に消しに行かない**
 *   のは、デッキが置き場から消える道が増えるたびに消し漏れるからである（ADR-0021）
 * - まだ一度も選んでいなければ、自分のデッキの先頭。**初めて座る人に選ばせない**——初めて入った
 *   人には既製デッキが 1 つ配られており（ADR-0021）、前に選んだ覚えも無い
 * - 自分のデッキを 1 つも持てない立て方では、既製デッキの先頭
 *
 * **デッキを持てる人は、既製デッキでは座れない**（ADR-0021）。選ぶ場所に並ばないだけでなく、
 * 識別子を直に送っても引けない——**画面の決まりで終わらせない**（ADR-0010）。デッキを 1 つも
 * 持てない立て方では既製デッキが既定なので、そちらでは今までどおり引ける。
 */
export function withOwnedDecks(base: DeckSource, pool: CardPool, owned: OwnedDeckSource): DeckSource {
  return {
    ...base,
    of: (participant, id) => {
      const mine = owned.decksOf(participant)
      const found = mine.find((deck) => deck.id === id)
      if (found !== undefined) return readingOf(pool, found.cards)

      return mine.length === 0 ? base.of(participant, id) : { kind: '無い' }
    },
    fallbackFor: (participant) => {
      // **持っているデッキを引くのは 1 度でよい。** ロビーを送り直すたびに人数ぶん呼ばれる
      // （`serve.ts` の `pushLobby`）。
      const mine = owned.decksOf(participant)
      const chosen = owned.lastChosenOf(participant)
      if (chosen !== undefined) return mine.some((deck) => deck.id === chosen) ? chosen : undefined

      const [first] = mine
      return first?.id ?? base.fallbackFor(participant)
    },
  }
}

/** コピー元として画面に出す既製デッキ（`WireDeck`）。**渡された順のまま並べる。** */
export function deckChoicesOf(supply: CardSupply): readonly WireDeck[] {
  return supply.presets.map((preset) => ({ id: preset.id, name: preset.name }))
}

/**
 * 部屋を作る時に選べる禁止／制限リストとして画面に出すもの（`WireRestrictionList`）。
 * **渡された順のまま並べる。** 中身（どのカードが何枚までか）は出さない。
 */
export function restrictionChoicesOf(supply: CardSupply): readonly WireRestrictionList[] {
  return supply.restrictions.map((list) => ({ id: list.id, name: list.name }))
}

/**
 * デッキを組む人に配るカードプール（`WirePoolCard`、ADR-0021）。
 *
 * **盤面に載るのと同じ書き出し方を使う**（engine の `faceOf`）。配るために別の道を作ると、盤面では
 * 落としているもの（効果や能力）がこちらでだけ漏れる、という食い違いが生まれうる。
 *
 * **並べ替えない。** 識別子から何も読み取らない（ADR-0021）ので、渡されたまとまりから取り出した
 * 順のまま並べる。
 *
 * エキスパンションは、渡された並びの順で名前を添える（`Expansion`）。どこにも入っていなければ空。
 */
export function poolFacesOf(supply: Pick<CardSupply, 'pool' | 'expansions'>): readonly WirePoolCard[] {
  const expansions = supply.expansions ?? []

  return Object.entries(supply.pool).map(([key, card]) => ({
    key,
    face: faceOf(card),
    expansions: expansions.filter((expansion) => expansion.cards.includes(key)).map((expansion) => expansion.name),
  }))
}

/** 新しい部屋に付ける合言葉の長さ。 */
const CODE_LENGTH = 6

/**
 * 新しい部屋の合言葉（#175）。
 *
 * **シードとは別に引く。** 合言葉はロビーにいる全員に見える（`room.ts` の `lobbyOf`）ので、
 * シードから作ると山札の並びが読み取れてしまう（ADR-0005）。URL にも載る（`?room=`）ので、
 * 英数字だけにする。
 */
function newCode(): string {
  return Math.random().toString(36).slice(2, 2 + CODE_LENGTH)
}

/**
 * 部屋が始まるたびに引くもの（`RoomSetup`）。
 *
 * **デッキと関わらない。** どのデッキで座るかは座る人が決めるようになった（ADR-0021）ので、ここに
 * 残るのはシードと合言葉だけである。**呼ぶたびに違うシードを返す**——同じシードを返すと、どの部屋も
 * 同じ山札の並びになる（ADR-0005）。
 */
export function newSetup(): RoomSetup {
  return { seed: Math.floor(Math.random() * 2 ** 31), code: newCode() }
}
