// 束ねた対戦サーバを置き場へ反映する。
//
// **どこへ持ち込むかを、このリポジトリは知らない。** 置き場の素性は公開する情報ではないので、
// 宛先は引数か環境変数で受け取る。ここに書いてよいのは**運び方**だけである。
//
//     pnpm deploy:server --decks packages/decks/src/index.ts --host <ユーザ>@<ホスト> --key <秘密鍵>
//
// 引数を省いた分は環境変数から読む。
//
//     REVOLUTION_DEPLOY_HOST   運ぶ先（`<ユーザ>@<ホスト>`）
//     REVOLUTION_DEPLOY_KEY    使う秘密鍵
//     REVOLUTION_DEPLOY_PATH   置き場でのパス（既定は下の DEFAULT_REMOTE_PATH）
//     REVOLUTION_DEPLOY_UNIT   置き場での常駐単位の名前（既定は下の DEFAULT_UNIT）
//
// **一度別の名前で置いてから差し替える。** 転送の途中で落ちたものを常駐単位が拾って
// 起動してしまうことがないようにするためである。
//
// カードは置き場でビルドさせない（ADR-0002、ADR-0014）ので、束ねるのはここ＝手元だけで行う。
import { spawnSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { bundleServer, readFlag } from './bundle-server.mjs'

const DEFAULT_REMOTE_PATH = '/opt/revolution/serve.cjs'
const DEFAULT_UNIT = 'revolution-duel'
const DEFAULT_OUT = 'dist/serve.cjs'

function options(argv) {
  const decks = readFlag(argv, 'decks')
  const host = readFlag(argv, 'host') ?? process.env.REVOLUTION_DEPLOY_HOST
  const key = readFlag(argv, 'key') ?? process.env.REVOLUTION_DEPLOY_KEY

  const missing = []
  if (decks === undefined || decks === '') missing.push('--decks <モジュールのパス>')
  if (host === undefined || host === '') missing.push('--host <ユーザ>@<ホスト>（または REVOLUTION_DEPLOY_HOST）')
  if (key === undefined || key === '') missing.push('--key <秘密鍵>（または REVOLUTION_DEPLOY_KEY）')
  if (missing.length > 0) throw new Error(`足りません:\n  ${missing.join('\n  ')}`)

  return {
    decks,
    host,
    key,
    out: resolve(readFlag(argv, 'out') ?? DEFAULT_OUT),
    remote: readFlag(argv, 'remote-path') ?? process.env.REVOLUTION_DEPLOY_PATH ?? DEFAULT_REMOTE_PATH,
    unit: readFlag(argv, 'unit') ?? process.env.REVOLUTION_DEPLOY_UNIT ?? DEFAULT_UNIT,
  }
}

/** 失敗したらそこで終わる。**途中まで進んだ状態で先へ行かない。** */
function run(command, args) {
  const { status } = spawnSync(command, args, { stdio: 'inherit' })
  if (status !== 0) {
    console.error(`\n${command} が失敗しました（終了コード ${status}）。`)
    process.exit(status ?? 1)
  }
}

const { decks, host, key, out, remote, unit } = options(process.argv.slice(2))
const ssh = ['-i', key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15']

console.log('1/3 束ねています…')
await mkdir(dirname(out), { recursive: true })
if (!(await bundleServer({ decks, outfile: out }))) process.exit(1)

console.log('2/3 運んでいます…')
run('scp', [...ssh, out, `${host}:${remote}.new`])

console.log('3/3 差し替えて立て直しています…')
run('ssh', [
  ...ssh,
  host,
  `mv ${remote}.new ${remote} && sudo systemctl restart ${unit} && sleep 2 && systemctl is-active ${unit}`,
])

console.log('\n反映しました。')
