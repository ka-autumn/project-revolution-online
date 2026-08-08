// エンジンが「依存ゼロ」かつ「ブラウザとサーバの両方で動く」ことを機械的に確かめる（ADR-0001）。
//
// 型検査だけでは足りない。tsconfig で lib と types を絞っても、実行時依存や
// バンドラから見た解決可能性は検査されないため、実際に両プラットフォーム向けに
// バンドルして確かめる。
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const repoRoot = new URL('../', import.meta.url)
const engineDir = 'packages/engine'
const entryPoint = fileURLToPath(new URL(`${engineDir}/src/index.ts`, repoRoot))

const failures = []

const manifest = JSON.parse(await readFile(new URL(`${engineDir}/package.json`, repoRoot), 'utf8'))
for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
  const names = Object.keys(manifest[field] ?? {})
  if (names.length > 0) {
    failures.push(`${field} が空ではありません: ${names.join(', ')}`)
  }
}

for (const platform of ['browser', 'node']) {
  try {
    const result = await esbuild.build({
      entryPoints: [entryPoint],
      absWorkingDir: fileURLToPath(repoRoot),
      bundle: true,
      write: false,
      format: 'esm',
      platform,
      target: platform === 'browser' ? 'es2022' : 'node22',
      metafile: true,
      logLevel: 'silent',
    })

    // バンドルに自分の src 以外が混ざっていれば、それは依存が生えたということ。
    // カード実装への依存（逆向き）もここで落ちる。
    const foreign = Object.keys(result.metafile.inputs)
      .map((input) => input.replaceAll('\\', '/'))
      .filter((input) => !input.startsWith(`${engineDir}/src/`))
    if (foreign.length > 0) {
      failures.push(`${platform} 向けバンドルに外部の入力が含まれます: ${foreign.join(', ')}`)
    }

    const bytes = result.outputFiles.reduce((total, file) => total + file.contents.byteLength, 0)
    console.log(`  ok  ${platform} 向けバンドル (${bytes} bytes)`)
  } catch (error) {
    failures.push(`${platform} 向けにバンドルできません: ${error.message}`)
  }
}

if (failures.length > 0) {
  console.error('\nエンジンの検証に失敗しました:')
  for (const failure of failures) {
    console.error(`  NG  ${failure}`)
  }
  process.exit(1)
}

console.log('\nエンジンは依存ゼロで、ブラウザとサーバの両方向けにビルドできます。')
