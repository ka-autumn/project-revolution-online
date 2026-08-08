# project-revolution-online

トレーディングカードゲーム「プロジェクトレヴォリューション」を、ルールを完全に自動適用する形で
オンライン対戦できるようにするプロジェクト。

用語の正は [`CONTEXT.md`](CONTEXT.md)、設計上の決定は [`docs/adr/`](docs/adr/) にある。

## 構成

pnpm ワークスペースのモノレポ。

| パッケージ | 役割 |
| --- | --- |
| `packages/engine` | ルールエンジン。「盤面 ＋ 行動 → 次の盤面」の純粋関数。実行時依存を持たず、ブラウザとサーバの両方で動く（ADR-0001） |
| `packages/cards` | カード実装。独立した非公開リポジトリであり、この公開リポジトリには含まれない（ADR-0002） |
| `packages/server` | 盤面の唯一の権威（ADR-0004） |
| `packages/client` | 対戦画面。エンジンを先読み表示と入力の妥当性チェックに使う（ADR-0004） |

依存の向きは cards → engine の一方向で、engine は cards を知らない。

## 開発

Node.js 22 以上。pnpm は `packageManager` で固定しているため、corepack が有効なら追加の準備は要らない。

```sh
pnpm install
pnpm verify
```

`pnpm verify` は次の 3 つを順に実行する。

```sh
pnpm typecheck       # 全パッケージの型検査
pnpm test            # vitest
pnpm verify:engine   # エンジンが依存ゼロで、ブラウザ／サーバ両方向けにビルドできることの確認
```

## この公開リポジトリだけを clone した場合

`packages/cards` が無いため、ゲームを動かすことはできない。型検査とテストは通る。
エンジンのテストは実カードではなく架空のテストカードで書くため、カード実装の有無に依存しない（ADR-0002）。
