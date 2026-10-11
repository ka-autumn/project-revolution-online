import { describe, expect, it } from 'vitest'
import type { Player, Square, WireChoice, WirePerspective } from '@revolution/engine'
import { areaPointerStore, highlightedSquares } from './area-highlight.js'
import { choicePicking } from './input-model.js'
import { areaSheetOf, forgetPointerWhenSheetClosed, tapOfSquare } from './phone-area.js'
import { reducePhone, initialPhone, settlePhone } from './phone.js'
import type { PhoneAction, PhoneState } from './phone.js'
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
    const first = areaSheetOf(open({ row: 0, column: 1 }), board('先攻'), AREAS, true, false)
    const second = areaSheetOf(open({ row: 0, column: 1 }), board('後攻'), AREAS, true, false)

    expect(first?.heading).toBe('味方エリア')
    expect(second?.heading).toBe('敵エリア')
    expect(areaSheetOf(open({ row: 2, column: 0 }), board('先攻'), AREAS, true, false)?.heading).toBe('敵エリア')
    expect(areaSheetOf(open({ row: 2, column: 0 }), board('後攻'), AREAS, true, false)?.heading).toBe('味方エリア')
  })

  it('「このエリアを選ぶ」で送る番号は、そのスクエアのエリアの候補の番号になる', () => {
    for (const column of [0, 1, 2] as const) {
      expect(areaSheetOf(open({ row: 0, column }), board(), AREAS, true, false)?.answer).toBe(0)
      expect(areaSheetOf(open({ row: 2, column }), board(), AREAS, true, false)?.answer).toBe(1)
    }
  })

  it('シートを出したスクエアを持つ（ユニットの詳細を引く）', () => {
    expect(areaSheetOf(open({ row: 2, column: 1 }), board(), AREAS, true, false)?.square).toEqual({ row: 2, column: 1 })
  })

  it('送ったかどうかは、渡された値がそのまま描く側に渡る', () => {
    expect(areaSheetOf(open({ row: 0, column: 0 }), board(), AREAS, true, false)?.sent).toBe(false)
    expect(areaSheetOf(open({ row: 0, column: 0 }), board(), AREAS, true, true)?.sent).toBe(true)
  })

  it('繋がりが切れたら出さない', () => {
    expect(areaSheetOf(open({ row: 0, column: 0 }), board(), AREAS, false, false)).toBeUndefined()
  })

  it('選択が無くなったら出さない（答えが受け入れられたあと）', () => {
    expect(areaSheetOf(open({ row: 0, column: 0 }), board(), undefined, true, true)).toBeUndefined()
  })

  it('候補が入れ替わったら出さない（中身が同じ候補でも、届いた選択が替わっていれば別）', () => {
    const replaced = choice([{ kind: 'エリア', row: 0 }, { kind: 'エリア', row: 2 }])

    expect(areaSheetOf(open({ row: 0, column: 0 }), board(), replaced, true, false)).toBeUndefined()
  })

  it('押したスクエアがもうエリアの候補でなければ出さない', () => {
    const asked = choice([{ kind: 'エリア', row: 2 }])

    expect(areaSheetOf(open({ row: 0, column: 0 }, asked), board(), asked, true, false)).toBeUndefined()
  })

  it('エリアでない候補のスクエアには出さない', () => {
    const asked = choice([{ kind: 'スクエア', square: { row: 1, column: 1 } }])

    expect(areaSheetOf(open({ row: 1, column: 1 }, asked), board(), asked, true, false)).toBeUndefined()
  })
})

