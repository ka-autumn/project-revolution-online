import { describe, expect, it } from 'vitest'
import type { WireCardFace, WireOwnedDeck, WirePoolCard } from '@revolution/engine'
import {
  DECK_NAME_LIMIT,
  NEW_DECK_NAME,
  applyToBuilder,
  autoLabelsOf,
  cardDetailOf,
  checkView,
  closedBuilder,
  comparePrinted,
  confirmView,
  deckColorChoices,
  deckLabelChoices,
  deckRows,
  draftOf,
  draftToSave,
  duplicatedDeckName,
  filterOwnedDeckRows,
  hasUnsavedChanges,
  levelBreakdownOf,
  newDraft,
  ownedDeckRows,
  poolRows,
  printedDetailsOf,
  seatableDecks,
  seatedChoice,
  startedEditing,
  starTotalOf,
  typeCountsOf,
  violationLine,
  withCard,
  withoutCard,
} from './deck-builder.js'
import type { Builder, DeckDraft } from './deck-builder.js'
import { unitFace } from './test-support.js'

/**
 * デッキを組むところ（#193）。
 *
 * **確かめるのはサーバである**（ADR-0021）。ここで見るのは、組みかけの持ち方と、届いたものを
 * どう出すかだけで、規定を満たしているかは見ない。
 */

function strategyFace(name: string, values: Partial<WireCardFace> = {}): WireCardFace {
  return {
    type: 'ストラテジー',
    name,
    level: 0,
    colors: [],
    stars: 0,
    reverseStars: 0,
    attributes: [],
    keywords: [],
    text: [],
    ...values,
  } as WireCardFace
}

/** 識別子は意味の無い文字列にする。**並べる順が識別子に引きずられていないこと**を見るため。 */
const POOL: readonly WirePoolCard[] = [
  { key: 'き', face: strategyFace('テスト・無色のストラテジー'), expansions: [] },
  { key: 'え', face: unitFace('テスト・青のユニット', { colors: ['青'], level: 1 }), expansions: [] },
  { key: 'う', face: unitFace('テスト・赤のユニットLv2', { colors: ['赤'], level: 2 }), expansions: [] },
  { key: 'い', face: unitFace('テスト・赤のユニットLv1', { colors: ['赤'], level: 1 }), expansions: [] },
  { key: 'あ', face: unitFace('テスト・無色のユニット', { colors: [], level: 0 }), expansions: [] },
]

const OWNED: WireOwnedDeck = { id: 'デッキ1', name: 'くみかけ', description: 'かいせつ', cards: ['い', 'い', 'え'] }

function editing(draft: DeckDraft): Builder {
  return { ...closedBuilder(), screen: 'デッキを組む', draft }
}

describe('組みかけを変える', () => {
  it('入れると 1 枚増え、抜くと 1 枚減る', () => {
    const added = withCard(withCard(newDraft(), 'い'), 'い')

    expect(added.cards).toEqual(['い', 'い'])
    expect(withoutCard(added, 'い').cards).toEqual(['い'])
  })

  it('入っていないカードは抜けない', () => {
    const draft = withCard(newDraft(), 'い')

    expect(withoutCard(draft, 'え')).toBe(draft)
  })
})

describe('保存していない変更', () => {
  it('開いたままなら、変更は無い', () => {
    expect(hasUnsavedChanges(draftOf(OWNED), [OWNED])).toBe(false)
  })

  /** サーバは揃えて残すので、入れた順が違っても同じデッキである。 */
  it('並びが違うだけなら、変更は無い', () => {
    const reordered = { ...draftOf(OWNED), cards: ['え', 'い', 'い'] }

    expect(hasUnsavedChanges(reordered, [OWNED])).toBe(false)
  })

  it('カード・名前・解説のどれかが変われば、変更がある', () => {
    const draft = draftOf(OWNED)

    expect(hasUnsavedChanges(withoutCard(draft, 'え'), [OWNED])).toBe(true)
    expect(hasUnsavedChanges(withCard(draft, 'え'), [OWNED])).toBe(true)
    expect(hasUnsavedChanges({ ...draft, name: 'べつのなまえ' }, [OWNED])).toBe(true)
    expect(hasUnsavedChanges({ ...draft, description: '' }, [OWNED])).toBe(true)
  })

  it('新しいデッキは、何もしていなければ変更は無く、1 枚でも入れれば変更がある', () => {
    expect(hasUnsavedChanges(newDraft(), [OWNED])).toBe(false)
    expect(hasUnsavedChanges(withCard(newDraft(), 'い'), [OWNED])).toBe(true)
  })

  /** ほかの画面で消した。残っているのは組みかけだけである。 */
  it('上書きする先がもう無ければ、変更がある', () => {
    expect(hasUnsavedChanges(draftOf(OWNED), [])).toBe(true)
  })
})

