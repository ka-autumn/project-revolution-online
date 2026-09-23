// 検証環境（ADR-0025）へ、サーバと画面のエイリアスをまとめて向ける。
//
// これまで手で行っていた2つの操作——`pnpm deploy:server:verify` と
// `vercel alias set <preview> <検証ドメイン>`——を1回のコマンドにまとめるだけで、
// 運び先の決め方そのものは変えない。**自動では走らない**（GitHub Actions 化しない理由は
// ADR-0025 を参照——検証環境は常設1組しか無く、張り替えは「今どのブランチで確かめたいか」
// という意思表示を伴うため、手元で明示的に叩く操作のまま残す）。
//
//     pnpm publish:verify --decks private/decks/src/index.ts
//
// 画面側のプレビュー URL は、現在の HEAD の git SHA に対して Vercel（GitHub 連携）が
// 作った Deployment を `gh` 経由で探す。プレビューがまだビルド中のことがあるため、
// 見つかる・`success` になるまで待つ。
//
//     REVOLUTION_VERIFY_CLIENT_DOMAIN   検証環境の画面が受け持つドメイン（alias の張り先）
//
// サーバ側の環境変数は deploy-server-verify.mjs と共通（`_VERIFY` の付いたもの）。
import { spawnSync } from 'node:child_process'
import { readFlag } from './bundle-server.mjs'
import { deployServer } from './deploy-server-core.mjs'

const DEFAULT_REMOTE_PATH = '/opt/revolution-verify/serve.cjs'
const DEFAULT_UNIT = 'revolution-duel-verify'
const DEFAULT_OUT = 'dist/serve-verify.cjs'

const POLL_INTERVAL_MS = 10_000
const POLL_TIMEOUT_MS = 5 * 60_000

function options(argv) {
  const decks = readFlag(argv, 'decks')
  const host = readFlag(argv, 'host') ?? process.env.REVOLUTION_DEPLOY_HOST_VERIFY
  const key = readFlag(argv, 'key') ?? process.env.REVOLUTION_DEPLOY_KEY_VERIFY
  const domain = readFlag(argv, 'domain') ?? process.env.REVOLUTION_VERIFY_CLIENT_DOMAIN

  const missing = []
  if (decks === undefined || decks === '') missing.push('--decks <モジュールのパス>')
  if (host === undefined || host === '') missing.push('--host <ユーザ>@<ホスト>（または REVOLUTION_DEPLOY_HOST_VERIFY）')
  if (key === undefined || key === '') missing.push('--key <秘密鍵>（または REVOLUTION_DEPLOY_KEY_VERIFY）')
  if (domain === undefined || domain === '') missing.push('--domain <ドメイン>（または REVOLUTION_VERIFY_CLIENT_DOMAIN）')
  if (missing.length > 0) throw new Error(`足りません:\n  ${missing.join('\n  ')}`)

  return {
    decks,
    host,
    key,
    domain,
    out: readFlag(argv, 'out') ?? DEFAULT_OUT,
    remote: readFlag(argv, 'remote-path') ?? process.env.REVOLUTION_DEPLOY_PATH_VERIFY ?? DEFAULT_REMOTE_PATH,
    unit: readFlag(argv, 'unit') ?? process.env.REVOLUTION_DEPLOY_UNIT_VERIFY ?? DEFAULT_UNIT,
  }
}

/**
 * 失敗した時点で処理を終了する。deploy-server-core.mjs の `run` と同じ考え方。
 *
 * `shell` は既定で使わない——シェルを介すと、引数に含めた `|` や `'` が argv の1要素では
 * なくシェル構文として読まれてしまう（`gh api --jq` に渡す jq 式が壊れる）。Windows の
 * `vercel` のように、実体が `.cmd` でシェルを介さないと spawn 自体に失敗するコマンドだけ、
 * 呼ぶ側で `shell: true` を指定する。
 */
function capture(command, args, { shell = false } = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', shell })
  if (result.error !== undefined) {
    console.error(`${command} を起動できませんでした: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout)
    process.exit(result.status ?? 1)
  }
  return result.stdout.trim()
}

/** `vercel` は Windows では `.cmd` のラッパーで、シェルを介さないと spawn 自体に失敗する。 */
function vercel(args) {
  return capture('vercel', args, { shell: process.platform === 'win32' })
}

function currentSha() {
  return capture('git', ['rev-parse', 'HEAD'])
}

function repoNameWithOwner() {
  return capture('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 現在の HEAD に対する Vercel の Preview Deployment の URL を待つ。
 *
 * push した直後はまだビルド中で、Deployment 自体がまだ無いことも、あっても
 * `success` になっていないこともある。**見つからない・終わっていない間はポーリングする。**
 */
async function waitForPreviewUrl(repo, sha) {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  let sawDeployment = false

  while (Date.now() < deadline) {
    const deployments = JSON.parse(
      capture('gh', ['api', `repos/${repo}/deployments`, '--jq', `[.[] | select(.sha == "${sha}" and .environment == "Preview")]`]),
    )
    if (deployments.length > 0) {
      sawDeployment = true
      const statuses = JSON.parse(capture('gh', ['api', `repos/${repo}/deployments/${deployments[0].id}/statuses`]))
      const success = statuses.find((status) => status.state === 'success' && status.environment_url)
      if (success !== undefined) return success.environment_url
      if (statuses.some((status) => status.state === 'failure' || status.state === 'error')) {
        throw new Error('Vercel の Preview Deployment が失敗しています（Vercel 側のログを確認してください）')
      }
    }

    console.log(sawDeployment ? '  画面のプレビューがビルド中…' : '  画面のプレビューの登録を待っています…')
    await sleep(POLL_INTERVAL_MS)
  }

  throw new Error(`画面のプレビューが ${POLL_TIMEOUT_MS / 1000} 秒待っても見つかりませんでした`)
}

async function main() {
  const { decks, host, key, domain, out, remote, unit } = options(process.argv.slice(2))

  console.log('1/2 対戦サーバを検証環境へデプロイしています…')
  await deployServer({ decks, host, key, out, remote, unit })

  console.log('\n2/2 画面のエイリアスを張り替えています…')
  const repo = repoNameWithOwner()
  const sha = currentSha()
  const previewUrl = await waitForPreviewUrl(repo, sha)
  console.log(`  ${previewUrl} → ${domain}`)
  vercel(['alias', 'set', previewUrl, domain])

  console.log(`\n検証環境を張り替えました: https://${domain}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
