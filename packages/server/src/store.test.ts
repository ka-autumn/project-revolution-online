import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { choose, defineStrategy, defineUnit } from '@revolution/engine'
import type { Card, Deck, FromClient } from '@revolution/engine'
import { emptyRooms, receive, restore, roomOf } from './room.js'
import type { ParticipantId, RoomSetup, Rooms } from './room.js'
import { openStore } from './store.js'
import type { Store } from './store.js'

/**
 * 書いたものが残り、そこから対戦を作り直せることを確かめる（ADR-0018）。
 *
 * **置き場は `:memory:` で開く。** 手元のファイルを触らずに済み、閉じれば消える。確かめたいのは
 * 「書いて、読み戻して、同じところへ進む」ことであって、どこに置いたかではない。
 *
 * サーバはカードを知れない（ADR-0002）ので、デッキは架空のテストカードで組む。
 */

const CHOOSING_NAME = 'テスト・置き場のストラテジー'

const CARDS: Readonly<Record<string, Card>> = Object.fromEntries([
  ...Array.from({ length: 14 }, (_, index) => [
    `TEST-${index}`,
    defineUnit({ name: `テスト・置き場${index}`, level: 0, bp: 100, sp: 100, moveIcon: ['上'] }),
  ]),
  [
    'TEST-S',
    defineStrategy({
      name: CHOOSING_NAME,
      level: 0,
      effect: function* () {
        yield* choose(['ア', 'イ'])
      },
    }),
  ],
])

/** 構築戦の最小枚数（60 枚）を満たす、15 種類 × 4 枚のデッキ（総合ルール 第3部 第1章 3-1）。 */
function buildDeck(): Deck {
  return Object.values(CARDS).flatMap((card) => Array.from({ length: 4 }, () => card))
}

/** 1 枚だけ違うデッキ。**記録と違うデッキで立て直した**場合を作るために要る。 */
function buildOtherDeck(): Deck {
  const [, ...rest] = buildDeck()
  return [defineUnit({ name: 'テスト・置き場のよそもの', level: 0, bp: 100, sp: 100, moveIcon: ['上'] }), ...rest]
}

const DECKS: readonly [Deck, Deck] = [buildDeck(), buildDeck()]
const SETUP: RoomSetup = { decks: DECKS, seed: 20260905, code: 'あたらしいへや' }
const CODE = 'あいことば'
const PASS: FromClient = { kind: '行動する', action: { kind: '優先権を放棄する' } }
const BOTH: ReadonlySet<ParticipantId> = new Set(['あ', 'い'])

/**
 * 部屋をメッセージで動かしながら、起きたことを置き場へ書いていくところ。
 *
 * **`serve.ts` がやっていることと同じ**で、送るところだけが無い。部屋は記録を作るだけで書かない
 * （ADR-0018）ので、書く側をここで受け持つ。
 */
class Table {
  rooms: Rooms = emptyRooms()

  constructor(
    readonly store: Store,
    readonly setup: RoomSetup = SETUP,
  ) {}

  send(who: ParticipantId, message: FromClient, connected: ReadonlySet<ParticipantId> = BOTH): Table {
    const outcome = receive(this.rooms, who, message, this.setup, connected)
    this.store.write(outcome.records)
    this.rooms = outcome.rooms
    return this
  }

  /** 2 人を入れてデュエルを始める。 */
  start(code = CODE): Table {
    return this.send('あ', { kind: '部屋に入る', room: code }).send('い', { kind: '部屋に入る', room: code })
  }

  /**
   * 優先権を持っているほうに放棄させる、を繰り返す。
   *
   * どちらが持っているかは盤面から決まる（`room.ts` の `boards`）ので、**両方に送ってみて、
   * 通ったほうを使う。** 優先権が無ければ断られ、部屋は変わらない。
   */
  passes(times: number): Table {
    for (let n = 0; n < times; n += 1) {
      for (const who of ['あ', 'い'] as const) {
        const before = this.rooms
        this.send(who, PASS)
        if (this.rooms !== before) break
      }
    }

    return this
  }
}

/** その部屋のいまの盤面。作り直したものと見比べるのに使う。 */
function boardOf(rooms: Rooms, code = CODE): unknown {
  const room = rooms.get(code)
  if (room?.duel === undefined) throw new Error('デュエルが始まっているはずだった')

  return room.duel.state
}

