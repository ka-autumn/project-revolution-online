import { describe, expect, it } from 'vitest'
import { defineStrategy } from '@revolution/engine'
import { poolFacesOf, readSupply } from './deck.js'

const card = defineStrategy({ name: 'テスト・作品つき', level: 1, works: ['見本作品'], makerSymbols: ['AA'], printedMakerSymbols: ['AX'] })
const makers = { AA: { name: '見本出版', reading: 'みほんしゅっぱん' }, AX: { name: '旧見本出版', reading: 'きゅうみほんしゅっぱん' } }
const supply = { pool: { 'test-card': card }, presets: [{ id: 'test', name: '見本デッキ', cards: ['test-card'] }], restrictions: [], expansions: [{ name: '見本商品', code: 'TEST', cards: ['test-card'] }], makers }

describe('カード分類の入力', () => {
  it('印刷とルールの記号を維持してプールへ渡し、エキスパンションコードを保持する', () => {
    const read = readSupply(supply)
    expect(read.kind).toBe('通す')
    if (read.kind !== '通す') throw new Error(read.reason)
    expect(read.supply.expansions?.[0]?.code).toBe('TEST')
    expect(poolFacesOf(read.supply)[0]?.face).toMatchObject({ works: ['見本作品'], makerSymbols: ['AA'], printedMakerSymbols: ['AX'] })
  })
  it('実カードの作品名の入力漏れと、印刷された記号の対応漏れを起動前に検出する', () => {
    expect(readSupply({ ...supply, pool: { 'test-card': { ...card, works: [] } } }).kind).toBe('断る')
    expect(readSupply({ ...supply, makers: { AA: makers.AA } }).kind).toBe('断る')
  })
  it('空のコードや名前・読み仮名がないメーカーを受け付けない', () => {
    expect(readSupply({ ...supply, expansions: [{ ...supply.expansions[0], code: '' }] }).kind).toBe('断る')
    expect(readSupply({ ...supply, makers: { AA: { name: '見本出版' } } }).kind).toBe('断る')
  })
})
