# project-revolution-online

トレーディングカードゲーム「プロジェクトレヴォリューション」を、ルールを完全に自動適用する形で
オンライン対戦できるようにするプロジェクト。

ルールの拠り所は総合ルール Version 15.00 で、全文が [`docs/rules/`](docs/rules/) にある。
用語の正は [`CONTEXT.md`](CONTEXT.md)、設計上の決定は [`docs/adr/`](docs/adr/)。

## 構成

pnpm ワークスペースのモノレポ。

| パッケージ | 役割 |
| --- | --- |
| `packages/engine` | ルールエンジン。「盤面 ＋ 行動 → 次の盤面」の純粋関数。実行時依存を持たず、ブラウザとサーバの両方で動く（ADR-0001） |
| `packages/cards` | カード実装。独立した非公開リポジトリであり、この公開リポジトリには含まれない（ADR-0002） |
| `packages/server` | 盤面の唯一の権威（ADR-0004） |
| `packages/client` | 対戦画面。受け取った盤面を描いて選んだものを送るだけで、ルールの判断は持たない（ADR-0010） |

依存の向きは cards → engine の一方向で、engine は cards を知らない。

## 開発

Node.js 22 以上。pnpm は `packageManager` で固定しているため、corepack が有効なら追加の準備は要らない。

```sh
pnpm install --frozen-lockfile
pnpm verify
```

`--frozen-lockfile` を付けるのは、`pnpm-lock.yaml` が `packages/cards` の importer を持っているため。
cards が無い環境で素の `pnpm install` を走らせると、ロックファイルからそれが黙って消える。

`pnpm verify` は次の 3 つを順に実行する。

```sh
pnpm typecheck       # 全パッケージの型検査
pnpm test            # vitest
pnpm verify:engine   # エンジンが依存ゼロで、ブラウザ／サーバ両方向けにビルドできることの確認
```

## この公開リポジトリだけを clone した場合

`packages/cards` が無いため、ゲームを動かすことはできない。`pnpm verify` は通る。
エンジンのテストは実カードではなく架空のテストカードで書くため、カード実装の有無に依存しない（ADR-0002）。

この状態では `pnpm install --frozen-lockfile` を使うこと。上に書いたとおり、素の `pnpm install` は
`pnpm-lock.yaml` から `packages/cards` の importer を消し、身に覚えのない差分を残す。
