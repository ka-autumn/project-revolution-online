// お知らせのファイルを、形を確かめてから置き場へ丸ごと上げる（ADR-0045）。
//
// ここは本体で、引数・環境変数・ファイル・上げる手段・出力を外から受け取る。`@vercel/blob` も
// Node の API も import しない（このパッケージを依存ゼロ・環境に寄らないまま保つため）。
// 実際につなぐのは `tools/publish-notices*.mjs`。
import { checkNoticeFile, readNotices } from './notice.js'

/** 置き場のパス名。本番も検証も同じで、上げ直しても URL は変わらない。 */
export const NOTICES_PATHNAME = 'notices.json'

/** 上げ先。本番と検証で置き場もトークンも別。 */
export type PublishTarget = '本番' | '検証'

/**
 * 上げ先ごとに読むトークンの環境変数。ここに無い変数は読まない
 * （`BLOB_READ_WRITE_TOKEN` も、もう一方の上げ先の変数も）。
 */
export const TOKEN_VARIABLES: Readonly<Record<PublishTarget, string>> = {
  本番: 'REVOLUTION_NOTICES_TOKEN',
  検証: 'REVOLUTION_NOTICES_TOKEN_VERIFY',
}

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

/**
 * 上げる手段が失敗した時に投げる。`kind` は例外の種類を表す文字列（クラス名）。
 * ライブラリの例外は `instanceof` で見分けられる入口の側で、この形に変えてから渡す。
 * 例外のメッセージは持たせない（中にトークンが混ざらないと言い切れないため）。
 */
export class PutFailure extends Error {
  readonly kind: string

  constructor(kind: string) {
    super(kind)
    this.kind = kind
  }
}

export type PublishRequest = {
  readonly argv: readonly string[]
  readonly target: PublishTarget
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
      if (flag === undefined) return '知らない引数があります'
      if (typeof arg === 'string' && arg.includes('=')) {
        return `${flag} は = でつなぐ形を受け付けません。--notices <パス> のように空白で区切って渡してください`
      }
      return `知らない引数です: ${flag}`
    }
  }
  if (path === undefined || path === '') return '--notices <お知らせのファイルのパス> が要ります'
  return { path, check }
}

/** 失敗の種類（クラス名）を、何が起きたか分かる文言にする。メッセージは使わない。 */
function describeFailure(kind: string, tokenVariable: string): string {
  switch (kind) {
    case 'BlobAccessError':
      return `トークンが受け付けられませんでした。${tokenVariable} の値を確かめてください`
    case 'BlobStoreNotFoundError':
      return 'ストアが見つかりません。トークンがどのストアのものか確かめてください'
    case 'BlobStoreSuspendedError':
      return 'ストアが止まっています（利用枠を超えた可能性があります）'
    case 'BlobRequestAbortedError':
      return '送信が中断されました。もう一度試してください'
    default:
      return `上げられませんでした（${kind}）。値と通信を確かめてください`
  }
}

/** 例外から、出してよい名前だけを取る。形が外れていれば '不明'。 */
function failureKind(error: unknown): string {
  const name = error instanceof PutFailure ? error.kind : error instanceof Error ? error.name : ''
  return /^\w{1,40}$/.test(name) ? name : '不明'
}

/**
 * 終了コードを返す。0 以外なら、理由を `err` に出してある。
 *
 * 順序: 引数 → ファイル → 形の確認（通らなければ終わり。トークンは読まない）→ `--check` ならここで
 * 終わり → トークン → 上げる。
 */
export async function publishNotices(request: PublishRequest): Promise<number> {
  const { out, err } = request
  const tokenVariable = TOKEN_VARIABLES[request.target]

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
  // ファイル全体の検査は、外した件が無い時だけ行う。何件目かをファイルの位置のまま出すため。
  const problems =
    reading.rejected.length > 0 ? reading.rejected.map((rejection) => rejection.reason) : checkNoticeFile(reading.notices)
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

  const token = (request.env(tokenVariable) ?? '').trim()
  if (token === '') {
    err(`環境変数 ${tokenVariable} が空か、設定されていません。上げていません。`)
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
  } catch (error) {
    // 例外のメッセージはそのまま出さない。中にトークンが混ざらないと言い切れない。
    err(describeFailure(failureKind(error), tokenVariable))
    return 1
  }

  out(`${count} 件を上げました。`)
  out(`公開 URL: ${uploaded.url}`)
  return 0
}
