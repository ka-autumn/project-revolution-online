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

/** 見分ける例外のクラス。本体は、この名前から日本語の文言を作る。 */
const BLOB_ERRORS = [
  'BlobAccessError',
  'BlobStoreNotFoundError',
  'BlobStoreSuspendedError',
  'BlobRequestAbortedError',
  'BlobClientTokenExpiredError',
  'BlobContentTypeNotAllowedError',
  'BlobFileTooLargeError',
  'BlobNotFoundError',
  'BlobPathnameMismatchError',
  'BlobPreconditionFailedError',
  'BlobUnknownError',
  'BlobError',
]

/** `target`（本番か検証）に対応する環境変数だけを、トークンとして読む。対応は本体の `TOKEN_VARIABLES`。 */
export async function publishNoticesCommand({ target }) {
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
    const { publishNotices, PutFailure } = await import(pathToFileURL(bundle).href)

    process.exitCode = await publishNotices({
      argv: process.argv.slice(2),
      target,
      env: (name) => process.env[name],
      readFile: (path) => readFile(path, 'utf8'),
      // `--check` では要らないので、必要になるまで読み込まない。
      put: async (pathname, body, options) => {
        const blob = await import('@vercel/blob')
        try {
          return await blob.put(pathname, body, options)
        } catch (error) {
          // 束ねるとクラスの名前が変わりうるので、constructor.name には頼らず instanceof で見分けて、
          // 固定の名前に直して渡す。Blob 以外の例外はそのまま渡す（本体が名前だけを使う）。
          const kind = BLOB_ERRORS.find((name) => typeof blob[name] === 'function' && error instanceof blob[name])
          throw kind === undefined ? error : new PutFailure(kind)
        }
      },
      out: (line) => console.log(line),
      err: (line) => console.error(line),
    })
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}