describe('保存する', () => {
  it('上書きする先があれば、そのまま送る', () => {
    const draft = draftOf(OWNED)

    expect(draftToSave(draft, [OWNED])).toBe(draft)
  })

  /** 置いておくと、サーバが「そのデッキはありません」と断り続ける。 */
  it('上書きする先がもう無ければ、新しいデッキとして送る', () => {
    expect(draftToSave(draftOf(OWNED), []).deck).toBeUndefined()
  })

  /** ADR-0026。中身をまるごと添えて届くので、`自分のデッキ` を待たずにここで識別子が付く。 */
  it('新しく作ったデッキは、保存した返事で識別子が付き、次からは上書きになる', () => {
    const sent = withCard(newDraft(), 'い')
    const waiting: Builder = { ...editing(sent), waiting: { kind: '保存', sent } }
    const saved: WireOwnedDeck = { id: 'あたらしい', name: sent.name, description: sent.description, cards: sent.cards }

    const builder = applyToBuilder(waiting, { kind: 'デッキを保存した', deck: saved, violations: [] })

    expect(builder.draft?.deck).toBe('あたらしい')
    expect(builder.waiting).toEqual({ kind: '無し' })
  })

  /** サーバは名前の前後の空白を落とす。合わせないと、保存した直後から変更があるように見える。 */
  it('送った後に手を加えていなければ、残ったものに合わせる', () => {
    const sent = { ...draftOf(OWNED), name: '  くみかけ  ' }
    const waiting: Builder = { ...editing(sent), waiting: { kind: '保存', sent } }

    const builder = applyToBuilder(waiting, { kind: 'デッキを保存した', deck: OWNED, violations: [] })

    expect(builder.draft).toEqual(draftOf(OWNED))
    expect(builder.waiting).toEqual({ kind: '無し' })
  })

  /** 返事が届くまでの間に手を加えていた場合。届いたものに揃え直さず、手を加えた側を残す。 */
  it('返事が届くまでに手を加えていれば、組みかけはそのまま残る', () => {
    const sent = draftOf(OWNED)
    const waiting: Builder = { ...editing(withCard(sent, 'う')), waiting: { kind: '保存', sent } }

    const builder = applyToBuilder(waiting, { kind: 'デッキを保存した', deck: OWNED, violations: [] })

    expect(builder.draft?.cards).toEqual([...OWNED.cards, 'う'])
  })

  /** どれを断られたかは添えられていないが、どれも、もう返事は来ない。 */
  it('断られたら、待つのをやめて理由を覚える', () => {
    const sent = newDraft()
    const waiting: Builder = { ...editing(sent), waiting: { kind: '保存', sent }, checking: 2 }

    const builder = applyToBuilder(waiting, { kind: '行えなかった', reason: 'デッキの名前を入れてください' })

    expect(builder.waiting).toEqual({ kind: '無し' })
    expect(builder.checking).toBe(0)
    expect(builder.refusal).toBe('デッキの名前を入れてください')
  })
})

/** ADR-0022。共有する下書きは、`Builder.sharing` に持つ。 */
describe('共有する', () => {
  const SHARE = {
    id: '共有1',
    key: '公開鍵1',
    recipe: 'かぎ1',
    sharer: 'わたし',
    name: 'わたしのレシピ',
    description: '',
    visibility: 'リンクを知っている人だけ',
    revoked: false,
    format: '構築戦',
    restriction: undefined,
  } as const

  const DRAFT = {
    deck: OWNED.id,
    name: OWNED.name,
    description: OWNED.description,
    visibility: 'リンクを知っている人だけ',
    format: undefined,
    restriction: undefined,
  } as const

  function sending(): Builder {
    return { ...closedBuilder(), sharing: { kind: '打ち込み中', draft: DRAFT, sending: true, refusal: undefined } }
  }

  it('共有できたら、リンクを組み立てる分に切り替わる', () => {
    const builder = applyToBuilder(sending(), { kind: '共有した', share: SHARE })

    expect(builder.sharing).toEqual({ kind: '共有した', share: SHARE })
  })

  /** 待っていないのに届いても、無視する。 */
  it('尋ねていない時に届いても、そのまま', () => {
    const builder = closedBuilder()

    expect(applyToBuilder(builder, { kind: '共有した', share: SHARE }).sharing).toBeUndefined()
  })

  it('断られたら、ダイアログの中に理由が出る', () => {
    const builder = applyToBuilder(sending(), { kind: '行えなかった', reason: 'この規定を満たしていません' })

    expect(builder.sharing).toEqual({ kind: '打ち込み中', draft: DRAFT, sending: false, refusal: 'この規定を満たしていません' })
  })

  it('尋ねている最中でなければ、断られても触らない', () => {
    const builder = applyToBuilder(closedBuilder(), { kind: '行えなかった', reason: 'そのデッキはありません' })

    expect(builder.sharing).toBeUndefined()
  })
})

