import { defineConfig, devices } from '@playwright/test'
import {
  CLIENT_PORT,
  MEASURE_SERVER,
  PRIVATE_DECKS,
  SCENARIO_SERVER,
  hasPrivateDecks,
  storePathOf,
} from './browser-tests/servers.js'
import type { GameServer } from './browser-tests/servers.js'

/**
 * ログインを持つ対戦サーバを立てる。デッキ構築は、ログインの無い立て方では開けないためである。
 * Google の設定は架空の値で、テストは Google へは行かず、置き場にセッションを作成して入る
 * （`browser-tests/players.ts`）。
 */
function gameServer(server: GameServer, decks: string) {
  return {
    command: `node tools/serve.mjs --decks ${decks}`,
    // 画像の置き場はリポジトリの根からの相対パスで渡されるので、根で立てる。
    cwd: '../..',
    port: server.port,
    // すでに待っているものは使わない。別の置き場を持つサーバに繋ぐと、作成したセッションで入れない。
    reuseExistingServer: false,
    env: {
      PORT: String(server.port),
      STORE: storePathOf(server),
      GOOGLE_CLIENT_ID: 'browser-test',
      GOOGLE_CLIENT_SECRET: 'browser-test',
      SIGN_IN_CALLBACK: `http://localhost:${server.port}/auth/google/callback`,
      SIGN_IN_RETURN_TO: `http://localhost:${CLIENT_PORT}/`,
    },
  }
}

/**
 * 本物のブラウザで確認する少数の筋書き（#242）。`pnpm test:browser` で走らせる。`pnpm verify` には
 * 含めない——対戦サーバと画面を立て、Chromium が要るためである。
 *
 * vitest が対象にする `src/` の `*.test.ts` とは混ざらないように、置き場（`browser-tests/`）と
 * 名前（`*.spec.ts`）を分ける。
 */
export default defineConfig({
  testDir: './browser-tests',
  // 対戦サーバはロビーを全部のテストが共有する。同時に走らせると部屋の数に互いに影響し、計測も揺れる。
  workers: 1,
  reporter: [['list'], ['./browser-tests/remove-stores.ts']],
  use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${CLIENT_PORT}` },
  webServer: [
    gameServer(SCENARIO_SERVER, 'packages/client/browser-tests/supply.ts'),
    ...(hasPrivateDecks ? [gameServer(MEASURE_SERVER, PRIVATE_DECKS)] : []),
    {
      command: `pnpm exec vite --port ${CLIENT_PORT} --strictPort`,
      port: CLIENT_PORT,
      reuseExistingServer: false,
      // お知らせの取得先は渡さない。テストから外へ取りに行かない。
      env: { VITE_NOTICES_URL: '', VITE_SERVER_URL: '' },
    },
  ],
})
