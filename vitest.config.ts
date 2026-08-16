import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    /**
     * 既定の 5 秒では足りない。自己対戦をランダムに何局も回すテスト（ADR-0005）は、それ自体が
     * 数秒かかるうえ、他のファイルと同時に走るので取り合いになる。**遅いのは意図どおり**なので、
     * 打ち切る側を緩める。
     */
    testTimeout: 30_000,
  },
})
