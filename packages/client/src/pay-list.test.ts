import { describe, expect, it } from 'vitest'
import type { WireChoice, WirePerspective } from '@revolution/engine'
import { choicePicking } from './input-model.js'
import { openPayList, settlePayState } from './pay-list.js'
import type { PayState } from './pay-list.js'
import { emptyBoard, instance, withZone } from './test-support.js'

/**
 * コストを払う一覧（スマートフォン、ADR-0034）。払うカードは 1 枚ずつ答える（ADR-0008）ので、
 * 一覧は払い終えるまで開いたままにする。
 */

const SMASH = (index: number) => ({ player: '先攻' as const, zone: 'スマッシュゾーン' as const, index })

/** エネルギー 1 枚と、裏向きのスマッシュ 2 枚がある盤面（プランのコストの形）。 */
function board(): WirePerspective {
  const withEnergy = withZone(emptyBoard('先攻'), '先攻', 'エネルギーゾーン', [
    { kind: '見えている', instance: instance('エネルギーの1枚', '先攻') },
  ])

  return withZone(withEnergy, '先攻', 'スマッシュゾーン', [
    { kind: '見えていない', orientation: 'リリース' },
    { kind: '見えていない', orientation: 'リリース' },
  ])
}

function choice(candidates: WireChoice['candidates']): WireChoice {
  return { player: '先攻', purpose: 'プレイのコスト', mayDecline: false, answered: 0, mayGoBack: true, candidates }
}

const BOTH = choice([
  { kind: '見えている', card: 'エネルギーの1枚' },
  { kind: '見えていない', at: SMASH(1) },
])
const ENERGY_ONLY = choice([{ kind: '見えている', card: 'エネルギーの1枚' }])
const SMASH_ONLY = choice([{ kind: '見えていない', at: SMASH(0) }])

describe('払う一覧を開く', () => {
  it('払うカードが両方の置き場にあれば、どちらのボタンからでも同じ一覧を開く', () => {
    const fromEnergy = openPayList(board(), BOTH, '先攻', 'エネルギーゾーン')
    const fromSmash = openPayList(board(), BOTH, '先攻', 'スマッシュゾーン')

    expect(fromEnergy?.list.zones).toEqual(['エネルギーゾーン', 'スマッシュゾーン'])
    expect(fromSmash?.list.zones).toEqual(fromEnergy?.list.zones)
    expect(fromSmash?.list.pressed).toBe('スマッシュゾーン')
  })

  it('片方にしか払うカードが無ければ、その置き場だけを並べる', () => {
    expect(openPayList(board(), ENERGY_ONLY, '先攻', 'エネルギーゾーン')?.list.zones).toEqual(['エネルギーゾーン'])
    expect(openPayList(board(), SMASH_ONLY, '先攻', 'スマッシュゾーン')?.list.zones).toEqual(['スマッシュゾーン'])
  })

  it('押した置き場に払うカードが無ければ、払う一覧にしない（見るだけの一覧）', () => {
    expect(openPayList(board(), ENERGY_ONLY, '先攻', 'スマッシュゾーン')).toBeUndefined()
    expect(openPayList(board(), undefined, '先攻', 'エネルギーゾーン')).toBeUndefined()
    expect(openPayList(board(), BOTH, '先攻', '捨札')).toBeUndefined()
  })
})

describe('裏向きのスマッシュを払う', () => {
  /** 押した裏向きの札と答えた番号が一致していること。ずれると別の札を払うことになる。 */
  it('払う候補の裏向きの札は、その置き場所に当たる番号で答える', () => {
    const picking = choicePicking(board(), BOTH)

    expect(picking.answerOfHidden(SMASH(1))).toBe(1)
  })

  it('候補でない裏向きの札は、押せない', () => {
    const picking = choicePicking(board(), BOTH)

    expect(picking.hidden).toEqual([SMASH(1)])
    expect(picking.answerOfHidden(SMASH(0))).toBeUndefined()
  })
})