describe('置き場（ADR-0018）', () => {
  it('立て直すと、記録した入力から同じ盤面が作り直される', () => {
    const store = openStore(':memory:')
    const table = new Table(store).start().passes(12)

    // 立て直したところ。置き場だけが残っていて、部屋はどこにも無い。
    const restored = restore(store.openDuels(), DECKS)

    expect(restored.has(CODE)).toBe(true)
    expect(boardOf(restored)).toEqual(boardOf(table.rooms))
    store.close()
  })

  it('作り直した部屋には、席に着いていた 2 人がそのままいる', () => {
    const store = openStore(':memory:')
    new Table(store).start().passes(4)

    const restored = restore(store.openDuels(), DECKS)

    expect(roomOf(restored, 'あ')?.code).toBe(CODE)
    expect(roomOf(restored, 'い')?.code).toBe(CODE)
    store.close()
  })

  it('選びかけている答えは書かない。行動が終わったところで 1 手になる（ADR-0008）', () => {
    const store = openStore(':memory:')
    const table = new Table(store).start()

    // まだ 1 手も打っていないので、記録も空である。
    const [before] = store.openDuels()
    expect(before?.steps).toEqual([])

    // 1 手だけ打つ。答えを待たない行動なので、そこで 1 手として書かれる。
    table.passes(1)
    const [after] = store.openDuels()
    expect(after?.steps).toHaveLength(1)
    store.close()
  })

  it('投げ出された対戦は戻らない。記録は残っている（ADR-0017）', () => {
    const store = openStore(':memory:')
    const table = new Table(store).start().passes(4)

    // 相手が繋がっていない対戦からは、打っている途中でも抜けられる（#175）。
    table.send('あ', { kind: 'ロビーに戻る' }, new Set(['あ']))

    expect(table.rooms.has(CODE)).toBe(false)
    expect(store.openDuels()).toEqual([])
    store.close()
  })

  it('閉じた対戦と同じ合言葉で新しく始めても、混ざらない', () => {
    const store = openStore(':memory:')
    const table = new Table(store).start().passes(6)
    table.send('あ', { kind: 'ロビーに戻る' }, new Set(['あ']))

    // 同じ合言葉をもう一度使う。**合言葉が空いているかを見るのは、いま開いている部屋の中だけ**
    // である（`room.ts` の `unusedCode`）ので、これは普通に起こる。
    table.start()

    const open = store.openDuels()
    expect(open).toHaveLength(1)
    expect(open[0]?.steps).toEqual([])
    store.close()
  })

  it('記録と違うデッキで立て直すと、その対戦は作り直さない（ADR-0018）', () => {
    const store = openStore(':memory:')
    new Table(store).start().passes(4)

    const restored = restore(store.openDuels(), [buildOtherDeck(), buildDeck()])

    // **消したのではない。** 記録は置き場に残っていて、戻す先の部屋ができないだけである。
    expect(restored.size).toBe(0)
    expect(store.openDuels()).toHaveLength(1)
    store.close()
  })

  it('CPU が打った手も記録に残る', () => {
    const store = openStore(':memory:')
    new Table(store).send('あ', { kind: '部屋を作る', name: 'ひとり', against: 'CPU' })

    const [duel] = store.openDuels()
    expect(duel?.cpu).toBeDefined()
    // 部屋を作った時点で CPU が打てるところまで打っている（#175）。
    expect((duel?.steps.length ?? 0) > 0).toBe(true)
    store.close()
  })
})

/**
 * 身元とセッション（ADR-0019）。
 *
 * **確かめるのは、同じ人が同じ席に戻れることである。** ログインの道筋そのものは
 * `sign-in.test.ts` が見ている。
 */
