import { describe, expect, it } from 'vitest'
// ゾーンを組み立てるためだけに `putInZone` を使う。engine の中からゾーンを差し替えるための
// 関数であり、公開する API ではない（`smash.test.ts` と同じ）。
import { moveToZone, putInZone } from './duel.js'
// できごとを積む `record` も engine の内部にある。積む時に見え方が決まる（#129）。
import { record } from './log.js'
import {
  defineStrategy,
  defineTrap,
  defineUnit,
  dream,
  emptyDuelState,
  instantiate,
  perspectiveOf,
  putOnSquare,
  toWire,
} from './index.js'
import type { Card, DuelEvent, DuelState, Player, PlayerZone } from './index.js'

/** 盤面に並べるカード。engine のテストは架空のカードで書く（ADR-0002）。 */
const CARDS = {
  スクエアのユニット: defineUnit({
    name: 'テスト・スクエアのユニット',
    level: 1,
    colors: ['赤'],
    bp: 1000,
    sp: 1000,
    moveIcon: ['上'],
    stars: 1,
    attributes: ['テスト属性'],
    // 印刷されているテキスト（#93）。engine は読まないが、表記として載る。
    text: ['夢（プランゾーンからプレイできる）'],
    // 能力は関数を持つ。表記に混ざって送られてしまわないことを、下の「JSON にできる」で見る。
    abilities: [dream],
  }),
  見えているカード: defineUnit({ name: 'テスト・見えているカード', level: 1, colors: ['白'], bp: 2000, sp: 500 }),
  隠されるカード: defineUnit({ name: 'テスト・隠されるカード', level: 2, colors: ['黒'], bp: 3000, sp: 1500 }),
  トラップ: defineTrap({ name: 'テスト・トラップ', level: 1, triggerIcon: [{ row: 1, column: 1 }] }),
  ストラテジー: defineStrategy({ name: 'テスト・ストラテジー', level: 1, colors: ['赤'] }),
} as const satisfies Readonly<Record<string, Card>>

/** カード 1 枚を、そのプレイヤーのそのゾーンに置く。 */
function place(state: DuelState, owner: Player, zone: PlayerZone, id: string, card: Card): DuelState {
  return putInZone(state, owner, zone, [...state.zones[owner][zone], instantiate({ id, card, owner })])
}

/**
 * 見えているカードと見えていないカードが両方ある盤面。
 *
 * 「隠されるカード」は後攻の手札と山札にだけ置く。先攻から見て、通信のどこにも現れては
 * ならないカードである。
 */
function filledState(): DuelState {
  const placements: readonly (readonly [Player, PlayerZone, string, Card])[] = [
    ['先攻', '手札', '先攻-手札', CARDS.見えているカード],
    ['先攻', '捨札', '先攻-捨札', CARDS.ストラテジー],
    ['先攻', 'トラップゾーン', '先攻-トラップ', CARDS.トラップ],
    ['先攻', '山札', '先攻-山札', CARDS.見えているカード],
    ['後攻', 'エネルギーゾーン', '後攻-エネルギー', CARDS.見えているカード],
    ['後攻', '手札', '後攻-手札', CARDS.隠されるカード],
    ['後攻', '山札', '後攻-山札', CARDS.隠されるカード],
  ]
  const withZones = placements.reduce(
    (state, [owner, zone, id, card]) => place(state, owner, zone, id, card),
    emptyDuelState(),
  )

  return putOnSquare(
    withZones,
    { row: 1, column: 1 },
    instantiate({ id: '先攻-スクエア', card: CARDS.スクエアのユニット, owner: '先攻' }),
  )
}

const 先攻から = perspectiveOf(filledState(), '先攻')
const wire = toWire(先攻から)