/** ADR-0022。どの鍵を尋ねたかは届くものに添えられないので、待っていたかどうかを覚える。 */
describe('レシピを尋ねる', () => {
  it('尋ねている間は真', () => {
    const builder = { ...closedBuilder(), viewingRecipe: 'かぎ1', viewingRecipeLoading: true }

    expect(applyToBuilder(builder, { kind: 'レシピ', recipe: undefined }).viewingRecipeLoading).toBe(false)
  })
})

describe('既製デッキをコピーする', () => {
  /** ADR-0022、ADR-0026。コピーしたものは、中身をまるごと添えて届くので、そのまま組み始められる。 */
  it('コピーしたデッキが届いたら、そのデッキを組み始める', () => {
    const waiting: Builder = { ...closedBuilder(), screen: 'デッキを選ぶ', waiting: { kind: 'コピー' } }

    const builder = applyToBuilder(waiting, { kind: 'デッキを保存した', deck: OWNED, violations: [] })

    expect(builder.screen).toBe('デッキを組む')
    expect(builder.draft).toEqual(draftOf(OWNED))
    expect(builder.waiting).toEqual({ kind: '無し' })
  })

  /** ADR-0028。窓と名前の打ち込みは前に開いていたデッキのものなので、持ち越さない。 */
  it('届いたデッキは、窓と名前の打ち込みを閉じた状態で組み始める', () => {
    const waiting: Builder = {
      ...closedBuilder(),
      screen: 'デッキを選ぶ',
      waiting: { kind: 'コピー' },
      modal: '解説',
      editingName: '打ちかけ',
    }

    const builder = applyToBuilder(waiting, { kind: 'デッキを保存した', deck: OWNED, violations: [] })

    expect(builder.modal).toBeUndefined()
    expect(builder.editingName).toBeUndefined()
  })

  it('何も待っていなければ、保存した返事が届いても組むところは変わらない', () => {
    const listing: Builder = { ...closedBuilder(), screen: 'デッキを選ぶ' }

    expect(applyToBuilder(listing, { kind: 'デッキを保存した', deck: OWNED, violations: [] })).toBe(listing)
  })
})

describe('組み始める', () => {
  it('どのデッキを開いても、窓と名前の打ち込みを閉じた状態で始める', () => {
    const before: Builder = { ...editing(draftOf(OWNED)), modal: '解説', editingName: '打ちかけ', pinned: 'い' }

    const builder = startedEditing(before, newDraft())

    expect(builder.screen).toBe('デッキを組む')
    expect(builder.draft).toEqual(newDraft())
    expect(builder.modal).toBeUndefined()
    expect(builder.editingName).toBeUndefined()
    expect(builder.pinned).toBeUndefined()
  })
})

/** ADR-0028。自分のデッキを、名前に「（コピー）」を付けて新しいデッキとして保存し直す。 */
describe('複製する', () => {
  it('名前に「（コピー）」を付ける', () => {
    expect(duplicatedDeckName('くみかけ')).toBe('くみかけ（コピー）')
  })

  it('付けると上限を超えるなら、元の名前の末尾を削って上限に収める', () => {
    const name = duplicatedDeckName('あ'.repeat(DECK_NAME_LIMIT))

    expect([...name]).toHaveLength(DECK_NAME_LIMIT)
    expect(name).toBe(`${'あ'.repeat(DECK_NAME_LIMIT - 5)}（コピー）`)
  })

  /** サーバはコードポイントで数える（`server` の `owned-deck.ts`）。 */
  it('長さはコードポイントで数える', () => {
    const name = duplicatedDeckName('😀'.repeat(DECK_NAME_LIMIT))

    expect([...name]).toHaveLength(DECK_NAME_LIMIT)
  })

  it('削った末尾が空白なら落とす', () => {
    const name = duplicatedDeckName(`${'あ'.repeat(DECK_NAME_LIMIT - 6)} いいいいい`)

    expect(name).toBe(`${'あ'.repeat(DECK_NAME_LIMIT - 6)}（コピー）`)
  })

  it('使えないカードが入っているデッキは複製できない', () => {
    const rows = ownedDeckRows(POOL, [
      OWNED,
      { id: 'デッキ2', name: '使えない', description: '', cards: ['い', 'どこにもない'] },
    ])

    expect(rows.map((row) => row.hasUnusable)).toEqual([false, true])
  })
})

