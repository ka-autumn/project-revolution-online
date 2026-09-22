// ビルド済みの対戦サーバをデプロイする、共通のデプロイ処理。
//
// 本番向け（deploy-server.mjs）と、常設の検証環境向け（deploy-server-verify.mjs）の
// どちらも、ここを呼び出す。**ビルド方法もデプロイ方法も1箇所にしか置かない**という方針を、
// デプロイ先が2つになっても保つ。デプロイ先ごとの既定値・環境変数名は呼び出す側が持つ。
import { mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import { bundleServer } from './bundle-server.mjs'

/**
 * 失敗した時点で処理を終了する。**途中まで進んだ状態で先へ進めない。**
 *
 * 255 は ssh が接続できなかった場合の終了コードで、**初めてのデプロイ先では必ずここで失敗する。**
 * `BatchMode=yes` を指定しているため、鍵を確認するやり取りを表示できないことによる。
 *
 * **自動では信用させない。** デプロイするのは接続先で実行されるファイルであるため、最初に何を
 * 信用したかは手動で確認した記録として残すべきである。代わりに、何をすればよいかをここで示す。
 */
function run(command, args) {
  const { status } = spawnSync(command, args, { stdio: 'inherit' })
  if (status === 0) return

  console.error(`\n${command} が失敗しました（終了コード ${status}）。`)
  if (status === 255) {
    console.error('接続できなかった場合、そのデプロイ先が known_hosts に無いことが多い。初めてのデプロイ先は先に登録する。')
  }
  process.exit(status ?? 1)
}

/** ビルド → 転送 → 差し替えて再起動、を順に行う。**一度別の名前で配置してから差し替える。** */
export async function deployServer({ decks, host, key, out, remote, unit }) {
  const ssh = ['-i', key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15']

  console.log('1/3 ビルドしています…')
  await mkdir(dirname(out), { recursive: true })
  if (!(await bundleServer({ decks, outfile: out }))) process.exit(1)

  console.log('2/3 転送しています…')
  run('scp', [...ssh, out, `${host}:${remote}.new`])

  console.log('3/3 差し替えて再起動しています…')
  run('ssh', [
    ...ssh,
    host,
    `mv ${remote}.new ${remote} && sudo systemctl restart ${unit} && sleep 2 && systemctl is-active ${unit}`,
  ])

  console.log('\nデプロイしました。')
}
