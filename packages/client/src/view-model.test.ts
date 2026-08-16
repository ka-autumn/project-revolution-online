import { describe, expect, it } from 'vitest'
import { indexOfSquare } from '@revolution/engine'
import type { Player, PlayerZone, Square, WireCardInstance, WirePerspective } from '@revolution/engine'
import { emptyBoard, instance, unitFace, withZone } from './test-support.js'
import { boardView } from './view-model.js'
import type { BoardView, CardView, SideView } from './view-model.js'

/**
 * 届いた盤面から画面に出す値を作るところ（#14）。
 *
 * **見せてはならないものが画面に出ないことを、ここで見る。** 隠す判断はクライアントに無い
 * （ADR-0004 / ADR-0010）ので、確かめられるのは「届いていないものを勝手に作り出していない」
 * ことである。
 */

/** そのスクエアにカードを置いた盤面。 */
function withSquare(board: WirePerspective, square: Square, cards: readonly WireCardInstance[]): WirePerspective {
  return {
    ...board,
    squares: board.squares.map((each, index) => (index === indexOfSquare(square) ? cards : each)),
  }
}

/** その持ち主の側。 */
function sideOf(view: BoardView, whose: '自分' | '相手'): SideView {
  return whose === '自分' ? view.own : view.opponent
}

/** その側のそのゾーン。 */
function zoneOf(view: BoardView, whose: '自分' | '相手', zone: PlayerZone) {
  const found = sideOf(view, whose).zones.find((each) => each.zone === zone)
  if (found === undefined) throw new Error(`${zone} が無い`)

  return found
}

/** 画面に出る文字すべて。出てはならないものが混ざっていないかを見るのに使う。 */
function shown(view: BoardView): string {
  return JSON.stringify(view)
}

describe('カード 1 枚', () => {
  it('見えているカードは、書かれていることが出る', () => {
    const card = instance('じぶんの1枚', '先攻', {
      card: unitFace('テスト・戦士', { level: 2, colors: ['赤', '白'], bp: 3000, sp: 2000 }),
    })
    const view = boardView(withZone(emptyBoard('先攻'), '先攻', '手札', [{ kind: '見えている', instance: card }]))

    expect(zoneOf(view, '自分', '手札').cards[0]).toMatchObject({
      kind: '表',
      id: 'じぶんの1枚',
      name: 'テスト・戦士',
      summary: 'Lv2 赤・白 BP3000 SP2000',
      orientation: 'リリース',
      damage: 0,
    })
  })

  it('見えていないカードは、向きだけが出る', () => {
    const view = boardView(
      withZone(emptyBoard('先攻'), '後攻', '手札', [{ kind: '見えていない', orientation: 'リリース' }]),
    )

    expect(zoneOf(view, '相手', '手札').cards).toEqual([{ kind: '裏', orientation: 'リリース' }])
  })

  it('乗っているダメージも出る', () => {
    const damaged = instance('傷ついた1枚', '先攻', { damage: 1000 })
    const view = boardView(withSquare(emptyBoard('先攻'), { row: 0, column: 0 }, [damaged]))
    const [card] = view.squares[2]?.[0]?.cards ?? []

    expect(card).toMatchObject({ kind: '表', damage: 1000 })
  })

  it('色の無いカードは無色と出る', () => {
    const colorless = instance('無色の1枚', '先攻', { card: unitFace('テスト・無色', { colors: [] }) })
    const view = boardView(withZone(emptyBoard('先攻'), '先攻', '手札', [{ kind: '見えている', instance: colorless }]))
    const [card] = zoneOf(view, '自分', '手札').cards

    expect(card).toMatchObject({ summary: 'Lv1 無色 BP1000 SP1000' })
  })
})