describe('身元とセッション', () => {
  it('同じ (発行元, sub) からは同じ識別子が返る', () => {
    const store = openStore(':memory:')

    expect(store.identify('google', '10001')).toBe(store.identify('google', '10001'))
    store.close()
  })

  it('sub が同じでも、発行元が違えば別の人である', () => {
    const store = openStore(':memory:')

    expect(store.identify('google', '10001')).not.toBe(store.identify('よそ', '10001'))
    store.close()
  })

  it('開いたセッションから、その人を引ける', () => {
    const store = openStore(':memory:')
    const participant = store.identify('google', '10001')
    store.openSession('ようやく', participant)

    expect(store.sessionHolder('ようやく', 0)).toBe(participant)
    store.close()
  })

  it('知らないセッションでは誰も引けない', () => {
    const store = openStore(':memory:')

    expect(store.sessionHolder('しらない', 0)).toBeUndefined()
    store.close()
  })

  /** 寿命を決めるのは呼ぶ側（`sign-in.ts`）で、置き場は言われた線で切るだけである。 */
  it('線より前に開いたセッションは無かったことにする', () => {
    const store = openStore(':memory:')
    store.openSession('ようやく', store.identify('google', '10001'))

    expect(store.sessionHolder('ようやく', Date.now() + 1)).toBeUndefined()
    store.close()
  })

  it('身元の識別子でないものではセッションを開けない', () => {
    const store = openStore(':memory:')

    expect(() => store.openSession('ようやく', 'だれか')).toThrow(/身元の識別子ではありません/)
    store.close()
  })

  /** 立て直しても身元は残る（ADR-0018）。ファイルに書いてから開き直して確かめる。 */
  it('立て直しても、同じ人として戻れる', () => {
    const path = `${tmpdir()}/revolution-identity-${randomUUID()}.sqlite`
    const first = openStore(path)
    const participant = first.identify('google', '10001')
    first.openSession('ようやく', participant)
    first.close()

    const again = openStore(path)
    expect(again.sessionHolder('ようやく', 0)).toBe(participant)
    again.close()
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true })
  })
})

/** ADR-0020。表示名は呼ぶためのもので、人を指す識別子ではない。 */
describe('表示名', () => {
  it('決めていなければ、まだ無い', () => {
    const store = openStore(':memory:')

    expect(store.nameOf(store.identify('google', '10001'))).toBeUndefined()
    store.close()
  })

  it('付けた名前が返る', () => {
    const store = openStore(':memory:')
    const participant = store.identify('google', '10001')

    store.rename(participant, 'かずお')

    expect(store.nameOf(participant)).toBe('かずお')
    store.close()
  })

  /** **変えられる**（ADR-0020）。本人が付けたものなので、直せないのは辛い。 */
  it('付け替えられる', () => {
    const store = openStore(':memory:')
    const participant = store.identify('google', '10001')

    store.rename(participant, 'まえのなまえ')
    store.rename(participant, 'あとのなまえ')

    expect(store.nameOf(participant)).toBe('あとのなまえ')
    store.close()
  })

  /**
   * ADR-0020。**重複を許す。** 人を指しているのは身元の行番号であって、表示名ではない。
   * 一意にすると、変わりうるものが 2 つ目の識別子になる。
   */
  it('同じ名前の人が並んでもよい', () => {
    const store = openStore(':memory:')
    const one = store.identify('google', '10001')
    const other = store.identify('google', '10002')

    store.rename(one, 'かずお')
    store.rename(other, 'かずお')

    expect(store.nameOf(one)).toBe('かずお')
    expect(store.nameOf(other)).toBe('かずお')
    store.close()
  })

  /**
   * ADR-0020。**列を足す前からある置き場に、足りない列を足す。** `create table if not exists` は
   * 表がある限り何もしないので、動いている置き場には列が増えない。
   */
  it('列が無い置き場を開いても、名前を付けられる', () => {
    const path = `${tmpdir()}/revolution-rename-${randomUUID()}.sqlite`
    const old = new DatabaseSync(path)
    old.exec(`
      create table identities (
        id integer primary key autoincrement,
        issuer text not null,
        subject text not null,
        unique (issuer, subject)
      );
    `)
    old.exec("insert into identities (issuer, subject) values ('google', '10001')")
    old.close()

    const store = openStore(path)
    const participant = store.identify('google', '10001')
    // 列を足しただけで、行は残っている。**足す前からいる人は「まだ決めていない」ことになる。**
    expect(store.nameOf(participant)).toBeUndefined()

    store.rename(participant, 'かずお')
    expect(store.nameOf(participant)).toBe('かずお')
    store.close()
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true })
  })
})
