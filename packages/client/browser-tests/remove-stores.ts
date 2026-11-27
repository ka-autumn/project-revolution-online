import { rmSync } from 'node:fs'
import type { Reporter } from '@playwright/test/reporter'
import { storeDirectory } from './servers.js'

/**
 * テストが使った置き場を消す。`globalTeardown` ではなく結果の出力役にしているのは、そちらは
 * 対戦サーバが置き場を開いている間に呼ばれ、Windows では消せないためである。`onExit` は
 * サーバを止めたあとに呼ばれる。
 */
export default class RemoveStores implements Reporter {
  printsToStdio(): boolean {
    return false
  }

  async onExit(): Promise<void> {
    rmSync(storeDirectory(), { recursive: true, force: true })
  }
}
