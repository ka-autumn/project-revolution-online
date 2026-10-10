import { describe, expect, it } from 'vitest'
import type { Player, WireChoice, WirePerspective } from '@revolution/engine'
import { choicePicking } from './input-model.js'
import { areaSheetOf, tapOfSquare } from './phone-area.js'
import { reducePhone, initialPhone, settlePhone } from './phone.js'
import { emptyBoard } from './test-support.js'

/**
 * スマートフォンで、効果がエリアを選ばせている間の、スクエアを押したあとの動き（ADR-0034、#278）。
 *
 * 押せるスクエアと答える番号は、届いた候補から作った `choicePicking` だけから引く（ADR-0010）。
 */

const choice = (candidates: WireChoice['candidates']): WireChoice => ({
  player: '先攻',
  purpose: '効果の対象',
  mayDecline: false,
  answered: 0,
  mayGoBack: true,
  candidates,
})

const board = (viewer: Player = '先攻'): WirePerspective => emptyBoard(viewer)
const AREAS = choice([{ kind: 'エリア', row: 0 }, { kind: 'エリア', row: 2 }])

describe('光っているスクエアを押したあとの動き', () => {
  // 判断はユニットの有無を見ない（押せるスクエアの種類だけ）。ユニットのいるスクエアも空きスクエアも同じ。
  it('スマートフォンでは、エリアのスクエアを押すと、答えずにシートを出す', () => {
    const picking = choicePicking(board(), AREAS)

    for (const each of picking.squares) expect(tapOfSquare(true, each)).toBe('エリアのシートを出す')
  })

  it('PC の並べ方では、エリアのスクエアも今までどおり押したら答える', () => {
    const picking = choicePicking(board(), AREAS)

    for (const each of picking.squares) expect(tapOfSquare(false, each)).toBe('答える')
  })

  it('エリアでないスクエアの候補（置き先）は、スマートフォンでも 1 回のタップで答える', () => {
    const picking = choicePicking(board(), choice([{ kind: 'スクエア', square: { row: 1, column: 1 } }]))

    expect(picking.squares).toHaveLength(1)
    expect(tapOfSquare(true, picking.squares[0])).toBe('答える')
  })

  it('押せるスクエアでなければ答える（シートは出さない）', () => {
    expect(tapOfSquare(true, undefined)).toBe('答える')
  })
})

describe('エリアのシート', () => {
  const open = (square: { row: 0 | 1 | 2; column: 0 | 1 | 2 }, asked: WireChoice = AREAS) => ({ square, choice: asked })

  it('見出しは、見る人から見たエリアの呼び名になる（先攻と後攻で入れ替わる）', () => {
    const first = areaSheetOf(open({ row: 0, column: 1 }), board('先攻'), AREAS, true)
    const second = areaSheetOf(open({ row: 0, column: 1 }), board('後攻'), AREAS, true)

    expect(first?.heading).toBe('味方エリア')
    expect(second?.heading).toBe('敵エリア')
    expect(areaSheetOf(open({ row: 2, column: 0 }), board('先攻'), AREAS, true)?.heading).toBe('敵エリア')
    expect(areaSheetOf(open({ row: 2, column: 0 }), board('後攻'), AREAS, true)?.heading).toBe('味方エリア')
  })

  it('「このエリアを選ぶ」で送る番号は、そのスクエアのエリアの候補の番号になる', () => {
    for (const column of [0, 1, 2] as const) {
      expect(areaSheetOf(open({ row: 0, column }), board(), AREAS, true)?.answer).toBe(0)
      expect(areaSheetOf(open({ row: 2, column }), board(), AREAS, true)?.answer).toBe(1)
    }
  })

  it('シートを出したスクエアを持つ（ユニットの詳細を引く）', () => {
    expect(areaSheetOf(open({ row: 2, column: 1 }), board(), AREAS, true)?.square).toEqual({ row: 2, column: 1 })
  })

  it('繋がりが切れたら出さない', () => {
    expect(areaSheetOf(open({ row: 0, column: 0 }), board(), AREAS, false)).toBeUndefined()
  })

  it('選択が無くなったら出さない（答えが受け入れられたあと）', () => {
    expect(areaSheetOf(open({ row: 0, column: 0 }), board(), undefined, true)).toBeUndefined()
  })

  it('候補が入れ替わったら出さない（中身が同じ候補でも、届いた選択が替わっていれば別）', () => {
    const replaced = choice([{ kind: 'エリア', row: 0 }, { kind: 'エリア', row: 2 }])

    expect(areaSheetOf(open({ row: 0, column: 0 }), board(), replaced, true)).toBeUndefined()
  })

  it('押したスクエアがもうエリアの候補でなければ出さない', () => {
    const asked = choice([{ kind: 'エリア', row: 2 }])

    expect(areaSheetOf(open({ row: 0, column: 0 }, asked), board(), asked, true)).toBeUndefined()
  })

  it('エリアでない候補のスクエアには出さない', () => {
    const asked = choice([{ kind: 'スクエア', square: { row: 1, column: 1 } }])

    expect(areaSheetOf(open({ row: 1, column: 1 }, asked), board(), asked, true)).toBeUndefined()
  })
})

describe('エリアのシートの覚え', () => {
  const square = { row: 1, column: 2 } as const

  it('開けば覚え、閉じれば捨てる', () => {
    const opened = reducePhone(initialPhone(), { kind: 'エリアのシートを開く', square, choice: AREAS })

    expect(opened.areaSheet).toEqual({ square, choice: AREAS })
    expect(reducePhone(opened, { kind: 'エリアのシートを閉じる' }).areaSheet).toBeUndefined()
  })

  it('開いていないのに閉じても、状態は変わらない', () => {
    const state = initialPhone()

    expect(reducePhone(state, { kind: 'エリアのシートを閉じる' })).toBe(state)
  })

  it('開き直すたびに、別のシートとして見分けられる', () => {
    const first = reducePhone(initialPhone(), { kind: 'エリアのシートを開く', square, choice: AREAS })
    const again = reducePhone(first, { kind: 'エリアのシートを開く', square, choice: AREAS })

    expect(again.areaSheet).toEqual(first.areaSheet)
    expect(again.areaSheet).not.toBe(first.areaSheet)
  })

  it('対戦画面を離れたら捨てる', () => {
    const opened = reducePhone(initialPhone(), { kind: 'エリアのシートを開く', square, choice: AREAS })
    const shown = { lobby: false, deckList: false, editor: false, duel: true }

    expect(settlePhone(opened, shown)).toBe(opened)
    expect(settlePhone(opened, { ...shown, duel: false }).areaSheet).toBeUndefined()
  })
})