describe('確かめる', () => {
  it('返事が届くたびに、待っている数が減る', () => {
    const builder = { ...editing(newDraft()), checking: 2 }

    expect(applyToBuilder(builder, { kind: 'デッキを確かめた', violations: [] }).checking).toBe(1)
  })

  /** 空の並びを「満たしている」と読むと、返事を待っている間に満たしているように見える。 */
  it('返事を待っている間は、確かめている', () => {
    expect(checkView(newDraft(), true, [], POOL)).toEqual({ kind: '確かめている' })
    expect(checkView(newDraft(), false, undefined, POOL)).toEqual({ kind: '確かめている' })
  })

  it('届いた不備が無ければ満たしている、あれば読める文で並ぶ', () => {
    expect(checkView(newDraft(), false, [], POOL)).toEqual({ kind: '満たしている' })
    // 総合ルール 第3部 第1章 3-1（ADR-0006）
    expect(checkView(newDraft(), false, [{ kind: '枚数不足', count: 58, minimum: 60 }], POOL)).toEqual({
      kind: '満たしていない',
      lines: ['あと 2 枚足りません（60 枚以上）'],
    })
  })

  /** サーバは断るだけで、何が足りないかは分からない。何をすればよいかは文で伝える。 */
  it('使えないカードが入っていれば、確かめられない', () => {
    const draft = withCard(newDraft(), 'どこにもない')

    expect(checkView(draft, false, [], POOL)).toEqual({
      kind: '確かめられない',
      reason: '使えなくなったカードが 1 枚入っています。下の一覧の「抜く」で外すまで、規定を確かめることも保存することもできません',
    })
  })

  it('使えないカードの枚数は、重複した識別子もそれぞれ数える', () => {
    const draft = { ...newDraft(), cards: ['どこにもない', 'どこにもない', 'い'] }

    expect(checkView(draft, false, [], POOL)).toEqual({
      kind: '確かめられない',
      reason: '使えなくなったカードが 2 枚入っています。下の一覧の「抜く」で外すまで、規定を確かめることも保存することもできません',
    })
  })

  it('不備はそれぞれ読める文になる', () => {
    // 総合ルール 第3部 第1章 3-1（ADR-0006）
    expect(violationLine({ kind: '同名の入れすぎ', name: 'テスト・戦士', count: 5, maximum: 4 })).toBe(
      '「テスト・戦士」が 5 枚入っています（4 枚まで）',
    )
    // 総合ルール 第2部 第7章 2（ADR-0006）
    expect(violationLine({ kind: 'スターアイコンの入れすぎ', stars: 16, maximum: 15 })).toBe(
      'スターアイコンが 16 個あります（15 個まで）',
    )
    // フロアルール Version 1.12 第2部 第1章 1-1（ADR-0023）
    expect(violationLine({ kind: '禁止／制限の入れすぎ', name: 'テスト・戦士', count: 1, maximum: 0 })).toBe(
      '禁止カード「テスト・戦士」が入っています',
    )
    expect(violationLine({ kind: '禁止／制限の入れすぎ', name: 'テスト・戦士', count: 2, maximum: 1 })).toBe(
      '制限カード「テスト・戦士」が 2 枚入っています（1 枚まで）',
    )
  })
})

describe('並べる', () => {
  /** #193。種別 → 色 → レベル → 名前。識別子は使わない（ADR-0021）。 */
  it('プールは、種別・色・レベル・名前の順に並ぶ', () => {
    expect(poolRows(POOL, newDraft()).map((row) => row.face.name)).toEqual([
      'テスト・赤のユニットLv1',
      'テスト・赤のユニットLv2',
      'テスト・青のユニット',
      'テスト・無色のユニット',
      'テスト・無色のストラテジー',
    ])
  })

  it('色を 2 つ持つカードは、持っている色を順に比べる', () => {
    const red = unitFace('テスト・あ', { colors: ['赤'] })
    const redBlack = unitFace('テスト・あ', { colors: ['赤', '黒'] })
    const black = unitFace('テスト・あ', { colors: ['黒'] })

    expect([black, redBlack, red].sort(comparePrinted)).toEqual([red, redBlack, black])
  })

  it('プールの行には、デッキに入れている枚数が付く', () => {
    const rows = poolRows(POOL, draftOf(OWNED))

    expect(rows.find((row) => row.key === 'い')?.count).toBe(2)
    expect(rows.find((row) => row.key === 'き')?.count).toBe(0)
  })

  it('デッキには入っているカードだけが、プールと同じ順に並ぶ', () => {
    const draft = { ...newDraft(), cards: ['き', 'い', 'き'] }

    expect(
      deckRows(POOL, draft).map((row) => ({
        kind: row.kind,
        key: row.key,
        name: row.kind === '使える' ? row.face.name : undefined,
        count: row.count,
      })),
    ).toEqual([
      { kind: '使える', key: 'い', name: 'テスト・赤のユニットLv1', count: 1 },
      { kind: '使える', key: 'き', name: 'テスト・無色のストラテジー', count: 2 },
    ])
  })

  /** ADR-0021。取り下げられたカードを含むデッキは、消さない。 */
  it('プールに無いカードは、使えないカードとして最後に並ぶ', () => {
    const draft = { ...newDraft(), cards: ['どこにもない', 'い'] }

    expect(deckRows(POOL, draft).map((row) => row.kind)).toEqual(['使える', '使えない'])
  })
})

