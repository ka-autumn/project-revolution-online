// 日ごとの「接続した人の数」と「接続した回数」を読む（#350）。
//
//     pnpm connections /var/lib/revolution/revolution.sqlite
//     pnpm connections revolution.sqlite --since 2026-11-01 --json
//
// **読むだけで、置き場には何も書かない。** 置き場は WAL なので、サーバが動いたままでも読める。
// 日付は日本時間（UTC+9）で区切る。`--since YYYY-MM-DD` はその日（日本時間）の 0 時以降。
//
// 束ね方は `serve.mjs` と同じ理由（node は `.js` で終わる import を `.ts` に読み替えない）で、
// esbuild で 1 つにしてから走らせる。
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'
import { readFlag } from './bundle-server.mjs'

const argv = process.argv.slice(2)
const path = argv.find((each, at) => !each.startsWith('--') && argv[at - 1] !== '--since')
if (path === undefined) {
  console.error('使い方: pnpm connections <置き場のパス> [--since YYYY-MM-DD] [--json]')
  process.exit(2)
}

const sinceFlag = readFlag(argv, 'since')
let since = 0
if (sinceFlag !== undefined) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceFlag) || Number.isNaN(Date.parse(sinceFlag))) {
    console.error('--since は YYYY-MM-DD で指定してください')
    process.exit(2)
  }
  // 日本時間のその日の 0 時（UTC では前日の 15 時）。
  since = Date.parse(`${sinceFlag}T00:00:00+09:00`)
}

const root = fileURLToPath(new URL('../', import.meta.url))
const workDir = await mkdtemp(join(tmpdir(), 'revolution-connections-'))
try {
  const outfile = join(workDir, 'store.mjs')
  await esbuild.build({
    entryPoints: [resolve(root, 'packages/server/src/store.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'error',
  })
  const { readConnectionDays } = await import(pathToFileURL(outfile).href)
  const days = readConnectionDays(resolve(path), since)

  if (argv.includes('--json')) {
    console.log(JSON.stringify(days, null, 2))
  } else {
    console.log('日付（日本時間）\t接続した人\t接続した回数')
    for (const day of days) console.log(`${day.day}\t${day.people}\t${day.connections}`)
  }
} catch (error) {
  console.error('読めませんでした:', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await rm(workDir, { recursive: true, force: true })
}
