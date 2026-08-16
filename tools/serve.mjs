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
// 束ねてから走らせるのは、node が `.js` で終わる import を `.ts` に読み替えないためである
// （リポジトリ全体がその書き方をしている）。エンジンを検証するところ（`verify-engine.mjs`）と
// 同じ esbuild を使う。CommonJS で出すのは `ws` が CommonJS だからで、ESM で束ねるとその中の
// `require` が動かない。
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const DEFAULT_PORT = 8787

const repoRoot = fileURLToPath(new URL('../', import.meta.url))

/**
 * import に書ける形にしたパス。
 *
 * **パッケージ名では指せない。** pnpm のワークスペースのリンクは各パッケージの
 * `node_modules` にしかなく、リポジトリのルートから `@revolution/server` は解決できない。
 * ソースを絶対パスで指せば、その中の import はそのパッケージから解決される。
 *
 * Windows の `\` はそのままだと文字列の中で潰れるので、`/` に直す。
 */
function specifier(path) {
  return resolve(path).replaceAll('\\', '/')
}

const serverEntry = specifier(join(repoRoot, 'packages/server/src/index.ts'))

/** `--decks <パス>` と `--port <番号>` を読む。 */
function options(argv) {
  const read = (name) => {
    const at = argv.indexOf(`--${name}`)
    return at === -1 ? undefined : argv[at + 1]
  }

  const decks = read('decks')
  if (decks === undefined || decks === '') {
    throw new Error('--decks <モジュールのパス> が要ります。デッキ 2 つを `decks` として export するモジュールを指してください')
  }

  return { decks, port: Number(read('port') ?? process.env.PORT ?? DEFAULT_PORT) }
}

/**
 * 束ねる対象になる入口。
 *
 * ここに置くのは**繋ぐところだけ**で、デッキの組み方も不備の見方もサーバの側にある
 * （`packages/server/src/deck.ts`）。この文字列は型検査を通らないので、判断を持たせない。
 */
function entryPoint(decksModule, port) {
  return `
import { checkDecks, serve, setupFromDecks } from ${JSON.stringify(serverEntry)}
import { decks } from ${JSON.stringify(specifier(decksModule))}

if (!Array.isArray(decks) || decks.length !== 2 || !decks.every(Array.isArray)) {
  console.error('渡されたモジュールは、デッキ 2 つを decks として export していません')
  process.exit(1)
}

const setup = setupFromDecks(decks)
const violations = checkDecks(decks)
if (violations.length > 0) {
  console.error('デッキが構築戦の規定を満たしていません:')
  for (const { seat, violation } of violations) console.error(\`  \${seat + 1} 人目: \${JSON.stringify(violation)}\`)
  process.exit(1)
}

serve({ port: ${port}, setup })
  .then((running) => {
    console.log(\`ポート \${running.port} で待っています\`)
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
`
}

const { decks, port } = options(process.argv.slice(2))
const workDir = await mkdtemp(join(tmpdir(), 'revolution-serve-'))
const bundle = join(workDir, 'serve.cjs')

try {
  await esbuild.build({
    stdin: { contents: entryPoint(decks, port), resolveDir: repoRoot, loader: 'ts' },
    outfile: bundle,
    absWorkingDir: repoRoot,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    logLevel: 'warning',
  })
} catch {
  // esbuild がすでに読める形で書いている。同じことを二度言わない。
  await rm(workDir, { recursive: true, force: true })
  process.exit(1)
}

const server = spawn(process.execPath, [bundle], { stdio: 'inherit' })
server.on('exit', async (code) => {
  await rm(workDir, { recursive: true, force: true })
  process.exitCode = code ?? 0
})
