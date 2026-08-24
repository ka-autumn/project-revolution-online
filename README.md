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
| `packages/decks` | 対戦に使うカードのまとまりを渡すだけ。カードを名指しするため、cards と同じくこの公開リポジトリには含まれない |

依存の向きは cards → engine の一方向で、engine は cards を知らない。**カードを名指しするのは
`packages/decks` だけ**で、デッキの組み方もサーバの立て方も公開側にある（ADR-0002）。

## 開発

Node.js 22 以上。pnpm は `packageManager` で固定しているため、corepack が有効なら追加の準備は要らない。

```sh
pnpm install --frozen-lockfile
pnpm verify
```

`--frozen-lockfile` を付けるのは、`pnpm-lock.yaml` が `packages/cards` と `packages/host` の
importer を持っているため。それらが無い環境で素の `pnpm install` を走らせると、ロックファイルから
黙って消える。

## 対戦する

サーバと対戦画面を別々に立てる。

```sh
pnpm serve --decks packages/decks/src/index.ts   # 対戦サーバ（既定で 8787 番）
pnpm --filter @revolution/client dev             # 対戦画面（既定で 5173 番）
```

`--decks` に渡すのは、デッキ 2 つを `decks` として export するモジュールである。
**このリポジトリはどのカードを使うかを知らない**（ADR-0002）ので、実行時に受け取る。

デッキはただのカードの並びなので、何をどの枚数入れるかは渡す側が決める。積み方の取り決めは
このリポジトリに無い。立てる時に構築戦の規定（総合ルール 第3部 第1章 3-1）を満たしているかを
確かめるので、満たしていなければその場で分かる。

ブラウザ 2 つで、同じ部屋の合言葉・違う名乗りで開く。

```
http://localhost:5173/?participant=あ&room=あいことば
http://localhost:5173/?participant=い&room=あいことば
```

名乗り（`participant`）は認証ではない（ADR-0009）。これを知っている人がその席に座れるので、
切れても同じ名乗りで開き直せば続きから打てる。

立てるにはカードの実装が要る。無い場合は下を参照。

## 離れた端末から確かめる

**画面だけを配り、対戦サーバは手元で立てたまま外から届く口を生やす**（ADR-0013）。走り続ける
プロセスを借りずに済み、手元の機械が起きている間は離れた端末から打てる。

### 対戦サーバに外から届く口を付ける

サーバはいつもどおり手元で立てて、そこへのトンネルを張る。

```sh
pnpm serve --decks packages/decks/src/index.ts   # 手元の 8787 番
cloudflared tunnel --url http://localhost:8787   # 届く URL が出る
```

出るのは `https://<毎回変わる名前>.trycloudflare.com` なので、`https` を `wss` に読み替えて画面に
渡す。**立て直すたびに変わる。** 固定したいなら、自分のドメインを Cloudflare に置いて名前付きの
トンネルにし、その URL を `VITE_SERVER_URL` に焼く。

### 対戦画面を配る

`vercel.json` にビルドの仕方が書いてある。設定するのは 2 つだけで、どちらも無くてよい。

| 環境変数 | 意味 |
| --- | --- |
| `VITE_SERVER_URL` | 繋ぎに行くサーバ（`wss://<サーバ>`）。**ビルド時に焼き付く。** 渡さなければ同じホストの 8787 番 |
| `BASIC_AUTH` | 画面に掛ける鍵（`名前:合言葉`）。渡さなければ素通し |

ブラウザ 2 つで、同じ部屋の合言葉・違う名乗りで開く。トンネルの URL は毎回変わるので、焼かずに
`?server=` で渡すのが早い。

```
https://<画面>/?participant=あ&room=あいことば&server=wss://<トンネル>
https://<画面>/?participant=い&room=あいことば&server=wss://<トンネル>
```

**これは動かして確かめるためのもので、公開する形ではない。** 画面に掛けた鍵はサーバには掛かって
おらず、トンネルの URL を知っている人は繋げる（ADR-0013）。

## 開発の確認

`pnpm verify` は次の 3 つを順に実行する。

```sh
pnpm typecheck       # 全パッケージの型検査
pnpm test            # vitest
pnpm verify:engine   # エンジンが依存ゼロで、ブラウザ／サーバ両方向けにビルドできることの確認
```

## この公開リポジトリだけを clone した場合

`packages/cards` と `packages/decks` が無いため、対戦を動かすことはできない。`pnpm verify` は通る。
エンジンのテストは実カードではなく架空のテストカードで書くため、カード実装の有無に依存しない（ADR-0002）。
クライアントも同じで、テストは手で組み立てた盤面に対して書くため、カード実装を要らない（ADR-0010）。

この状態では `pnpm install --frozen-lockfile` を使うこと。上に書いたとおり、素の `pnpm install` は
`pnpm-lock.yaml` から非公開パッケージの importer を消し、身に覚えのない差分を残す。
