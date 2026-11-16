import { describe, expect, it } from 'vitest'
import { defineUnit, faceOf } from '@revolution/engine'
import { metadataRowsOf } from './card-metadata.js'
import { emptyFilter, filterChoicesOf, filterPool } from './pool-filter.js'
import { cardDetailOf } from './deck-builder.js'
import { applyMessage, connecting } from './session.js'

const makers = {
  AA: { name: '見本書房', reading: 'みほんしょぼう' },
  AX: { name: '旧見本書房', reading: 'きゅうみほんしょぼう' },
  BB: { name: '架空出版', reading: 'かくうしゅっぱん' },
}
const face = faceOf(defineUnit({ name: 'テスト・複合作品', level: 2, bp: 3000, sp: 1000, works: ['作品甲', '作品乙'], makerSymbols: ['AA', 'BB'], printedMakerSymbols: ['AX', 'BB'] }))
const other = faceOf(defineUnit({ name: 'テスト・別作品', level: 3, bp: 3000, sp: 1000, works: ['作品丙'], makerSymbols: ['BB'] }))
const pool = [{ key: 'test-a', face, expansions: ['見本商品'] }, { key: 'test-b', face: other, expansions: ['見本商品'] }]

describe('作品名とブロックの表示・分類', () => {
  it('分類の対応表はロビーから対戦待ちへ移っても保持する', () => {
    const classified = applyMessage(connecting(), { kind: 'カード分類', makers, workReadings: { 作品甲: 'さくひんこう' }, expansionCodes: { 見本商品: 'TEST' } })
    const waiting = applyMessage(classified, { kind: '相手を待っている', room: 'test-room' })
    expect(waiting.makers).toEqual(makers)
    expect(waiting.expansionCodes).toEqual({ 見本商品: 'TEST' })
    expect(waiting.workReadings).toEqual({ 作品甲: 'さくひんこう' })
  })
  it('漢字・英字を含む作品名も読み仮名で五十音順に並べる', () => {
    expect(filterChoicesOf(pool, makers, { 作品甲: 'う', 作品乙: 'あ', 作品丙: 'い' }).works).toEqual(['作品乙', '作品丙', '作品甲'])
  })
  it('詳細は印刷された記号の名前を表示し、複数の作品・ブロックを維持する', () => {
    expect(metadataRowsOf(face, makers)).toEqual([{ label: '作品名', value: '作品甲 | 作品乙' }, { label: 'ブロック', value: '旧見本書房 | 架空出版' }])
    expect(cardDetailOf(pool, 'test-a', false, makers)?.metadataRows).toContainEqual({ label: 'ブロック', value: '旧見本書房 | 架空出版' })
    expect(cardDetailOf(pool, 'test-a', true, makers)?.metadataRows).toContainEqual({ label: '作品名', value: '作品甲 | 作品乙' })
  })
  it('ブロックはルール上の値で選び、選択肢を名前の読みの順に並べる', () => {
    expect(filterChoicesOf(pool, makers).blocks).toEqual(['BB', 'AA'])
    expect(filterPool(pool, { ...emptyFilter(), blocks: ['AA'] })).toEqual([pool[0]])
    expect(filterPool(pool, { ...emptyFilter(), blocks: ['AX'] })).toEqual([])
  })
  it('同じ項目の複数選択はOR、作品・ブロック・既存条件の組み合わせはANDで判定する', () => {
    const filter = { ...emptyFilter(), works: ['作品乙', '作品丙'], blocks: ['AA'], levels: [2], expansions: ['見本商品'] }
    expect(filterPool(pool, filter)).toEqual([pool[0]])
    expect(filterPool(pool, { ...filter, levels: [3] })).toEqual([])
    expect(filterPool(pool, emptyFilter())).toEqual(pool)
  })
  it('古いサーバから新しい項目が届かなくても、条件を解除すれば一覧を表示できる', () => {
    const { works: _works, makerSymbols: _symbols, printedMakerSymbols: _printed, ...oldFace } = face
    const oldPool = [{ key: 'old', face: oldFace, expansions: [] }]
    expect(filterPool(oldPool, emptyFilter())).toEqual(oldPool)
    expect(filterPool(oldPool, { ...emptyFilter(), works: ['作品甲'] })).toEqual([])
  })
})
