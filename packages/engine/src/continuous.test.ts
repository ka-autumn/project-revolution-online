import { describe, expect, it } from 'vitest'
// 継続効果を適用した後のデータを直に読むために使う。効果の外からデータを読む必要が
// まだ無いので、engine の公開 API には出していない。
import { continuousData } from './continuous.js'
// ダメージを与えたり山札を積んだりするためだけに使う。engine の中から盤面を組み替える
// ための関数であり、公開する API ではない（`rule-effect.test.ts` と同じ）。
import { dealDamage, putInZone } from './duel.js'
import {
  PLAYERS,
  alsoTreatedAs,
  attributeAdding,
  bpModification,
  bpModifying,
  bpOf,
  bpPlus,
  cardsIn,
  cardsOn,
  defineUnit,
  emptyDuelState,
  dream,
  friendship,
  hasFriendship,
  hasMakerSymbol,
  instantiate,
  passPriority,
  playCard,
  putOnSquare,
  resolveEffect,
} from './index.js'
import type { Attribute, Chooser, DuelState, Player, ResolutionVia, Square, UnitCard } from './index.js'

// 検証したいルールだけを持つ架空のテストカード（ADR-0002）。
const vanilla = defineUnit({ name: 'テスト・バニラ', level: 1, colors: ['赤'], bp: 1000, sp: 1000 })

/** ＢＰが大きいユニット。修整の前後でバトルの結果が変わる相手として使う。 */
const tough = defineUnit({ name: 'テスト・大ＢＰ', level: 1, colors: ['赤'], bp: 2000, sp: 1000 })

/** 「友情－1000」を持つユニット（総合ルール 第5部 第5章）。 */
const friendly = defineUnit({
  name: 'テスト・友情',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [friendship(1000)],
})

/** 「すべての味方のＢＰを＋2000」。自分自身も味方に含まれる。 */
const boosting = defineUnit({
  name: 'テスト・味方強化',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [bpModifying((duel) => duel.allies().map((ally) => bpPlus(ally, 2000)))],
})

/** 「テスト属性」を持つユニット。 */
const attributed = defineUnit({
  name: 'テスト・属性あり',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  attributes: ['テスト属性'],
})

/** 別の属性を持つユニット。加えても書かれている属性が残ることを見るために使う。 */
const otherwiseAttributed = defineUnit({
  name: 'テスト・別の属性あり',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  attributes: ['別のテスト属性'],
})

/** 「すべての味方は『テスト属性』としても扱う」。 */
const granting = defineUnit({
  name: 'テスト・属性を加える',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [attributeAdding((duel) => duel.allies().map((ally) => alsoTreatedAs(ally, 'テスト属性')))],
})

/** 「『テスト属性』の味方のＢＰを＋2000」。属性で対象を絞る修整。 */
const boostingAttributed = defineUnit({
  name: 'テスト・属性で強化',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [
    bpModifying((duel) =>
      duel
        .allies()
        .filter((ally) => ally.card.attributes.includes('テスト属性'))
        .map((ally) => bpPlus(ally, 2000)),
    ),
  ],
})

/** 「すべての敵のＢＰを－1000」。 */
const weakening = defineUnit({
  name: 'テスト・敵弱体',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [bpModifying((duel) => duel.enemies().map((enemy) => bpPlus(enemy, -1000)))],
})

/** 先攻から見た味方エリアの 3 マスと、その 1 つ上（中央エリア）のマス。 */
const homeLeft: Square = { row: 0, column: 0 }
const homeCenter: Square = { row: 0, column: 1 }
const homeRight: Square = { row: 0, column: 2 }
const centerCenter: Square = { row: 1, column: 1 }
const centerLeft: Square = { row: 1, column: 0 }

const chooseFirst: Chooser = (candidates) => candidates[0]

/** このファイルのテストは経路を見ていない（#104）。 */
const VIA: ResolutionVia = '誘発'

