// 対戦サーバを立てる（#105）。
//
// **どのカードを使うかは、このリポジトリが知らない。** カードの実装は非公開で（ADR-0002）、
// 公開リポジトリだけを clone した人でも `pnpm install` と `pnpm verify` を通せる必要がある。
// そのため、カードを渡すモジュールは**実行時に受け取り、静的な依存にしない。**
//
//     pnpm serve --decks ../revolution-decks/index.ts
//
// 渡すモジュールが export するのは、識別子で引けるカードのまとまり（`pool`）と、識別子の並びで
// できた既製デッキ（`presets`）と、禁止／制限リスト（`restrictions`、空でよい）である
// （ADR-0021）。**何がプールに入るかも、既製デッキに何を何枚積むかも渡す側が決める。**
// このリポジトリは積み方の取り決めを持たない。
//
//     export const pool = { 'カードの識別子': card, ... }
//     export const presets = [{ id: 'デッキの識別子', name: '名前', cards: ['カードの識別子', ...] }]
//     export const restrictions = []
//
// 立てる時に、既製デッキが構築戦の規定（総合ルール 第3部 第1章 3-1）を満たしているかを
// 確かめるので、満たしていなければその場で分かる。
//
// **ここは手元で立てるためのもので、置き場へ運ぶものは `build-server.mjs` が書き出す。**
// 束ね方はどちらも `bundle-server.mjs` にある。
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_PORT, DEFAULT_STORE, bundleServer, readFlag } from './bundle-server.mjs'

/**
 * `--decks <パス>`、`--port <番号>`、`--store <パス>` を読む。
 *
 * `--store` に空文字を渡すと、何も残さずに立てる。立て直せば対戦は消える（ADR-0018 より前と
 * 同じ）。手元で作った置き場を残したくないときに使う。
 */
function options(argv) {
  const decks = readFlag(argv, 'decks')
  if (decks === undefined || decks === '') {
    throw new Error('--decks <モジュールのパス> が要ります。カードのプールと既製デッキを export するモジュールを指してください')
  }

  return {
    decks,
    port: Number(readFlag(argv, 'port') ?? process.env.PORT ?? DEFAULT_PORT),
    store: readFlag(argv, 'store') ?? process.env.STORE ?? DEFAULT_STORE,
  }
}

const { decks, port, store } = options(process.argv.slice(2))
const workDir = await mkdtemp(join(tmpdir(), 'revolution-serve-'))
const bundle = join(workDir, 'serve.cjs')

if (!(await bundleServer({ decks, port, store, outfile: bundle }))) {
  await rm(workDir, { recursive: true, force: true })
  process.exit(1)
}

const server = spawn(process.execPath, [bundle], { stdio: 'inherit' })
server.on('exit', async (code) => {
  await rm(workDir, { recursive: true, force: true })
  process.exitCode = code ?? 0
})