describe('内訳（ADR-0028）', () => {
  // い：赤Lv1、う：赤Lv2、え：青Lv1、き：無色Lv0
  const draft = { ...newDraft(), cards: ['い', 'い', 'う', 'え', 'き'] }

  it('レベルの段ごとに、色別の枚数を積み上げる。無色は黒とは別に数える', () => {
    const bars = levelBreakdownOf(POOL, draft)

    expect(bars.find((bar) => bar.label === '2-')).toEqual({
      label: '2-',
      total: 5,
      byColor: [
        { color: '赤', count: 3 },
        { color: '黒', count: 0 },
        { color: '青', count: 1 },
        { color: '白', count: 0 },
        { color: '緑', count: 0 },
        { color: '無色', count: 1 },
      ],
    })
    expect(bars.filter((bar) => bar.label !== '2-').every((bar) => bar.total === 0)).toBe(true)
  })

  it('段は「2-」「3」〜「6」「7+」。レベル0は「2-」、7と8は「7+」に入る', () => {
    const levels: WirePoolCard[] = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((level) => ({
      key: `Lv${level}`,
      face: unitFace(`テスト・Lv${level}`, { level }),
      expansions: [],
    }))
    const everyLevel = { ...newDraft(), cards: levels.map((card) => card.key) }

    expect(levelBreakdownOf(levels, everyLevel).map((bar) => [bar.label, bar.total])).toEqual([
      ['2-', 3],
      ['3', 1],
      ['4', 1],
      ['5', 1],
      ['6', 1],
      ['7+', 2],
    ])
  })

  it('使えないカードは数えない', () => {
    const withUnusable = { ...newDraft(), cards: ['どこにもない'] }

    expect(levelBreakdownOf(POOL, withUnusable).every((bar) => bar.total === 0)).toBe(true)
    expect(typeCountsOf(POOL, withUnusable).every((row) => row.count === 0)).toBe(true)
    expect(starTotalOf(POOL, withUnusable)).toBe(0)
  })

  it('種別ごとの枚数を数える。プールに無い種別も0枚で出す', () => {
    expect(typeCountsOf(POOL, draft)).toEqual([
      { type: 'ユニット', count: 4 },
      { type: 'ストラテジー', count: 1 },
      { type: 'トラップ', count: 0 },
      { type: '超必殺ストラテジー！', count: 0 },
    ])
  })

  it('スターの合計を数える。リバーススターは含めない', () => {
    const starred: WirePoolCard[] = [
      { key: 'す', face: unitFace('テスト・スター持ち', { stars: 2 }), expansions: [] },
      { key: 'り', face: unitFace('テスト・リバーススター持ち', { reverseStars: 1 }), expansions: [] },
    ]
    const withStars = { ...newDraft(), cards: ['す', 'す', 'り'] }

    expect(starTotalOf(starred, withStars)).toBe(4)
  })
})

