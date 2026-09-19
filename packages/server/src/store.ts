import { DatabaseSync } from 'node:sqlite'
import type { DeckId, RoomCode } from '@revolution/engine'
import type { DeckDraft, OwnedDeck } from './owned-deck.js'
import type { DuelRecord, ParticipantId, StoredDuel } from './room.js'

/**
 * 書いたものが残る置き場（ADR-0018）。
 *
 * **SQL を書くのはここだけである。** 置き場に使っている `node:sqlite` は Node に同梱されている
 * が実験扱いで、形が変わりうる。**触るところを 1 箇所に閉じておけば、変わったときに直す場所が
 * 1 つで済む。** サーバのほかの場所は、この下に何があるかを知らない。
 *
 * 残すのは盤面ではなく、**そこへ至った入力**である（ADR-0018）。デッキとシードと「行動と答えの
 * 並び」があれば、同じ盤面をいつでも作り直せる（ADR-0001、ADR-0008）。決着まで打った 1 本を
 * 最初から作り直すのに 18ms しかかからない。
 */

/**
 * 部屋の合言葉は使い回される。
 *
 * 合言葉が空いているかを見るのは、いま開いている部屋の中だけである（`room.ts` の `unusedCode`）
 * ので、**閉じた対戦と同じ合言葉の部屋が後からできる。** 記録は消さない（ADR-0018）ため、
 * 合言葉を鍵にすると衝突する。**行そのものの番号を鍵にし、合言葉はただの列にする。**
 *
 * 身元は `(発行元, sub)` の組で持つ（ADR-0019）。**発行元を列として持っておけば、2 つ目の
 * ログインの手立てを足したときに既存の行が壊れない。** 席に使う識別子は行の番号のほうで、
 * `sub` をそのまま席に使わないのは、発行元をまたいで同じ文字列が来うるからである。
 *
 * **表示名は NULL を許す**（ADR-0020）。決まりを決める前からいる身元には名前が無く、**「まだ
 * 決めていない」を表せる形でなければならない。** 名前が無い人は、決めるまで何もできない
 * （`serve.ts`）。
 *
 * セッションは合言葉そのものではなく、その要約を鍵にする（`sign-in.ts` の `digest`）。
 * **置き場に残るものは公開できないものとして扱う**（ADR-0018）ので、漏れてもその行から席に
 * 座れないようにしておく。
 *
 * **デッキは身元の持ち物である**（ADR-0021）。持つのはカードを指す識別子の並びだけで、JSON の
 * 配列として 1 列に入れる。**並びは揃えてから入る**（`owned-deck.ts` の `sortCards`）ので、同じ
 * 中身なら同じ文字列になる。対戦の記録（`duels.decks`）はデッキの行を指さずに並びを写し取って
 * いるので、**デッキを消しても記録は壊れない。**
 */
const SCHEMA = `
  create table if not exists duels (
    id integer primary key autoincrement,
    code text not null,
    name text not null,
    seed integer not null,
    first text not null,
    second text not null,
    cpu text,
    decks text not null,
    started_at integer not null,
    closed_at integer,
    format text not null default '構築戦',
    restriction text
  );
  create index if not exists duels_open on duels (code) where closed_at is null;
  create table if not exists steps (
    duel integer not null references duels (id),
    ordinal integer not null,
    action text not null,
    answers text not null,
    primary key (duel, ordinal)
  );
  create table if not exists identities (
    id integer primary key autoincrement,
    issuer text not null,
    subject text not null,
    name text,
    last_deck integer,
    unique (issuer, subject)
  );
  create table if not exists sessions (
    digest text primary key,
    identity integer not null references identities (id),
    opened_at integer not null
  );
  create table if not exists decks (
    id integer primary key autoincrement,
    owner integer not null references identities (id),
    name text not null,
    description text not null,
    cards text not null,
    updated_at integer not null
  );
  create index if not exists decks_by_owner on decks (owner);
`

/**
 * 読み出した 1 行から 1 つの列を取り出す。
 *
 * **置き場から来るものは、型としては何でもありうる。** ここが外の値が入ってくる境目なので、
 * 黙って信じずに読み方を書く。**違うものが入っていたらその場で落とす**——読めない記録を持った
 * まま進むと、どこで壊れたかが分からなくなる。
 */
type Row = Record<string, unknown>

function text(row: Row, key: string): string {
  const value = row[key]
  if (typeof value !== 'string') throw new Error(`${key} が文字列ではない: ${String(value)}`)

  return value
}

function maybeText(row: Row, key: string): string | undefined {
  const value = row[key]
  return value === null || value === undefined ? undefined : text(row, key)
}

function maybeInt(row: Row, key: string): number | undefined {
  const value = row[key]
  return value === null || value === undefined ? undefined : int(row, key)
}

