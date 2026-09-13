import { describe, expect, it } from 'vitest'
import type { WireCardFace, WireOwnedDeck, WirePoolCard } from '@revolution/engine'
import {
  NEW_DECK_NAME,
  applyToBuilder,
  cardDetailOf,
  checkView,
  closedBuilder,
  comparePrinted,
  confirmView,
  deckRows,
  draftOf,
  draftToSave,
  hasUnsavedChanges,
  newDraft,
  poolRows,
  printedDetailsOf,
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

  it('新しく作ったデッキは、保存した返事で識別子が付き、次からは上書きになる', () => {
    const sent = withCard(newDraft(), 'い')
    const waiting: Builder = { ...editing(sent), waiting: { kind: '保存', sent } }

    const saved = applyToBuilder(waiting, { kind: 'デッキを保存した', deck: 'あたらしい', violations: [] })

    expect(saved.draft?.deck).toBe('あたらしい')
    expect(saved.waiting.kind).toBe('保存したデッキ')
  })

  /** サーバは名前の前後の空白を落とす。合わせないと、保存した直後から変更があるように見える。 */
  it('送った後に手を加えていなければ、残ったものに合わせる', () => {
    const sent = { ...draftOf(OWNED), name: '  くみかけ  ' }
    const waiting: Builder = { ...editing(sent), waiting: { kind: '保存', sent } }

    const builder = [
      { kind: 'デッキを保存した', deck: OWNED.id, violations: [] } as const,
      { kind: '自分のデッキ', decks: [OWNED] } as const,
    ].reduce(applyToBuilder, waiting)

    expect(builder.draft).toEqual(draftOf(OWNED))
    expect(builder.waiting).toEqual({ kind: '無し' })
  })

  it('送った後に手を加えていれば、組みかけはそのまま残る', () => {
    const sent = draftOf(OWNED)
    const saved = applyToBuilder(
      { ...editing(sent), waiting: { kind: '保存', sent } },
      { kind: 'デッキを保存した', deck: OWNED.id, violations: [] },
    )
    const changed = { ...saved, draft: withCard(sent, 'う') }

    const builder = applyToBuilder(changed, { kind: '自分のデッキ', decks: [OWNED] })

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

describe('既製デッキをコピーする', () => {
  /** ADR-0022。コピーしたものは、そのまま組み始められる。 */
  it('コピーしたデッキが届いたら、そのデッキを組み始める', () => {
    const waiting: Builder = { ...closedBuilder(), screen: 'デッキを選ぶ', waiting: { kind: 'コピー' } }

    const builder = [
      { kind: 'デッキを保存した', deck: OWNED.id, violations: [] } as const,
      { kind: '自分のデッキ', decks: [OWNED] } as const,
    ].reduce(applyToBuilder, waiting)

    expect(builder.screen).toBe('デッキを組む')
    expect(builder.draft).toEqual(draftOf(OWNED))
    expect(builder.waiting).toEqual({ kind: '無し' })
  })

  it('何も待っていなければ、自分のデッキが届いても組むところは変わらない', () => {
    const listing: Builder = { ...closedBuilder(), screen: 'デッキを選ぶ' }

    expect(applyToBuilder(listing, { kind: '自分のデッキ', decks: [OWNED] })).toBe(listing)
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

  /** サーバは断るだけで、何が足りないかは分からない。 */
  it('使えないカードが入っていれば、確かめられない', () => {
    const draft = withCard(newDraft(), 'どこにもない')

    expect(checkView(draft, false, [], POOL).kind).toBe('確かめられない')
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
    expect(poolRows(POOL, newDraft()).map((row) => row.name)).toEqual([
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

    expect(deckRows(POOL, draft)).toEqual([
      { kind: '使える', key: 'い', name: 'テスト・赤のユニットLv1', summary: 'Lv1 赤 BP1000 SP1000', count: 1 },
      { kind: '使える', key: 'き', name: 'テスト・無色のストラテジー', summary: 'Lv0 無色 ストラテジー', count: 2 },
    ])
  })

  /** ADR-0021。取り下げられたカードを含むデッキは、消さない。 */
  it('プールに無いカードは、使えないカードとして最後に並ぶ', () => {
    const draft = { ...newDraft(), cards: ['どこにもない', 'い'] }

    expect(deckRows(POOL, draft).map((row) => row.kind)).toEqual(['使える', '使えない'])
  })
})

describe('詳しく出す', () => {
  it('印刷されている項目と、テキストが出る', () => {
    const face = unitFace('テスト・詳しく', { level: 3, colors: ['緑'], stars: 1, attributes: ['テスト属性'], text: ['一行め'] })

    expect(cardDetailOf([{ key: 'く', face, expansions: [] }], 'く')).toEqual({
      name: 'テスト・詳しく',
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
})

describe('新しく作る', () => {
  it('名前が付いた、空のデッキから始まる', () => {
    expect(newDraft()).toEqual({ deck: undefined, name: NEW_DECK_NAME, description: '', cards: [] })
  })
})
