import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { choose, defineStrategy, defineUnit } from '@revolution/engine'
import type { Card, FromClient } from '@revolution/engine'
import { deckSourceFrom } from './deck.js'
import { emptyRooms, receive, restore, roomOf } from './room.js'
import type { DeckSource, ParticipantId, RoomSetup, Rooms } from './room.js'
import { openStore } from './store.js'
import type { Store } from './store.js'

/**
 * 書いたものが残り、そこから対戦を作り直せることを確かめる（ADR-0018）。
 *
 * **置き場は `:memory:` で開く。** 手元のファイルを触らずに済み、閉じれば消える。確かめたいのは
 * 「書いて、読み戻して、同じところへ進む」ことであって、どこに置いたかではない。
 *
 * サーバはカードを知れない（ADR-0002）ので、デッキは架空のテストカードと架空の識別子で組む。
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

/** 構築戦の最小枚数（60 枚）を満たす、15 種類 × 4 枚の並び（総合ルール 第3部 第1章 3-1）。 */
const DECK_KEYS = Object.keys(CARDS).flatMap((key) => Array.from({ length: 4 }, () => key))

const DECKS: DeckSource = deckSourceFrom({
  pool: CARDS,
  presets: [{ id: '既製1', name: 'ひとつめ', cards: DECK_KEYS }],
  restrictions: [],
})

/** 1 枚が引けなくなったカードのまとまり。**取り下げられたカードを含む記録**を作るために要る。 */
const WITHOUT_ONE: DeckSource = deckSourceFrom({
  pool: Object.fromEntries(Object.entries(CARDS).filter(([key]) => key !== 'TEST-0')),
  presets: [{ id: '既製1', name: 'ひとつめ', cards: DECK_KEYS.filter((key) => key !== 'TEST-0') }],
  restrictions: [],
})

const SETUP: RoomSetup = { seed: 20260905, code: 'あたらしいへや' }
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
    const outcome = receive(this.rooms, who, message, this.setup, DECKS, connected)
    this.store.write(outcome.records)
    this.rooms = outcome.rooms
    return this
  }

  /** 2 人を入れてデュエルを始める。 */
  start(code = CODE): Table {
    return this.send('あ', { kind: '部屋に入る', room: code, deck: undefined }).send('い', { kind: '部屋に入る', room: code, deck: undefined })
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

  it('取り下げられたカードを含む記録は、作り直さない（ADR-0018・ADR-0021）', () => {
    const store = openStore(':memory:')
    new Table(store).start().passes(4)

    const restored = restore(store.openDuels(), WITHOUT_ONE)

    // **消したのではない。** 記録は置き場に残っていて、戻す先の部屋ができないだけである。
    expect(restored.size).toBe(0)
    expect(store.openDuels()).toHaveLength(1)
    store.close()
  })

  /** ADR-0021。立て直した部屋も同じルールになる（`room.ts` の `restore`）。 */
  it('部屋のルールが記録に残る', () => {
    const store = openStore(':memory:')
    store.write([
      {
        kind: '始まった',
        code: CODE,
        name: CODE,
        seats: { 先攻: 'あ', 後攻: 'い' },
        cpu: undefined,
        seed: SETUP.seed,
        decks: [DECK_KEYS, DECK_KEYS],
        rules: { format: '構築戦', restriction: 'リスト1' },
      },
    ])

    expect(store.openDuels()[0]?.rules).toEqual({ format: '構築戦', restriction: 'リスト1' })
    store.close()
  })

  it('制限なしの部屋は、リストを持たないものとして読み戻される', () => {
    const store = openStore(':memory:')
    new Table(store).start()

    expect(store.openDuels()[0]?.rules).toEqual({ format: '構築戦', restriction: undefined })
    store.close()
  })

  it('CPU が打った手も記録に残る', () => {
    const store = openStore(':memory:')
    new Table(store).send('あ', { kind: '部屋を作る', name: 'ひとり', against: 'CPU', deck: undefined, cpuDeck: undefined, format: undefined, restriction: undefined })

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

  /**
   * ADR-0021。部屋がルールを持つ前の対戦は、構築戦を制限なしで打ったものである——形式という値が
   * 無く、禁止／制限リストはどこにも当てていなかった。
   */
  it('ルールの列が無い置き場を開くと、残っていた対戦は構築戦の制限なしとして読める', () => {
    const path = `${tmpdir()}/revolution-rules-${randomUUID()}.sqlite`
    const old = new DatabaseSync(path)
    old.exec(`
      create table duels (
        id integer primary key autoincrement,
        code text not null,
        name text not null,
        seed integer not null,
        first text not null,
        second text not null,
        cpu text,
        decks text not null,
        started_at integer not null,
        closed_at integer
      );
    `)
    old
      .prepare('insert into duels (code, name, seed, first, second, decks, started_at) values (?, ?, ?, ?, ?, ?, ?)')
      .run(CODE, CODE, SETUP.seed, 'あ', 'い', JSON.stringify([DECK_KEYS, DECK_KEYS]), 0)
    old.close()

    const store = openStore(path)

    expect(store.openDuels()[0]?.rules).toEqual({ format: '構築戦', restriction: undefined })
    store.close()
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true })
  })
})

