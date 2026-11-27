// サーバの置き場を直に使う。画面のパッケージはサーバを依存に持たないので、依存には追加せず、
// テストからだけ相対パスで読み込む。
import { digest } from '../../server/src/sign-in.js'
import { openStore } from '../../server/src/store.js'
import { MEASURE_SERVER, SCENARIO_SERVER, sessionToken, storePathOf } from './servers.js'
import type { GameServer } from './servers.js'

/**
 * Google でのログインを済ませたあとに置き場に残るもの（身元・表示名・セッション）を、使う人数分
 * 書き込む。置き場は 1 つのプロセスだけが持つ前提（ADR-0014）なので、対戦サーバを立てる前に呼ぶ。
 * テストが走っている間は、置き場に書き込まない。
 */
function seedStore(server: GameServer): void {
  const store = openStore(storePathOf(server))
  try {
    for (let seat = 0; seat < server.people; seat += 1) {
      const token = sessionToken(seat)
      const participant = store.identify('browser-test', token)
      store.rename(participant, `テストの人${seat + 1}`)
      store.openSession(digest(token), participant)
    }
  } finally {
    store.close()
  }
}

export function seedStores(): void {
  seedStore(SCENARIO_SERVER)
  seedStore(MEASURE_SERVER)
}
