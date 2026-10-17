// お知らせのファイルを置き場へ上げる、共通の入口（ADR-0045）。
//
// 本番向け（publish-notices.mjs）と検証向け（publish-notices-verify.mjs）のどちらも、ここを呼ぶ。
// 本体は `packages/notices/src/publish.ts` にあり、ここは Node の API と `@vercel/blob` の `put` を
// つなぐだけ。TypeScript は node が `.js` の import を `.ts` に読み替えないため、esbuild で束ねてから読む。
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

const entry = fileURLToPath(new URL('../packages/notices/src/publish.ts', import.meta.url))

/** `tokenVariable` に指定した環境変数だけを、トークンとして読む。 */
export async function publishNoticesCommand({ tokenVariable }) {
  const workDir = await mkdtemp(join(tmpdir(), 'revolution-notices-'))
  try {
    const bundle = join(workDir, 'publish.mjs')
    await esbuild.build({
      entryPoints: [entry],
      outfile: bundle,
      bundle: true,
      platform: 'node',
      format: 'esm',
      logLevel: 'error',
    })
    const { publishNotices } = await import(pathToFileURL(bundle).href)

    process.exitCode = await publishNotices({
      argv: process.argv.slice(2),
      tokenVariable,
      env: (name) => process.env[name],
      readFile: (path) => readFile(path, 'utf8'),
      // `--check` では要らないので、必要になるまで読み込まない。
      put: async (pathname, body, options) => {
        const { put } = await import('@vercel/blob')
        return put(pathname, body, options)
      },
      out: (line) => console.log(line),
      err: (line) => console.error(line),
    })
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}
