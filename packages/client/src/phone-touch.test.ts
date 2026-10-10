import { describe, expect, it } from 'vitest'
import { noFinger, trackFinger } from './phone-touch.js'
import type { Finger, FingerEvent } from './phone-touch.js'

/** 指が重なっている手札のカードを目立たせる（ADR-0034）。状態の進め方だけを確かめる。 */

function run(events: readonly FingerEvent<string>[]): Finger<string> {
  return events.reduce((state, event) => trackFinger(state, event), noFinger<string>())
}

describe('指の下のカード', () => {
  it('自分の手札に触れたら、その下のカードが指の下になる', () => {
    expect(run([{ kind: '触れた', inHand: true, under: 'A' }])).toEqual({ active: true, under: 'A' })
  })

  it('なぞって動かすと、指の下のカードが追って替わる（段を送っている間も）', () => {
    const state = run([
      { kind: '触れた', inHand: true, under: 'A' },
      { kind: '動いた', under: 'B' },
      { kind: '動いた', under: 'C' },
    ])

    expect(state.under).toBe('C')
  })

  it('指がカードの間や段の外へ出たら、指の下のカードは無くなる。触れている間は追い続ける', () => {
    const left = run([
      { kind: '触れた', inHand: true, under: 'A' },
      { kind: '動いた', under: undefined },
    ])

    expect(left).toEqual({ active: true, under: undefined })
    expect(trackFinger(left, { kind: '動いた', under: 'D' }).under).toBe('D')
  })

  it('指を離す・取り消されると、戻る', () => {
    const touched = run([{ kind: '触れた', inHand: true, under: 'A' }])

    expect(trackFinger(touched, { kind: '離れた' })).toEqual(noFinger())
  })

  it('手札の外で触れ始めた指は追わない。手札の上へなぞり込んでも目立たせない', () => {
    const state = run([
      { kind: '触れた', inHand: false, under: undefined },
      { kind: '動いた', under: 'A' },
    ])

    expect(state).toEqual(noFinger())
  })

  it('触れ直したら、前の指は忘れる', () => {
    const state = run([
      { kind: '触れた', inHand: true, under: 'A' },
      { kind: '触れた', inHand: false, under: undefined },
    ])

    expect(state).toEqual(noFinger())
  })
})