describe('払う一覧の開閉', () => {
  const open = openPayList(board(), BOTH, '先攻', 'スマッシュゾーン') as PayState
  const answeredBoard = settlePayState(settlePayState(open, { kind: '答えた' }), { kind: '盤面', actions: 0, scroll: 42 })
  const elsewhere = choice([{ kind: '見えている', card: 'てふだの1枚' }])

  it('答えたあとの盤面が届いたら、その場で閉じ、開き直す予定だけを覚える', () => {
    expect(answeredBoard).toEqual({ kind: '開き直す予定', list: (open as { list: unknown }).list, scroll: 42 })
  })

  it('続く選択が一覧の置き場の候補を含めば、同じ一覧を開き直す', () => {
    const reopened = settlePayState(answeredBoard, { kind: '選んでほしい', board: board(), choice: SMASH_ONLY, autoOpen: true })

    expect(reopened).toEqual({ kind: '開いている', list: (open as { list: unknown }).list, answered: false })
  })

  it('一覧の片方の置き場だけ候補が残っていても、開き直す', () => {
    expect(settlePayState(answeredBoard, { kind: '選んでほしい', board: board(), choice: ENERGY_ONLY, autoOpen: true })?.kind).toBe('開いている')
  })

  it('続く選択が一覧の置き場の候補を含まなければ、予定を捨てる', () => {
    expect(settlePayState(answeredBoard, { kind: '選んでほしい', board: board(), choice: elsewhere, autoOpen: true })).toBeUndefined()
  })

  it('選択が遅れて届いても、予定が残っていれば開き直す（待ち時間では見切らない）', () => {
    // 盤面のあと、ほかに何も届かないまま時間が過ぎても、状態は変わらない。
    expect(settlePayState(answeredBoard, { kind: '選んでほしい', board: board(), choice: SMASH_ONLY, autoOpen: true })?.kind).toBe('開いている')
  })

  it('行動が終わった（行える手が付いてきた）盤面なら、予定も残さない', () => {
    const answered = settlePayState(open, { kind: '答えた' })

    expect(settlePayState(answered, { kind: '盤面', actions: 3, scroll: 0 })).toBeUndefined()
  })

  it('予定を捨てたあとに選択が遅れて届いても、予定からは開き直さない', () => {
    const dropped = settlePayState(answeredBoard, { kind: '捨てる' })

    expect(dropped).toBeUndefined()
    // 開いてよい場面でなければ（PC の並べ方、繋がっていない）、開かない。
    expect(settlePayState(dropped, { kind: '選んでほしい', board: board(), choice: SMASH_ONLY, autoOpen: false })).toBeUndefined()
  })

  it('予定のあとに、選択以外のもの（盤面・断られた）が届いたら、予定を捨てる', () => {
    expect(settlePayState(answeredBoard, { kind: '盤面', actions: 0, scroll: 0 })).toBeUndefined()
    expect(settlePayState(answeredBoard, { kind: '断られた' })).toBeUndefined()
  })

  it('答えていないのに盤面が届いたら、別の盤面になったので閉じる', () => {
    expect(settlePayState(open, { kind: '盤面', actions: 0, scroll: 0 })).toBeUndefined()
  })

  it('行動をやめたら、閉じる。予定も残さない', () => {
    expect(settlePayState(open, { kind: 'やめた' })).toBeUndefined()
    expect(settlePayState(answeredBoard, { kind: 'やめた' })).toBeUndefined()
  })

  it('送った答えが断られたら、選択は続いているので、開いたまま選び直せる', () => {
    const answered = settlePayState(open, { kind: '答えた' })

    expect(settlePayState(answered, { kind: '断られた' })).toEqual(open)
  })

  it('開いていなければ、盤面や断られた・やめたが届いても開かない', () => {
    expect(settlePayState(undefined, { kind: '盤面', actions: 0, scroll: 0 })).toBeUndefined()
    expect(settlePayState(undefined, { kind: '断られた' })).toBeUndefined()
    expect(settlePayState(undefined, { kind: 'やめた' })).toBeUndefined()
  })
})

