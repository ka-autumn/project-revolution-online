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
  /**
   * ロビーのお知らせのファイルの URL（ADR-0045）。Vercel の Production に本番の置き場、Preview に検証の置き場を入れる。
   * 無ければ取りに行かず、「お知らせはまだありません」を出す。ビルド時の値が焼き付くので、変えたら配り直す。
   */
  readonly VITE_NOTICES_URL?: string
}