function pass(state: DuelState): DuelState {
  return passPriority(state, chooseFirst)
}

type Placement = readonly [Square, string, UnitCard, Player?]

/**
 * 山札を積んだ、カードの置かれていない盤面。山札が 0 枚以下のプレイヤーは次に優先権が
 * 発生した時に敗北する（総合ルール 第3部 第3章 2）ので、優先権を動かすテストでは積んでおく。
 */
function stockedDuelState(): DuelState {
  return PLAYERS.reduce(
    (state, player) =>
      putInZone(
        state,
        player,
        '山札',
        Array.from({ length: 10 }, (_, index) =>
          instantiate({ id: `${player}の山札${index}`, card: vanilla, owner: player }),
        ),
      ),
    emptyDuelState(),
  )
}

/** アクティブプレイヤー（先攻）が行動できる、第 1 ターンのメインフェイズの盤面。 */
function mainPhase(): DuelState {
  let current = stockedDuelState()
  while (current.turn.phase !== 'メインフェイズ') current = pass(current)
  // フェイズの始めには非アクティブプレイヤーに優先権が発生している（総合ルール 第3部 第8章 1）。
  return pass(current)
}

function boardOf(...placements: readonly Placement[]): DuelState {
  return placements.reduce(
    (state, [square, id, card, owner]) =>
      putOnSquare(state, square, instantiate({ id, card, owner: owner ?? '先攻' })),
    stockedDuelState(),
  )
}

/** そのユニットのＢＰ。継続効果による修整を集めてから読む。 */
function bpOn(state: DuelState, id: string, card: UnitCard): number {
  return bpOf(card, bpModification(state)(id))
}

/** そのユニットがいま持っている属性。カードに書かれているものと、継続効果で加わったもの。 */
function attributesOn(state: DuelState, id: string, card: UnitCard): readonly Attribute[] {
  return continuousData(state)(id, card).attributes
}

const idsOf = (cards: readonly { readonly id: string }[]) => cards.map((card) => card.id)

// 総合ルール 第4部 第12章 4-1（ADR-0006）
describe('常在型能力が生み出した継続効果', () => {
  // 同 4-1 の【例】: 「他の味方のＢＰを＋1000」の効果は、スクエアにある間ずっと継続する。
  it('能力を持つカードがスクエアにある間、ＢＰを修整する', () => {
    const board = boardOf([homeLeft, '強化するユニット', boosting], [homeRight, '味方', vanilla])

    expect(bpOn(board, '味方', vanilla)).toBe(3000)
  })

  it('能力を持つカードがスクエアに無ければ、修整しない', () => {
    const board = boardOf([homeRight, '味方', vanilla])

    expect(bpOn(board, '味方', vanilla)).toBe(1000)
  })

  it('修整を受けていないユニットのＢＰは、カードに書かれている数字のままである', () => {
    const board = boardOf([homeLeft, '強化するユニット', boosting], [homeRight, '敵', vanilla, '後攻'])

    expect(bpOn(board, '敵', vanilla)).toBe(1000)
  })

  it('複数の継続効果が同じユニットに影響する場合、どちらも適用される', () => {
    const board = boardOf(
      [homeLeft, '強化するユニット', boosting],
      [homeCenter, '弱体化するユニット', weakening, '後攻'],
      [homeRight, '味方', vanilla],
    )

    // 書かれている 1000 に、味方からの＋2000 と敵からの−1000 の両方がかかる。
    expect(bpOn(board, '味方', vanilla)).toBe(2000)
  })
})

