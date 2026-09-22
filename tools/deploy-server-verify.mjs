// 束ねた対戦サーバを、常設のもう1組（本番以外での通し確認用）へ反映する（Issue #183）。
//
// **本番の deploy:server とは、環境変数の名前も既定値も分けてある。** シェルに本番向けの
// `REVOLUTION_DEPLOY_HOST` 等が残っていても、こちらはそれを読まない。逆に、こちらの
// `_VERIFY` 環境変数が本番の deploy:server に拾われることも無い。**別コマンドを打たない限り、
// どちらの宛先にも届かない。**
//
//     pnpm deploy:server:verify --decks private/decks/src/index.ts --host <ユーザ>@<ホスト> --key <秘密鍵>
//
// 引数を省いた分は環境変数から読む。
//
//     REVOLUTION_DEPLOY_HOST_VERIFY   運ぶ先（`<ユーザ>@<ホスト>`）
//     REVOLUTION_DEPLOY_KEY_VERIFY    使う秘密鍵
//     REVOLUTION_DEPLOY_PATH_VERIFY   置き場でのパス（既定は下の DEFAULT_REMOTE_PATH）
//     REVOLUTION_DEPLOY_UNIT_VERIFY   置き場での常駐単位の名前（既定は下の DEFAULT_UNIT）
//
// カードは置き場でビルドさせない（ADR-0002、ADR-0014）ので、束ねるのはここ＝手元だけで行う。
import { resolve } from 'node:path'
import { readFlag } from './bundle-server.mjs'
import { deployServer } from './deploy-server-core.mjs'

const DEFAULT_REMOTE_PATH = '/opt/revolution/serve-verify.cjs'
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
