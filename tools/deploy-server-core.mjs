// 束ねた対戦サーバを置き場へ運ぶ、共通の運び方。
//
// 本番向け（deploy-server.mjs）と、常設のもう1組向け（deploy-server-verify.mjs）の
// どちらも、ここを呼ぶ。**束ね方も運び方も1箇所にしか置かない**という方針を、
// 宛先が2つになっても保つ。宛先ごとの既定値・環境変数名は呼ぶ側が持つ。
import { mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import { bundleServer } from './bundle-server.mjs'

/**
 * 失敗したらそこで終わる。**途中まで進んだ状態で先へ行かない。**
 *
 * 255 は ssh が繋げなかったときの終了コードで、**初めての宛先は必ずここで落ちる。**
 * `BatchMode=yes` を渡しているので、鍵を確かめるやり取りを出せないためである。
 *
 * **自動では信用させない。** 運ぶのは向こうで実行されるファイルなので、最初に何を信用したかは
 * 手で確かめたところに残っているべきである。代わりに、何をすればいいかをここで言う。
 */
function run(command, args) {
  const { status } = spawnSync(command, args, { stdio: 'inherit' })
  if (status === 0) return

  console.error(`\n${command} が失敗しました（終了コード ${status}）。`)
  if (status === 255) {
    console.error('繋がらなかった場合、その宛先が known_hosts に無いことが多い。初めての宛先は先に登録する。')
  }
  process.exit(status ?? 1)
}

/** 束ねる → 運ぶ → 差し替えて立て直す、を順に行う。**一度別の名前で置いてから差し替える。** */
export async function deployServer({ decks, host, key, out, remote, unit }) {
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
}
