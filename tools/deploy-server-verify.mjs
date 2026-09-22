// ビルド済みの対戦サーバを、常設の検証環境（本番以外での通し確認用）へデプロイする（Issue #183）。
//
// **本番用の deploy:server とは、環境変数の名前も既定値も分けている。** シェルに本番向けの
// `REVOLUTION_DEPLOY_HOST` などが残っていても、こちらはそれを読み込まない。逆に、こちらの
// `_VERIFY` 環境変数が本番用の deploy:server に読み込まれることもない。**別コマンドを実行しない
// 限り、どちらの宛先にも届かない。**
//
//     pnpm deploy:server:verify --decks private/decks/src/index.ts --host <ユーザ>@<ホスト> --key <秘密鍵>
//
// 引数を省略した分は環境変数から読み込む。
//
//     REVOLUTION_DEPLOY_HOST_VERIFY   デプロイ先（`<ユーザ>@<ホスト>`）
//     REVOLUTION_DEPLOY_KEY_VERIFY    使用する秘密鍵
//     REVOLUTION_DEPLOY_PATH_VERIFY   デプロイ先でのパス（既定値は下記 DEFAULT_REMOTE_PATH）
//     REVOLUTION_DEPLOY_UNIT_VERIFY   デプロイ先の常駐単位の名前（既定値は下記 DEFAULT_UNIT）
//
// カードはデプロイ先でビルドさせない（ADR-0002、ADR-0014）ため、ビルドはここ＝手元だけで行う。
import { resolve } from 'node:path'
import { readFlag } from './bundle-server.mjs'
import { deployServer } from './deploy-server-core.mjs'

const DEFAULT_REMOTE_PATH = '/opt/revolution-verify/serve.cjs'
const DEFAULT_UNIT = 'revolution-duel-verify'
const DEFAULT_OUT = 'dist/serve-verify.cjs'

function options(argv) {
  const decks = readFlag(argv, 'decks')
  const host = readFlag(argv, 'host') ?? process.env.REVOLUTION_DEPLOY_HOST_VERIFY
  const key = readFlag(argv, 'key') ?? process.env.REVOLUTION_DEPLOY_KEY_VERIFY

  const missing = []
  if (decks === undefined || decks === '') missing.push('--decks <モジュールのパス>')
  if (host === undefined || host === '') missing.push('--host <ユーザ>@<ホスト>（または REVOLUTION_DEPLOY_HOST_VERIFY）')
  if (key === undefined || key === '') missing.push('--key <秘密鍵>（または REVOLUTION_DEPLOY_KEY_VERIFY）')
  if (missing.length > 0) throw new Error(`足りません:\n  ${missing.join('\n  ')}`)

  return {
    decks,
    host,
    key,
    out: resolve(readFlag(argv, 'out') ?? DEFAULT_OUT),
    remote: readFlag(argv, 'remote-path') ?? process.env.REVOLUTION_DEPLOY_PATH_VERIFY ?? DEFAULT_REMOTE_PATH,
    unit: readFlag(argv, 'unit') ?? process.env.REVOLUTION_DEPLOY_UNIT_VERIFY ?? DEFAULT_UNIT,
  }
}

await deployServer(options(process.argv.slice(2)))
