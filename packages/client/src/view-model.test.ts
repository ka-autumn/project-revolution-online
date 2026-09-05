import { describe, expect, it } from 'vitest'
import { indexOfSquare } from '@revolution/engine'
import type {
  DuelEvent,
  LoggedEvent,
  Player,
  PlayerZone,
  Procedure,
  Progress,
  Square,
  Turn,
  WireCardInstance,
  WirePerspective,
} from '@revolution/engine'
import { emptyBoard, instance, logged, unitFace, withZone } from './test-support.js'
import {
  boardView,
  cutInViews,
  lobbyView,
  logLines,
  overlayDurationMs,
  priorityReason,
  showsOverlay,
  transitionViews,
} from './view-model.js'
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
      battles: [
        {
          square,
          attacker: 'せめた1枚',
          attacked: 'うけた1枚',
          step: '第１ダメージステップ',
          dealtDamage: [],
          endOfBattleTriggered: false,
          heldBank: [],
          heldTriggered: [],
          startedAt: 0,
        },
      ],
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
          startedAt: 0,
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
  function withLog(...events: readonly DuelEvent[]): WirePerspective {
    const board = withSquare(emptyBoard('先攻'), ON_SQUARE, [instance('置いてある', '先攻')])
    return { ...board, log: logged(events) }
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
      { kind: 'できごと', whose: '相手', text: 'プランする', depth: 0 },
      { kind: 'できごと', whose: '自分', text: 'エネルギーを置く', depth: 0 },
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

    expect(logLines(board)).toEqual([
      { kind: 'できごと', whose: '相手', text: 'テスト・置いてあるにダメージ 500', depth: 0 },
    ])
  })

  /**
   * #159。効果が置き先を選ばせる場合、選ばれるのはスクエアそのものである（`log.ts` の
   * `選ぶ`）。見る人から見た呼び名で出す（総合ルール 第2部 第22章 6）。
   */
  describe('効果が選んだもの', () => {
    it('カードを選んだなら、そのカードの名前が出る', () => {
      const board = withLog({
        kind: '命令を実行した',
        controller: '先攻',
        instruction: { kind: '選ぶ', card: '置いてある', square: undefined },
      })

      expect(texts(board)).toEqual(['テスト・置いてあるを選んだ'])
    })

    it('スクエアを選んだなら、どこを選んだのかが出る', () => {
      const board = withLog({
        kind: '命令を実行した',
        controller: '先攻',
        instruction: { kind: '選ぶ', card: undefined, square: ON_SQUARE },
      })

      expect(texts(board)).toEqual(['中央エリアの中央ラインを選んだ'])
    })

    /** どちらも指していなければ、名前もスクエアも作り出さない（#95）。 */
    it('どちらも指していなければ、選んだことだけが出る', () => {
      const board = withLog({
        kind: '命令を実行した',
        controller: '先攻',
        instruction: { kind: '選ぶ', card: undefined, square: undefined },
      })

      expect(texts(board)).toEqual(['選んだ'])
    })
  })

  /** ルールエフェクトはどちらのプレイヤーにも支配されない（総合ルール 第4部 第14章 1）。 */
  it('ルールが起こしたことは、誰のものにもならない', () => {
    const board = withLog({ kind: 'ルールで捨札に置かれた', cards: ['置いてある'] })

    expect(logLines(board)).toEqual([
      { kind: 'できごと', whose: undefined, text: 'ルールで捨札：テスト・置いてある', depth: 0 },
    ])
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

  /**
   * フェイズやステップの始めに自動で行われる処理（#157）。
   *
   * **枚数と名指しは別に届く**（`log.ts` の `リリースした`）。名指しが落ちても何枚だったか
   * は落ちていないので、名前が出せない分は枚数で言う。行が出るのは行われた時だけなので、
   * 「行われなかった」を言い分ける必要はここに無い。
   */
  describe('自動で行われる処理', () => {
    const ANOTHER_SQUARE: Square = { row: 0, column: 0 }

    /** そのできごとと、名前を引ける 2 枚が届いた盤面。 */
    function withTwoNamed(...events: readonly DuelEvent[]): WirePerspective {
      const board = withSquare(withLog(...events), ANOTHER_SQUARE, [instance('もう 1 枚', '先攻')])
      return board
    }

    // 総合ルール 第3部 第5章 1
    it('リリースされたカードの名前が、ゾーンとあわせて出る', () => {
      const board = withTwoNamed({
        kind: 'リリースした',
        player: '先攻',
        released: [{ zone: 'エネルギーゾーン', count: 2, cards: ['置いてある', 'もう 1 枚'] }],
      })

      // 区切りは `、` である。カード名そのものが `・` を含む（「テスト・置いてある」）ので、
      // `・` で繋ぐとどこまでが 1 枚なのか読めなくなる。
      expect(logLines(board)).toEqual([
        {
          kind: 'できごと',
          whose: '自分',
          text: 'リリース（エネルギーゾーン）：テスト・置いてある、テスト・もう 1 枚',
          depth: 0,
        },
      ])
    })

    /**
     * 1 件のできごとが、ゾーンの数だけの行になる（`view-model.ts` の `linesOf`）。
     *
     * **並びは届いたとおりのままである。** 1 件から作っているので、リリースした順と行の
     * 前後が入れ替わることはない（`log.ts` の `リリースした`）。
     */
    it('ゾーンをまたいだリリースは、ゾーンごとの行になる', () => {
      const board = withTwoNamed({
        kind: 'リリースした',
        player: '先攻',
        released: [
          { zone: 'スクエア', count: 1, cards: ['置いてある'] },
          { zone: 'エネルギーゾーン', count: 1, cards: ['もう 1 枚'] },
        ],
      })

      // 画面は新しい順に出す（#111）ので、届いた並びとは逆に出る。
      expect(texts(board)).toEqual([
        'リリース（エネルギーゾーン）：テスト・もう 1 枚',
        'リリース（バトルスペース）：テスト・置いてある',
      ])
    })

    /**
     * スクエアだけは「バトルスペース」と呼ぶ（`orientedZoneLabel`）。
     *
     * 総合ルール 第2部 第21章 1-1: スクエアはそれぞれが単独のゾーンである。まとめて
     * リリースされた分に単数のゾーン名を貼ると、9 つの別々のゾーンを 1 つのように見せる
     * ことになる。**呼び替えるのは画面だけで、届くできごとは `スクエア` のままである。**
     */
    it('スクエアからのリリースは、バトルスペースと出る', () => {
      const event: DuelEvent = {
        kind: 'リリースした',
        player: '先攻',
        released: [{ zone: 'スクエア', count: 1, cards: ['置いてある'] }],
      }
      const board = withLog(event)

      expect(texts(board)).toEqual(['リリース（バトルスペース）：テスト・置いてある'])
      // 届いたできごとは呼び替えられていない。
      expect(board.log[0]?.event).toEqual(event)
    })

    /**
     * スマッシュゾーンのカードは裏向きで、持ち主からも見られない（総合ルール 第2部
     * 第21章 7-3）。名前が出せない分を黙ると、届いているより少なく見せることになる。
     * **ゾーンで分かれているので、名前の出ない分がどこの何枚だったのかが読める。**
     */
    it('名指しされていない分は、そのゾーンの枚数で出る', () => {
      const board = withLog({
        kind: 'リリースした',
        player: '先攻',
        released: [
          { zone: 'エネルギーゾーン', count: 3, cards: ['置いてある'] },
          { zone: 'スマッシュゾーン', count: 2, cards: [] },
        ],
      })

      expect(texts(board)).toEqual([
        'リリース（スマッシュゾーン）：2 枚',
        'リリース（エネルギーゾーン）：テスト・置いてある ほか 2 枚',
      ])
    })

    // 総合ルール 第3部 第6章 1-1
    it('ドローフェイズで引いたカードの名前が出る', () => {
      const board = withLog({ kind: 'カードを引いた', player: '先攻', card: '置いてある' })

      expect(texts(board)).toEqual(['カードを引いた：テスト・置いてある'])
    })

    /** 名指しが落ちていれば、名前のところは出ない。**「見えていないカード」とも書かない。** */
    it('名指しされていなければ、引いたことだけが出る', () => {
      const board = withLog({ kind: 'カードを引いた', player: '後攻', card: undefined })

      expect(logLines(board)).toEqual([{ kind: 'できごと', whose: '相手', text: 'カードを引いた', depth: 0 }])
    })

    /** 総合ルール 第3部 第10章 1: 取り除かれるのは両者のカードとプレイヤーのダメージである。 */
    it('ダメージの除去は、誰のものにもならない', () => {
      const board = withLog({ kind: 'ダメージが取り除かれた' })

      expect(logLines(board)).toEqual([
        { kind: 'できごと', whose: undefined, text: 'ダメージが取り除かれた', depth: 0 },
      ])
    })

    // 総合ルール 第3部 第18章 1
    it('回復ステップで回復した量が出る', () => {
      const board = withLog({ kind: 'ダメージを回復した', player: '後攻', amount: 2000 })

      expect(logLines(board)).toEqual([{ kind: 'できごと', whose: '相手', text: 'ダメージ 2000 を回復した', depth: 0 }])
    })

    /** 効果によるドロー（総合ルール 第2部 第21章 1-5）も、枚数と名指しの出し方は同じ。 */
    it('効果で引いたカードも、名前と枚数で出る', () => {
      const board = withLog({
        kind: '命令を実行した',
        controller: '後攻',
        instruction: { kind: 'カードを引く', player: '後攻', count: 2, cards: ['置いてある'] },
      })

      expect(texts(board)).toEqual(['相手が引いた：テスト・置いてある ほか 1 枚'])
    })

    it('効果で引いたカードが 1 枚も名指しされていなければ、枚数だけが出る', () => {
      const board = withLog({
        kind: '命令を実行した',
        controller: '後攻',
        instruction: { kind: 'カードを引く', player: '後攻', count: 2, cards: [] },
      })

      expect(texts(board)).toEqual(['相手が引いた：2 枚'])
    })
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
      const board = withNamedInLog({ kind: 'バトルの勝敗が決まった', winner: '勝った' }, instance('勝った', '後攻'))

      expect(texts(board)).toEqual(['バトル結果：相手のテスト・勝ったの勝ち'])
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
        log: logged([{ kind: 'プランをめくった', player: '先攻', card: '新しいプラン', discarded: '古いプラン' }]),
      }

      expect(texts(board)).toEqual(['プランをめくった：テスト・新しいプラン（テスト・古いプランを捨札へ）'])
    })
  })

  /**
   * #111、#160。総合ルール 第3部 第16章 1-1: バトルの勝敗はバトル終了ステップの開始時に
   * 判定される。**決まった瞬間の行であって、バトルを閉じる行ではない。**
   */
  describe('バトルの勝敗が決まった', () => {
    it('勝者が自分なら、カード名を添えて「勝ち」になる', () => {
      const board = withLog({ kind: 'バトルの勝敗が決まった', winner: '置いてある' })

      expect(texts(board)).toEqual(['バトル結果：自分のテスト・置いてあるの勝ち'])
    })

    it('勝者が相手なら、カード名を添えて「勝ち」になる', () => {
      const board: WirePerspective = {
        ...withSquare(emptyBoard('先攻'), ON_SQUARE, [instance('勝ったユニット', '後攻')]),
        log: logged([{ kind: 'バトルの勝敗が決まった', winner: '勝ったユニット' }]),
      }

      expect(texts(board)).toEqual(['バトル結果：相手のテスト・勝ったユニットの勝ち'])
    })

    it('引き分けなら「引き分け」になる', () => {
      const board = withLog({ kind: 'バトルの勝敗が決まった', winner: undefined })

      expect(texts(board)).toEqual(['バトル結果：引き分け'])
    })

    /** 勝者が名指しされていなければ、勝敗を作り出さない。 */
    it('勝者が見えていなければ勝敗を言わない', () => {
      const board = withLog({ kind: 'バトルの勝敗が決まった', winner: '見えていないカード' })

      expect(texts(board)).toEqual(['バトル結果'])
    })

    /** バトルを閉じる行は、勝敗を言わない区切りだけになる（#160）。 */
    it('バトルが終わった行は、勝敗を持たない区切りになる', () => {
      const board = withLog({ kind: 'バトルが終わった' })

      expect(logLines(board)).toEqual([{ kind: '区切り', whose: undefined, text: '=== バトル終了 ===', depth: 0 }])
    })
  })

  it('何も起きていなければ空', () => {
    expect(logLines(emptyBoard('先攻'))).toEqual([])
  })

  /**
   * 進行そのもの（#133）。**進行はどちらのプレイヤーのものでもない。** ターンにも判定にも
   * 持ち主はいるが、進行させているのはルールである。
   */
  describe('進行', () => {
    /** 何ターン目の、誰の、どのフェイズか（`log.ts` の `Progress`）。 */
    function at(turn: number, active: Player, phase: Progress['phase']): Progress {
      return { turn, active, phase }
    }

    /** 同じターンの中で進むだけなら、フェイズだけを言えば足りる。 */
    it('同じターンの中では、フェイズだけが 1 行で出る', () => {
      const board = withLog({
        kind: '進行が変わった',
        from: at(2, '先攻', 'メインフェイズ'),
        to: at(2, '先攻', 'スマッシュフェイズ'),
      })

      expect(logLines(board)).toEqual([
        {
          kind: '区切り',
          whose: '自分',
          text: '=== 自分のメインフェイズ終了／スマッシュフェイズ開始 ===',
          depth: 0,
        },
      ])
    })

    /**
     * ターンの境目は、終わりと始まりを分けて読ませる。積まれているできごとは 1 件のまま
     * （`log.ts` の `進行が変わった`）なので、**新しい順に出しても 2 行の前後は狂わない。**
     */
    it('ターンの境目は、終わりと始まりの 2 行になる', () => {
      const board = withLog({
        kind: '進行が変わった',
        from: at(2, '先攻', 'リカバリーフェイズ'),
        to: at(3, '後攻', 'リリースフェイズ'),
      })

      // 新しいものが先頭に出る（#111）ので、始まりが上に来る。持ち主も入れ替わる。
      expect(logLines(board)).toEqual([
        { kind: '区切り', whose: '相手', text: '=== 相手の第 3 ターン開始（リリースフェイズ開始） ===', depth: 0 },
        { kind: '区切り', whose: '自分', text: '=== 自分の第 2 ターン終了（リカバリーフェイズ終了） ===', depth: 0 },
      ])
    })

    /**
     * デュエルは先攻のプレイヤーの第 1 ターンから始まる（総合ルール 第3部 第4章 1）ので、
     * 移ってくる元が無い。終わったものが無いぶん、始まりの 1 行だけになる。
     */
    it('デュエルの始まりは、終わりの行を伴わない', () => {
      const board = withLog({
        kind: '進行が変わった',
        from: undefined,
        to: at(1, '先攻', 'リリースフェイズ'),
      })

      expect(texts(board)).toEqual(['=== 自分の第 1 ターン開始（リリースフェイズ開始） ==='])
    })

    /**
     * 総合ルール 第3部 第11章 3。呼び名は条文の語をそのまま使う。ステップの区切りは
     * 手順の中にあるが、区切りとして読ませるので字下げしない。
     */
    it('バトルのステップは、条文の呼び名がそのまま出る', () => {
      const board = withLog({ kind: 'バトルのステップが変わった', step: '第１ダメージステップ' })

      expect(logLines(board)).toEqual([
        { kind: '区切り', whose: undefined, text: '--- 第１ダメージステップ ---', depth: 0 },
      ])
    })

    /** 誰の判定かは文の中で言う。区切りの行は、どちらのプレイヤーのものでもない。 */
    it('スマッシュ判定の始まりは、繰り返す回数とあわせて出る', () => {
      const board = withLog({ kind: 'スマッシュ判定が始まった', player: '後攻', repeats: 2 })

      expect(logLines(board)).toEqual([
        { kind: '区切り', whose: '相手', text: '=== 相手のスマッシュ判定開始（2 回） ===', depth: 0 },
      ])
    })

    it('スマッシュ判定の終わりも出る', () => {
      const board = withLog({ kind: 'スマッシュ判定が終わった', player: '先攻' })

      expect(logLines(board)).toEqual([
        { kind: '区切り', whose: '自分', text: '=== 自分のスマッシュ判定終了 ===', depth: 0 },
      ])
    })

    /**
     * 総合ルール 第3部 第17章 3: 繰り返して区別が必要な場合、「第１希望ステップ」のように
     * 表現する。回復ステップは 1 回だけなので数字が付かない。
     *
     * 誰の判定のステップかも言う。字下げが無いので、入れ子になった判定を見分けられるのは
     * これだけになる（同 2-2）。
     */
    it.each([
      ['回復ステップ', 0, '--- 自分の回復ステップ ---'],
      ['希望ステップ', 1, '--- 自分の第１希望ステップ ---'],
      ['確定ステップ', 2, '--- 自分の第２確定ステップ ---'],
    ] as const)('スマッシュ判定のステップは、何回目かとあわせて出る（%s）', (step, round, expected) => {
      const board = withLog({ kind: 'スマッシュ判定のステップが変わった', player: '先攻', step, round })

      expect(texts(board)).toEqual([expected])
    })

    it('待機中になったことと、戻ったことが出る', () => {
      const board = withLog(
        { kind: 'スマッシュ判定が待機中になった', player: '先攻' },
        { kind: 'スマッシュ判定が戻った', player: '先攻' },
      )

      // 新しいものが先頭に出る（#111）。
      expect(texts(board)).toEqual(['スマッシュ判定が戻った', 'スマッシュ判定が待機中になった'])
    })
  })

  /**
   * 字下げ（#133）。**字下げが表すのは入れ子だけである。** 手順が 1 つ進行しているだけなら
   * それは進行の本筋なので、中の行も字下げしない。
   */
  describe('字下げ', () => {
    /** 進行中の手順を並べた盤面。深さだけを見るので、できごとの中身は問わない。 */
    function withDuring(...during: readonly (readonly Procedure[])[]): WirePerspective {
      return {
        ...emptyBoard('先攻'),
        log: during.map((each) => ({
          event: { kind: 'ダメージを受けた', player: '先攻', amount: 1000 },
          during: each,
        })),
      }
    }

    it('手順の外も、手順が 1 つ進行しているだけの中も、字下げしない', () => {
      const board = withDuring([], [{ kind: 'バトル' }], [{ kind: 'スマッシュ判定', player: '後攻' }])

      expect(logLines(board).map((line) => line.depth)).toEqual([0, 0, 0])
    })

    /** 総合ルール 第3部 第17章 2-2: スマッシュ判定中にスマッシュ判定が発生する。 */
    it('手順の中で始まった手順の中は、1 つ深くなる', () => {
      const board = withDuring([
        { kind: 'スマッシュ判定', player: '後攻' },
        { kind: 'スマッシュ判定', player: '先攻' },
      ])

      expect(logLines(board)[0]?.depth).toBe(1)
    })

    /**
     * 手順の始まりと終わりの行は、**その手順自身**の深さに立つ（`view-model.ts` の
     * `depthOf`）。外側の判定の中で始まった判定は、始まりの行から 1 つ深いところに出る。
     */
    it('入れ子になった手順は、始まりの行から深くなる', () => {
      const outer: readonly Procedure[] = [{ kind: 'スマッシュ判定', player: '後攻' }]
      const board: WirePerspective = {
        ...emptyBoard('先攻'),
        log: [
          // 外側の判定が始まり、そのステップが進み、待機して、内側の判定が始まる。
          { event: { kind: 'スマッシュ判定が始まった', player: '後攻', repeats: 1 }, during: [] },
          {
            event: { kind: 'スマッシュ判定のステップが変わった', player: '後攻', step: '希望ステップ', round: 1 },
            during: outer,
          },
          { event: { kind: 'スマッシュ判定が待機中になった', player: '後攻' }, during: outer },
          { event: { kind: 'スマッシュ判定が始まった', player: '先攻', repeats: 1 }, during: outer },
          {
            event: { kind: 'スマッシュ判定のステップが変わった', player: '先攻', step: '回復ステップ', round: 0 },
            during: [...outer, { kind: 'スマッシュ判定', player: '先攻' }],
          },
          { event: { kind: 'スマッシュ判定が終わった', player: '先攻' }, during: outer },
          { event: { kind: 'スマッシュ判定が戻った', player: '後攻' }, during: outer },
          { event: { kind: 'スマッシュ判定が終わった', player: '後攻' }, during: [] },
        ],
      }

      // 起きた順に戻して見る（`logLines` は新しい順に出す）。
      expect([...logLines(board)].reverse().map((line) => line.depth)).toEqual([0, 0, 0, 1, 1, 1, 0, 0])
    })

    /** 既存のできごとにも付く。できごとの型を 1 つずつ広げていないことが、ここに出る。 */
    it('もとからあるできごとも、入れ子の中なら字下げされる', () => {
      const board: WirePerspective = {
        ...emptyBoard('先攻'),
        log: [
          {
            event: { kind: 'ルールで捨札に置かれた', cards: [] },
            during: [{ kind: 'バトル' }, { kind: 'スマッシュ判定', player: '後攻' }],
          },
        ],
      }

      expect(logLines(board)[0]?.depth).toBe(1)
    })
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

    expect(cutInViews(board, logged(fresh)).map((view) => view.heading)).toEqual([heading])
  })

  it('発生源が名指しされていなければ、経路だけの見出しになる', () => {
    const fresh: readonly DuelEvent[] = [{ kind: '能力を解決した', controller: '先攻', via: '発動', source: undefined }]

    expect(cutInViews(board, logged(fresh))[0]?.heading).toBe('トラップを発動！')
  })

  it('本文は命令 1 つにつき 1 行になる', () => {
    const fresh: readonly DuelEvent[] = [
      { kind: '能力を解決した', controller: '先攻', via: '誘発', source: '置いてある' },
      { kind: '命令を実行した', controller: '先攻', instruction: { kind: '選ぶ', card: '置いてある', square: undefined } },
      { kind: '命令を実行した', controller: '先攻', instruction: { kind: '破壊する', card: '置いてある' } },
    ]

    expect(cutInViews(board, logged(fresh))[0]?.lines).toEqual([`${NAME}を選んだ`, `${NAME}を破壊した`])
  })

  /** 解決 → 命令 → 行動 → 解決 → 命令、で 2 つのカットインに切れる。 */
  it('次の別種のできごとが来ると切れる', () => {
    const fresh: readonly DuelEvent[] = [
      { kind: '能力を解決した', controller: '先攻', via: '誘発', source: '置いてある' },
      { kind: '命令を実行した', controller: '先攻', instruction: { kind: '選ぶ', card: '置いてある', square: undefined } },
      { kind: '行動した', player: '先攻', action: '優先権を放棄する', card: undefined, square: undefined },
      { kind: '能力を解決した', controller: '先攻', via: '起動', source: '置いてある' },
      { kind: '命令を実行した', controller: '先攻', instruction: { kind: '破壊する', card: '置いてある' } },
    ]

    const views = cutInViews(board, logged(fresh))

    expect(views).toHaveLength(2)
    expect(views[0]?.lines).toEqual([`${NAME}を選んだ`])
    expect(views[1]?.lines).toEqual([`${NAME}を破壊した`])
  })

  it('「能力を解決した」で始まらない並びからは何も出ない', () => {
    const fresh: readonly DuelEvent[] = [
      { kind: '行動した', player: '先攻', action: '優先権を放棄する', card: undefined, square: undefined },
      { kind: '命令を実行した', controller: '先攻', instruction: { kind: '選ぶ', card: '置いてある', square: undefined } },
    ]

    expect(cutInViews(board, logged(fresh))).toEqual([])
  })

  it('誰のできごとかが出る', () => {
    const fresh: readonly DuelEvent[] = [{ kind: '能力を解決した', controller: '後攻', via: '誘発', source: undefined }]

    expect(cutInViews(board, logged(fresh))[0]?.whose).toBe('相手')
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

    expect(JSON.stringify(cutInViews(secretBoard, logged(fresh)))).not.toContain(secret.name)
  })

  it('新しく届いた分が空なら、カットインも空', () => {
    expect(cutInViews(board, [])).toEqual([])
  })
})