describe('自動ラベル（ADR-0028）', () => {
  it('入っていなければ何も付かない', () => {
    expect(autoLabelsOf(POOL, newDraft(), undefined)).toEqual([])
  })

  /** しきい値は仮の値（平均レベル 3.6 以下）。 */
  it('平均レベルが低ければアグロ', () => {
    const draft = { ...newDraft(), cards: ['い', 'い'] } // 赤Lv1 のみ、平均1

    expect(autoLabelsOf(POOL, draft, undefined)).toContainEqual({ group: 'アーキタイプ', label: 'アグロ' })
  })

  /** しきい値は仮の値（平均レベル 4.6 以上）。 */
  it('平均レベルが高ければコントロール', () => {
    const highLevel: WirePoolCard[] = [{ key: 'た', face: unitFace('テスト・高レベル', { level: 8 }), expansions: [] }]
    const draft = { ...newDraft(), cards: ['た'] }

    expect(autoLabelsOf(highLevel, draft, undefined)).toContainEqual({ group: 'アーキタイプ', label: 'コントロール' })
  })

  /** しきい値ちょうどは、アグロ・コントロールの側に入る（以下・以上）。 */
  it('平均がちょうど 3.6 ならアグロ、ちょうど 4.6 ならコントロール', () => {
    const levels: WirePoolCard[] = [3, 4, 5].map((level) => ({
      key: `Lv${level}`,
      face: unitFace(`テスト・Lv${level}`, { level }),
      expansions: [],
    }))
    // 3・3・4・4・4 → 18 / 5 = 3.6、4・4・5・5・5 → 23 / 5 = 4.6
    const aggro = { ...newDraft(), cards: ['Lv3', 'Lv3', 'Lv4', 'Lv4', 'Lv4'] }
    const control = { ...newDraft(), cards: ['Lv4', 'Lv4', 'Lv5', 'Lv5', 'Lv5'] }

    expect(autoLabelsOf(levels, aggro, undefined)).toContainEqual({ group: 'アーキタイプ', label: 'アグロ' })
    expect(autoLabelsOf(levels, control, undefined)).toContainEqual({ group: 'アーキタイプ', label: 'コントロール' })
  })

  it('使えないカードだけのデッキには、何も付かない', () => {
    expect(autoLabelsOf(POOL, { ...newDraft(), cards: ['どこにもない', 'どこにもない'] }, undefined)).toEqual([])
  })

  it('使えないカードが混ざっていれば、それを除いて数える', () => {
    // 使えるのは赤Lv1 の い だけ。使えないカードを数えると平均も色も変わりうる。
    const mixed = { ...newDraft(), cards: ['い', 'どこにもない', 'どこにもない'] }

    expect(autoLabelsOf(POOL, mixed, undefined)).toEqual([
      { group: 'アーキタイプ', label: 'アグロ' },
      { group: '色の構成', label: '赤単' },
    ])
  })

  it('間なら、ミッドレンジ', () => {
    const midLevel: WirePoolCard[] = [{ key: 'た', face: unitFace('テスト・中間レベル', { level: 4 }), expansions: [] }]
    const draft = { ...newDraft(), cards: ['た'] }

    expect(autoLabelsOf(midLevel, draft, undefined)).toContainEqual({ group: 'アーキタイプ', label: 'ミッドレンジ' })
  })

  it('持ち主がアーキタイプを選んでいれば、自動のアーキタイプは付かない', () => {
    const draft = { ...newDraft(), cards: ['い'] }

    expect(autoLabelsOf(POOL, draft, 'コンボ')).not.toContainEqual(expect.objectContaining({ group: 'アーキタイプ' }))
  })

  it('単色なら「◯単」、2色ならその2色、3色以上なら「多色」', () => {
    const single = { ...newDraft(), cards: ['い', 'う'] } // 赤のみ
    const double = { ...newDraft(), cards: ['い', 'え'] } // 赤・青
    const triple: WirePoolCard[] = [
      ...POOL,
      { key: 'ら', face: unitFace('テスト・緑', { colors: ['緑'] }), expansions: [] },
    ]
    const tripleDraft = { ...newDraft(), cards: ['い', 'え', 'ら'] }

    expect(autoLabelsOf(POOL, single, undefined)).toContainEqual({ group: '色の構成', label: '赤単' })
    expect(autoLabelsOf(POOL, double, undefined)).toContainEqual({ group: '色の構成', label: '赤青' })
    expect(autoLabelsOf(triple, tripleDraft, undefined)).toContainEqual({ group: '色の構成', label: '多色' })
  })

  it('無色は色の構成に含めない', () => {
    const redAndColorless = { ...newDraft(), cards: ['い', 'き', 'あ'] } // 赤・無色・無色

    expect(autoLabelsOf(POOL, redAndColorless, undefined)).toContainEqual({ group: '色の構成', label: '赤単' })
  })

  it('無色のカードだけなら、色の構成は付かない', () => {
    const colorless = { ...newDraft(), cards: ['き', 'あ'] }

    expect(autoLabelsOf(POOL, colorless, undefined)).not.toContainEqual(expect.objectContaining({ group: '色の構成' }))
  })
})