function int(row: Row, key: string): number {
  const value = row[key]
  // `node:sqlite` は大きい整数を bigint で返すことがある。行番号もシードもここでは数として扱う。
  if (typeof value === 'bigint') return Number(value)
  if (typeof value !== 'number') throw new Error(`${key} が数ではない: ${String(value)}`)

  return value
}

/**
 * 身元の行番号と、席に使う識別子の行き来（ADR-0019）。
 *
 * **席に使うのは行番号である。** `sub` をそのまま使わないのは、発行元をまたいで同じ文字列が
 * 来うるからで、`(発行元, sub)` を繋げた文字列にしないのは、記録（`duels`）に発行元まで
 * 書き込むことになるからである。
 *
 * 読み替えをここだけに置いているのは、**2 つの列（`sessions.identity` と `duels.first`）が
 * 同じものを別の型で持っている**ためである。片方を直してもう片方を忘れる形にしない。
 */
function seatedAs(id: number): ParticipantId {
  return String(id)
}

function identityOf(participant: ParticipantId): number {
  const id = Number(participant)
  if (!Number.isInteger(id)) throw new Error(`身元の識別子ではありません: ${participant}`)

  return id
}

/**
 * デッキを指す識別子から行番号を引く。**知らない形なら `undefined`。**
 *
 * 身元と違って投げない。デッキの識別子は画面から送られてくるもので、読めないものが来ても
 * それは「そのデッキは無い」と同じである。
 */
function deckRowOf(deck: DeckId): number | undefined {
  const row = Number(deck)
  return Number.isSafeInteger(row) && row > 0 && String(row) === deck ? row : undefined
}

/**
 * すでにある置き場に、足りない列だけを足す（ADR-0020）。
 *
 * **`create table if not exists` は、表がある限り何もしない。** 列を 1 つ足したときに、新しく
 * 作った置き場では通り、動いている置き場では通らないという食い違いがここで生まれる。置き場は
 * 差し替えても消えないもの（ADR-0018）なので、**動いているほうに合わせる手立てが要る。**
 *
 * **足すだけで、落とさない。** 消す向きの手当ては、消してよいと決めたときに書く。
 */
function addMissingColumns(db: DatabaseSync): void {
  addMissingColumn(db, 'identities', 'name', 'text')
  // 前に席に着く時に選んだデッキ（ADR-0021、#194）。**選ぶ前の人には入っていない**——自分の
  // デッキを持つようになるより前からいる人も、初めて選ぶまでは空のままである。
  addMissingColumn(db, 'identities', 'last_deck', 'integer')
  // 部屋のルール（ADR-0021）。**ルールを持つ前の対戦は、構築戦を制限なしで打ったものである**
  // ——当時は形式という値が無く、禁止／制限リストはどこにも当てていなかった。
  addMissingColumn(db, 'duels', 'format', "text not null default '構築戦'")
  addMissingColumn(db, 'duels', 'restriction', 'text')
}

function addMissingColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = db.prepare(`pragma table_info(${table})`).all()
  if (columns.some((each) => text(each as Row, 'name') === column)) return

  db.exec(`alter table ${table} add column ${column} ${definition}`)
}