describe('エリアのシートの覚え', () => {
  const square = { row: 2, column: 1 } as const
  const opened =(): PhoneState => reducePhone(initialPhone(), { kind: 'エリアのシートを開く', square, choice: AREAS })
  /** 描く側に渡る値。`index.ts` の `draw` が、覚えから `areaSheetOf` を引くのと同じ。 */
  const viewOf = (state: PhoneState, ...rest: [asked?: WireChoice | undefined]) =>
    areaSheetOf(state.areaSheet, board(), rest.length === 0 ? AREAS : rest[0], true, state.areaSheetSent)

  it('開けば覚え、閉じれば捨てる', () => {
    const state = opened()

    expect(state.areaSheet).toEqual({ square, choice: AREAS })
    expect(reducePhone(state, { kind: 'エリアのシートを閉じる' }).areaSheet).toBeUndefined()
  })

  it('開いていないのに閉じても、状態は変わらない', () => {
    const state = initialPhone()

    expect(reducePhone(state, { kind: 'エリアのシートを閉じる' })).toBe(state)
  })

  it('開き直すたびに、別のシートとして見分けられる', () => {
    const first = opened()
    const again = reducePhone(first, { kind: 'エリアのシートを開く', square, choice: AREAS })

    expect(again.areaSheet).toEqual(first.areaSheet)
    expect(again.areaSheet).not.toBe(first.areaSheet)
  })

  it('対戦画面を離れたら捨てる', () => {
    const shown = { lobby: false, deckList: false, editor: false, duel: true }
    const sent = reducePhone(opened(), { kind: 'エリアの答えを送った' })

    expect(settlePhone(sent, shown)).toBe(sent)
    const left = settlePhone(sent, { ...shown, duel: false })
    expect(left.areaSheet).toBeUndefined()
    expect(left.areaSheetSent).toBe(false)
  })

  describe('答えを送ったあと', () => {
    it('開いた直後は送っていない', () => {
      expect(viewOf(opened())?.sent).toBe(false)
    })

    it('送ると、描く側に渡る値が「送信済み」になる', () => {
      expect(viewOf(reducePhone(opened(), { kind: 'エリアの答えを送った' }))?.sent).toBe(true)
    })

    it('返事の前に描き直しが何度入っても、「送信済み」のまま（シートの中だけに持たない）', () => {
      // 描き直し = 同じ状態から、同じ選択で見直す。相手の繋がりの知らせは選択を替えない（`session.test.ts`）。
      const sent = reducePhone(opened(), { kind: 'エリアの答えを送った' })

      for (let redraws = 0; redraws < 3; redraws++) {
        const view = viewOf(sent)
        expect(view?.sent).toBe(true)
        expect(view?.answer).toBe(1)
      }
    })

    it('送った覚えは同じシートの開いた単位を変えない（描き直しで別のダイアログ扱いにならない）', () => {
      const before = opened()
      const sent = reducePhone(before, { kind: 'エリアの答えを送った' })

      expect(sent.areaSheet).toBe(before.areaSheet)
    })

    it('返事が盤面や次の選択なら、選択が替わるのでシートは出ない（捨てるのは呼ぶ側）', () => {
      const sent = reducePhone(opened(), { kind: 'エリアの答えを送った' })

      expect(viewOf(sent, undefined)).toBeUndefined()
      expect(viewOf(sent, choice([{ kind: 'エリア', row: 0 }, { kind: 'エリア', row: 2 }]))).toBeUndefined()
    })

    it('捨てたあとは、送った覚えも消える（次に開いたシートは送信済みでない）', () => {
      const closed = reducePhone(reducePhone(opened(), { kind: 'エリアの答えを送った' }), { kind: 'エリアのシートを閉じる' })

      expect(closed.areaSheet).toBeUndefined()
      expect(closed.areaSheetSent).toBe(false)
      expect(viewOf(reducePhone(closed, { kind: 'エリアのシートを開く', square, choice: AREAS }))?.sent).toBe(false)
    })

    it('開いていないときに「送った」が来ても、何も起きない', () => {
      const state = initialPhone()

      expect(reducePhone(state, { kind: 'エリアの答えを送った' })).toBe(state)
    })
  })

  describe('サーバに断られたとき', () => {
    it('送ったあとの断りは、シートを閉じて捨てる', () => {
      const refused = reducePhone(reducePhone(opened(), { kind: 'エリアの答えを送った' }), { kind: 'エリアの答えが断られた' })

      expect(refused.areaSheet).toBeUndefined()
      expect(refused.areaSheetSent).toBe(false)
    })

    it('選択は残る（断られても選択は替わらない）ので、シートを出す判断だけでは閉じられない', () => {
      const sent = reducePhone(opened(), { kind: 'エリアの答えを送った' })

      expect(viewOf(sent, AREAS)).toBeDefined()
    })

    it('送っていないシートは、別の手の断りでは閉じない', () => {
      const state = opened()

      expect(reducePhone(state, { kind: 'エリアの答えが断られた' })).toBe(state)
    })
  })
})

