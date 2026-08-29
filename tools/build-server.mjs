// 置き場へ持ち込む 1 ファイルを書き出す。
//
// **カードは置き場でビルドさせない**（ADR-0002、ADR-0014）。カードの実装は非公開なので、
// 束ねるのは手元でだけ行い、置き場へ渡すのは出来上がった 1 ファイルにする。
// 置き場がリポジトリを読んでビルドする形にすると、非公開のカードをそこへ渡すことになってしまう。
//
//     pnpm build:server --decks packages/decks/src/index.ts --out dist/serve.cjs
//
// 出したものは node だけで動く（`ws` も束ねてある）。**待つポートは `PORT` で決められる**ので、
// 置き場では常駐の設定の側に書けばよく、束ね直す必要はない。
//
// 出力は `dist/` に置く。**成果物はリポジトリに入れない**（`.gitignore` 済み）。焼き込んだ
// カードごと追跡してしまうため。
import { mkdir, stat } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { DEFAULT_PORT, bundleServer, readFlag } from './bundle-server.mjs'

const DEFAULT_OUT = 'dist/serve.cjs'

/** `--decks <パス>`、`--out <パス>`、`--port <番号>` を読む。 */
function options(argv) {
  const decks = readFlag(argv, 'decks')
  if (decks === undefined || decks === '') {
    throw new Error('--decks <モジュールのパス> が要ります。デッキ 2 つを `decks` として export するモジュールを指してください')
  }

  return {
    decks,
    out: resolve(readFlag(argv, 'out') ?? DEFAULT_OUT),
    port: Number(readFlag(argv, 'port') ?? DEFAULT_PORT),
  }
}

const { decks, out, port } = options(process.argv.slice(2))

await mkdir(dirname(out), { recursive: true })
if (!(await bundleServer({ decks, port, outfile: out }))) {
  process.exit(1)
}

const { size } = await stat(out)
console.log(`${relative(process.cwd(), out)} に書き出しました（${(size / 1024 / 1024).toFixed(2)} MB、既定のポート ${port}）`)
