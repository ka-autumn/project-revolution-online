// 対戦サーバを 1 ファイルに束ねる。
//
// **立てるとき（`serve.mjs`）と持ち出すとき（`build-server.mjs`）で、同じものが要る。**
// 手元で走らせたものと置き場へ運ぶものが別物にならないよう、束ね方はここにしか置かない。
//
// 束ねてから走らせるのは、node が `.js` で終わる import を `.ts` に読み替えないためである
// （リポジトリ全体がその書き方をしている）。エンジンを検証するところ（`verify-engine.mjs`）と
// 同じ esbuild を使う。CommonJS で出すのは `ws` が CommonJS だからで、ESM で束ねるとその中の
// `require` が動かない。
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

export const DEFAULT_PORT = 8787

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

const serverEntry = specifier(resolve(repoRoot, 'packages/server/src/index.ts'))

/** `--<名前> <値>` を読む。無ければ `undefined`。 */
export function readFlag(argv, name) {
  const at = argv.indexOf(`--${name}`)
  return at === -1 ? undefined : argv[at + 1]
}

/**
 * 束ねる対象になる入口。
 *
 * ここに置くのは**繋ぐところだけ**で、デッキの組み方も不備の見方もサーバの側にある
 * （`packages/server/src/deck.ts`）。この文字列は型検査を通らないので、判断を持たせない。
 *
 * ポートは焼き付けた値を既定にしつつ、`PORT` で上書きできるようにしてある。
 * **置き場では、待つポートを常駐の設定の側で決めたい。** 束ね直さずに変えられる余地を残す。
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

serve({ port: Number(process.env.PORT ?? ${port}), setup })
  .then((running) => {
    console.log(\`ポート \${running.port} で待っています\`)
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
`
}

/**
 * `outfile` に束ねたものを書き出す。
 *
 * 失敗したときは `false` を返す。**呼ぶ側で言い直さない。** esbuild がすでに読める形で
 * 書いているので、同じことを二度言わないため。
 */
export async function bundleServer({ decks, port = DEFAULT_PORT, outfile }) {
  try {
    await esbuild.build({
      stdin: { contents: entryPoint(decks, port), resolveDir: repoRoot, loader: 'ts' },
      outfile,
      absWorkingDir: repoRoot,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      logLevel: 'warning',
    })
    return true
  } catch {
    return false
  }
}