/**
 * 自分のデッキ（ADR-0021）。
 *
 * **決まりを見るのは `owned-deck.ts` である。** ここで確かめるのは、預けたものが持ち主のもの
 * として返ることと、**他人のデッキには手が届かない**ことである。
 */
describe('自分のデッキ', () => {
  const DRAFT = { name: 'わたしのデッキ', description: 'かいせつ', cards: ['TEST-0', 'TEST-1'] }

  it('はじめは何も持っていない', () => {
    const store = openStore(':memory:')

    expect(store.decksOf(store.identify('google', '10001'))).toEqual([])
    store.close()
  })

  /** ADR-0021、#195。自分が座るデッキと CPU の席のデッキは、別々に覚える。 */
  it('CPU の席に選んだデッキを、自分の席のデッキとは別に覚える', () => {
    const store = openStore(':memory:')
    const me = store.identify('google', '10001')
    const first = store.saveDeck(me, undefined, DRAFT)
    const second = store.saveDeck(me, undefined, { ...DRAFT, name: 'ふたつめ' })
    if (first === undefined || second === undefined) throw new Error('デッキを残せるはずだった')

    expect(store.lastChosenCpuDeckOf(me)).toBeUndefined()
    store.rememberChosenDeck(me, first)
    store.rememberChosenCpuDeck(me, second)

    expect(store.lastChosenDeckOf(me)).toBe(first)
    expect(store.lastChosenCpuDeckOf(me)).toBe(second)
    store.close()
  })

  it('残したデッキが、作った順に返る', () => {
    const store = openStore(':memory:')
    const me = store.identify('google', '10001')

    const first = store.saveDeck(me, undefined, DRAFT)
    const second = store.saveDeck(me, undefined, { ...DRAFT, name: 'ふたつめ' })

    expect(store.decksOf(me)).toEqual([
      { id: first, ...DRAFT },
      { id: second, ...DRAFT, name: 'ふたつめ' },
    ])
    store.close()
  })

  it('上書きできる', () => {
    const store = openStore(':memory:')
    const me = store.identify('google', '10001')
    const deck = store.saveDeck(me, undefined, DRAFT)
    if (deck === undefined) throw new Error('残せるはずだった')

    expect(store.saveDeck(me, deck, { ...DRAFT, cards: ['TEST-2'] })).toBe(deck)
    expect(store.decksOf(me)).toEqual([{ id: deck, ...DRAFT, cards: ['TEST-2'] }])
    store.close()
  })

  it('他人のデッキは見えない', () => {
    const store = openStore(':memory:')
    const me = store.identify('google', '10001')
    store.saveDeck(store.identify('google', '10002'), undefined, DRAFT)

    expect(store.decksOf(me)).toEqual([])
    store.close()
  })

  /** 識別子だけで引くと、他人のデッキの識別子を送れば書き換えられてしまう。 */
  it('他人のデッキは上書きできない', () => {
    const store = openStore(':memory:')
    const me = store.identify('google', '10001')
    const other = store.identify('google', '10002')
    const theirs = store.saveDeck(other, undefined, DRAFT)
    if (theirs === undefined) throw new Error('残せるはずだった')

    expect(store.saveDeck(me, theirs, { ...DRAFT, name: 'のっとり' })).toBeUndefined()
    expect(store.decksOf(other)).toEqual([{ id: theirs, ...DRAFT }])
    store.close()
  })

  it('知らない識別子では上書きできない', () => {
    const store = openStore(':memory:')
    const me = store.identify('google', '10001')

    expect(store.saveDeck(me, '999', DRAFT)).toBeUndefined()
    expect(store.saveDeck(me, 'よめない', DRAFT)).toBeUndefined()
    expect(store.decksOf(me)).toEqual([])
    store.close()
  })

  it('消せる', () => {
    const store = openStore(':memory:')
    const me = store.identify('google', '10001')
    const deck = store.saveDeck(me, undefined, DRAFT)
    if (deck === undefined) throw new Error('残せるはずだった')

    expect(store.deleteDeck(me, deck)).toBe(true)
    expect(store.decksOf(me)).toEqual([])
    store.close()
  })

  it('他人のデッキは消せない', () => {
    const store = openStore(':memory:')
    const other = store.identify('google', '10002')
    const theirs = store.saveDeck(other, undefined, DRAFT)
    if (theirs === undefined) throw new Error('残せるはずだった')

    expect(store.deleteDeck(store.identify('google', '10001'), theirs)).toBe(false)
    expect(store.decksOf(other)).toHaveLength(1)
    store.close()
  })

  /** 置き場は差し替えても消えない（ADR-0018）。デッキは対戦が終わっても残るものである。 */
  it('立て直しても残っている', () => {
    const path = `${tmpdir()}/revolution-decks-${randomUUID()}.sqlite`
    const first = openStore(path)
    const me = first.identify('google', '10001')
    const deck = first.saveDeck(me, undefined, DRAFT)
    first.close()

    const second = openStore(path)
    expect(second.decksOf(me)).toEqual([{ id: deck, ...DRAFT }])
    second.close()
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true })
  })
})

