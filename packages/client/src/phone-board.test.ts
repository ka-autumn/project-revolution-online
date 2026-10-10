import { describe, expect, it } from 'vitest'
import {
  BOARD_NATURAL_WIDTH_REM,
  FALLBACK_CONTROLS_REM,
  HAND_MIN_REM,
  MIN_ZOOM,
  boardAvailableHeight,
  controlsReserve,
  drawerTop,
  fittedZoom,
  reservedHeight,
  topInContent,
  visibleHeight,
  widthZoom,
} from './phone-board.js'

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
    // 相手の札・ログ・手順・盤面・手札・自分の札（操作の帯は画面に固定で、段に数えない）
    const rows = [44, 32, 24, 700, 200, 42]

    expect(reservedHeight(rows, 4, 13, rem)).toBe(44 + 32 + 24 + HAND_MIN_REM * rem + 42 + 4 * 5 + 13)
  })

  it('外枠の余白（下に操作の帯の分を含む）は、そのまま残す高さに入る', () => {
    const rows = [44, 32, 24, 700, 200, 42]

    expect((reservedHeight(rows, 4, 13 + 70, rem) ?? 0) - (reservedHeight(rows, 4, 13, rem) ?? 0)).toBe(70)
  })

  it('段の数が合わなければ、測れなかったものとして扱う', () => {
    expect(reservedHeight([44, 32, 24], 4, 13, rem)).toBeUndefined()
    expect(reservedHeight([44, 32, 24, 700, 200, 42, 110], 4, 13, rem)).toBeUndefined()
  })

  it('数にならない高さが混じれば、測れなかったものとして扱う', () => {
    expect(reservedHeight([44, 32, 24, Number.NaN, 200, 42], 4, 13, rem)).toBeUndefined()
  })
})

describe('いま見えている高さ', () => {
  it('visualViewport があれば、その高さ（アドレスバーが出ていれば低い）', () => {
    expect(visibleHeight({ height: 740, scale: 1 }, 844)).toBe(740)
  })

  it('visualViewport が無ければ、innerHeight', () => {
    expect(visibleHeight(undefined, 844)).toBe(844)
  })

  it('測れない値（0 や NaN）のときも、innerHeight', () => {
    expect(visibleHeight({ height: 0, scale: 1 }, 844)).toBe(844)
    expect(visibleHeight({ height: Number.NaN, scale: 1 }, 844)).toBe(844)
  })

  it('ピンチで拡大している間は、拡大の率を掛け戻す（見える範囲が狭くなっただけで、画面は低くなっていない）', () => {
    expect(visibleHeight({ height: 422, scale: 2 }, 844)).toBe(844)
  })

  it('アドレスバーが出入りして高さが変わると、盤面に使える高さも変わる', () => {
    const reserved = 400

    expect(boardAvailableHeight(visibleHeight({ height: 844, scale: 1 }, 844), reserved)).toBe(444)
    expect(boardAvailableHeight(visibleHeight({ height: 740, scale: 1 }, 844), reserved)).toBe(340)
  })

  it('使える高さの違いが、縮める率に表れる', () => {
    const heightAt = (at: number): number => 700 * at
    const tall = fittedZoom(0.5, boardAvailableHeight(844, 400), heightAt)
    const short = fittedZoom(0.5, boardAvailableHeight(640, 400), heightAt)

    expect(tall).toBe(0.5)
    expect(short).toBeCloseTo(240 / 700, 5)
  })
})

describe('操作の帯の分に空ける高さ', () => {
  const rem = 16

  it('測れた高さをそのまま使う。帯が高くなれば、余白も追随する', () => {
    expect(controlsReserve(72, 60, rem)).toBe(72)
    expect(controlsReserve(120, 72, rem)).toBe(120)
  })

  it('帯が操作パネルそのものになって測れない間は、前に測った高さを使う', () => {
    expect(controlsReserve(undefined, 72, rem)).toBe(72)
  })

  it('どちらも無ければ、決め打ちの高さ', () => {
    expect(controlsReserve(undefined, undefined, rem)).toBe(FALLBACK_CONTROLS_REM * rem)
  })

  it('0 や負の高さは、測れなかったものとして扱う', () => {
    expect(controlsReserve(0, 72, rem)).toBe(72)
    expect(controlsReserve(-1, undefined, rem)).toBe(FALLBACK_CONTROLS_REM * rem)
  })
})

describe('つまみの位置の座標', () => {
  it('画面の座標の段の上端を、外枠の中身の座標にする（送られた分を足す）', () => {
    expect(topInContent(300, 0, 0)).toBe(300)
    expect(topInContent(240, 0, 60)).toBe(300)
  })

  it('外枠が画面の上端から離れていれば、その分を引く', () => {
    expect(topInContent(340, 40, 0)).toBe(300)
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