export interface Store {
  /**
   * 書き足す。**渡された並びを 1 つのまとまりとして書く。**
   *
   * 途中で落ちて、1 手ぶんが半分だけ書かれた状態にしない。
   */
  write(records: readonly DuelRecord[]): void
  /**
   * まだ閉じていない対戦。立て直したときにここから戻す（ADR-0018）。
   *
   * 閉じた対戦は返らない。**記録としては残っているが、戻す先の部屋が無い**（ADR-0017）。
   */
  openDuels(): readonly StoredDuel[]
  /**
   * その身元に紐づく識別子。**初めてなら作る**（ADR-0019）。
   *
   * 同じ `(発行元, sub)` からは何度呼んでも同じものが返る。ログインするたびに新しい人が
   * 増えないための約束であり、**席に戻れるかどうかがここに乗っている。**
   */
  identify(issuer: string, subject: string): ParticipantId
  /**
   * その人が付けた表示名。まだ決めていなければ `undefined`（ADR-0020）。
   *
   * **決まりを見るのはここではない**（`name.ts`）。置き場は、通ったものを預かって返すだけである。
   */
  nameOf(participant: ParticipantId): string | undefined
  /** 表示名を付ける。すでに付いていれば付け替える（ADR-0020）。 */
  rename(participant: ParticipantId, name: string): void
  /** セッションを開く。渡すのは合言葉ではなく、その要約（`sign-in.ts` の `digest`）。 */
  openSession(digest: string, participant: ParticipantId): void
  /**
   * その要約に紐づく人。無ければ `undefined`。
   *
   * `since` より前に開いたものは無かったことにする。**寿命を決めるのは呼ぶ側**（`sign-in.ts`）
   * で、ここは言われた線で切るだけである。Cookie の寿命はブラウザに預けたものなので、
   * 送られてきたものが古いかどうかは置き場の側でも見る。
   */
  sessionHolder(digest: string, since: number): ParticipantId | undefined
  /**
   * その人が持っているデッキ。作った順に並ぶ（ADR-0021）。
   *
   * **決まりを見るのはここではない**（`owned-deck.ts`）。置き場は、通ったものを預かって返すだけ
   * である。
   */
  decksOf(owner: ParticipantId): readonly OwnedDeck[]
  /**
   * デッキを残す。`deck` が `undefined` なら新しく作り、あればその人のものを上書きする。
   *
   * 残した識別子を返す。**上書きしようとしたデッキがその人のものでなければ `undefined`**——
   * 他人のデッキの識別子を送っても、書き換えられない。
   */
  saveDeck(owner: ParticipantId, deck: DeckId | undefined, draft: DeckDraft): DeckId | undefined
  /** その人のデッキを消す。**その人のものでなければ何もせず `false`。** */
  deleteDeck(owner: ParticipantId, deck: DeckId): boolean
  /**
   * その人が前に席に着く時に選んだデッキ（ADR-0021、#194）。まだ選んでいなければ `undefined`。
   *
   * **そのデッキがまだあるかは見ない。** 消えたものを指したままになりうるので、使う側が読む時に
   * 確かめる（`deck.ts` の `withOwnedDecks`）。消す時に覚えているほうも消しに行くと、デッキが
   * 置き場から消える道が増えるたびに消し漏れる。
   */
  lastChosenDeckOf(owner: ParticipantId): DeckId | undefined
  /** 席に着く時に選んだデッキを覚える。**前に覚えたものは置き換わる。** */
  rememberChosenDeck(owner: ParticipantId, deck: DeckId): void
  close(): void
}