// 総合ルール 第4部 第12章 4-2 の【例】（ADR-0006）
describe('常在型能力が生み出した継続効果と、後から置かれたカード', () => {
  // 同 4-2 の【例】: 「他の味方のＢＰを＋1000」の効果は、そのカードがスクエアに置かれて
  // 効果が発生した後で、スクエアに置かれた味方にも影響を与える。
  it('継続効果が発生した後にスクエアに置かれたユニットにも影響する', () => {
    const later = boardOf([homeLeft, '強化するユニット', boosting], [homeRight, '味方', vanilla])
    const earlier = boardOf([homeRight, '味方', vanilla], [homeLeft, '強化するユニット', boosting])

    expect(bpOn(later, '味方', vanilla)).toBe(3000)
    expect(bpOn(earlier, '味方', vanilla)).toBe(bpOn(later, '味方', vanilla))
  })
})

// 総合ルール 第4部 第12章 2 の【例】（ADR-0006）
describe('データを変える継続効果がある時にプレイされたユニット', () => {
  // 同 2 の【例】: 「他の味方のＢＰを＋1000」を持つカードがスクエアにある状況でユニットを
  // プレイすると、そのユニットは修整された後のＢＰのユニットとしてスクエアに置かれる。
  it('修整された後のＢＰで置かれる', () => {
    const boosted = putOnSquare(
      mainPhase(),
      homeLeft,
      instantiate({ id: '強化するユニット', card: boosting, owner: '先攻' }),
    )
    const inHand = putInZone(boosted, '先攻', '手札', [
      instantiate({ id: 'プレイされたユニット', card: vanilla, owner: '先攻' }),
    ])
    const ready = putInZone(inHand, '先攻', 'エネルギーゾーン', [
      instantiate({ id: '赤エネ', card: vanilla, owner: '先攻' }),
    ])

    const outcome = playCard(ready, { card: 'プレイされたユニット', square: homeRight }, chooseFirst)
    if (outcome.kind !== '行った') throw new Error(`行えなかった: ${outcome.violation}`)

    expect(bpOn(outcome.state, 'プレイされたユニット', vanilla)).toBe(3000)
  })
})

// 総合ルール 第2部 第13章 4（ADR-0006）
describe('継続効果によって加わる属性', () => {
  it('カードに書かれている属性はすべて残る', () => {
    const board = boardOf(
      [homeLeft, '属性を加えるユニット', granting],
      [homeRight, '味方', otherwiseAttributed],
    )

    expect(attributesOn(board, '味方', otherwiseAttributed)).toEqual(['別のテスト属性', 'テスト属性'])
  })

  it('すでに書かれている属性を加えても、持っている属性は変わらない', () => {
    const board = boardOf([homeLeft, '属性を加えるユニット', granting], [homeRight, '味方', attributed])

    expect(attributesOn(board, '味方', attributed)).toEqual(['テスト属性'])
  })

  // 総合ルール 第4部 第12章 4-1。
  it('加える能力を持つカードがスクエアに無ければ、加わらない', () => {
    const board = boardOf([homeRight, '味方', otherwiseAttributed])

    expect(attributesOn(board, '味方', otherwiseAttributed)).toEqual(['別のテスト属性'])
  })
})

/** メーカーシンボル「テスト社」を持つユニット。 */
const madeByTestCompany = defineUnit({
  name: 'テスト・テスト社製',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  makerSymbols: ['テスト社'],
})

/** 「テスト社」と「テスト社・別名」の両方を並びに書いたユニット。同じものとして扱うカードの書き方。 */
const madeByTestCompanyOrItsAlias = defineUnit({
  name: 'テスト・テスト社と別名',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  makerSymbols: ['テスト社', 'テスト社・別名'],
})

/** 属性にだけ「テスト社」と同じ綴りを書いたユニット。メーカーシンボルとは別の並びであることを見る。 */
const attributedLikeCompany = defineUnit({
  name: 'テスト・属性が同じ綴り',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  attributes: ['テスト社'],
})

/** 「テスト社」のメーカーシンボルを持つ他の味方のＢＰを＋2000。 */
const boostingMadeByTestCompany = defineUnit({
  name: 'テスト・テスト社製を強化',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [
    bpModifying((duel) =>
      duel
        .allies()
        .filter((ally) => ally.id !== duel.self()?.id && ally.card.makerSymbols.includes('テスト社'))
        .map((ally) => bpPlus(ally, 2000)),
    ),
  ],
})

