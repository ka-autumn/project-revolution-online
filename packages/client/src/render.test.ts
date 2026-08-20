import { describe, expect, it } from 'vitest'
import { panelSide } from './render.js'

/**
 * 詳細の札をどちら側に出すか（#93）。
 *
 * `render.ts` で唯一の判断であり、数値だけの関数に出してある。測る側（`placePanel`）は
 * 実際の DOM が要るのでここでは扱わない。
 */
describe('詳細の札を出す側', () => {
  it('右に入るなら、右に出す', () => {
    expect(panelSide({ right: 300, left: 500, needed: 200 })).toBe('右')
  })

  /** 幅がちょうどのときは、はみ出していないので右のまま。 */
  it('右がちょうど足りるなら、右に出す', () => {
    expect(panelSide({ right: 200, left: 500, needed: 200 })).toBe('右')
  })

  it('右に入らず左に入るなら、左に出す', () => {
    expect(panelSide({ right: 10, left: 500, needed: 200 })).toBe('左')
  })

  /** 左が広いというだけでは動かさない。右で足りているものを動かすと、出る場所が揺れる。 */
  it('右に入るなら、左のほうが広くても右に出す', () => {
    expect(panelSide({ right: 200, left: 900, needed: 200 })).toBe('右')
  })

  /** どちらもはみ出す。隠れる量が少ないほうを選ぶ。 */
  it('両側とも足りないなら、広いほうに出す', () => {
    expect(panelSide({ right: 50, left: 120, needed: 200 })).toBe('左')
    expect(panelSide({ right: 120, left: 50, needed: 200 })).toBe('右')
  })

  /** 画面の端に貼り付いているカード。左に逃がす余地が無いので、右のままにする。 */
  it('左に何も無いなら、右に出す', () => {
    expect(panelSide({ right: 50, left: 0, needed: 200 })).toBe('右')
  })
})
