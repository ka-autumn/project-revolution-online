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
    const reopened = settlePayState(answeredBoard, { kind: '選んでほしい', board: board(), choice: SMASH_ONLY })

    expect(reopened).toEqual({ kind: '開いている', list: (open as { list: unknown }).list, answered: false })
  })

  it('一覧の片方の置き場だけ候補が残っていても、開き直す', () => {
    expect(settlePayState(answeredBoard, { kind: '選んでほしい', board: board(), choice: ENERGY_ONLY })?.kind).toBe('開いている')
  })

  it('続く選択が一覧の置き場の候補を含まなければ、予定を捨てる', () => {
    expect(settlePayState(answeredBoard, { kind: '選んでほしい', board: board(), choice: elsewhere })).toBeUndefined()
  })

  it('選択が遅れて届いても、予定が残っていれば開き直す（待ち時間では見切らない）', () => {
    // 盤面のあと、ほかに何も届かないまま時間が過ぎても、状態は変わらない。
    expect(settlePayState(answeredBoard, { kind: '選んでほしい', board: board(), choice: SMASH_ONLY })?.kind).toBe('開いている')
  })

  it('行動が終わった（行える手が付いてきた）盤面なら、予定も残さない', () => {
    const answered = settlePayState(open, { kind: '答えた' })

    expect(settlePayState(answered, { kind: '盤面', actions: 3, scroll: 0 })).toBeUndefined()
  })

  it('予定を捨てたあとに選択が遅れて届いても、開き直さない', () => {
    const dropped = settlePayState(answeredBoard, { kind: '捨てる' })

    expect(dropped).toBeUndefined()
    expect(settlePayState(dropped, { kind: '選んでほしい', board: board(), choice: SMASH_ONLY })).toBeUndefined()
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

  it('開いていなければ、何が届いても開かない', () => {
    expect(settlePayState(undefined, { kind: '選んでほしい', board: board(), choice: BOTH })).toBeUndefined()
  })
})