// 総合ルール 第2部 第13章 1-1・1-1-1（ADR-0006）
describe('メーカーシンボル', () => {
  it('持つかどうかは、書かれた並びに含まれるかで決まる', () => {
    expect(hasMakerSymbol(madeByTestCompany, 'テスト社')).toBe(true)
    expect(hasMakerSymbol(madeByTestCompany, '別のテスト社')).toBe(false)
    expect(hasMakerSymbol(vanilla, 'テスト社')).toBe(false)
  })

  // 総合ルール 第2部 第13章 1-1-1。別名を同じものとして扱うカードは、並びに両方を書く。
  it('別名と同じものとして扱うカードは、どちらのシンボルでも持つと答える', () => {
    expect(hasMakerSymbol(madeByTestCompanyOrItsAlias, 'テスト社')).toBe(true)
    expect(hasMakerSymbol(madeByTestCompanyOrItsAlias, 'テスト社・別名')).toBe(true)
  })

  it('属性の並びとは別で、属性に同じ綴りがあってもメーカーシンボルは持たない', () => {
    expect(hasMakerSymbol(attributedLikeCompany, 'テスト社')).toBe(false)
    expect(attributedLikeCompany.makerSymbols).toEqual([])
    expect(madeByTestCompany.attributes).toEqual([])
  })

  it('メーカーシンボルを持つ味方のＢＰを、他の味方に限って修整できる', () => {
    const board = boardOf(
      [homeLeft, '強化するユニット', boostingMadeByTestCompany],
      [homeCenter, '対象の味方', madeByTestCompany],
      [homeRight, '対象でない味方', vanilla],
      [centerCenter, '属性だけが同じ味方', attributedLikeCompany],
      [centerLeft, '対象の敵', madeByTestCompany, '後攻'],
    )

    expect(bpOn(board, '対象の味方', madeByTestCompany)).toBe(3000)
    expect(bpOn(board, '対象でない味方', vanilla)).toBe(1000)
    expect(bpOn(board, '属性だけが同じ味方', attributedLikeCompany)).toBe(1000)
    expect(bpOn(board, '対象の敵', madeByTestCompany)).toBe(1000)
  })

  it('強化するユニット自身がメーカーシンボルを持っていても、他の味方に限るなら自分は修整されない', () => {
    const selfMade = defineUnit({
      name: 'テスト・テスト社製の強化役',
      level: 1,
      colors: ['赤'],
      bp: 1000,
      sp: 1000,
      makerSymbols: ['テスト社'],
      abilities: boostingMadeByTestCompany.abilities,
    })
    const board = boardOf([homeLeft, '強化するユニット', selfMade])

    expect(bpOn(board, '強化するユニット', selfMade)).toBe(1000)
  })

  it('継続効果を適用した後の姿も、書かれたメーカーシンボルのまま変わらない', () => {
    const board = boardOf(
      [homeLeft, '強化するユニット', boostingMadeByTestCompany],
      [homeCenter, '対象の味方', madeByTestCompany],
    )

    expect(continuousData(board)('対象の味方', madeByTestCompany).makerSymbols).toEqual(['テスト社'])
  })
})

