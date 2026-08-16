import { defineConfig } from 'vite'

/**
 * 開発サーバとバンドル（#14）。
 *
 * `@revolution/engine` はワークスペースの中にあり、ビルド済みのものを持たない（`exports` が
 * `src/index.ts` を指している）。vite は TypeScript のまま読んで変換するので、そのまま繋がる。
 *
 * 対戦サーバは別の口（既定で 8787 番、`serve.ts`）で待っている。ここでは中継しない。WebSocket
 * 1 本を直に張る（ADR-0009）だけなので、同じ口に載せる必要が無い。
 */
export default defineConfig({
  server: { port: 5173 },
  build: { target: 'es2022' },
})
