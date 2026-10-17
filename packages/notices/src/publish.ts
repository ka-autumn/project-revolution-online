// お知らせのファイルを、形を確かめてから置き場へ丸ごと上げる（ADR-0045）。
//
// ここは本体で、引数・環境変数・ファイル・上げる手段・出力を外から受け取る。`@vercel/blob` も
// Node の API も import しない（このパッケージを依存ゼロ・環境に寄らないまま保つため）。
// 実際につなぐのは `tools/publish-notices*.mjs`。
import { checkNoticeFile, readNotices } from './notice.js'

/** 置き場のパス名。本番も検証も同じで、上げ直しても URL は変わらない。 */
export const NOTICES_PATHNAME = 'notices.json'

/** `@vercel/blob` の `put` に渡す引数のうち、こちらが決めているもの。 */
export type PublishOptions = {
  readonly access: 'public'
  readonly addRandomSuffix: false
  readonly allowOverwrite: true
  readonly cacheControlMaxAge: number
  readonly contentType: 'application/json'
  readonly token: string
}

export type PutNotices = (
  pathname: string,
  body: string,
  options: PublishOptions,
) => Promise<{ readonly url: string }>

export type PublishRequest = {
  readonly argv: readonly string[]
  /** 読むトークンの環境変数の名前。本番と検証で別。これ以外の変数は読まない。 */
  readonly tokenVariable: string
  readonly env: (name: string) => string | undefined
  readonly readFile: (path: string) => Promise<string>
  readonly put: PutNotices
  readonly out: (line: string) => void
  readonly err: (line: string) => void
}

type Args = { readonly path: string; readonly check: boolean }

function readArgs(argv: readonly string[]): Args | string {
  let path: string | undefined
  let check = false
  for (let at = 0; at < argv.length; at++) {
    const arg = argv[at]
    if (arg === '--check') {
      check = true
    } else if (arg === '--notices') {
      const next = argv[at + 1]
      if (next !== undefined && !next.startsWith('--')) path = argv[++at]
    } else {
      // 値は出さない。トークンを引数で渡されても、ここから漏れないように。
      const flag = typeof arg === 'string' && arg.startsWith('--') ? arg.split('=')[0] : undefined
      return flag === undefined ? '知らない引数があります' : `知らない引数です: ${flag}`
    }
  }
  if (path === undefined || path === '') return '--notices <お知らせのファイルのパス> が要ります'
  return { path, check }
}

/**
 * 終了コードを返す。0 以外なら、理由を `err` に出してある。
 *
 * 順序: 引数 → ファイル → 形の確認（通らなければ終わり。トークンは読まない）→ `--check` ならここで
 * 終わり → トークン → 上げる。
 */
export async function publishNotices(request: PublishRequest): Promise<number> {
  const { out, err } = request

  const args = readArgs(request.argv)
  if (typeof args === 'string') {
    err(args)
    return 2
  }

  let text: string
  try {
    text = await request.readFile(args.path)
  } catch {
    err(`ファイルを読めません: ${args.path}`)
    return 1
  }

  const reading = readNotices(text)
  if (!reading.ok) {
    err(`お知らせのファイルを読めません: ${reading.reason}`)
    return 1
  }
  const problems = [...reading.rejected.map((rejection) => rejection.reason), ...checkNoticeFile(reading.notices)]
  if (problems.length > 0) {
    err(`お知らせのファイルに誤りがあります（${problems.length} 件）。上げていません。`)
    for (const problem of problems) err(`  ${problem}`)
    return 1
  }

  const count = reading.notices.length
  if (args.check) {
    out(`形は正しいです（${count} 件）。--check なので上げていません。`)
    return 0
  }

  const token = (request.env(request.tokenVariable) ?? '').trim()
  if (token === '') {
    err(`環境変数 ${request.tokenVariable} が空か、設定されていません。上げていません。`)
    return 1
  }

  let uploaded: { readonly url: string }
  try {
    uploaded = await request.put(NOTICES_PATHNAME, text, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
      contentType: 'application/json',
      token,
    })
  } catch {
    // 例外の文言はそのまま出さない。中にトークンが混ざらないと言い切れない。
    err(`上げられませんでした。${request.tokenVariable} の値と通信を確かめてください。`)
    return 1
  }

  out(`${count} 件を上げました。`)
  out(`公開 URL: ${uploaded.url}`)
  return 0
}
