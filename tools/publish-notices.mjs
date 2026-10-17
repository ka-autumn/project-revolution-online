// ロビーのお知らせのファイルを、形を確かめてから本番の置き場へ丸ごと上げる（ADR-0045）。
//
//     pnpm publish:notices --notices <お知らせのファイルのパス>
//     pnpm publish:notices --notices <パス> --check    # 形を確かめるだけ。トークンを読まず、通信しない
//
// トークンは環境変数 REVOLUTION_NOTICES_TOKEN だけから読む（引数では渡せない）。検証の置き場へは
// 別コマンドの `pnpm publish:notices:verify`（`publish-notices-verify.mjs`）で、そちらは
// REVOLUTION_NOTICES_TOKEN_VERIFY だけを読む。どちらも `BLOB_READ_WRITE_TOKEN` は読まない。
import { publishNoticesCommand } from './publish-notices-core.mjs'

await publishNoticesCommand({ tokenVariable: 'REVOLUTION_NOTICES_TOKEN' })
