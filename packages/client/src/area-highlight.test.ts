import type { Square } from '@revolution/engine'
import { describe, expect, it } from 'vitest'
import { areaPointerStore, highlightedSquares, NO_POINTER, settleAreaPointer } from './area-highlight.js'
import type { AreaPointer, AreaPointerEvent } from './area-highlight.js'

const at = (row: 0 | 1 | 2, column: 0 | 1 | 2): Square => ({ row, column })
const row = (n: 0 | 1 | 2): Square[] => [at(n, 0), at(n, 1), at(n, 2)]
/** 行 0 と行 1 のエリアが候補（行 2 は候補でない）。 */
const AREA_SQUARES: readonly Square[] = [...row(0), ...row(1)]

const settle = (...events: AreaPointerEvent[]): AreaPointer => events.reduce(settleAreaPointer, NO_POINTER)
const cursorIn = (square: Square): AreaPointerEvent => ({ kind: '入った', pointer: 'カーソル', square })
const focusIn = (square: Square): AreaPointerEvent => ({ kind: '入った', pointer: 'フォーカス', square })
const cursorOut: AreaPointerEvent = { kind: '出た', pointer: 'カーソル' }
const focusOut: AreaPointerEvent = { kind: '出た', pointer: 'フォーカス' }

describe('エリアの強調', () => {
  it('フォーカスが X にある間にカーソルが X を通って出ても、X は強調されたまま', () => {
    const state = settle(focusIn(at(0, 1)), cursorIn(at(0, 2)), cursorOut)

    expect(highlightedSquares(state, AREA_SQUARES)).toEqual(row(0))
  })

  it('カーソルが X にある間にフォーカスが X を通って出ても、X は強調されたまま', () => {
    const state = settle(cursorIn(at(1, 0)), focusIn(at(1, 1)), focusOut)

    expect(highlightedSquares(state, AREA_SQUARES)).toEqual(row(1))
  })

  it('フォーカスが X、カーソルが Y なら、後から動いたほうのエリアだけを強調する', () => {
    const cursorLater = settle(focusIn(at(0, 0)), cursorIn(at(1, 0)))
    const focusLater = settle(cursorIn(at(1, 0)), focusIn(at(0, 0)))

    expect(highlightedSquares(cursorLater, AREA_SQUARES)).toEqual(row(1))
    expect(highlightedSquares(focusLater, AREA_SQUARES)).toEqual(row(0))
  })

  it('後から動いたほうが離れると、もう一方のエリアに戻る', () => {
    const cursorLeft = settle(focusIn(at(0, 0)), cursorIn(at(1, 0)), cursorOut)
    const focusLeft = settle(cursorIn(at(1, 0)), focusIn(at(0, 0)), focusOut)

    expect(highlightedSquares(cursorLeft, AREA_SQUARES)).toEqual(row(0))
    expect(highlightedSquares(focusLeft, AREA_SQUARES)).toEqual(row(1))
  })

  it('戻った先の後で、離れたほうがまた入れば、そちらが後に動いたものになる', () => {
    const state = settle(focusIn(at(0, 0)), cursorIn(at(1, 0)), cursorOut, cursorIn(at(1, 2)))

    expect(highlightedSquares(state, AREA_SQUARES)).toEqual(row(1))
  })

  it('どちらも無ければ、強調しない', () => {
    expect(highlightedSquares(NO_POINTER, AREA_SQUARES)).toEqual([])
    expect(highlightedSquares(settle(cursorIn(at(0, 0)), cursorOut), AREA_SQUARES)).toEqual([])
    expect(highlightedSquares(settle(focusIn(at(0, 0)), focusOut), AREA_SQUARES)).toEqual([])
  })

  it('候補でないエリアのスクエアにカーソルがあっても、強調しない', () => {
    expect(highlightedSquares(settle(cursorIn(at(2, 1))), AREA_SQUARES)).toEqual([])
  })

  it('後から動いたほうが候補でないエリアにあるなら、もう一方の候補のエリアを強調する', () => {
    const state = settle(focusIn(at(0, 0)), cursorIn(at(2, 1)))

    expect(highlightedSquares(state, AREA_SQUARES)).toEqual(row(0))
  })

  it('押せるエリアのスクエアが無ければ、強調しない', () => {
    expect(highlightedSquares(settle(cursorIn(at(0, 0))), [])).toEqual([])
  })
})

describe('覚え先（描き直しをまたぐ）', () => {
  it('描き直しの間も、カーソルまたはフォーカスのあるエリアを覚えていて、捨てると無くなる', () => {
    const store = areaPointerStore()
    store.send(cursorIn(at(1, 1)))

    // 描き直しは、覚え先をそのまま次の描く関数へ渡す。要素は作り直されるが、位置は残る。
    expect(highlightedSquares(store.read(), AREA_SQUARES)).toEqual(row(1))
    expect(highlightedSquares(store.read(), AREA_SQUARES)).toEqual(row(1))

    store.clear()

    expect(highlightedSquares(store.read(), AREA_SQUARES)).toEqual([])
  })
})