describe('詳しく出す', () => {
  it('印刷されている項目と、テキストが出る', () => {
    const face = unitFace('テスト・詳しく', { level: 3, colors: ['緑'], stars: 1, attributes: ['テスト属性'], text: ['一行め'] })

    expect(cardDetailOf([{ key: 'く', face, expansions: [] }], 'く')).toEqual({
      name: 'テスト・詳しく',
      face,
      rows: [
        { label: '種別', value: 'ユニット' },
        { label: 'レベル', value: '3' },
        { label: '色', value: '緑' },
        { label: 'ＢＰ', value: '1000' },
        { label: 'ＳＰ', value: '1000' },
        { label: 'ムーブアイコン', value: '上' },
        { label: 'スター', value: '1' },
        { label: '属性', value: 'テスト属性' },
      ],
      text: ['一行め'],
    })
  })

  it('属性が複数あれば「 | 」でつなぐ', () => {
    const face = unitFace('テスト・属性いろいろ', { attributes: ['属性ア', '属性イ'] })

    expect(printedDetailsOf(face)).toContainEqual({ label: '属性', value: '属性ア | 属性イ' })
  })

  it('キーワードがあれば出る', () => {
    const face = unitFace('テスト・キーワード持ち', { keywords: ['夢', '希望'] })

    expect(printedDetailsOf(face)).toContainEqual({ label: 'キーワード', value: '夢・希望' })
  })

  /** 画面は勝手に配られるが、サーバは配り直すまで古いまま残る。古いサーバは `keywords` を送らない。 */
  it('キーワードが届かなくても、キーワードの行を出さずに済ませる', () => {
    const { keywords: _, ...face } = unitFace('テスト・古いサーバ')

    expect(printedDetailsOf(face as WireCardFace).map((row) => row.label)).not.toContain('キーワード')
  })

  /** 収録（ADR-0028）。エキスパンションは名前で出す（#230が済むまでコードは無い）。 */
  it('収録しているエキスパンションが名前で出る', () => {
    const face = unitFace('テスト・収録あり')

    expect(printedDetailsOf(face, ['テストの第1弾', 'テストの第2弾'])).toContainEqual({
      label: '収録',
      value: 'テストの第1弾・テストの第2弾',
    })
  })

  it('呼ぶ側がエキスパンションを渡さなければ、収録の行は出ない（公開ページなど）', () => {
    const labels = printedDetailsOf(unitFace('テスト・渡さない')).map((row) => row.label)

    expect(labels).not.toContain('収録')
  })

  /** 盤面に置かれて初めて決まるもの（支配者・向き・ダメージ）は、プールのカードには無い。 */
  it('盤面に置かれて決まるものは出ない', () => {
    const labels = printedDetailsOf(strategyFace('テスト・ストラテジー')).map((row) => row.label)

    expect(labels).toEqual(['種別', 'レベル', '色'])
  })

  it('プールに無いカードは出せない', () => {
    expect(cardDetailOf(POOL, 'どこにもない')).toBeUndefined()
  })
})

describe('押す前に尋ねる', () => {
  it('削除するときは、どのデッキを削除するかと、戻せないことを尋ねる', () => {
    expect(confirmView({ kind: 'デッキを消す', deck: 'デッキ1', name: 'くみかけ' })).toEqual({
      message: '「くみかけ」を削除しますか？ 削除したデッキは戻せません',
      confirmLabel: '削除する',
      cancelLabel: 'やめる',
    })
  })

  /** 「はい」「いいえ」では、文を読み返さないとどちらを押せばよいかが分からない。 */
  it('保存していない変更があるときは、押すと何が起きるかをボタンに書く', () => {
    const view = confirmView({ kind: '変更を捨てる' })

    expect([view.cancelLabel, view.confirmLabel]).toEqual(['編集を続ける', '保存せずに戻る'])
  })

  it('初めは何も尋ねていない', () => {
    expect(closedBuilder().confirming).toBeUndefined()
  })

  /** ADR-0022。取り消した共有は取り消されたまま残り、復活しない。 */
  it('共有を取り消すときは、コピーしたデッキは残ることを添える', () => {
    const view = confirmView({ kind: '共有を取り消す', share: '共有1', name: 'わたしのレシピ' })

    expect(view.message).toContain('コピーした人のデッキは残ります')
  })
})

describe('新しく作る', () => {
  it('名前が付いた、空のデッキから始まる', () => {
    expect(newDraft()).toEqual({ deck: undefined, name: NEW_DECK_NAME, description: '', cards: [] })
  })
})

/** ADR-0021、#194。席に着く時に選ぶのは自分のデッキである。 */
describe('席に着く時に選ぶデッキ', () => {
  function owned(id: string, name: string): WireOwnedDeck {
    return { id, name, description: '', cards: [] }
  }

  const MINE = [owned('1', 'ひとつめ'), owned('2', 'ふたつめ')]

  const PRESETS = [{ id: '既製1', name: 'トライアルデッキ' }]

  const SHOWN = [
    { id: '1', name: 'ひとつめ' },
    { id: '2', name: 'ふたつめ' },
  ]

  /** 既製デッキはコピーしてから使う（ADR-0022）ので、ここには並ばない。 */
  it('自分のデッキが、届いた順に名前付きで並ぶ', () => {
    expect(seatableDecks(MINE, PRESETS)).toEqual(SHOWN)
  })

  /**
   * 届かないのは、デッキを持てない立て方だからである（ADR-0021）。**そこで何も並べないと、手元で
   * 2 人ぶん試す時に両方の席が同じデッキに固定される。**
   */
  it('自分のデッキが届かない立て方では、既製デッキが並ぶ', () => {
    expect(seatableDecks(undefined, PRESETS)).toEqual(PRESETS)
  })

  it('自分で選んだものがあれば、それを選んだ状態にする', () => {
    expect(seatedChoice(SHOWN, '2', '1')).toBe('2')
  })

  /** どれが既定かを決めるのはサーバである（ADR-0010）。 */
  it('選んでいなければ、サーバが決めた既定を選んだ状態にする', () => {
    expect(seatedChoice(SHOWN, undefined, '1')).toBe('1')
  })

  /**
   * デッキを消してもロビーは届き直すが、**届くまでの間に消えたものを選んだ状態にしない。**
   * 座れないものが選ばれて見える。
   */
  it('選んでいたデッキが消えていれば、何も選ばない', () => {
    expect(seatedChoice(SHOWN, '消えたデッキ', '消えた既定')).toBeUndefined()
  })

  it('既定が消えていても、自分で選んだものが残っていればそれを選ぶ', () => {
    expect(seatedChoice(SHOWN, '1', '消えた既定')).toBe('1')
  })
})

