import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 本物のブラウザのテストが立てる対戦サーバと画面。番号は、手元で立てている対戦サーバ
 * （8787・8788）や画面（5173）と取り合わないものにする。
 */
export const CLIENT_PORT = 5197

export interface GameServer {
  readonly port: number
  /** 置き場のファイル名。テストの実行ごとの使い捨てのディレクトリに作成する。 */
  readonly store: string
  /** 1 つのテストで同時に使う人数の最大。この数のセッションを、起動の前に置き場へ書き込む。 */
  readonly people: number
}

/** 筋書き用。架空のカードを渡すので、公開リポジトリだけで走る。 */
export const SCENARIO_SERVER: GameServer = { port: 8797, store: 'scenarios.sqlite', people: 8 }

/** 計測用。非公開側のカードと画像が要るので、`private/` があるときだけ立てる。 */
export const MEASURE_SERVER: GameServer = { port: 8798, store: 'measure.sqlite', people: 1 }

export const PRIVATE_DECKS = 'private/decks/src/index.ts'
export const hasPrivateDecks = existsSync(fileURLToPath(new URL(`../../../${PRIVATE_DECKS}`, import.meta.url)))

/** 置き場のディレクトリを、このプロセスか親のプロセスがすでに作成したか。 */
export const hasStoreDirectory = (): boolean => process.env['REVOLUTION_BROWSER_TEST_STORES'] !== undefined

/**
 * 置き場を作成するディレクトリ。設定ファイルはテストを走らせるプロセスごとに読み直されるので、
 * 最初に作成したものを環境変数で引き継ぐ。片付けるのは `remove-stores.ts`。
 */
export function storeDirectory(): string {
  process.env['REVOLUTION_BROWSER_TEST_STORES'] ??= mkdtempSync(join(tmpdir(), 'revolution-browser-test-'))
  return process.env['REVOLUTION_BROWSER_TEST_STORES']
}

export const storePathOf = (server: GameServer): string => join(storeDirectory(), server.store)

/** 何人目かの人の、セッションの合言葉。使い捨ての置き場でだけ通る。 */
export const sessionToken = (seat: number): string => `browser-test-session-${seat}`