describe('カードの詳細', () => {
  /** 詳細に出る 1 行を引く。 */
  function detailOf(view: BoardView, label: string): string | undefined {
    const [card] = zoneOf(view, '自分', '手札').cards
    if (card?.kind !== '表') throw new Error('自分の手札は見えるはずだった')

    return card.details.find((row) => row.label === label)?.value
  }

  /** その 1 枚を自分の手札に置いた盤面。 */
  function inHand(card: WireCardInstance): BoardView {
    return boardView(withZone(emptyBoard('先攻'), '先攻', '手札', [{ kind: '見えている', instance: card }]))
  }

  it('ユニットはＢＰ・ＳＰ・ムーブアイコンが出る', () => {
    const view = inHand(
      instance('ゆにっと', '先攻', { card: unitFace('テスト・戦士', { bp: 3000, sp: 2000, moveIcon: ['上', '右'] }) }),
    )

    expect(detailOf(view, 'ＢＰ')).toBe('3000')
    expect(detailOf(view, 'ＳＰ')).toBe('2000')
    expect(detailOf(view, 'ムーブアイコン')).toBe('上・右')
  })

  /**
   * トリガーアイコンは**カードに印刷された図**であって、盤面のどこかを指してはいない
   * （`board.ts` の `squareFromView`）。支配者の手前を基準にした呼び名で出す。
   */
  it('トラップはトリガーアイコンが、支配者から見た呼び名で出る', () => {
    const trap: WireCardInstance = {
      ...instance('とらっぷ', '先攻'),
      card: {
        type: 'トラップ',
        name: 'テスト・罠',
        level: 1,
        colors: [],
        stars: 0,
        reverseStars: 0,
        attributes: [],
        triggerIcon: [{ row: 0, column: 0 }],
      },
    }

    expect(detailOf(inHand(trap), 'トリガーアイコン')).toBe('味方エリアの左ライン')
  })

  /** 持っていない項目は行ごと出さない。「スター 0」と書いても読む人の役に立たない。 */
  it('持っていない項目は出ない', () => {
    const plain = instance('すたーなし', '先攻', { card: unitFace('テスト・素', { stars: 0, attributes: [] }) })
    const view = inHand(plain)

    expect(detailOf(view, 'スター')).toBeUndefined()
    expect(detailOf(view, '属性')).toBeUndefined()
    expect(detailOf(view, 'トリガーアイコン')).toBeUndefined()
  })

  it('スターと属性は、持っていれば出る', () => {
    const starred = instance('すたーあり', '先攻', {
      card: unitFace('テスト・星', { stars: 2, reverseStars: 1, attributes: ['属性ア', '属性イ'] }),
    })
    const view = inHand(starred)

    expect(detailOf(view, 'スター')).toBe('2')
    expect(detailOf(view, 'リバーススター')).toBe('1')
    expect(detailOf(view, '属性')).toBe('属性ア・属性イ')
  })

  /**
   * 能力テキストは通信に載っていない（#93）。**無いものを作り出していない**ことを見る。
   * 載るようになったらこのテストは書き換わる。
   */
  it('能力テキストは出ない', () => {
    const view = inHand(instance('てきすとなし', '先攻'))

    expect(detailOf(view, 'テキスト')).toBeUndefined()
  })

  it('見えていないカードは詳細を持たない', () => {
    const view = boardView(
      withZone(emptyBoard('先攻'), '後攻', '手札', [{ kind: '見えていない', orientation: 'リリース' }]),
    )

    expect(zoneOf(view, '相手', '手札').cards[0]).not.toHaveProperty('details')
  })
})