// 総合ルール 第4部 第12章 5-2 の【例】（ADR-0006）
describe('別の種類に属する継続効果の適用の順序', () => {
  // 同 5-2 の【例】: 「他の〈属性〉の味方のＢＰを＋1000」と「あなたのユニットの属性に
  // 〈属性〉を加える」の 2 つがスクエアに置かれた順番に関係なく、両方の影響を受ける
  // ユニットは、まず属性を加えられ、次にＢＰを修整される。
  it('置かれた順番に関係なく、属性を加える継続効果がＢＰを修整する継続効果より先に適用される', () => {
    const 属性が先 = boardOf(
      [homeLeft, '属性を加えるユニット', granting],
      [homeCenter, '属性で強化するユニット', boostingAttributed],
      [homeRight, '味方', vanilla],
    )
    const ＢＰが先 = boardOf(
      [homeCenter, '属性で強化するユニット', boostingAttributed],
      [homeLeft, '属性を加えるユニット', granting],
      [homeRight, '味方', vanilla],
    )

    // 味方はカードに「テスト属性」を持たないが、先に加わるので修整の対象になる。
    expect(bpOn(属性が先, '味方', vanilla)).toBe(3000)
    expect(bpOn(ＢＰが先, '味方', vanilla)).toBe(3000)
  })

  it('属性で絞る修整は、カードに書かれている属性を持つユニットにも効く', () => {
    const board = boardOf([homeCenter, '属性で強化するユニット', boostingAttributed], [homeRight, '味方', attributed])

    expect(bpOn(board, '味方', attributed)).toBe(3000)
  })

  it('属性を持たないユニットは、修整の対象にならない', () => {
    const board = boardOf([homeCenter, '属性で強化するユニット', boostingAttributed], [homeRight, '味方', vanilla])

    expect(bpOn(board, '味方', vanilla)).toBe(1000)
  })
})

// 総合ルール 第4部 第12章 2（ADR-0006）
describe('効果に見せる盤面', () => {
  it('継続効果を適用した後のデータを写す', () => {
    const board = boardOf(
      [homeLeft, '属性を加えるユニット', granting],
      [homeCenter, '属性で強化するユニット', boostingAttributed],
      [homeRight, '味方', vanilla],
    )

    const seen: UnitCard[] = []
    resolveEffect(
      board,
      function* (duel) {
        for (const ally of duel.allies()) if (ally.id === '味方') seen.push(ally.card)
      },
      { controller: '先攻', via: VIA, chooser: chooseFirst },
    )

    expect(seen[0]?.attributes).toEqual(['テスト属性'])
    expect(seen[0]?.bp).toBe(3000)
  })
})

// 総合ルール 第5部 第5章 2（ADR-0006）
describe('「友情－Ｘ」', () => {
  it('上下左右の隣のスクエアにいる味方のＢＰを＋Ｘする', () => {
    const board = boardOf(
      [homeCenter, '友情を持つユニット', friendly],
      [homeLeft, '左隣の味方', vanilla],
      [homeRight, '右隣の味方', vanilla],
      [centerCenter, '上隣の味方', vanilla],
    )

    expect(bpOn(board, '左隣の味方', vanilla)).toBe(2000)
    expect(bpOn(board, '右隣の味方', vanilla)).toBe(2000)
    expect(bpOn(board, '上隣の味方', vanilla)).toBe(2000)
  })

  // 総合ルール 第5部 第5章 3。
  it('斜めに接するスクエアにいる味方には影響しない', () => {
    const board = boardOf([homeCenter, '友情を持つユニット', friendly], [centerLeft, '斜めの味方', vanilla])

    expect(bpOn(board, '斜めの味方', vanilla)).toBe(1000)
  })

  it('隣のスクエアにいても、敵には影響しない', () => {
    const board = boardOf([homeCenter, '友情を持つユニット', friendly], [homeLeft, '左隣の敵', vanilla, '後攻'])

    expect(bpOn(board, '左隣の敵', vanilla)).toBe(1000)
  })

  it('自分自身のＢＰは変わらない', () => {
    const board = boardOf([homeCenter, '友情を持つユニット', friendly], [homeLeft, '左隣の味方', vanilla])

    expect(bpOn(board, '友情を持つユニット', friendly)).toBe(1000)
  })

  it('友情という名前を持つ', () => {
    expect(friendship(1000).keyword).toBe('友情')
    expect(hasFriendship(friendly)).toBe(true)
    expect(hasFriendship(vanilla)).toBe(false)
  })
})