describe('シートを閉じたあとの強調', () => {
  const square = { row: 0, column: 1 } as const
  const row0: readonly Square[] = [0, 1, 2].map((column) => ({ row: 0, column }) as Square)
  const row2: readonly Square[] = [0, 1, 2].map((column) => ({ row: 2, column }) as Square)
  const areaSquares = [...row0, ...row2]

  /** タップしたときに覚えたカーソルとフォーカスがあり、シートを開いた状態から、`closing` で閉じるまでを進める。 */
  const closeBy = (closing: (state: PhoneState) => PhoneState) => {
    const pointer = areaPointerStore()
    pointer.send({ kind: '入った', pointer: 'カーソル', square })
    pointer.send({ kind: '入った', pointer: 'フォーカス', square })
    const opened = reducePhone(initialPhone(), { kind: 'エリアのシートを開く', square, choice: AREAS })
    // 開いている間は、シートのエリアが強調される。
    expect(highlightedSquares(pointer.read(), areaSquares, opened.areaSheet?.square)).toEqual(row0)

    const closed = closing(opened)
    forgetPointerWhenSheetClosed(opened, closed, pointer)

    return { pointer, closed }
  }
  const act = (action: PhoneAction) => (state: PhoneState) => reducePhone(state, action)

  it('「閉じる」・Esc・背面（どれも閉じる動き）で閉じたら、強調するスクエアは空になる', () => {
    const { pointer, closed } = closeBy(act({ kind: 'エリアのシートを閉じる' }))

    expect(highlightedSquares(pointer.read(), areaSquares, closed.areaSheet?.square)).toEqual([])
  })

  it('断られて閉じたときも、空になる', () => {
    const { pointer, closed } = closeBy((state) =>
      reducePhone(reducePhone(state, { kind: 'エリアの答えを送った' }), { kind: 'エリアの答えが断られた' }),
    )

    expect(highlightedSquares(pointer.read(), areaSquares, closed.areaSheet?.square)).toEqual([])
  })

  it('対戦画面を離れて捨てられたときも、空になる', () => {
    const { pointer, closed } = closeBy((state) => settlePhone(state, { lobby: true, deckList: false, editor: false, duel: false }))

    expect(highlightedSquares(pointer.read(), areaSquares, closed.areaSheet?.square)).toEqual([])
  })

  it('シートが開いたままなら、覚えは捨てない', () => {
    const pointer = areaPointerStore()
    pointer.send({ kind: '入った', pointer: 'カーソル', square })
    const opened = reducePhone(initialPhone(), { kind: 'エリアのシートを開く', square, choice: AREAS })
    const sent = reducePhone(opened, { kind: 'エリアの答えを送った' })
    forgetPointerWhenSheetClosed(opened, sent, pointer)

    expect(highlightedSquares(pointer.read(), areaSquares)).toEqual(row0)
  })

  it('シートが無いときの動きは、覚えを捨てない（PC の並べ方の強調はそのまま）', () => {
    const pointer = areaPointerStore()
    pointer.send({ kind: '入った', pointer: 'カーソル', square })
    const state = initialPhone()
    forgetPointerWhenSheetClosed(state, reducePhone(state, { kind: 'エリアのシートを閉じる' }), pointer)

    expect(highlightedSquares(pointer.read(), areaSquares)).toEqual(row0)
  })
})