// #14 の完了条件。相手の手札・山札・裏向きのトラップ・スマッシュが画面に出ない。
describe('画面に出てはならないもの', () => {
  /**
   * 見えていないカードは、名前も識別子も持たずに届く（`perspective.ts` の `VisibleCard`）。
   * ここで確かめられるのは、**届いていないものを画面に足していない**ことである。
   */
  it.each([
    ['相手の手札', '後攻', '手札'],
    ['相手の山札', '後攻', '山札'],
    ['相手のトラップゾーン', '後攻', 'トラップゾーン'],
    ['相手のスマッシュゾーン', '後攻', 'スマッシュゾーン'],
    ['自分の山札', '先攻', '山札'],
    ['自分のスマッシュゾーン', '先攻', 'スマッシュゾーン'],
  ] as const)('%sは、裏のまま出る', (_, owner: Player, zone: PlayerZone) => {
    const hidden = Array.from({ length: 3 }, () => ({ kind: '見えていない', orientation: 'リリース' }) as const)
    const view = boardView(withZone(emptyBoard('先攻'), owner, zone, hidden))
    const whose = owner === '先攻' ? '自分' : '相手'

    expect(zoneOf(view, whose, zone).cards.every((card: CardView) => card.kind === '裏')).toBe(true)
  })

  /**
   * 山札は枚数だけを出す。持ち主であっても中身を見てはならない（総合ルール 第2部 第21章 2-2）
   * ので、1 枚ずつ並べても見分けが付かない。
   */
  it('山札は枚数だけが出る', () => {
    const hidden = Array.from({ length: 30 }, () => ({ kind: '見えていない', orientation: 'リリース' }) as const)
    const view = boardView(withZone(emptyBoard('先攻'), '先攻', '山札', hidden))

    expect(zoneOf(view, '自分', '山札')).toEqual({ zone: '山札', count: 30, cards: [] })
  })

  /** スマッシュは枚数が要る。何点まで耐えられるかが、そこからしか分からない。 */
  it('スマッシュは枚数が出る', () => {
    const hidden = Array.from({ length: 4 }, () => ({ kind: '見えていない', orientation: 'リリース' }) as const)
    const view = boardView(withZone(emptyBoard('先攻'), '先攻', 'スマッシュゾーン', hidden))

    expect(zoneOf(view, '自分', 'スマッシュゾーン').count).toBe(4)
  })

  /**
   * 届いていないカードの名前が、どこからも湧いてこない。
   *
   * 見えないカードは名前を持たずに届くので、画面に出しようがない。**出ていないことを、画面に
   * 出る文字すべてを見て確かめる。**
   */
  it('見えないカードの名前は、画面のどこにも出ない', () => {
    const secret = unitFace('テスト・見えないはずのカード')
    const board = withZone(emptyBoard('先攻'), '後攻', '手札', [{ kind: '見えていない', orientation: 'リリース' }])
    // 同じ名前のカードが、見えるところに 1 枚もない盤面にしておく。
    expect(JSON.stringify(board)).not.toContain(secret.name)

    expect(shown(boardView(board))).not.toContain(secret.name)
  })
})

describe('スクエア', () => {
  /**
   * 味方エリアが下、敵エリアが上に並ぶ（総合ルール 第2部 第22章 6）。**同じ盤面でも、見る人に
   * よって上下が入れ替わる。**
   */
  it.each(['先攻', '後攻'] as const)('%s から見ると、自分の味方エリアが下に来る', (viewer: Player) => {
    const view = boardView(emptyBoard(viewer))

    expect(view.squares[0]?.map((square) => square.area)).toEqual(['敵エリア', '敵エリア', '敵エリア'])
    expect(view.squares[1]?.map((square) => square.area)).toEqual(['中央エリア', '中央エリア', '中央エリア'])
    expect(view.squares[2]?.map((square) => square.area)).toEqual(['味方エリア', '味方エリア', '味方エリア'])
  })

  /** 先攻の手前は行 0 である（`board.ts` の `HOME_ROW_OF_FIRST`）。 */
  it('先攻から見ると、左下は行 0・列 0 のスクエアになる', () => {
    const view = boardView(emptyBoard('先攻'))

    expect(view.squares[2]?.[0]?.square).toEqual({ row: 0, column: 0 })
  })

  /** 後攻から見ると、盤面は縦も横も折り返る（同 第22章 4・6）。 */
  it('後攻から見ると、左下は行 2・列 2 のスクエアになる', () => {
    const view = boardView(emptyBoard('後攻'))

    expect(view.squares[2]?.[0]?.square).toEqual({ row: 2, column: 2 })
  })

  it('スクエアにいるユニットが、そのマスに出る', () => {
    const unit = instance('まんなかの1枚', '先攻')
    const view = boardView(withSquare(emptyBoard('先攻'), { row: 1, column: 1 }, [unit]))

    expect(view.squares[1]?.[1]?.cards[0]).toMatchObject({
      kind: '表',
      id: 'まんなかの1枚',
      name: 'テスト・まんなかの1枚',
      summary: 'Lv1 赤 BP1000 SP1000',
      orientation: 'リリース',
      damage: 0,
    })
  })
})

