import { defineConfig, devices } from '@playwright/test'
import { CLIENT_PORT, SERVER_PORT } from './browser-tests/ports.js'

/**
 * 本物のブラウザで確認する少数の筋書き（#242）。`pnpm test:browser` で走らせる。`pnpm verify` には
 * 含めない——対戦サーバと画面を立て、Chromium が要るためである。
 *
 * vitest が対象にする `src/` の `*.test.ts` とは混ざらないように、置き場（`browser-tests/`）と
 * 名前（`*.spec.ts`）を分ける。
 */
export default defineConfig({
  testDir: './browser-tests',
  // 対戦サーバは 1 つで、ロビーを全部のテストが共有する。同時に走らせると部屋の数に互いに影響する。
  workers: 1,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${CLIENT_PORT}` },
  webServer: [
    {
      command: 'node ../../tools/serve.mjs --decks browser-tests/supply.ts',
      port: SERVER_PORT,
      // すでに待っているものは使わない。ログインの設定を持つサーバや、前の回の部屋が残った
      // サーバに繋ぐと、筋書きの前提が崩れる。
      reuseExistingServer: false,
      env: {
        PORT: String(SERVER_PORT),
        // 置き場を持たず、立てるたびに空のロビーから始める。
        STORE: '',
        // 手元の環境変数にログインの設定があっても使わず、名乗り（`?participant=`）で入る。
        GOOGLE_CLIENT_ID: '',
        GOOGLE_CLIENT_SECRET: '',
        SIGN_IN_CALLBACK: '',
        SIGN_IN_RETURN_TO: '',
      },
    },
    {
      command: `pnpm exec vite --port ${CLIENT_PORT} --strictPort`,
      port: CLIENT_PORT,
      reuseExistingServer: false,
      // お知らせの取得先は渡さない。テストから外へ取りに行かない。
      env: { VITE_NOTICES_URL: '', VITE_SERVER_URL: '' },
    },
  ],
})