/** 置き場を開く。無ければ作る。`:memory:` を渡すと、閉じたときに消えるものになる。 */
export function openStore(path: string): Store {
  const db = new DatabaseSync(path)
  // 落ちたときに書き終えた分が残るようにする。読み書きが並ぶわけではない（部屋を持つのは
  // 1 つのプロセスだけ、ADR-0014）が、追記の形が素直になる。
  db.exec('pragma journal_mode = wal')
  db.exec('pragma foreign_keys = on')
  db.exec(SCHEMA)
  addMissingColumns(db)

  const insertDuel = db.prepare(
    `insert into duels (code, name, seed, first, second, cpu, decks, started_at, format, restriction)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const insertStep = db.prepare('insert into steps (duel, ordinal, action, answers) values (?, ?, ?, ?)')
  const closeDuel = db.prepare('update duels set closed_at = ? where code = ? and closed_at is null')
  const openRows = db.prepare('select * from duels where closed_at is null order by id')
  const stepRows = db.prepare('select action, answers from steps where duel = ? order by ordinal')
  const stepCount = db.prepare('select count(*) as n from steps where duel = ?')
  const insertIdentity = db.prepare('insert or ignore into identities (issuer, subject) values (?, ?)')
  const identityRow = db.prepare('select id from identities where issuer = ? and subject = ?')
  const nameRow = db.prepare('select name from identities where id = ?')
  const setName = db.prepare('update identities set name = ? where id = ?')
  const insertSession = db.prepare('insert or replace into sessions (digest, identity, opened_at) values (?, ?, ?)')
  const sessionRow = db.prepare('select identity from sessions where digest = ? and opened_at >= ?')
  const deckRows = db.prepare('select id, name, description, cards from decks where owner = ? order by id')
  const insertDeck = db.prepare(
    'insert into decks (owner, name, description, cards, updated_at) values (?, ?, ?, ?, ?)',
  )
  // **持ち主も条件に入れる。** 識別子だけで引くと、他人のデッキを書き換えられる。
  const updateDeck = db.prepare(
    'update decks set name = ?, description = ?, cards = ?, updated_at = ? where id = ? and owner = ?',
  )
  const removeDeck = db.prepare('delete from decks where id = ? and owner = ?')
  const lastDeckRow = db.prepare('select last_deck from identities where id = ?')
  const setLastDeck = db.prepare('update identities set last_deck = ? where id = ?')

  /**
   * いま開いている対戦の、合言葉から行番号への引き当て。
   *
   * 手を書き足すたびに引き直すと、閉じた同じ合言葉の行まで見えてしまう。**開いている 1 つに
   * 決まるのはここだけである。**
   */
  const openIds = new Map<RoomCode, number>()
  /** その対戦にいくつ手が書かれているか。並び順の番号に使う。 */
  const written = new Map<RoomCode, number>()

  for (const row of openRows.all()) {
    openIds.set(text(row, 'code'), int(row, 'id'))
    written.set(text(row, 'code'), int(stepCount.get(int(row, 'id')) ?? {}, 'n'))
  }

  function writeOne(record: DuelRecord): void {
    switch (record.kind) {
      case '始まった': {
        const result = insertDuel.run(
          record.code,
          record.name,
          record.seed,
          record.seats.先攻,
          record.seats.後攻,
          record.cpu ?? null,
          JSON.stringify(record.decks),
          Date.now(),
          record.rules.format,
          record.rules.restriction ?? null,
        )
        openIds.set(record.code, Number(result.lastInsertRowid))
        written.set(record.code, 0)
        return
      }
      case '打たれた': {
        const duel = openIds.get(record.code)
        // 始まりを書いていない対戦の手は捨てる。手元で置き場を後から足した場合に起こりうる。
        // **書けないことでサーバを止めない**——記録が欠けるより、打てなくなるほうが重い。
        if (duel === undefined) return

        const ordinal = written.get(record.code) ?? 0
        insertStep.run(duel, ordinal, JSON.stringify(record.action), JSON.stringify(record.answers))
        written.set(record.code, ordinal + 1)
        return
      }
      case '閉じた': {
        closeDuel.run(Date.now(), record.code)
        openIds.delete(record.code)
        written.delete(record.code)
        return
      }
    }
  }

  return {
    write: (records) => {
      if (records.length === 0) return

      db.exec('begin')
      try {
        for (const record of records) writeOne(record)
        db.exec('commit')
      } catch (error) {
        db.exec('rollback')
        throw error
      }
    },
    openDuels: () =>
      openRows.all().map((row) => ({
        code: text(row, 'code'),
        name: text(row, 'name'),
        seed: int(row, 'seed'),
        seats: { 先攻: text(row, 'first'), 後攻: text(row, 'second') },
        cpu: maybeText(row, 'cpu'),
        decks: JSON.parse(text(row, 'decks')) as StoredDuel['decks'],
        rules: {
          format: text(row, 'format') as StoredDuel['rules']['format'],
          restriction: maybeText(row, 'restriction'),
        },
        steps: stepRows.all(int(row, 'id')).map((step) => ({
          action: JSON.parse(text(step, 'action')) as StoredDuel['steps'][number]['action'],
          answers: JSON.parse(text(step, 'answers')) as StoredDuel['steps'][number]['answers'],
        })),
      })),
    identify: (issuer, subject) => {
      // 入れてから引く。**入っていれば入れないので**、初めてでも 2 度目でも同じ行に行き着く。
      insertIdentity.run(issuer, subject)
      const row = identityRow.get(issuer, subject)
      if (row === undefined) throw new Error(`身元を作れませんでした: ${issuer}`)

      return seatedAs(int(row, 'id'))
    },
    nameOf: (participant) => {
      const row = nameRow.get(identityOf(participant))
      return row === undefined ? undefined : maybeText(row, 'name')
    },
    rename: (participant, name) => {
      setName.run(name, identityOf(participant))
    },
    openSession: (digest, participant) => {
      insertSession.run(digest, identityOf(participant), Date.now())
    },
    sessionHolder: (digest, since) => {
      const row = sessionRow.get(digest, since)
      return row === undefined ? undefined : seatedAs(int(row, 'identity'))
    },
    decksOf: (owner) =>
      deckRows.all(identityOf(owner)).map((row) => ({
        id: String(int(row, 'id')),
        name: text(row, 'name'),
        description: text(row, 'description'),
        cards: JSON.parse(text(row, 'cards')) as readonly string[],
      })),
    saveDeck: (owner, deck, draft) => {
      const cards = JSON.stringify(draft.cards)
      if (deck === undefined) {
        const result = insertDeck.run(identityOf(owner), draft.name, draft.description, cards, Date.now())
        return String(result.lastInsertRowid)
      }

      const row = deckRowOf(deck)
      if (row === undefined) return undefined

      const result = updateDeck.run(draft.name, draft.description, cards, Date.now(), row, identityOf(owner))
      return Number(result.changes) === 0 ? undefined : deck
    },
    deleteDeck: (owner, deck) => {
      const row = deckRowOf(deck)
      if (row === undefined) return false

      return Number(removeDeck.run(row, identityOf(owner)).changes) > 0
    },
    lastChosenDeckOf: (owner) => {
      const row = lastDeckRow.get(identityOf(owner))
      if (row === undefined) return undefined

      const deck = maybeInt(row, 'last_deck')
      return deck === undefined ? undefined : String(deck)
    },
    rememberChosenDeck: (owner, deck) => {
      const row = deckRowOf(deck)
      // 読めない形の識別子は、指せるデッキが無いのと同じである（`deckRowOf`）。覚えずに捨てる。
      if (row === undefined) return

      setLastDeck.run(row, identityOf(owner))
    },
    close: () => {
      db.close()
    },
  }
}