/**
 * フェイズ・ターンの切り替わり（#96、#155）。
 *
 * **材料は積まれた `進行が変わった` である。** 前後の盤面を比べ直さない——変わり目を数えるのは
 * エンジンで、ここはそれを何枚の見出しにするかだけを決める。ターンが変わる時は必ずフェイズも
 * 変わる（`turn.ts` の `beginPhase`）ので、1 件から 2 枚出ることも確かめる。
 */
describe('フェイズ・ターンの切り替わり', () => {
  const board = emptyBoard('先攻')
  const start: Progress = { turn: 1, active: '先攻', phase: 'ドローフェイズ' }

  /** 変わり目 1 つ分のできごと。 */
  function moved(from: Progress | undefined, to: Progress): readonly LoggedEvent[] {
    return logged([{ kind: '進行が変わった', from, to }])
  }

  it('新しく届いたできごとが無ければ、何も出ない', () => {
    expect(transitionViews([], board)).toEqual([])
  })

  it('進行が変わっていなければ、何も出ない', () => {
    expect(transitionViews(logged([{ kind: 'カードを引いた', player: '先攻', card: undefined }]), board)).toEqual([])
  })

  it('フェイズだけ変わっていれば、フェイズの見出しだけ出る', () => {
    const views = transitionViews(moved(start, { ...start, phase: 'スマッシュフェイズ' }), board)

    expect(views).toEqual([{ heading: 'スマッシュフェイズ' }])
  })

  it('ターン数だけ変わっていれば、ターンの見出しだけ出る', () => {
    expect(transitionViews(moved(start, { ...start, turn: 2 }), board)).toEqual([
      { heading: '第 2 ターン：自分のターン' },
    ])
  })

  it('手番が変わっていれば、ターン数が同じでもターンの見出しが出る', () => {
    expect(transitionViews(moved(start, { ...start, active: '後攻' }), board)).toEqual([
      { heading: '第 1 ターン：相手のターン' },
    ])
  })

  it('見る人から見た手番の呼び方になる', () => {
    const opponentView = emptyBoard('後攻')
    const views = transitionViews(moved(start, { ...start, turn: 2, active: '先攻' }), opponentView)

    expect(views).toEqual([{ heading: '第 2 ターン：相手のターン' }])
  })

  /** 新しいターンは必ず最初のフェイズから始まる（`turn.ts` の `beginPhase`）。 */
  it('ターンが変わる時は、1 件のできごとからフェイズの見出しも一緒に出る', () => {
    const views = transitionViews(moved(start, { turn: 2, active: '後攻', phase: 'リリースフェイズ' }), board)

    expect(views).toEqual([{ heading: '第 2 ターン：相手のターン' }, { heading: 'リリースフェイズ' }])
  })

  /**
   * 自動で進むフェイズ（#157）は、1 回の行動でまとめて届く。**差し引きの結果ではなく、起きた
   * 変わり目をそのまま出す。**
   */
  it('変わり目がいくつも届けば、その数だけ出る', () => {
    const views = transitionViews(
      logged([
        { kind: '進行が変わった', from: start, to: { ...start, phase: 'エネルギーフェイズ' } },
        { kind: 'カードを引いた', player: '先攻', card: undefined },
        { kind: '進行が変わった', from: { ...start, phase: 'エネルギーフェイズ' }, to: { ...start, phase: 'メインフェイズ' } },
      ]),
      board,
    )

    expect(views).toEqual([{ heading: 'エネルギーフェイズ' }, { heading: 'メインフェイズ' }])
  })

  /** デュエルの始まりには「前」が無い（`setup.ts` の `prepareDuel`）。 */
  it('移ってくる元が無ければ、何も出ない', () => {
    expect(transitionViews(moved(undefined, start), board)).toEqual([])
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

/**
 * 相手が何をして、いま優先権が回ってきたのか（#147）。
 *
 * 相手のユニットが味方エリアに移動してきた、のような**その場で割り込むかどうかを決める材料**を
 * 打つところで読めるようにする。行える手を盤面の上に移した（#128）ので、確かめるのに操作ログ
 * まで目を往復させない。
 *
 * **出すのは直前の 1 手だけである。** そこまでの経過はログ（#95）にある。
 */
describe('優先権が回ってきた理由', () => {
  const ON_SQUARE: Square = { row: 1, column: 1 }

  /** 相手のカードが 1 枚スクエアにある盤面。名前はそこから引ける。 */
  function board(): WirePerspective {
    return withSquare(emptyBoard('先攻'), ON_SQUARE, [instance('あいてのカード', '後攻')])
  }

  const moved: DuelEvent = {
    kind: '行動した',
    player: '後攻',
    action: 'ユニットを移動する',
    card: 'あいてのカード',
    square: ON_SQUARE,
  }

  /** 移動してきた先が分かることが、割り込むかどうかの判断に効く。 */
  it('相手が行った手が、何をしたのかの文で出る', () => {
    expect(priorityReason(board(), logged([moved]))).toBe('相手がテスト・あいてのカードを中央エリアの中央ラインに移動させました')
  })

  it.each([
    ['プランする', undefined, undefined, '相手がプランしました'],
    ['エネルギーを置く', 'あいてのカード', undefined, '相手がテスト・あいてのカードをエネルギーゾーンに置きました'],
    ['スマッシュする', 'あいてのカード', undefined, '相手がテスト・あいてのカードでスマッシュしました'],
    ['トラップを発動する', 'あいてのカード', undefined, '相手がテスト・あいてのカードを発動しました'],
    ['起動型能力を起動する', 'あいてのカード', undefined, '相手がテスト・あいてのカードの能力を起動しました'],
  ] as const)('%s も文になる', (action, card, square, expected) => {
    const event: DuelEvent = { kind: '行動した', player: '後攻', action, card, square }

    expect(priorityReason(board(), logged([event]))).toBe(expected)
  })

  /** 自分が打った手で優先権が動いたなら、読ませるものは無い。自分が何をしたかは知っている。 */
  it('自分が行った手では、何も出ない', () => {
    const mine: DuelEvent = { kind: '行動した', player: '先攻', action: 'プランする', card: undefined, square: undefined }

    expect(priorityReason(board(), logged([mine]))).toBeUndefined()
  })

  /**
   * バンクの解決やステップの進行で優先権が来た場合、行われた手は無い。効果の解決はカットイン
   * （#104）が出しているので、ここで言うと二重になる。
   */
  it('行われた手が無ければ、何も出ない', () => {
    const resolved: DuelEvent = { kind: '能力を解決した', controller: '後攻', source: 'あいてのカード', via: '誘発' }

    expect(priorityReason(board(), logged([resolved]))).toBeUndefined()
    expect(priorityReason(board(), logged([]))).toBeUndefined()
  })

  /** 1 回の盤面に手が複数あっても、優先権を渡してきたのは最後の 1 手である。 */
  it('手が複数あれば、直前の 1 手だけが出る', () => {
    const planned: DuelEvent = {
      kind: '行動した',
      player: '後攻',
      action: 'プランする',
      card: undefined,
      square: undefined,
    }

    expect(priorityReason(board(), logged([planned, moved]))).toBe(
      '相手がテスト・あいてのカードを中央エリアの中央ラインに移動させました',
    )
  })

  /**
   * 名指しは射影で落ちる（#129・#139）。相手の手札から出たカードのように、その時見えて
   * いなかったものは名前が出ない。**見えていないものの名前を作らない**（#95）。
   */
  it('名指しされていないカードは、名前を作り出さない', () => {
    const hidden: DuelEvent = {
      kind: '行動した',
      player: '後攻',
      action: 'トラップとしてプレイする',
      card: undefined,
      square: undefined,
    }

    expect(priorityReason(board(), logged([hidden]))).toBe('相手がカードをトラップとしてプレイしました')
  })
})

/** #175。ロビーに並ぶ部屋。 */
describe('ロビー', () => {
  const waiting = { code: 'ま', name: 'まっているへや', status: '相手を待っている', cpu: false } as const
  const playing = { code: 'う', name: 'うっているへや', status: '対戦中', cpu: false } as const
  const withCpu = { code: 'し', name: 'ひとりのへや', status: '対戦中', cpu: true } as const
  const over = { code: 'お', name: 'おわったへや', status: '終わった', cpu: false } as const

  /** 一覧を見る人がまずしたいのは、打てる部屋に入ることである。 */
  it('入れる部屋が先に並ぶ', () => {
    expect(lobbyView([over, playing, waiting]).map((view) => view.code)).toEqual(['ま', 'う', 'お'])
  })

  it('入れるのは、相手を待っている部屋だけ', () => {
    expect(lobbyView([waiting, playing, withCpu, over]).map((view) => view.joinable)).toEqual([
      true,
      false,
      false,
      false,
    ])
  })

  it('CPU との対戦は、そうと分かる', () => {
    expect(lobbyView([withCpu])[0]?.status).toBe('CPU と対戦中')
    expect(lobbyView([playing])[0]?.status).toBe('対戦中')
  })

  it('部屋が無ければ、並ぶものも無い', () => {
    expect(lobbyView([])).toEqual([])
  })
})
