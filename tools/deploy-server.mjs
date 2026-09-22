// ビルド済みの対戦サーバを本番へデプロイする。
//
// **デプロイ先を、このリポジトリは知らない。** デプロイ先の情報は公開しないため、
// 宛先は引数か環境変数で受け取る。ここに書いてよいのは**デプロイ方法**だけである。
//
//     pnpm deploy:server --decks private/decks/src/index.ts --host <ユーザ>@<ホスト> --key <秘密鍵>
//
// 引数を省略した分は環境変数から読み込む。
//
//     REVOLUTION_DEPLOY_HOST   デプロイ先（`<ユーザ>@<ホスト>`）
//     REVOLUTION_DEPLOY_KEY    使用する秘密鍵
//     REVOLUTION_DEPLOY_PATH   デプロイ先でのパス（既定値は下記 DEFAULT_REMOTE_PATH）
//     REVOLUTION_DEPLOY_UNIT   デプロイ先の常駐単位の名前（既定値は下記 DEFAULT_UNIT）
//
// **常設の検証環境へデプロイする場合はこれを使わない。** `pnpm deploy:server:verify`
// （`deploy-server-verify.mjs`）が別の環境変数を読み込む、別のコマンドとして用意されている。
// 引数を省略しても、この既定値・環境変数名を越えて検証環境へ届くことはない。
//
// カードはデプロイ先でビルドさせない（ADR-0002、ADR-0014）ため、ビルドはここ＝手元だけで行う。
import { resolve } from 'node:path'
import { readFlag } from './bundle-server.mjs'
import { deployServer } from './deploy-server-core.mjs'

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

await deployServer(options(process.argv.slice(2)))
