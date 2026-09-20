# project-revolution-online

## プロジェクト

pnpm ワークスペースのモノレポ。パッケージ構成は `README.md` を参照。

## コマンド

- `pnpm verify` — 型検査 → テスト → エンジンの検証。まとめて確認するときはこれ
- `pnpm typecheck` — 全パッケージの型検査
- `pnpm test` — vitest（`pnpm test <パターン>` でファイルを絞れる）
- `pnpm verify:engine` — エンジンが依存ゼロで、ブラウザ／サーバ両方向けにビルドできることの確認

CI で install するときは `pnpm install --frozen-lockfile` を使う。`pnpm-lock.yaml` は
`private/` 以下の importer を持っており、それが無い環境で素の `pnpm install` を
走らせるとロックファイルからそれが消えてしまうため。

## 規約

- ドメイン用語は型名を英語、値を日本語にする（ADR-0003）。用語の正は `CONTEXT.md`
- テストは `packages/*/src/**/*.test.ts` に置き、実装と並べる（`private/` 以下も同じ）
- ルールの挙動を検証するテストには、根拠となる総合ルールの条番号を付ける（ADR-0006）。
  総合ルールの本文は `docs/rules/`。引用は `docs/rules/index.json` の `citation` と同じ文字列で書く。
  総合ルールが外へ投げた判定はフロアルール第2部（`docs/floor-rules/`）を引く（ADR-0023 / ADR-0024）
- エンジンに実行時依存を足さない。`private/cards` にも依存させない（ADR-0001 / ADR-0002）