describe('プレイヤーの様子', () => {
  it('ダメージが両方とも出る', () => {
    const board = { ...emptyBoard('先攻'), damage: { 先攻: 2000, 後攻: 1000 } }
    const view = boardView(board)

    expect(view.own.damage).toBe(2000)
    expect(view.opponent.damage).toBe(1000)
  })

  it('自分と相手が分かれて出る', () => {
    const view = boardView(emptyBoard('後攻'))

    expect(view.own).toMatchObject({ player: '後攻', whose: '自分' })
    expect(view.opponent).toMatchObject({ player: '先攻', whose: '相手' })
  })

  it('ターンの様子が 1 行になる', () => {
    const empty = emptyBoard('後攻')
    const board = { ...empty, turn: { ...empty.turn, number: 3, active: '先攻', priority: '後攻' } } as const

    expect(boardView(board).turn).toBe('第 3 ターン・相手のターン・メインフェイズ・自分の優先権')
  })

  it.each([
    ['勝った', { kind: '勝利', winner: '先攻' }, '勝ち'],
    ['負けた', { kind: '勝利', winner: '後攻' }, '負け'],
    ['引き分けた', { kind: '引き分け' }, '引き分け'],
  ] as const)('%sことが出る', (_, result, expected) => {
    expect(boardView({ ...emptyBoard('先攻'), result }).result).toBe(expected)
  })

  it('決着していなければ、結果は出ない', () => {
    expect(boardView(emptyBoard('先攻')).result).toBeUndefined()
  })
})

// 総合ルール 第3部 第11章。いまバトルのどの段階かが分かる。
describe('バトル', () => {
  /** 攻撃側と被攻撃側がスクエアにいる、バトル中の盤面。 */
  function inBattle(viewer: Player): WirePerspective {
    const square = { row: 1, column: 1 } as const
    const attacker = instance('せめた1枚', '先攻', { card: unitFace('テスト・攻め手') })
    const attacked = instance('うけた1枚', '後攻', { card: unitFace('テスト・受け手') })

    return {
      ...withSquare(emptyBoard(viewer), square, [attacker, attacked]),
      battle: {
        square,
        attacker: 'せめた1枚',
        attacked: 'うけた1枚',
        step: '第１ダメージステップ',
        dealtDamage: [],
        endOfBattleTriggered: false,
        heldBank: [],
        heldTriggered: [],
      },
    }
  }

  it('どのステップかと、どのユニット同士かが出る', () => {
    expect(boardView(inBattle('先攻')).battle).toEqual({
      where: '中央エリアの中央ライン',
      step: '第１ダメージステップ',
      attacker: 'テスト・攻め手',
      attacked: 'テスト・受け手',
    })
  })

  /** スクエアの呼び名は見る人によって入れ替わる（総合ルール 第2部 第22章 4・6）。 */
  it('起きている場所は、見る人から見た呼び名で出る', () => {
    expect(boardView(inBattle('後攻')).battle?.where).toBe('中央エリアの中央ライン')
  })

  it('バトルが起きていなければ出ない', () => {
    expect(boardView(emptyBoard('先攻')).battle).toBeUndefined()
  })
})

// 総合ルール 第2部 第21章 11。バンクに何が積まれているか。
describe('解決を待っている能力', () => {
  /** バンクに 2 つ、誘発した能力が 1 つある盤面。 */
  function withAbilities(): WirePerspective {
    const unit = instance('はっせいげん', '先攻', { card: unitFace('テスト・発生源') })

    return {
      ...withSquare(emptyBoard('先攻'), { row: 1, column: 1 }, [unit]),
      bank: [
        { controller: '先攻', source: 'はっせいげん' },
        { controller: '後攻', source: undefined },
      ],
      triggered: [{ controller: '先攻', source: 'はっせいげん' }],
    }
  }

  it('誰の能力で、どのカードから出たかが分かる', () => {
    expect(boardView(withAbilities()).bank).toEqual([
      { whose: '自分', source: 'テスト・発生源' },
      { whose: '相手', source: undefined },
    ])
  })

  /** 誘発したがまだバンクに置かれていない能力（総合ルール 第4部 第3章 3）も分かれて出る。 */
  it('誘発した能力は、バンクとは分かれて出る', () => {
    const view = boardView(withAbilities())

    expect(view.triggered).toEqual([{ whose: '自分', source: 'テスト・発生源' }])
  })

  /**
   * 何をする能力かは出せない。効果は関数なので射影の時点で落ちている（`perspective.ts` の
   * `VisibleAbility`）。**出せないものを作り出していない**ことを見る。
   */
  it('何をする能力かは出ない', () => {
    const [ability] = boardView(withAbilities()).bank

    expect(Object.keys(ability ?? {}).sort()).toEqual(['source', 'whose'])
  })

  it('積まれていなければ空', () => {
    expect(boardView(emptyBoard('先攻')).bank).toEqual([])
  })
})
