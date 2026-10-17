// ロビーのお知らせのファイルを、検証の置き場へ丸ごと上げる（ADR-0045）。
//
// 本番用の publish:notices とは環境変数の名前を分けている。シェルに本番向けの
// REVOLUTION_NOTICES_TOKEN が残っていても、こちらはそれを読まない。逆も同じ。
//
//     pnpm publish:notices:verify --notices <お知らせのファイルのパス>
//     pnpm publish:notices:verify --notices <パス> --check
//
// トークンは環境変数 REVOLUTION_NOTICES_TOKEN_VERIFY だけから読む。
import { publishNoticesCommand } from './publish-notices-core.mjs'

await publishNoticesCommand({ target: '検証' })
