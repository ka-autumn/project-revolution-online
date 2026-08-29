// 対戦サーバを立てる（#105）。
//
// **どのカードを使うかは、このリポジトリが知らない。** カードの実装は非公開で（ADR-0002）、
// 公開リポジトリだけを clone した人でも `pnpm install` と `pnpm verify` を通せる必要がある。
// そのため、デッキを渡すモジュールは**実行時に受け取り、静的な依存にしない。**
//
//     pnpm serve --decks ../revolution-decks/index.ts
//
// 渡すモジュールは、デッキ 2 つを `decks` として export する。デッキはただのカードの並びなので、
// **何をどの枚数入れるかは渡す側が決める。** このリポジトリは積み方の取り決めを持たない。
//
//     export const decks = [[cardA, cardA, cardB, ...], [...]]
//
// 立てる時に構築戦の規定（総合ルール 第3部 第1章 3-1）を満たしているかを確かめるので、
// 満たしていなければその場で分かる。
//
// **ここは手元で立てるためのもので、置き場へ運ぶものは `build-server.mjs` が書き出す。**
// 束ね方はどちらも `bundle-server.mjs` にある。
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_PORT, bundleServer, readFlag } from './bundle-server.mjs'

/** `--decks <パス>` と `--port <番号>` を読む。 */
function options(argv) {
  const decks = readFlag(argv, 'decks')
  if (decks === undefined || decks === '') {
    throw new Error('--decks <モジュールのパス> が要ります。デッキ 2 つを `decks` として export するモジュールを指してください')
  }

  return { decks, port: Number(readFlag(argv, 'port') ?? process.env.PORT ?? DEFAULT_PORT) }
}

const { decks, port } = options(process.argv.slice(2))
const workDir = await mkdtemp(join(tmpdir(), 'revolution-serve-'))
const bundle = join(workDir, 'serve.cjs')

if (!(await bundleServer({ decks, port, outfile: bundle }))) {
  await rm(workDir, { recursive: true, force: true })
  process.exit(1)
}

const server = spawn(process.execPath, [bundle], { stdio: 'inherit' })
server.on('exit', async (code) => {
  await rm(workDir, { recursive: true, force: true })
  process.exitCode = code ?? 0
})
