import { defineUnit } from '@revolution/engine'
import type { Card } from '@revolution/engine'

/**
 * 本物のブラウザのテストで対戦サーバに渡す、架空のカードと既製デッキ（`tools/serve.mjs` の `--decks`）。
 *
 * 非公開のカード実装には依存しない（ADR-0002）。公開リポジトリだけを clone した状態でも、
 * `pnpm test:browser` が立つようにするためである。
 */
export const pool: Readonly<Record<string, Card>> = Object.fromEntries(
  Array.from({ length: 15 }, (_, index) => [
    `BROWSER-${index}`,
    defineUnit({ name: `テスト・画面${index}`, level: 0, bp: 100, sp: 100, moveIcon: ['上'] }),
  ]),
)

/** 構築戦の最小枚数を、同名 4 枚までで満たす（総合ルール 第3部 第1章 3-1）。 */
export const presets = [
  {
    id: '既製1',
    name: 'テストのデッキ',
    cards: Object.keys(pool).flatMap((key) => Array.from({ length: 4 }, () => key)),
  },
]

export const restrictions = []