/** 友情－500。数値が違っても、友情を持つことに変わりは無いことを見るために使う。 */
const mildlyFriendly = defineUnit({
  name: 'テスト・小さな友情',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [friendship(500)],
})

/** 友情ではない、名前を持つキーワード能力（夢）を持つユニット。 */
const dreamer = defineUnit({
  name: 'テスト・夢',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [dream],
})

/** 「他の、友情を持つ味方のＢＰを＋2000」。隣かどうか、数値がいくつかは問わない。 */
const boostingFriendly = defineUnit({
  name: 'テスト・友情持ちを強化',
  level: 1,
  colors: ['赤'],
  bp: 1000,
  sp: 1000,
  abilities: [
    bpModifying((duel) =>
      duel
        .allies()
        .filter((ally) => ally.id !== duel.self()?.id && duel.hasKeyword(ally, '友情'))
        .map((ally) => bpPlus(ally, 2000)),
    ),
  ],
})

// 総合ルール 第5部 第5章 2、第4部 第12章 5-2 の(5)（ADR-0006）
describe('友情を持つユニットで対象を絞るＢＰの修整', () => {
  it('友情を持つ味方のＢＰを修整する。隣かどうかも、数値がいくつかも問わない', () => {
    const board = boardOf(
      [homeLeft, '強化するユニット', boostingFriendly],
      [centerCenter, '遠くの友情', friendly],
      [homeRight, '数値の違う友情', mildlyFriendly],
    )

    expect(bpOn(board, '遠くの友情', friendly)).toBe(3000)
    expect(bpOn(board, '数値の違う友情', mildlyFriendly)).toBe(3000)
  })

  it('友情を持たない味方は修整されない。ほかのキーワード能力を持っていても同じ', () => {
    const board = boardOf(
      [homeLeft, '強化するユニット', boostingFriendly],
      [homeCenter, '何も持たない味方', vanilla],
      [homeRight, '夢を持つ味方', dreamer],
    )

    expect(bpOn(board, '何も持たない味方', vanilla)).toBe(1000)
    expect(bpOn(board, '夢を持つ味方', dreamer)).toBe(1000)
  })

  it('友情を持つ敵は修整されない', () => {
    const board = boardOf([homeLeft, '強化するユニット', boostingFriendly], [centerCenter, '敵の友情', friendly, '後攻'])

    expect(bpOn(board, '敵の友情', friendly)).toBe(1000)
  })

  it('強化するユニット自身が友情を持っていても、「他の」と書けば自分は修整されない', () => {
    const friendlyBooster = defineUnit({
      name: 'テスト・友情持ちの強化役',
      level: 1,
      colors: ['赤'],
      bp: 1000,
      sp: 1000,
      abilities: [friendship(0), ...boostingFriendly.abilities],
    })
    const board = boardOf([homeLeft, '強化するユニット', friendlyBooster])

    expect(bpOn(board, '強化するユニット', friendlyBooster)).toBe(1000)
  })

  // 友情を持つ味方は、この修整と、隣の友情からの修整の両方を受ける。
  it('隣の友情からの修整と、重なる', () => {
    const board = boardOf(
      [homeLeft, '強化するユニット', boostingFriendly],
      [homeCenter, '友情を持つ味方', friendly],
      [homeRight, '隣の友情', friendly],
    )

    // 書かれた 1000 に、隣の友情の＋1000 と、友情を持つことによる＋2000。
    expect(bpOn(board, '友情を持つ味方', friendly)).toBe(4000)
    // 隣の友情からは、友情を持つ味方のほうが＋1000 を受けている。
    expect(bpOn(board, '隣の友情', friendly)).toBe(4000)
  })

  it('尋ねられるのは、いま写しているユニットが持つ能力である', () => {
    const board = boardOf([homeLeft, '見るユニット', vanilla], [homeCenter, '友情を持つ味方', friendly], [homeRight, '夢を持つ味方', dreamer])
    const answers: boolean[] = []

    resolveEffect(
      board,
      function* (duel) {
        for (const ally of duel.allies()) answers.push(duel.hasKeyword(ally, '友情'))
        for (const ally of duel.allies()) answers.push(duel.hasKeyword(ally, '夢'))
      },
      { controller: '先攻', via: VIA, chooser: chooseFirst },
    )

    expect(answers).toEqual([false, true, false, false, false, true])
  })
})