/** 候補が全部、自分のエネルギー・スマッシュにある選択は、届いた時点で払う一覧を開く（ADR-0034）。 */
describe('選択が届いた時点で払う一覧を開く', () => {
  /** 盤面のユニットも候補に混じる選択。 */
  function withUnit(): WirePerspective {
    const base = board()

    return { ...base, squares: base.squares.map((each, at) => (at === 4 ? [instance('スクエアの1枚', '先攻')] : each)) }
  }
  const MIXED = choice([
    { kind: '見えている', card: 'エネルギーの1枚' },
    { kind: '見えている', card: 'スクエアの1枚' },
  ])

  it('候補が両方のゾーンにあれば、2 つをまとめた一覧が開く。先頭のゾーンの見出しから見せる', () => {
    const opened = settlePayState(undefined, { kind: '選んでほしい', board: board(), choice: BOTH, autoOpen: true })

    expect(opened).toEqual({
      kind: '開いている',
      list: { player: '先攻', zones: ['エネルギーゾーン', 'スマッシュゾーン'], pressed: 'エネルギーゾーン' },
      answered: false,
    })
  })

  it('スマッシュだけ（裏向き）が候補でも開く。そのゾーンの見出しから見せる', () => {
    const opened = settlePayState(undefined, { kind: '選んでほしい', board: board(), choice: SMASH_ONLY, autoOpen: true })

    expect(opened).toMatchObject({ kind: '開いている', list: { zones: ['スマッシュゾーン'], pressed: 'スマッシュゾーン' } })
  })

  it('エネルギーだけが候補でも開く', () => {
    const opened = settlePayState(undefined, { kind: '選んでほしい', board: board(), choice: ENERGY_ONLY, autoOpen: true })

    expect(opened).toMatchObject({ kind: '開いている', list: { zones: ['エネルギーゾーン'] } })
  })

  it('盤面のユニットなどが候補に混じる選択では、開かない', () => {
    expect(settlePayState(undefined, { kind: '選んでほしい', board: withUnit(), choice: MIXED, autoOpen: true })).toBeUndefined()
  })

  it('相手のカードが候補に混じるときは、開かない', () => {
    const opponents = choice([
      { kind: '見えている', card: 'エネルギーの1枚' },
      { kind: '見えていない', at: { player: '後攻', zone: 'スマッシュゾーン', index: 0 } },
    ])

    expect(settlePayState(undefined, { kind: '選んでほしい', board: board(), choice: opponents, autoOpen: true })).toBeUndefined()
  })

  it('候補が無ければ、開かない', () => {
    expect(settlePayState(undefined, { kind: '選んでほしい', board: board(), choice: choice([]), autoOpen: true })).toBeUndefined()
  })

  it('開いてよい場面でなければ（PC の並べ方・繋がっていない間）、条件に合っていても開かない', () => {
    expect(settlePayState(undefined, { kind: '選んでほしい', board: board(), choice: BOTH, autoOpen: false })).toBeUndefined()
  })

  it('「閉じる」で閉じたあと（何も開いていない）は、その選択の間は開き直さない', () => {
    const opened = settlePayState(undefined, { kind: '選んでほしい', board: board(), choice: BOTH, autoOpen: true })
    // 閉じる＝呼ぶ側が状態を捨てる。盤面の更新（行える手なし）が届いても、予定は無いので開き直さない。
    const closed = settlePayState(opened, { kind: '捨てる' })

    expect(settlePayState(closed, { kind: '盤面', actions: 0, scroll: 0 })).toBeUndefined()
  })

  it('次の選択が届けば、また条件を見て開く', () => {
    const closed = settlePayState(settlePayState(undefined, { kind: '選んでほしい', board: board(), choice: BOTH, autoOpen: true }), {
      kind: '捨てる',
    })

    expect(closed).toBeUndefined()
    expect(settlePayState(closed, { kind: '選んでほしい', board: board(), choice: SMASH_ONLY, autoOpen: true })?.kind).toBe('開いている')
  })

  it('開いている一覧は、同じ選択の描き直しのように選択が重ねて届いても、答え待ちを解いて開いたままにする', () => {
    const opened = settlePayState(undefined, { kind: '選んでほしい', board: board(), choice: BOTH, autoOpen: true })
    const answered = settlePayState(opened, { kind: '答えた' })
    const again = settlePayState(answered, { kind: '選んでほしい', board: board(), choice: BOTH, autoOpen: true })

    expect(again).toEqual(opened)
  })
})
