/// <reference types="vite/client" />

/**
 * ビルド時に渡せる値（#155 以前、リモートに置くため）。
 *
 * vite は `import.meta.env` に `VITE_` で始まる環境変数だけを埋め込む。ここに書いたものは
 * **ビルドした時の値が焼き付く**ので、変えるならビルドし直す。その場で変えたい時のために
 * `?server=` が別にある（`main.ts`）。
 */
interface ImportMetaEnv {
  /** 対戦サーバの WebSocket の URL（`wss://example.com` のような、パスまでのもの）。 */
  readonly VITE_SERVER_URL?: string
}