describe('デッキ一覧（ADR-0028）', () => {
  // い：赤Lv1、う：赤Lv2、き：無色Lv0
  const decks: readonly WireOwnedDeck[] = [
    { id: 'A', name: 'デッキA', description: '', cards: ['い', 'い', 'う'] },
    { id: 'B', name: 'デッキB', description: '', cards: ['い', 'き'] },
    { id: 'C', name: '空のデッキ', description: '', cards: [] },
    { id: 'D', name: '使えないデッキ', description: '', cards: ['どこにもない'] },
    { id: 'E', name: '無色のデッキ', description: '', cards: ['き', 'き'] },
  ]

  it('顔は一番多く入れたカード。同じ枚数ならレベルの高いもの', () => {
    const rows = ownedDeckRows(POOL, decks)

    expect(rows.find((row) => row.id === 'A')?.face?.name).toBe('テスト・赤のユニットLv1')
    // B は い(Lv1)・き(Lv0) が同数。レベルの高い い が顔になる。
    expect(rows.find((row) => row.id === 'B')?.face?.name).toBe('テスト・赤のユニットLv1')
    expect(rows.find((row) => row.id === 'C')?.face).toBeUndefined()
    expect(rows.find((row) => row.id === 'D')?.face).toBeUndefined()
  })

  it('色ごとの枚数を数える。0 枚の色は持たない。使えないカードは数えない', () => {
    const rows = ownedDeckRows(POOL, decks)

    expect(rows.find((row) => row.id === 'A')?.colorCounts).toEqual([{ color: '赤', count: 3 }])
    expect(rows.find((row) => row.id === 'C')?.colorCounts).toEqual([])
    expect(rows.find((row) => row.id === 'D')?.colorCounts).toEqual([])
  })

  it('無色は黒とは別に数える', () => {
    const rows = ownedDeckRows(POOL, decks)

    expect(rows.find((row) => row.id === 'B')?.colorCounts).toEqual([
      { color: '赤', count: 1 },
      { color: '無色', count: 1 },
    ])
  })

  it('名前で探せる', () => {
    const rows = ownedDeckRows(POOL, decks)

    expect(filterOwnedDeckRows(rows, 'デッキA', [], []).map((row) => row.id)).toEqual(['A'])
  })

  it('探す文字の前後の空白は無視する', () => {
    const rows = ownedDeckRows(POOL, decks)

    expect(filterOwnedDeckRows(rows, '  デッキA　', [], []).map((row) => row.id)).toEqual(['A'])
    expect(filterOwnedDeckRows(rows, '   ', [], []).map((row) => row.id)).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('入っている色で絞り込める', () => {
    const rows = ownedDeckRows(POOL, decks)

    expect(filterOwnedDeckRows(rows, '', ['赤'], []).map((row) => row.id)).toEqual(['A', 'B'])
  })

  it('無色だけのデッキは、黒で絞り込んでも残らない', () => {
    const rows = ownedDeckRows(POOL, decks)

    expect(filterOwnedDeckRows(rows, '', ['黒'], []).map((row) => row.id)).toEqual([])
    expect(filterOwnedDeckRows(rows, '', ['無色'], []).map((row) => row.id)).toEqual(['B', 'E'])
  })

  it('自動のラベルで絞り込める', () => {
    const rows = ownedDeckRows(POOL, decks)

    // B は赤と無色なので、色の構成は赤単になる。
    expect(filterOwnedDeckRows(rows, '', [], ['赤単']).map((row) => row.id)).toEqual(['A', 'B'])
  })

  it('選べる色・ラベルは、実際にどれかのデッキが持つものだけ', () => {
    const rows = ownedDeckRows(POOL, decks)

    expect(deckColorChoices(rows)).toEqual(['赤', '無色'])
    expect(deckLabelChoices(rows).map((label) => label.label)).toContain('赤単')
  })

  it('選べるラベルは、いくつのデッキに付いていても 1 つずつ並べる', () => {
    const rows = ownedDeckRows(POOL, decks)
    const labels = deckLabelChoices(rows).map((label) => label.label)

    expect(labels.filter((label) => label === '赤単')).toHaveLength(1)
    expect(labels.filter((label) => label === 'アグロ')).toHaveLength(1)
  })
})
