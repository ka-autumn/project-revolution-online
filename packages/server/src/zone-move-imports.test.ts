import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * カードのゾーン移動が、すべて `moveToZone`（`zone-move.ts`）を通っていることを、engine のソースの
 * import から照合する（ADR-0059）。
 *
 * 誘発を探さない土台の関数（`moveToZoneWithoutTriggers`）は、別のファイルから呼ぶために
 * export されていて、型だけではほかのファイルから呼ぶことを止められない。経路を追加した時に
 * 土台の関数を直接呼べば、ここで失敗する。engine は Node の型を持たない（ADR-0001）ので、
 * ファイルを読むこのテストは server に置いている。
 *
 * 参照するのは import だけである。`duel.ts` の中の呼び出し（カードを 1 枚引く処理とプランを裏向きに
 * する処理）は、依存が循環するので例外として直接呼んでいて、ここでは検出できない（ADR-0059）。
 */

const BASE = 'moveToZoneWithoutTriggers'
const ALLOWED = ['zone-move.ts', 'duel.ts']

const engineSource = fileURLToPath(new URL('../../engine/src/', import.meta.url))

/**
 * `./duel.js` から土台の関数を取り込んでいる（名前を列挙した import と export）か。名前空間の
 * import と `export *` も含める。動的な `import()` は検出できない。
 */
function importsBaseFunction(source: string): boolean {
  const named = /(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]\.\/duel\.js['"]/g
  for (const match of source.matchAll(named)) {
    const names = (match[1] ?? '').split(',').map((name) => name.trim().split(/\s+as\s+/)[0])
    if (names.includes(BASE)) return true
  }
  return /(?:import\s+\*\s+as\s+\w+|export\s+\*)\s+from\s*['"]\.\/duel\.js['"]/.test(source)
}

describe('ゾーン移動の関数以外が、土台の関数を取り込まない', () => {
  // ADR-0059
  it('zone-move.ts と duel.ts とテストのファイル以外は、土台の関数を import しない', () => {
    const offenders = readdirSync(engineSource)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && !ALLOWED.includes(file))
      .filter((file) => importsBaseFunction(readFileSync(join(engineSource, file), 'utf8')))

    expect(offenders).toEqual([])
  })

  it('zone-move.ts は土台の関数を import している（照合が空振りしていない）', () => {
    expect(importsBaseFunction(readFileSync(join(engineSource, 'zone-move.ts'), 'utf8'))).toBe(true)
  })

  it('複数行の import・別名・再 export・名前空間の import も検出する', () => {
    expect(importsBaseFunction(`import {\n  cardsIn,\n  ${BASE},\n} from './duel.js'`)).toBe(true)
    expect(importsBaseFunction(`import { ${BASE} as move } from './duel.js'`)).toBe(true)
    expect(importsBaseFunction(`export { ${BASE} } from './duel.js'`)).toBe(true)
    expect(importsBaseFunction(`import * as duel from './duel.js'`)).toBe(true)
    expect(importsBaseFunction(`export * from "./duel.js"`)).toBe(true)
    expect(importsBaseFunction(`import { ${BASE} } from "./duel.js"`)).toBe(true)
  })

  it('土台の関数を含まない import は検出しない', () => {
    expect(importsBaseFunction(`import { cardsIn, putInZone } from './duel.js'`)).toBe(false)
    expect(importsBaseFunction(`import type { DuelState } from './duel.js'`)).toBe(false)
    expect(importsBaseFunction(`import { ${BASE} } from './other.js'`)).toBe(false)
  })
})