// ADR-0004 / ADR-0010。サーバがクライアントへ送る形。
describe('通信に載せる形', () => {
  /**
   * JSON にできることが、この型の存在意義そのものである。
   *
   * `DuelPerspective` には `Card` が残っていて、カードは効果を関数として持つ。関数は
   * `JSON.stringify` で黙って落ちるので、送れないものが混ざっていても気づけない。ここでは
   * 往復して同じになることで、落ちたものが無いことを見る。
   */
  it('JSON にして戻しても変わらない', () => {
    expect(JSON.parse(JSON.stringify(wire))).toEqual(wire)
  })

  /**
   * カードは表記のデータとして載る（ADR-0010）。
   *
   * 受け取った側はカードの実装を持たない（`packages/client` は公開されるので、非公開のカードに
   * 依存できない）。画面に出すものは、すべてここに入っていなければならない。
   */
  it('ユニットは書かれていることが載る', () => {
    const square = wire.squares.flat()[0]

    expect(square?.card).toEqual({
      type: 'ユニット',
      name: 'テスト・スクエアのユニット',
      level: 1,
      colors: ['赤'],
      stars: 1,
      reverseStars: 0,
      attributes: ['テスト属性'],
      // テキストは engine が読まないデータだが、印刷されている表記として載る（#93）。
      text: ['夢（プランゾーンからプレイできる）'],
      bp: 1000,
      sp: 1000,
      moveIcon: ['上'],
    })
  })

  it('トラップはトリガーアイコンが載る', () => {
    const trap = wire.zones.先攻.トラップゾーン[0]
    if (trap?.kind !== '見えている') throw new Error('自分のトラップは見えるはずだった')

    expect(trap.instance.card).toEqual({
      type: 'トラップ',
      name: 'テスト・トラップ',
      level: 1,
      colors: [],
      stars: 0,
      reverseStars: 0,
      attributes: [],
      // テキストを書いていないカードは、空のまま載る。
      text: [],
      triggerIcon: [{ row: 1, column: 1 }],
    })
  })

  /** ストラテジーはムーブアイコンもトリガーアイコンも持たない（`card.ts` の `WrittenCard`）。 */
  it('ストラテジーはアイコンを持たない', () => {
    const discarded = wire.zones.先攻.捨札[0]
    if (discarded?.kind !== '見えている') throw new Error('捨札は見えるはずだった')

    expect(discarded.instance.card).not.toHaveProperty('moveIcon')
    expect(discarded.instance.card).not.toHaveProperty('triggerIcon')
  })

  /**
   * 能力は載らない（ADR-0010）。
   *
   * クライアントはルールの判断を持たないので、能力が何をするかは要らない。効果は関数なので
   * `JSON.stringify` で黙って落ちる。**落ちるからよい**のではなく、**そもそも写していない**
   * ことをここで見る（`wire.ts` の `faceOf`）。
   */
  it('能力は載らない', () => {
    const square = wire.squares.flat()[0]

    expect(square?.card).not.toHaveProperty('abilities')
  })

  it('見えていないカードは、表記も持たないまま載る', () => {
    expect(wire.zones.後攻.手札[0]).toEqual({ kind: '見えていない', orientation: 'リリース' })
  })
})

// #13 の完了条件。通信内容を見ても相手の非公開情報が復元できない。
describe('通信内容に現れないもの', () => {
  const sent = JSON.stringify(wire)

  // 下の「現れない」が、元々どこにも現れないことで通っていないことを見る。
  it('見えているカードの名前は現れる', () => {
    expect(sent).toContain('テスト・見えているカード')
  })

  it.each([
    ['カード名', 'テスト・隠されるカード'],
    ['識別子', '後攻-手札'],
  ])('相手の手札と山札にしかないカードの%sは現れない', (_, leaked) => {
    expect(sent).not.toContain(leaked)
  })
})

/**
 * #139。ログが名指ししているカードは、盤面から居なくなっていても名前を引けるように載る
 * （`perspective.ts` の `DuelPerspective.namedInLog`）。
 *
 * **ここで新しく見せるものは無い。** 載るのは射影を通ったログに名指しが残っている識別子
 * だけなので、一度も見えていないカードは今までどおり現れない。
 */
describe('ログが名指ししているカード', () => {
  /** 何かを行ったことにする。名指しが残るかどうかだけを見るので、行動そのものは問わない。 */
  function played(player: Player, card: string): DuelEvent {
    return { kind: '行動した', player, action: 'カードをプレイする', card, square: undefined }
  }

  /**
   * 先攻のスクエアにいたユニットが山札に戻り、後攻の手札にあるカードも名指しされた盤面。
   *
   * 前者は先攻から見えていた（積む時に見えているので名指しが残る）が、いまは盤面のどこにも
   * 載っていない。後者は先攻から一度も見えていない。
   */
  function withLog(): DuelState {
    const board = filledState()
    const acted = record(record(board, played('先攻', '先攻-スクエア')), played('後攻', '後攻-手札'))
    return moveToZone(acted, '先攻-スクエア', '山札')
  }

  const sentWithLog = JSON.stringify(toWire(perspectiveOf(withLog(), '先攻')))

  it('盤面から居なくなったカードも、名前を引けるように載る', () => {
    const named = toWire(perspectiveOf(withLog(), '先攻')).namedInLog

    expect(named.map((instance) => [instance.id, instance.card.name])).toEqual([
      ['先攻-スクエア', 'テスト・スクエアのユニット'],
    ])
    expect(sentWithLog).toContain('テスト・スクエアのユニット')
  })

  it.each([
    ['カード名', 'テスト・隠されるカード'],
    ['識別子', '後攻-手札'],
  ])('一度も見えていないカードの%sは、ログで名指しされても現れない', (_, leaked) => {
    expect(sentWithLog).not.toContain(leaked)
  })

  it('盤面に載っているカードは、二度は載らない', () => {
    // 名指しされているが、まだスクエアにいる。名前は盤面から引けるので、ここには載らない。
    const stillOnSquare = record(filledState(), played('先攻', '先攻-スクエア'))

    expect(toWire(perspectiveOf(stillOnSquare, '先攻')).namedInLog).toEqual([])
  })
})
