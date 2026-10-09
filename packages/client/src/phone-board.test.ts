import { describe, expect, it } from 'vitest'
import { BOARD_NATURAL_WIDTH_REM, HAND_MIN_REM, MIN_ZOOM, drawerTop, fittedZoom, reservedHeight, widthZoom } from './phone-board.js'

describe('スマートフォンの盤面を縮める率（ADR-0034）', () => {
  const rem = 16

  it('幅が狭いときは、幅に合わせる', () => {
    expect(widthZoom(390, rem)).toBeCloseTo((390 - 16) / (BOARD_NATURAL_WIDTH_REM * rem), 5)
  })

  it('広い画面でも、元の大きさより大きくしない', () => {
    expect(widthZoom(1000, rem)).toBe(1)
  })

  it('高さに収まっていれば、幅に合わせた率のまま', () => {
    const zoom = fittedZoom(0.5, 400, (at) => 600 * at)

    expect(zoom).toBe(0.5)
  })

  it('高さが足りないときは、収まるまで縮め直す', () => {
    const zoom = fittedZoom(0.5, 240, (at) => 600 * at)

    expect(zoom).toBeCloseTo(0.4, 5)
  })

  /** 縮めた高さが率に比例しないとき（文字の大きさの下限）も、測り直して収める。 */
  it('縮めるほど相対的に高くなっても、収まる率まで縮め直す', () => {
    const heightAt = (at: number): number => (600 + 80 * (1 - at)) * at
    const zoom = fittedZoom(0.5, 240, heightAt)

    expect(heightAt(zoom)).toBeLessThanOrEqual(240 + 0.5)
    expect(zoom).toBeLessThan(0.5)
  })

  it('高さが極端に低くても、盤面を消さない', () => {
    expect(fittedZoom(0.5, 10, (at) => 600 * at)).toBe(MIN_ZOOM)
  })

  it('高さが測れないとき（0 以下）は、縮め直さない', () => {
    expect(fittedZoom(0.5, 240, () => 0)).toBe(0.5)
  })
})

describe('盤面のほかの段に残す高さ', () => {
  const rem = 16

  it('盤面の段は数えず、自分の手札の段は最低の高さで数える', () => {
    // 相手の札・ログ・手順・盤面・手札・自分の札・操作の帯
    const rows = [44, 32, 24, 700, 200, 42, 110]

    expect(reservedHeight(rows, 4, 13, rem)).toBe(44 + 32 + 24 + HAND_MIN_REM * rem + 42 + 110 + 4 * 6 + 13)
  })

  it('段の数が合わなければ、測れなかったものとして扱う', () => {
    expect(reservedHeight([44, 32, 24], 4, 13, rem)).toBeUndefined()
  })

  it('数にならない高さが混じれば、測れなかったものとして扱う', () => {
    expect(reservedHeight([44, 32, 24, Number.NaN, 200, 42, 110], 4, 13, rem)).toBeUndefined()
  })
})

describe('引き出しのつまみの縦の位置', () => {
  it('段の高さの真ん中に、つまみの真ん中を合わせる', () => {
    expect(drawerTop({ top: 200, height: 60 }, 40)).toBe(210)
  })

  it('つまみが段より高ければ、段の真ん中を軸に上下へはみ出す', () => {
    expect(drawerTop({ top: 200, height: 60 }, 100)).toBe(180)
  })
})