/**
 * レシピと共有（ADR-0022）。
 *
 * **決まりを見るのは `recipe.ts` である。** ここで確かめるのは、置き場に書いたものが正しく
 * 返ることと、レシピと共有が別の表で、鍵とレシピが 1 対 1 で対応することである。
 */
describe('レシピと共有', () => {
  const SHARE_DRAFT = {
    name: 'わたしのレシピ',
    description: 'かいせつ',
    format: '構築戦',
    restriction: undefined,
    visibility: 'リンクを知っている人だけ' as const,
  }

  it('レシピを作ると、鍵から中身が引ける', () => {
    const store = openStore(':memory:')

    store.ensureRecipe('かぎ1', ['TEST-0', 'TEST-1'])

    expect(store.recipeCards('かぎ1')).toEqual(['TEST-0', 'TEST-1'])
    store.close()
  })

  it('知らない鍵では中身が引けない', () => {
    const store = openStore(':memory:')

    expect(store.recipeCards('しらないかぎ')).toBeUndefined()
    store.close()
  })

  // 完了条件 2: 同じ中身のデッキを共有すると、レシピは1つに決まる。
  it('同じ鍵をもう一度作ろうとしても、中身は変わらない', () => {
    const store = openStore(':memory:')
    store.ensureRecipe('かぎ1', ['TEST-0'])

    store.ensureRecipe('かぎ1', ['TEST-9'])

    expect(store.recipeCards('かぎ1')).toEqual(['TEST-0'])
    store.close()
  })

  it('共有すると、その人の共有として残る', () => {
    const store = openStore(':memory:')
    const me = store.identify('google', '10001')
    store.ensureRecipe('かぎ1', ['TEST-0'])

    const id = store.addShare('かぎ1', me, SHARE_DRAFT)

    expect(store.sharesOf(me)).toEqual([
      {
        id,
        key: expect.any(String),
        recipe: 'かぎ1',
        owner: me,
        name: 'わたしのレシピ',
        description: 'かいせつ',
        visibility: 'リンクを知っている人だけ',
        sharedAt: expect.any(Number),
        revoked: false,
        format: '構築戦',
        restriction: undefined,
      },
    ])
    store.close()
  })

  /** 確かめた形式と禁止／制限リストも読み出せる（ADR-0022）。 */
  it('確かめた形式と禁止／制限リストも残る', () => {
    const store = openStore(':memory:')
    const me = store.identify('google', '10001')
    store.ensureRecipe('かぎ1', ['TEST-0'])

    const id = store.addShare('かぎ1', me, { ...SHARE_DRAFT, format: '構築戦', restriction: 'リスト1' })

    expect(store.shareById(id)).toMatchObject({ format: '構築戦', restriction: 'リスト1' })
    store.close()
  })

  it('識別子から、持ち主を問わずに共有が引ける（コピーするのに使う）', () => {
    const store = openStore(':memory:')
    const owner = store.identify('google', '10001')
    store.ensureRecipe('かぎ1', ['TEST-0'])
    const id = store.addShare('かぎ1', owner, SHARE_DRAFT)

    expect(store.shareById(id)?.owner).toBe(owner)
    store.close()
  })

  it('知らない共有の識別子では引けない', () => {
    const store = openStore(':memory:')

    expect(store.shareById('999')).toBeUndefined()
    expect(store.shareById('よめない')).toBeUndefined()
    store.close()
  })

  /** `/share/<鍵>` の口が使う（ADR-0022、#197）。`id` とは別の、未ログインにも渡せる鍵。 */
  describe('公開の鍵から共有を引く', () => {
    it('公開の鍵から、持ち主を問わずに共有が引ける', () => {
      const store = openStore(':memory:')
      const owner = store.identify('google', '10001')
      store.ensureRecipe('かぎ1', ['TEST-0'])
      const id = store.addShare('かぎ1', owner, SHARE_DRAFT)
      const key = store.shareById(id)?.key
      if (key === undefined) throw new Error('鍵が無い')

      expect(store.shareByPublicKey(key)?.owner).toBe(owner)
      store.close()
    })

    it('知らない鍵では引けない', () => {
      const store = openStore(':memory:')

      expect(store.shareByPublicKey('しらない鍵')).toBeUndefined()
      store.close()
    })

    it('取り消した共有は、公開の鍵からは引けなくなる', () => {
      const store = openStore(':memory:')
      const me = store.identify('google', '10001')
      store.ensureRecipe('かぎ1', ['TEST-0'])
      const id = store.addShare('かぎ1', me, SHARE_DRAFT)
      const key = store.shareById(id)?.key
      if (key === undefined) throw new Error('鍵が無い')

      store.revokeShare(me, id)

      expect(store.shareByPublicKey(key)).toBeUndefined()
      // `id` からは、取り消した本人には見えたままである（自分の共有）。公開の鍵だけが死ぬ。
      expect(store.shareById(id)?.revoked).toBe(true)
      store.close()
    })

    it('2 つの共有は、それぞれ別の鍵を持つ', () => {
      const store = openStore(':memory:')
      const owner = store.identify('google', '10001')
      store.ensureRecipe('かぎ1', ['TEST-0'])
      store.ensureRecipe('かぎ2', ['TEST-0'])
      const first = store.shareById(store.addShare('かぎ1', owner, SHARE_DRAFT))?.key
      const second = store.shareById(store.addShare('かぎ2', owner, SHARE_DRAFT))?.key

      expect(first).not.toBe(second)
      store.close()
    })

    it('同じレシピをもう一度共有しても、鍵は変わらない（書き換わるだけで同じ行のまま）', () => {
      const store = openStore(':memory:')
      const owner = store.identify('google', '10001')
      store.ensureRecipe('かぎ1', ['TEST-0'])
      const id = store.addShare('かぎ1', owner, SHARE_DRAFT)
      const before = store.shareById(id)?.key

      store.addShare('かぎ1', owner, { ...SHARE_DRAFT, name: '書き換え後' })

      expect(store.shareById(id)?.key).toBe(before)
      store.close()
    })
  })

  /** 完了条件 5: 自分の共有を取り消すと、その共有は消える。 */
  it('取り消すと、レシピにぶら下がる一覧からは外れる', () => {
    const store = openStore(':memory:')
    const me = store.identify('google', '10001')
    store.ensureRecipe('かぎ1', ['TEST-0'])
    const id = store.addShare('かぎ1', me, SHARE_DRAFT)

    expect(store.revokeShare(me, id)).toBe(true)

    expect(store.sharesOfRecipe('かぎ1')).toEqual([])
    // **取り消した本人の一覧にだけ、取り消されたものとして残る。**
    expect(store.sharesOf(me)).toEqual([expect.objectContaining({ id, revoked: true })])
    store.close()
  })

  it('他人の共有は取り消せない', () => {
    const store = openStore(':memory:')
    const owner = store.identify('google', '10001')
    const someoneElse = store.identify('google', '10002')
    store.ensureRecipe('かぎ1', ['TEST-0'])
    const id = store.addShare('かぎ1', owner, SHARE_DRAFT)

    expect(store.revokeShare(someoneElse, id)).toBe(false)
    expect(store.sharesOfRecipe('かぎ1')).toHaveLength(1)
    store.close()
  })

  it('公開の段階を変えられる', () => {
    const store = openStore(':memory:')
    const me = store.identify('google', '10001')
    store.ensureRecipe('かぎ1', ['TEST-0'])
    const id = store.addShare('かぎ1', me, SHARE_DRAFT)

    expect(store.setShareVisibility(me, id, '一覧に載せる')).toBe(true)

    expect(store.sharesOf(me)[0]?.visibility).toBe('一覧に載せる')
    store.close()
  })

  it('他人の共有の公開の段階は変えられない', () => {
    const store = openStore(':memory:')
    const owner = store.identify('google', '10001')
    const someoneElse = store.identify('google', '10002')
    store.ensureRecipe('かぎ1', ['TEST-0'])
    const id = store.addShare('かぎ1', owner, SHARE_DRAFT)

    expect(store.setShareVisibility(someoneElse, id, '一覧に載せる')).toBe(false)
    store.close()
  })

  /** 取り消し済みの共有は、公開の段階を変えられない（ADR-0022）。 */
  it('取り消し済みの共有は、公開の段階を変えられない', () => {
    const store = openStore(':memory:')
    const me = store.identify('google', '10001')
    store.ensureRecipe('かぎ1', ['TEST-0'])
    const id = store.addShare('かぎ1', me, SHARE_DRAFT)
    store.revokeShare(me, id)

    expect(store.setShareVisibility(me, id, '一覧に載せる')).toBe(false)
    expect(store.sharesOf(me)[0]?.visibility).toBe(SHARE_DRAFT.visibility)
    store.close()
  })

  /**
   * 同じレシピに対する、自分の生きている共有は 1 つまで（ADR-0022）。もう一度共有すると
   * 書き換わり、取り消した後の共有し直しは新しい行になる。
   */
  describe('同じレシピを二重に共有する', () => {
    it('同じ人が同じレシピをもう一度共有しても、行は増えず内容が書き換わる', () => {
      const store = openStore(':memory:')
      const me = store.identify('google', '10001')
      store.ensureRecipe('かぎ1', ['TEST-0'])
      const first = store.addShare('かぎ1', me, SHARE_DRAFT)

      const second = store.addShare('かぎ1', me, { ...SHARE_DRAFT, name: 'あたらしい名前', visibility: '一覧に載せる' })

      expect(second).toBe(first)
      expect(store.sharesOf(me)).toHaveLength(1)
      expect(store.sharesOf(me)[0]).toMatchObject({ name: 'あたらしい名前', visibility: '一覧に載せる' })
      store.close()
    })

    it('取り消したあとに共有し直すと、新しい行が 1 つできる', () => {
      const store = openStore(':memory:')
      const me = store.identify('google', '10001')
      store.ensureRecipe('かぎ1', ['TEST-0'])
      const first = store.addShare('かぎ1', me, SHARE_DRAFT)
      store.revokeShare(me, first)

      const second = store.addShare('かぎ1', me, SHARE_DRAFT)

      expect(second).not.toBe(first)
      expect(store.sharesOf(me)).toHaveLength(2)
      expect(store.sharesOf(me).find((share) => share.id === first)?.revoked).toBe(true)
      expect(store.sharesOf(me).find((share) => share.id === second)?.revoked).toBe(false)
      store.close()
    })

    it('別の人が同じレシピを共有しても、それぞれ別の行のまま残る', () => {
      const store = openStore(':memory:')
      const me = store.identify('google', '10001')
      const someoneElse = store.identify('google', '10002')
      store.ensureRecipe('かぎ1', ['TEST-0'])
      const mine = store.addShare('かぎ1', me, SHARE_DRAFT)
      const theirs = store.addShare('かぎ1', someoneElse, SHARE_DRAFT)

      expect(mine).not.toBe(theirs)
      expect(store.sharesOfRecipe('かぎ1')).toHaveLength(2)
      store.close()
    })
  })

  describe('一覧', () => {
    it('「一覧に載せる」共有が無いレシピは並ばない', () => {
      const store = openStore(':memory:')
      const me = store.identify('google', '10001')
      store.ensureRecipe('かぎ1', ['TEST-0'])
      store.addShare('かぎ1', me, SHARE_DRAFT)

      expect(store.publicRecipes('新着')).toEqual([])
      store.close()
    })

    it('新着順は、一番新しい「一覧に載せる」共有の時刻で並ぶ', () => {
      const store = openStore(':memory:')
      const me = store.identify('google', '10001')
      store.ensureRecipe('ふるい', ['TEST-0'])
      store.ensureRecipe('あたらしい', ['TEST-1'])
      store.addShare('ふるい', me, { ...SHARE_DRAFT, visibility: '一覧に載せる', name: 'ふるいレシピ' })
      store.addShare('あたらしい', me, { ...SHARE_DRAFT, visibility: '一覧に載せる', name: 'あたらしいレシピ' })

      expect(store.publicRecipes('新着').map((recipe) => recipe.key)).toEqual(['あたらしい', 'ふるい'])
      store.close()
    })

    /**
     * 新着順が本当に `shared_at` の時刻で決まることを、時計を差し込んで確かめる。
     *
     * `addShare` は内部で時刻を打つため、自然な流れでは書き込み順（行番号の順）と時刻の順が
     * 必ず一致し、`shared_at` を完全に無視して行番号だけで並べる実装でも上のテストは通って
     * しまう。**行番号の順と時刻の順をわざとずらして**、時刻そのもので並んでいることを見る。
     */
    it('新着順は、行番号の並びに頼らず shared_at の時刻そのもので決まる', () => {
      let now = 2_000_000
      const store = openStore(':memory:', { now: () => now })
      const me = store.identify('google', '10001')
      store.ensureRecipe('さきに書くが時刻は新しい', ['TEST-0'])
      store.ensureRecipe('あとに書くが時刻は古い', ['TEST-1'])

      // 行番号は「さきに書く」ほうが若いが、時刻はこちらのほうが新しい。行番号順に並べる実装なら
      // 逆の結果になる。
      store.addShare('さきに書くが時刻は新しい', me, { ...SHARE_DRAFT, visibility: '一覧に載せる' })
      now = 1_000_000
      store.addShare('あとに書くが時刻は古い', me, { ...SHARE_DRAFT, visibility: '一覧に載せる' })

      expect(store.publicRecipes('新着').map((recipe) => recipe.key)).toEqual([
        'さきに書くが時刻は新しい',
        'あとに書くが時刻は古い',
      ])
      store.close()
    })

    // 完了条件 8: 一番新しい共有の名前と解説が出る。
    it('出るのは一番新しい「一覧に載せる」共有の名前と解説', () => {
      const store = openStore(':memory:')
      const me = store.identify('google', '10001')
      store.ensureRecipe('かぎ1', ['TEST-0'])
      store.addShare('かぎ1', me, { ...SHARE_DRAFT, visibility: '一覧に載せる', name: 'ふるい名前' })
      store.addShare('かぎ1', me, { ...SHARE_DRAFT, visibility: '一覧に載せる', name: 'あたらしい名前' })

      expect(store.publicRecipes('新着')).toEqual([
        { key: 'かぎ1', name: 'あたらしい名前', description: 'かいせつ', copies: 0 },
      ])
      store.close()
    })

    /**
     * 身内に渡すつもりのものが新着に流れることを設定で防ぐ（ADR-0022）ので、「一覧に載せる」より
     * 後に「リンクを知っている人だけ」で共有しても、一覧の見え方は変わらない。
     *
     * **別の人が共有する。** 同じ人が同じレシピをもう一度共有すると、いまの共有そのものが
     * 書き換わる（`store.ts` の `addShare`）ので、同じ人で試すと後の「リンクを知っている人
     * だけ」が公開の共有を消してしまい、この完了条件を確かめられない。
     */
    it('あとから別の人が「リンクを知っている人だけ」で共有しても、一覧の名前は変わらない', () => {
      const store = openStore(':memory:')
      const me = store.identify('google', '10001')
      const someoneElse = store.identify('google', '10002')
      store.ensureRecipe('かぎ1', ['TEST-0'])
      store.addShare('かぎ1', me, { ...SHARE_DRAFT, visibility: '一覧に載せる', name: '一覧の名前' })
      store.addShare('かぎ1', someoneElse, { ...SHARE_DRAFT, visibility: 'リンクを知っている人だけ', name: '身内向けの名前' })

      expect(store.publicRecipes('新着')[0]?.name).toBe('一覧の名前')
      store.close()
    })

    it('コピー数順で並び替えられる。コピー数はレシピ単位で数える', () => {
      const store = openStore(':memory:')
      const me = store.identify('google', '10001')
      const other = store.identify('google', '10002')
      store.ensureRecipe('よくコピーされる', ['TEST-0'])
      store.ensureRecipe('あまりコピーされない', ['TEST-1'])
      store.addShare('よくコピーされる', me, { ...SHARE_DRAFT, visibility: '一覧に載せる' })
      // **誰の共有からコピーされたかは数えない。** 同じレシピへの記録は、誰が書いても積み上がる。
      store.addShare('よくコピーされる', other, { ...SHARE_DRAFT, visibility: '一覧に載せる' })
      store.recordCopy('よくコピーされる')
      store.recordCopy('よくコピーされる')
      store.addShare('あまりコピーされない', me, { ...SHARE_DRAFT, visibility: '一覧に載せる' })
      store.recordCopy('あまりコピーされない')

      const ordered = store.publicRecipes('コピー数')
      expect(ordered.map((recipe) => recipe.key)).toEqual(['よくコピーされる', 'あまりコピーされない'])
      expect(ordered.map((recipe) => recipe.copies)).toEqual([2, 1])
      store.close()
    })

    /** 完了条件 6: 取り消したあと、同じ中身を誰かが共有すると、また一覧に出るようになる。 */
    it('取り消した後に同じレシピを一覧向けに共有すると、また一覧に出る', () => {
      const store = openStore(':memory:')
      const first = store.identify('google', '10001')
      const second = store.identify('google', '10002')
      store.ensureRecipe('かぎ1', ['TEST-0'])
      const revoked = store.addShare('かぎ1', first, { ...SHARE_DRAFT, visibility: '一覧に載せる' })
      store.revokeShare(first, revoked)
      expect(store.publicRecipes('新着')).toEqual([])

      store.addShare('かぎ1', second, { ...SHARE_DRAFT, visibility: '一覧に載せる' })

      expect(store.publicRecipes('新着').map((recipe) => recipe.key)).toEqual(['かぎ1'])
      store.close()
    })
  })

  /** 置き場は差し替えても消えない（ADR-0018）。レシピと共有も対戦や自分のデッキと同じ扱いにする。 */
  it('立て直しても、レシピと共有は残っている', () => {
    const path = `${tmpdir()}/revolution-recipes-${randomUUID()}.sqlite`
    const first = openStore(path)
    const me = first.identify('google', '10001')
    first.ensureRecipe('かぎ1', ['TEST-0'])
    const id = first.addShare('かぎ1', me, SHARE_DRAFT)
    first.close()

    const second = openStore(path)
    expect(second.recipeCards('かぎ1')).toEqual(['TEST-0'])
    expect(second.sharesOf(me)).toEqual([
      {
        id,
        key: expect.any(String),
        recipe: 'かぎ1',
        owner: me,
        name: SHARE_DRAFT.name,
        description: SHARE_DRAFT.description,
        visibility: SHARE_DRAFT.visibility,
        sharedAt: expect.any(Number),
        revoked: false,
        format: SHARE_DRAFT.format,
        restriction: SHARE_DRAFT.restriction,
      },
    ])
    second.close()
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true })
  })

  /**
   * ADR-0022、#197。`public_key` は #197 で足した列——**列を足す前からある共有にも、開いた時点で
   * 埋まっていなければならない。** 埋めずに残すと、`/share/<鍵>` を持たない古い共有ができてしまう。
   */
  it('公開の鍵の列が無い置き場を開くと、既存の共有にも鍵が埋まる', () => {
    const path = `${tmpdir()}/revolution-share-keys-${randomUUID()}.sqlite`
    const old = new DatabaseSync(path)
    old.exec(`
      create table identities (
        id integer primary key autoincrement,
        issuer text not null,
        subject text not null,
        name text,
        unique (issuer, subject)
      );
      create table recipes (
        key text primary key,
        cards text not null
      );
      create table shares (
        id integer primary key autoincrement,
        recipe text not null references recipes (key),
        owner integer not null references identities (id),
        name text not null,
        description text not null,
        format text not null,
        restriction text,
        visibility text not null,
        shared_at integer not null,
        revoked_at integer
      );
    `)
    old.exec("insert into identities (issuer, subject) values ('google', '10001')")
    old.exec("insert into recipes (key, cards) values ('かぎ1', '[\"TEST-0\"]')")
    old.exec(
      `insert into shares (recipe, owner, name, description, format, visibility, shared_at)
       values ('かぎ1', 1, '共有A', '', '構築戦', 'リンクを知っている人だけ', 0),
              ('かぎ1', 1, '共有B', '', '構築戦', 'リンクを知っている人だけ', 0)`,
    )
    old.close()

    const store = openStore(path)
    const shares = store.sharesOf('1')
    expect(shares).toHaveLength(2)
    for (const share of shares) {
      expect(typeof share.key).toBe('string')
      expect(share.key.length).toBeGreaterThan(0)
      // 埋めた鍵がそのまま公開の口から引ける。
      expect(store.shareByPublicKey(share.key)?.id).toBe(share.id)
    }
    // 2 行に同じ鍵が埋まっていない。
    expect(shares[0]?.key).not.toBe(shares[1]?.key)
    store.close()
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true })
  })
})
