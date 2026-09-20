import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * フロアルール第2部を置いた `docs/floor-rules/` が、コードやテストや文書に書かれた引用から辿れることを
 * 確かめる（ADR-0024）。条番号からテストへ、テストからコードへ辿る導線が切れていないかを見る。
 */

const root = fileURLToPath(new URL('../../../', import.meta.url))
const floorRules = join(root, 'docs', 'floor-rules')

type Clause = { citation: string; clause: string; file: string; examples: number }
const index: { clauses: Clause[] } = JSON.parse(readFileSync(join(floorRules, 'index.json'), 'utf8'))

/** 本文の Markdown から、`**1-1.**` の形の条の見出しと、それに属する例（`> 例`）の数を数える。 */
function clausesIn(file: string): Map<string, number> {
  const found = new Map<string, number>()
  let current: string | undefined
  for (const line of readFileSync(join(floorRules, file), 'utf8').split('\n')) {
    const heading = /^\*\*([^*]+?)\.\*\*/.exec(line)
    if (heading?.[1] !== undefined) {
      current = heading[1]
      found.set(current, 0)
    } else if (line.startsWith('> 例') && current !== undefined) {
      found.set(current, (found.get(current) ?? 0) + 1)
    }
  }
  return found
}

describe('フロアルール第2部の索引', () => {
  it('本文にある条がすべて索引にあり、索引にある条がすべて本文にある', () => {
    const files = [...new Set(index.clauses.map((c) => c.file))]
    const inIndex = index.clauses.map((c) => `${c.file}:${c.clause}:${c.examples}`).sort()
    const inBody = files
      .flatMap((file) => [...clausesIn(file)].map(([clause, examples]) => `${file}:${clause}:${examples}`))
      .sort()
    expect(inIndex).toEqual(inBody)
  })

  it('本文のファイルはすべて索引から引かれている', () => {
    const chapterFiles = readdirSync(floorRules).filter((name) => /^\d\d-\d\d-.+\.md$/.test(name))
    expect(chapterFiles.sort()).toEqual([...new Set(index.clauses.map((c) => c.file))].sort())
  })

  it('引用の文字列に重複がない', () => {
    const citations = index.clauses.map((c) => c.citation)
    expect(new Set(citations).size).toBe(citations.length)
  })
})

/** 引用を探す場所。本文そのもの（`docs/floor-rules/`）と、生成物・依存は含めない。 */
function sourcesUnder(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'temp', '.git'].includes(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (path === floorRules) continue
      out.push(...sourcesUnder(path))
    } else if (/\.(ts|tsx|md)$/.test(entry.name) && path !== fileURLToPath(import.meta.url)) {
      out.push(path)
    }
  }
  return out
}

describe('フロアルールの引用', () => {
  it('コード・テスト・文書に書かれた引用が、すべて本文へ辿れる', () => {
    const known = new Set(index.clauses.map((c) => c.citation))
    const unresolved: string[] = []
    let seen = 0
    for (const path of sourcesUnder(root)) {
      // コメントの折り返し（`\n * ` や `\n// `）をまたいで書かれた引用も拾う。
      const text = readFileSync(path, 'utf8').replace(/\r?\n\s*(?:\*|\/\/|>)?\s*/g, ' ')
      for (const match of text.matchAll(/フロアルール Version \d+\.\d+ ?(第\d+部 第\d+章 \d+(?:-\d+|-\([\d-]+\))*)?/g)) {
        seen += 1
        const cited = match[0].trim()
        if (!known.has(cited)) unresolved.push(`${relative(root, path).split(sep).join('/')}: ${cited}`)
      }
    }
    expect(seen).toBeGreaterThan(0)
    expect(unresolved).toEqual([])
  })
})
