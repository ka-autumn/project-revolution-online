import { describe, expect, it } from 'vitest'
import { indexOfSquare } from '@revolution/engine'
import type { DuelEvent, Player, PlayerZone, Square, Turn, WireCardInstance, WirePerspective } from '@revolution/engine'
import { emptyBoard, instance, unitFace, withZone } from './test-support.js'
import { boardView, cutInViews, logLines, overlayDurationMs, showsOverlay, transitionViews } from './view-model.js'
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

  /** 出るのは向きと置き場所だけである。置き場所は盤面の枠を指すもので、中身を何も言わない（#127）。 */
  it('見えていないカードは、向きと置き場所が出る', () => {
    const view = boardView(
      withZone(emptyBoard('先攻'), '後攻', '手札', [{ kind: '見えていない', orientation: 'リリース' }]),
    )

    expect(zoneOf(view, '相手', '手札').cards).toEqual([
      { kind: '裏', orientation: 'リリース', at: { player: '後攻', zone: '手札', index: 0 } },
    ])
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

/**
 * #93。カードに印刷されているテキスト（総合ルール 第2部 第10章）を、詳細に出す。
 *
 * 落とす判断はここに無い。テキストが載るのは表側が見えているカードだけである
 * （`wire.ts` の `WireWrittenCard`）。
 */
describe('カードのテキスト', () => {
  const SQUARE: Square = { row: 0, column: 0 }
  const TEXT = ['登場した時、敵を１枚まで選び、3000ダメージ！', '根性（リリースして登場！）']

  function unitView(board: WirePerspective): CardView {
    const found = boardView(board)
      .squares.flat()
      .flatMap((square) => square.cards)[0]
    if (found === undefined) throw new Error('ユニットが無い')

    return found
  }

  /** 改行ごとに別の能力になる（同 第4部 第1章 3）ので、行の並びのまま渡す。 */
  it('印刷されたテキストが、行の並びのまま出る', () => {
    const unit = instance('テキストを持つ1枚', '先攻', { card: unitFace('テスト・テキストあり', { text: TEXT }) })
    const view = unitView(withSquare(emptyBoard('先攻'), SQUARE, [unit]))

    expect(view.kind === '表' && view.text).toEqual(TEXT)
  })

  it('テキストを持たないカードは、空のまま出る', () => {
    const unit = instance('テキストのない1枚', '先攻')
    const view = unitView(withSquare(emptyBoard('先攻'), SQUARE, [unit]))

    expect(view.kind === '表' && view.text).toEqual([])
  })

  /** 裏向きのカードは表記そのものが届かないので、テキストも出しようがない。 */
  it('裏向きのカードには、テキストが無い', () => {
    const board = withZone(emptyBoard('先攻'), '後攻', '手札', [{ kind: '見えていない', orientation: 'リリース' }])
    const card = zoneOf(boardView(board), '相手', '手札').cards[0]

    expect(card?.kind).toBe('裏')
    expect(JSON.stringify(card)).not.toContain('テキスト')
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
        text: [],
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

  /** 持ち主と支配者が同じなら 1 行で足りる。 */
  it('支配者が出る。持ち主が同じなら、持ち主の行は出ない', () => {
    const view = inHand(instance('じぶんの1枚', '先攻'))

    expect(detailOf(view, '支配者')).toBe('自分')
    expect(detailOf(view, '持ち主')).toBeUndefined()
  })

  it('持ち主と支配者が食い違えば、両方出る', () => {
    const taken: WireCardInstance = { ...instance('とられた1枚', '後攻'), controller: '先攻' }
    const view = boardView(withZone(emptyBoard('先攻'), '先攻', '手札', [{ kind: '見えている', instance: taken }]))
    const [card] = zoneOf(view, '自分', '手札').cards
    if (card?.kind !== '表') throw new Error('自分の手札は見えるはずだった')

    expect(card.details.find((row) => row.label === '支配者')?.value).toBe('自分')
    expect(card.details.find((row) => row.label === '持ち主')?.value).toBe('相手')
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

/**
 * #91。継続効果を適用した後のＢＰと属性（総合ルール 第4部 第12章 2）を画面に出す。
 *
 * 修整を集めるのは盤面の側（`perspective.ts` の `EffectiveUnitData`）で、ここでするのは
 * 書かれている値と見比べてどこが変わったかを取り出すことだけである（ADR-0010）。
 */
describe('継続効果を適用した後のデータ', () => {
  const SQUARE: Square = { row: 0, column: 0 }
  const unit = instance('修整を受ける1枚', '先攻', { card: unitFace('テスト・修整を受ける', { bp: 1000 }) })

  /** そのユニットが、修整を適用した後のデータと一緒に届いた盤面。 */
  function withEffective(effective: WirePerspective['effective']): WirePerspective {
    return { ...withSquare(emptyBoard('先攻'), SQUARE, [unit]), effective }
  }

  /** 画面に出たそのユニット。スクエアは見る人の向きに直っている（`squareViews`）。 */
  function unitView(board: WirePerspective): CardView {
    const found = boardView(board)
      .squares.flat()
      .flatMap((square) => square.cards)[0]
    if (found === undefined) throw new Error('ユニットが無い')

    return found
  }

  it('修整を受けていれば、修整後のＢＰが出る', () => {
    const view = unitView(withEffective([{ card: unit.id, bp: 3000, attributes: [] }]))

    expect(view.kind === '表' && view.modified?.bp).toBe(3000)
  })

  /** 印刷された数字を消さない。どちらがカードに書かれている値かも要る。 */
  it('印刷された数字と、修整後の数字が、どちらも出る', () => {
    const view = unitView(withEffective([{ card: unit.id, bp: 3000, attributes: [] }]))

    expect(view.kind === '表' && view.summary).toContain('BP1000→3000')
  })

  it('修整を受けていなければ、修整後のＢＰを出さない', () => {
    const view = unitView(withEffective([{ card: unit.id, bp: 1000, attributes: [] }]))

    expect(view.kind === '表' && view.modified).toBeUndefined()
    expect(view.kind === '表' && view.summary).toContain('BP1000 ')
  })

  /** 加わった属性はカードに書かれていない（総合ルール 第4部 第12章 5-2 の(3)）ので、分けて出す。 */
  it('加わった属性が、書かれている属性と見分けられる形で出る', () => {
    const attributed = instance('属性を持つ1枚', '先攻', {
      card: unitFace('テスト・属性あり', { attributes: ['目印'] }),
    })
    const board: WirePerspective = {
      ...withSquare(emptyBoard('先攻'), SQUARE, [attributed]),
      effective: [{ card: attributed.id, bp: 1000, attributes: ['目印', '夢'] }],
    }
    const view = unitView(board)

    expect(view.kind === '表' && view.modified?.addedAttributes).toEqual(['夢'])
    expect(view.kind === '表' && view.summary).toContain('《目印・+夢》')
  })

  /** 詳細でも、印刷された値と修整後の値を別の行にする。 */
  it('詳細に、修整後のＢＰが別の行として出る', () => {
    const view = unitView(withEffective([{ card: unit.id, bp: 3000, attributes: [] }]))
    const details = view.kind === '表' ? view.details : []

    expect(details.find((row) => row.label === 'ＢＰ')?.value).toBe('1000')
    expect(details.find((row) => row.label === 'ＢＰ（修整後）')?.value).toBe('3000')
  })

  /** 相手のユニットについても同じように見える（スクエアは公開情報、同 第2部 第23章 1-1）。 */
  it('相手のユニットでも同じように出る', () => {
    const enemy = instance('相手の1枚', '後攻', { card: unitFace('テスト・相手', { bp: 1000 }) })
    const board: WirePerspective = {
      ...withSquare(emptyBoard('先攻'), SQUARE, [enemy]),
      effective: [{ card: enemy.id, bp: 2000, attributes: [] }],
    }
    const view = unitView(board)

    expect(view.kind === '表' && view.controlledBy).toBe('相手')
    expect(view.kind === '表' && view.modified?.bp).toBe(2000)
  })

  /** スクエアの外にいるカードは、修整後のデータを持たない。 */
  it('ゾーンにあるカードは、修整後のデータを持たない', () => {
    const board = withZone(emptyBoard('先攻'), '先攻', '手札', [{ kind: '見えている', instance: unit }])
    const card = zoneOf(boardView(board), '自分', '手札').cards[0]

    expect(card?.kind === '表' && card.modified).toBeUndefined()
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

  /**
   * スクエアはどちらのユニットも同じ枠に並ぶので、どちらのものかが分からないと読めない。
   * 分けるのは支配者である（総合ルール 第2部 第21章 8-2 の「味方」「敵」）。
   */
  it.each(['先攻', '後攻'] as const)('%s から見て、自分のユニットと相手のユニットが分かれる', (viewer: Player) => {
    const mine = instance('じぶんの1枚', viewer)
    const theirs = instance('あいての1枚', viewer === '先攻' ? '後攻' : '先攻')
    const placed = withSquare(withSquare(emptyBoard(viewer), { row: 0, column: 0 }, [mine]), { row: 2, column: 2 }, [
      theirs,
    ])
    const view = boardView(placed)
    const all = view.squares.flat().flatMap((square) => square.cards)

    expect(all.map((card) => (card.kind === '表' ? [card.id, card.controlledBy] : []))).toEqual(
      expect.arrayContaining([
        ['じぶんの1枚', '自分'],
        ['あいての1枚', '相手'],
      ]),
    )
  })

  /**
   * バトル中は支配者の違う 2 体が同じスクエアに並ぶ（総合ルール 第3部 第11章 1）。
   * **スクエア単位では決まらない**ので、1 枚ごとに持つ。
   */
  it('同じスクエアに並んでも、1 枚ずつ分かれる', () => {
    const attacker = instance('せめた1枚', '先攻')
    const attacked = instance('うけた1枚', '後攻')
    const view = boardView(withSquare(emptyBoard('先攻'), { row: 1, column: 1 }, [attacker, attacked]))

    expect(view.squares[1]?.[1]?.cards.map((card) => (card.kind === '表' ? card.controlledBy : '裏'))).toEqual([
      '自分',
      '相手',
    ])
  })

  /** 分けるのは持ち主ではなく支配者である（同 8-2）。食い違えば支配者に従う。 */
  it('持ち主と支配者が食い違えば、支配者に従う', () => {
    const taken = instance('とられた1枚', '後攻', { controller: '先攻' })
    const view = boardView(withSquare(emptyBoard('先攻'), { row: 1, column: 1 }, [taken]))
    const [card] = view.squares[1]?.[1]?.cards ?? []

    expect(card).toMatchObject({ controlledBy: '自分' })
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
        result: undefined,
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

/**
 * #102。スマッシュ判定（総合ルール 第3部 第17章）が進行していることを画面に出す。
 *
 * 出ていないと、正しい挙動が誤りに見える。スマッシュゾーンにカードが置かれるのは希望ステップ
 * （同 第19章 1）で、そこへ進むには優先権のやり取りが要るためである。
 */
describe('スマッシュ判定', () => {
  const board = emptyBoard('先攻')

  /** 判定 1 つが進行している盤面。届く形は変えていない（`wire.ts` の `smashJudgments`）。 */
  function judging(judgment: Partial<WirePerspective['smashJudgments'][number]> = {}): WirePerspective {
    return {
      ...board,
      smashJudgments: [
        {
          player: '後攻',
          step: '回復ステップ',
          repeats: 2,
          round: 0,
          faceUp: undefined,
          // 待機中のバンク（総合ルール 第3部 第17章 2）は画面に出さない。判定が終わるまで
          // 存在しないものとして扱われる。
          heldBank: [],
          heldTriggered: [],
          ...judgment,
        },
      ],
    }
  }

  it('発生していなければ、何も出ない', () => {
    expect(boardView(board).smashJudgments).toEqual([])
  })

  it('誰のスマッシュ判定かが出る', () => {
    expect(boardView(judging()).smashJudgments[0]?.whose).toBe('相手')
  })

  it('見る人が変われば、誰のものかの呼び方も変わる', () => {
    const opponentView: WirePerspective = { ...judging(), viewer: '後攻' }

    expect(boardView(opponentView).smashJudgments[0]?.whose).toBe('自分')
  })

  it('いまどのステップかが出る', () => {
    expect(boardView(judging({ step: '希望ステップ' })).smashJudgments[0]?.step).toBe('希望ステップ')
  })

  /** 繰り返しの何回目かは「第１希望ステップ」にあたる（総合ルール 第3部 第17章 3）。 */
  it('繰り返しの何回目かが出る', () => {
    const view = boardView(judging({ step: '希望ステップ', round: 1 })).smashJudgments[0]

    expect(view?.round).toBe(1)
    expect(view?.repeats).toBe(2)
  })

  /** 回復ステップの間はまだ 1 回目に入っていないので、回数として出さない。 */
  it('回復ステップの間は、何回目かを出さない', () => {
    expect(boardView(judging()).smashJudgments[0]?.round).toBeUndefined()
  })

  /**
   * 希望ステップでは山札の 1 番上を**表向きで**置く（総合ルール 第3部 第19章 1）。届くのは
   * 識別子なので、名前に直す。
   */
  it('表向きに置かれているカードの名前が出る', () => {
    const card = instance('希望の1枚', '後攻')
    const withCard = withZone(judging({ step: '希望ステップ', round: 1, faceUp: card.id }), '後攻', 'スマッシュゾーン', [
      { kind: '見えている', instance: card },
    ])

    expect(boardView(withCard).smashJudgments[0]?.faceUp).toBe(card.card.name)
  })

  /**
   * 表向きに置かれているカードはスマッシュではない（総合ルール 第2部 第21章 7-2、第3部
   * 第19章 1）。エンジンが数えるところ（`smash.ts` の `smashesOf`）と同じ数え方にする。
   */
  it('表向きのカードは、スマッシュの枚数に数えられない', () => {
    const faceUp = instance('希望の1枚', '後攻')
    const withCards = withZone(judging({ step: '希望ステップ', round: 1, faceUp: faceUp.id }), '後攻', 'スマッシュゾーン', [
      { kind: '見えていない', orientation: 'リリース' },
      { kind: '見えている', instance: faceUp },
    ])

    const zone = zoneOf(boardView(withCards), '相手', 'スマッシュゾーン')
    expect(zone.count).toBe(1)
    // 数えないだけで、置かれていることは見える。
    expect(zone.cards).toHaveLength(2)
  })

  /** 確定ステップで裏返れば、そのカードはスマッシュになる（同 第20章 1）。 */
  it('表向きのカードが無ければ、そのまま数える', () => {
    const withCards = withZone(judging({ step: '確定ステップ', round: 1 }), '後攻', 'スマッシュゾーン', [
      { kind: '見えていない', orientation: 'リリース' },
      { kind: '見えていない', orientation: 'リリース' },
    ])

    expect(zoneOf(boardView(withCards), '相手', 'スマッシュゾーン').count).toBe(2)
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

/**
 * 操作ログ（#95）。
 *
 * **落とす判断はここに無い。** 見てはならないカードは名指しされないまま届く
 * （`perspective.ts` の `DuelPerspective.log`）ので、ここで見るのは「届いたできごとを
 * どう読める行にするか」と、「名指しされていないものを勝手に補っていないか」である。
 */
describe('操作ログ', () => {
  const ON_SQUARE: Square = { row: 1, column: 1 }

  /** そのできごとだけを持つ盤面。スクエアに 1 枚置いて、名前を引けるようにしておく。 */
  function withLog(...log: WirePerspective['log']): WirePerspective {
    const board = withSquare(emptyBoard('先攻'), ON_SQUARE, [instance('置いてある', '先攻')])
    return { ...board, log }
  }

  /** 出た行の文だけ。 */
  function texts(board: WirePerspective): readonly string[] {
    return logLines(board).map((line) => line.text)
  }

  /** 新しいものが先頭に出る（#111）。 */
  it('行った手が、行われた順とは逆に出る', () => {
    const board = withLog(
      { kind: '行動した', player: '先攻', action: 'エネルギーを置く', card: undefined, square: undefined },
      { kind: '行動した', player: '後攻', action: 'プランする', card: undefined, square: undefined },
    )

    expect(logLines(board)).toEqual([
      { whose: '相手', text: 'プランする' },
      { whose: '自分', text: 'エネルギーを置く' },
    ])
  })

  it('指されたカードとスクエアが出る', () => {
    const board = withLog({
      kind: '行動した',
      player: '先攻',
      action: 'カードをプレイする',
      card: '置いてある',
      square: ON_SQUARE,
    })

    expect(texts(board)).toEqual(['カードをプレイする：テスト・置いてある（中央エリアの中央ライン）'])
  })

  /**
   * 名指しされていなければ、名前のところは出ない。**「見えていないカード」とも書かない。**
   * 名指しが落ちたのか、そもそもカードを指していないできごとなのかは、届いたものからは
   * 見分けられない。
   */
  it('名指しされていないカードは、名前を作り出さない', () => {
    const board = withLog({
      kind: '行動した',
      player: '後攻',
      action: 'トラップとしてプレイする',
      card: undefined,
      square: undefined,
    })

    expect(texts(board)).toEqual(['トラップとしてプレイする'])
  })

  /**
   * 見出しの言葉が経路と取り違えられていないことを、操作ログの側でも確かめる（#104）。
   * 「発動」はトラップの言葉である（総合ルール 第2部 第20章 3-10）。
   */
  it('能力の解決は、経路の言葉で出る', () => {
    const board = withLog({ kind: '能力を解決した', controller: '先攻', via: '発動', source: '置いてある' })

    expect(texts(board)).toEqual(['発動：テスト・置いてある'])
  })

  it('能力の解決は、発生源が名指しされていなければ経路の言葉だけが出る', () => {
    const board = withLog({ kind: '能力を解決した', controller: '先攻', via: '誘発', source: undefined })

    expect(texts(board)).toEqual(['誘発'])
  })

  it('効果が実行した命令が出る', () => {
    const board = withLog({
      kind: '命令を実行した',
      controller: '後攻',
      instruction: { kind: 'ユニットにダメージを与える', card: '置いてある', amount: 500 },
    })

    expect(logLines(board)).toEqual([{ whose: '相手', text: 'テスト・置いてあるにダメージ 500' }])
  })

  /** ルールエフェクトはどちらのプレイヤーにも支配されない（総合ルール 第4部 第14章 1）。 */
  it('ルールが起こしたことは、誰のものにもならない', () => {
    const board = withLog({ kind: 'ルールで捨札に置かれた', cards: ['置いてある'] })

    expect(logLines(board)).toEqual([{ whose: undefined, text: 'ルールで捨札：テスト・置いてある' }])
  })

  it('決着は、見る人から見た言い方で出る', () => {
    const board = withLog({ kind: '決着した', result: { kind: '勝利', winner: '後攻' } })

    expect(texts(board)).toEqual(['決着：負け'])
  })

  // #111。使ったカードが分かるようにする。
  it('コストとして支払ったカードが出る', () => {
    const board = withLog({
      kind: 'コストを支払った',
      player: '先攻',
      zone: 'エネルギーゾーン',
      card: '置いてある',
      purpose: 'プランのコスト',
    })

    expect(texts(board)).toEqual(['テスト・置いてあるをコストとしてフリーズした'])
  })

  /**
   * スマッシュは裏向きで、支払った本人からも見られない（総合ルール 第2部 第21章 7-3）ので
   * 名前は出せない。かわりにゾーンの名前で言う。
   */
  it('コストとしてスマッシュをフリーズした時は、ゾーンの名前で出る', () => {
    const board = withLog({
      kind: 'コストを支払った',
      player: '先攻',
      zone: 'スマッシュゾーン',
      card: undefined,
      purpose: 'プランのコスト',
    })

    expect(texts(board)).toEqual(['コストとしてスマッシュをフリーズした'])
  })

  // 総合ルール 第3部 第19章 1。表向きなのはそこだけなので、この時にしか名指しできない。
  it('希望ステップで表向きに置いたカードが出る', () => {
    const board = withLog({ kind: '希望ステップでめくった', player: '後攻', card: '置いてある', name: 'テスト・置いてある' })

    expect(texts(board)).toEqual(['テスト・置いてあるを希望ステップでめくった'])
  })

  /**
   * #139。盤面から居なくなったカードの名前は、`namedInLog` から引く。
   *
   * ログの名指しは**そのできごとの時に**見えていたかで残る（#129）のに対して、盤面に載って
   * いるのは**いま**見えているカードだけである。山札に戻ったカードのように、名指しは残って
   * いるのに盤面から引けないものがあるので、引く先をサーバが揃えて送ってくる。
   */
  describe('盤面から居なくなったカード', () => {
    /** そのできごとと、盤面に載っていない 1 枚の名前が届いた盤面。 */
    function withNamedInLog(event: DuelEvent, ...named: readonly WireCardInstance[]): WirePerspective {
      return { ...withLog(event), namedInLog: named }
    }

    it('名前が届いていれば、その名前が出る', () => {
      const board = withNamedInLog(
        { kind: '行動した', player: '先攻', action: 'カードをプレイする', card: '戻された', square: undefined },
        instance('戻された', '先攻'),
      )

      expect(texts(board)).toEqual(['カードをプレイする：テスト・戻された'])
    })

    /** 届いていないものは、今までどおり補わない（#95）。 */
    it('名前が届いていなければ、見えていないカードのままになる', () => {
      const board = withLog({
        kind: '行動した',
        player: '先攻',
        action: 'カードをプレイする',
        card: '届いていない',
        square: undefined,
      })

      expect(texts(board)).toEqual(['カードをプレイする：見えていないカード'])
    })

    // #111。勝者は名前だけでなく支配者も引くので、そちらも同じところから引けている。
    it('バトルの勝者も、届いた名前と支配者で出る', () => {
      const board = withNamedInLog({ kind: 'バトルが終わった', winner: '勝った' }, instance('勝った', '後攻'))

      expect(texts(board)).toEqual(['バトル終了：相手のテスト・勝ったの勝ち'])
    })
  })

  /**
   * 裏返された後は盤面のどこにも見えなくなる（`namesIn` が名前を引けない）ので、盤面から
   * 引き直さず、できごとが持つ名前をそのまま出すことを見る。
   */
  it('盤面に見えていなくても、持っている名前が出る', () => {
    const board = withLog({ kind: '希望ステップでめくった', player: '後攻', card: '見えなくなったカード', name: 'テスト・裏返された' })

    expect(texts(board)).toEqual(['テスト・裏返されたを希望ステップでめくった'])
  })

  // #111。CONTEXT.md「プランする」：山札の 1 番上をめくってプランゾーンに置く。
  describe('プランをめくった', () => {
    it('めくったカードが出る', () => {
      const board = withLog({ kind: 'プランをめくった', player: '先攻', card: '置いてある', discarded: undefined })

      expect(texts(board)).toEqual(['プランをめくった：テスト・置いてある'])
    })

    it('置き換えられた古いプランが捨札に置かれたことも出る', () => {
      const board: WirePerspective = {
        ...withSquare(emptyBoard('先攻'), ON_SQUARE, [instance('新しいプラン', '先攻'), instance('古いプラン', '先攻')]),
        log: [{ kind: 'プランをめくった', player: '先攻', card: '新しいプラン', discarded: '古いプラン' }],
      }

      expect(texts(board)).toEqual(['プランをめくった：テスト・新しいプラン（テスト・古いプランを捨札へ）'])
    })
  })

  // #111。総合ルール 第3部 第16章 1-1。
  describe('バトルが終わった', () => {
    it('勝者が自分なら、カード名を添えて「勝ち」になる', () => {
      const board = withLog({ kind: 'バトルが終わった', winner: '置いてある' })

      expect(texts(board)).toEqual(['バトル終了：自分のテスト・置いてあるの勝ち'])
    })

    it('勝者が相手なら、カード名を添えて「勝ち」になる', () => {
      const board: WirePerspective = {
        ...withSquare(emptyBoard('先攻'), ON_SQUARE, [instance('勝ったユニット', '後攻')]),
        log: [{ kind: 'バトルが終わった', winner: '勝ったユニット' }],
      }

      expect(texts(board)).toEqual(['バトル終了：相手のテスト・勝ったユニットの勝ち'])
    })

    it('引き分けなら「引き分け」になる', () => {
      const board = withLog({ kind: 'バトルが終わった', winner: undefined })

      expect(texts(board)).toEqual(['バトル終了：引き分け'])
    })

    /** 勝者が名指しされていなければ、勝敗を作り出さない。 */
    it('勝者が見えていなければ勝敗を言わない', () => {
      const board = withLog({ kind: 'バトルが終わった', winner: '見えていないカード' })

      expect(texts(board)).toEqual(['バトル終了'])
    })
  })

  it('何も起きていなければ空', () => {
    expect(logLines(emptyBoard('先攻'))).toEqual([])
  })
})

/**
 * 効果の解決 1 つ分のカットイン（#104）。
 *
 * 見出しの言葉が経路と取り違えられていないこと、本文が命令から組み立てられること、
 * 見てはならないものが出ないことを見る。**落とす判断はここに無い**ので、確かめられるのは
 * 「届いたできごとから作り出していないか」だけである。
 */
describe('カットイン', () => {
  const ON_SQUARE: Square = { row: 1, column: 1 }
  const board = withSquare(emptyBoard('先攻'), ON_SQUARE, [instance('置いてある', '先攻')])
  const NAME = 'テスト・置いてある'

  it.each([
    ['誘発', `${NAME}の効果、誘発！`],
    ['起動', `${NAME}の効果、起動！`],
    ['発動', `${NAME}を発動！`],
    ['プレイ', `${NAME}をプレイ！`],
    ['希望', `${NAME}の希望！`],
  ] as const)('見出しは経路ごとに変わる（%s）', (via, heading) => {
    const fresh: readonly DuelEvent[] = [{ kind: '能力を解決した', controller: '先攻', via, source: '置いてある' }]

    expect(cutInViews(board, fresh).map((view) => view.heading)).toEqual([heading])
  })

  it('発生源が名指しされていなければ、経路だけの見出しになる', () => {
    const fresh: readonly DuelEvent[] = [{ kind: '能力を解決した', controller: '先攻', via: '発動', source: undefined }]

    expect(cutInViews(board, fresh)[0]?.heading).toBe('トラップを発動！')
  })

  it('本文は命令 1 つにつき 1 行になる', () => {
    const fresh: readonly DuelEvent[] = [
      { kind: '能力を解決した', controller: '先攻', via: '誘発', source: '置いてある' },
      { kind: '命令を実行した', controller: '先攻', instruction: { kind: '選ぶ', card: '置いてある' } },
      { kind: '命令を実行した', controller: '先攻', instruction: { kind: '破壊する', card: '置いてある' } },
    ]

    expect(cutInViews(board, fresh)[0]?.lines).toEqual([`${NAME}を選んだ`, `${NAME}を破壊した`])
  })

  /** 解決 → 命令 → 行動 → 解決 → 命令、で 2 つのカットインに切れる。 */
  it('次の別種のできごとが来ると切れる', () => {
    const fresh: readonly DuelEvent[] = [
      { kind: '能力を解決した', controller: '先攻', via: '誘発', source: '置いてある' },
      { kind: '命令を実行した', controller: '先攻', instruction: { kind: '選ぶ', card: '置いてある' } },
      { kind: '行動した', player: '先攻', action: '優先権を放棄する', card: undefined, square: undefined },
      { kind: '能力を解決した', controller: '先攻', via: '起動', source: '置いてある' },
      { kind: '命令を実行した', controller: '先攻', instruction: { kind: '破壊する', card: '置いてある' } },
    ]

    const views = cutInViews(board, fresh)

    expect(views).toHaveLength(2)
    expect(views[0]?.lines).toEqual([`${NAME}を選んだ`])
    expect(views[1]?.lines).toEqual([`${NAME}を破壊した`])
  })

  it('「能力を解決した」で始まらない並びからは何も出ない', () => {
    const fresh: readonly DuelEvent[] = [
      { kind: '行動した', player: '先攻', action: '優先権を放棄する', card: undefined, square: undefined },
      { kind: '命令を実行した', controller: '先攻', instruction: { kind: '選ぶ', card: '置いてある' } },
    ]

    expect(cutInViews(board, fresh)).toEqual([])
  })

  it('誰のできごとかが出る', () => {
    const fresh: readonly DuelEvent[] = [{ kind: '能力を解決した', controller: '後攻', via: '誘発', source: undefined }]

    expect(cutInViews(board, fresh)[0]?.whose).toBe('相手')
  })

  /** 見えないカードの名前は、画面のどこにも出ない（`view-model.test.ts` の他の描画と同じ）。 */
  it('見えないカードの名前は、カットインのどこにも出ない', () => {
    const secret = unitFace('テスト・見えないはずのカード')
    const secretBoard = withZone(board, '後攻', '手札', [{ kind: '見えていない', orientation: 'リリース' }])
    expect(JSON.stringify(secretBoard)).not.toContain(secret.name)

    const fresh: readonly DuelEvent[] = [
      { kind: '能力を解決した', controller: '先攻', via: '誘発', source: undefined },
      { kind: '命令を実行した', controller: '先攻', instruction: { kind: '破壊する', card: undefined } },
    ]

    expect(JSON.stringify(cutInViews(secretBoard, fresh))).not.toContain(secret.name)
  })

  it('新しく届いた分が空なら、カットインも空', () => {
    expect(cutInViews(board, [])).toEqual([])
  })
})

/**
 * フェイズ・ターンの切り替わり（#96）。
 *
 * 通信の形式は変えず、前後の盤面で `turn` を比べるだけで作れることを見る。ターンが変わる
 * 時は必ずフェイズも変わる（`turn.ts` の `beginPhase`）ので、両方出ることも確かめる。
 */
describe('フェイズ・ターンの切り替わり', () => {
  const board = emptyBoard('先攻')

  it('比べる相手がいなければ、何も出ない', () => {
    expect(transitionViews(undefined, board)).toEqual([])
  })

  it('ターンもフェイズも変わっていなければ、何も出ない', () => {
    expect(transitionViews(board.turn, board)).toEqual([])
  })

  it('フェイズだけ変わっていれば、フェイズの見出しだけ出る', () => {
    const changed: WirePerspective = { ...board, turn: { ...board.turn, phase: 'スマッシュフェイズ' } }

    expect(transitionViews(board.turn, changed)).toEqual([{ heading: 'スマッシュフェイズ' }])
  })

  it('ターン数だけ変わっていれば、ターンの見出しだけ出る', () => {
    const changed: WirePerspective = { ...board, turn: { ...board.turn, number: 2 } }

    expect(transitionViews(board.turn, changed)).toEqual([{ heading: '第 2 ターン：自分のターン' }])
  })

  it('手番が変わっていれば、ターン数が同じでもターンの見出しが出る', () => {
    const changed: WirePerspective = { ...board, turn: { ...board.turn, active: '後攻' } }

    expect(transitionViews(board.turn, changed)).toEqual([{ heading: '第 1 ターン：相手のターン' }])
  })

  it('見る人から見た手番の呼び方になる', () => {
    const opponentView = emptyBoard('後攻')
    const changed: WirePerspective = { ...opponentView, turn: { ...opponentView.turn, active: '先攻', number: 2 } }

    expect(transitionViews(opponentView.turn, changed)).toEqual([{ heading: '第 2 ターン：相手のターン' }])
  })

  /** 新しいターンは必ず最初のフェイズから始まる（`turn.ts` の `beginPhase`）。 */
  it('ターンが変わる時は、フェイズの見出しも一緒に出る', () => {
    const nextTurn: Turn = { ...board.turn, number: 2, active: '後攻', phase: 'リリースフェイズ' }
    const changed: WirePerspective = { ...board, turn: nextTurn }

    expect(transitionViews(board.turn, changed)).toEqual([
      { heading: '第 2 ターン：相手のターン' },
      { heading: 'リリースフェイズ' },
    ])
  })
})

/**
 * #115。演出は待ち行列に溜まる（`index.ts`）。演出が出ている間は打てないので、出しておく
 * 長さはそのまま待ち時間になる。
 */
describe('演出を出しておく長さ', () => {
  /** 溜まった分を順に出し切るまでの合計。1 件出すたびに待っている件数が 1 つ減る。 */
  function totalMsFor(count: number): number {
    return Array.from({ length: count }, (_, shown) => overlayDurationMs(count - 1 - shown)).reduce(
      (sum, each) => sum + each,
      0,
    )
  }

  it('後ろに何も待っていなければ、通常の長さで出る', () => {
    expect(overlayDurationMs(0)).toBe(2000)
  })

  it('後ろに待っているほど短くなる', () => {
    expect(overlayDurationMs(3)).toBeLessThan(overlayDurationMs(1))
    expect(overlayDurationMs(9)).toBeLessThan(overlayDurationMs(3))
  })

  /** 読む前に消えては出す意味が無いので、いくら溜まっても下限を割らない。 */
  it('どれだけ溜まっても、短くなりすぎない', () => {
    expect(overlayDurationMs(1000)).toBe(400)
  })

  /**
   * 自動放棄（#14）で何段も一気に進むと、1 回の盤面到着で何件も溜まる。**溜まった時ほど
   * 1 件あたりを短くする**ので、件数に比例しては伸びない。
   */
  it('溜まった時の合計が、件数に比例して伸びない', () => {
    // 通常の長さのまま 10 件出すと 20 秒かかる。
    expect(totalMsFor(10)).toBeLessThan(10_000)
    expect(totalMsFor(3)).toBeLessThan(3 * 2000)
  })
})

// #115。演出が出ているかどうかで、行える手を出すかが決まる（`index.ts`）。
describe('演出が出ているか', () => {
  it('出すものが無ければ、出ていない', () => {
    expect(showsOverlay({ transitions: [], cutIns: [] })).toBe(false)
  })

  it('フェイズ・ターンの切り替わりだけでも、出ている', () => {
    expect(showsOverlay({ transitions: [{ heading: 'メインフェイズ' }], cutIns: [] })).toBe(true)
  })

  it('カットインだけでも、出ている', () => {
    expect(showsOverlay({ transitions: [], cutIns: [{ whose: '自分', heading: '効果、発動！', lines: [] }] })).toBe(
      true,
    )
  })
})
