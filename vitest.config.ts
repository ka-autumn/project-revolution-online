import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // テストはパッケージの中で実装と並べる。`proxy.test.ts` だけが例外で、配る側が入口を
    // パッケージの中から拾えないため、実装もろともルートに置いてある（ADR-0013）。
    //
    // `private/` は公開リポジトリに含められないパッケージの置き場（ADR-0002）。**無ければ
    // 何も拾わないだけ**で、clone しただけの状態でもここは通る。
    include: ['packages/*/src/**/*.test.ts', 'private/*/src/**/*.test.ts', 'proxy.test.ts'],
    /**
     * 既定の 5 秒では足りない。自己対戦をランダムに何局も回すテスト（ADR-0005）は、それ自体が
     * 数秒かかるうえ、他のファイルと同時に走るので取り合いになる。**遅いのは意図どおり**なので、
     * 打ち切る側を緩める。
     */
    testTimeout: 30_000,
  },
})