// 総合ルール 第4部 第14章 4-5（ADR-0006）
describe('修整によってＢＰが 0 以下になったユニット', () => {
  it('持ち主の捨札に置かれる', () => {
    const board = boardOf(
      [homeLeft, '弱体化するユニット', weakening],
      [homeRight, '敵', vanilla, '後攻'],
    )

    expect(idsOf(cardsIn(pass(board), '後攻', '捨札'))).toEqual(['敵'])
  })
})

// 総合ルール 第4部 第14章 4-6（ADR-0006）
describe('修整の後のＢＰと、受けているダメージ', () => {
  /** 味方が 1000 のダメージを受けている盤面。書かれているＢＰは 1000 で、ちょうど届く。 */
  function damaged(...placements: readonly Placement[]): DuelState {
    return dealDamage(boardOf([homeRight, '傷ついた味方', vanilla], ...placements), '傷ついた味方', 1000)
  }

  it('修整でＢＰが上がってダメージに届かなくなれば、スクエアに残る', () => {
    const board = damaged([homeLeft, '強化するユニット', boosting])

    expect(idsOf(cardsOn(pass(board), homeRight))).toEqual(['傷ついた味方'])
  })

  it('修整が無ければ、同じダメージで持ち主の捨札に置かれる', () => {
    expect(idsOf(cardsIn(pass(damaged()), '先攻', '捨札'))).toEqual(['傷ついた味方'])
  })
})

// 総合ルール 第3部 第13章 1（ADR-0006）
describe('バトルダメージ', () => {
  /**
   * 後攻のユニットが先に置かれたスクエアに、先攻のユニットが後から置かれた盤面を、
   * バトルが終わるまで進める。後から置かれたほうが攻撃したユニットになる
   * （総合ルール 第3部 第11章 4）。
   *
   * 攻撃されたユニットのＢＰは 2000 で、攻撃したユニットに書かれているＢＰ 1000 より
   * 大きい。修整の後のＢＰでダメージを与えるのでなければ、捨札に置かれるのは攻撃した
   * ほうになる。
   */
  function throughBattle(...placements: readonly Placement[]): DuelState {
    const board = boardOf(
      [homeCenter, '攻撃された', tough, '後攻'],
      [homeCenter, '攻撃した', vanilla],
      ...placements,
    )

    let current = pass(board)
    for (let steps = 0; current.battles.length > 0; steps++) {
      if (steps > 50) throw new Error('バトルが終わらない')
      current = pass(current)
    }
    return current
  }

  it('修整の後のＢＰと同じ数字のダメージを与える', () => {
    // 攻撃したユニットが与えるのは 1000＋2000 で、攻撃されたユニットの 2000 に届く。
    const after = throughBattle([homeLeft, '強化するユニット', boosting])

    expect(idsOf(cardsIn(after, '後攻', '捨札'))).toEqual(['攻撃された'])
    expect(idsOf(cardsOn(after, homeCenter))).toEqual(['攻撃した'])
  })

  it('修整が無ければ、同じ組み合わせで逆の結果になる', () => {
    const after = throughBattle()

    expect(idsOf(cardsIn(after, '先攻', '捨札'))).toEqual(['攻撃した'])
    expect(idsOf(cardsOn(after, homeCenter))).toEqual(['攻撃された'])
  })
})
