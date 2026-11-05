import { describe, expect, it } from 'vitest'
import { artworkUrl, configureArtworkOrigin } from './card-art.js'
import { faceFieldsOf } from './view-model.js'
import { defineUnit, faceOf } from '@revolution/engine'

describe('カード画像の表示情報', () => {
  it('選択した対戦サーバで画像を解決し、外部URLを使用しない', () => {
    configureArtworkOrigin('wss://example.test/duel')
    expect(artworkUrl('/card-art/sample')).toBe('https://example.test/card-art/sample')
    expect(artworkUrl('https://other.test/card-art/sample')).toBeUndefined()
    expect(artworkUrl('javascript:alert(1)')).toBeUndefined()
  })
  it('表示情報のない古い表記を使用でき、登録済みならキーとフレーバーを維持する', () => {
    const face = faceOf(defineUnit({ name: '架空のカード', level: 1, bp: 100, sp: 100 }))
    expect(faceFieldsOf(face).artwork).toBeUndefined()
    expect(faceFieldsOf({ ...face, key: 'sample', artwork: { flavor: '架空の風景' } })).toMatchObject({ key: 'sample', artwork: { flavor: '架空の風景' } })
  })
})
