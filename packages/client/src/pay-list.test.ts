import { describe, expect, it } from 'vitest'
import type { WireChoice, WirePerspective } from '@revolution/engine'
import { choicePicking } from './input-model.js'
import { openPayList, settlePayList } from './pay-list.js'
import type { PayList } from './pay-list.js'
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

    expect(fromEnergy?.zones).toEqual(['エネルギーゾーン', 'スマッシュゾーン'])
    expect(fromSmash).toEqual(fromEnergy)
  })

  it('片方にしか払うカードが無ければ、その置き場だけを並べる', () => {
    expect(openPayList(board(), ENERGY_ONLY, '先攻', 'エネルギーゾーン')?.zones).toEqual(['エネルギーゾーン'])
    expect(openPayList(board(), SMASH_ONLY, '先攻', 'スマッシュゾーン')?.zones).toEqual(['スマッシュゾーン'])
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

describe('払う一覧をいつまで開いておくか', () => {
  const open: PayList = { player: '先攻', zones: ['エネルギーゾーン', 'スマッシュゾーン'], awaiting: false }

  it('1 枚払って盤面が届いても、次の選択を待つあいだは開いたままにする', () => {
    const answered = settlePayList(open, { kind: '答えた' })
    const arrived = settlePayList(answered, { kind: '盤面', actions: 0 })

    expect(arrived).toEqual({ ...open, awaiting: true })
  })

  it('次の選択がまだ一覧の置き場の候補を含むなら、開いたまま次の 1 枚を選べる', () => {
    const waiting = settlePayList(settlePayList(open, { kind: '答えた' }), { kind: '盤面', actions: 0 })

    expect(settlePayList(waiting, { kind: '選んでほしい', board: board(), choice: SMASH_ONLY })).toEqual(open)
  })

  it('次の選択が一覧の置き場の候補を含まなくなったら、閉じる', () => {
    const waiting = settlePayList(settlePayList(open, { kind: '答えた' }), { kind: '盤面', actions: 0 })
    const elsewhere = choice([{ kind: '見えている', card: 'てふだの1枚' }])

    expect(settlePayList(waiting, { kind: '選んでほしい', board: board(), choice: elsewhere })).toBeUndefined()
  })

  it('一覧の片方の置き場だけ候補が残っていれば、開いたまま', () => {
    const waiting = settlePayList(open, { kind: '答えた' })

    expect(settlePayList(waiting, { kind: '選んでほしい', board: board(), choice: ENERGY_ONLY })).toEqual(open)
  })

  it('行える手が付いてきた盤面は、行動が終わったあとのものなので、閉じる', () => {
    const waiting = settlePayList(open, { kind: '答えた' })

    expect(settlePayList(waiting, { kind: '盤面', actions: 3 })).toBeUndefined()
  })

  it('選択が続かないまま待ちきれなかったら、閉じる', () => {
    const waiting = settlePayList(settlePayList(open, { kind: '答えた' }), { kind: '盤面', actions: 0 })

    expect(settlePayList(waiting, { kind: '続かなかった' })).toBeUndefined()
  })

  it('次の選択が届いたあとに待ちきれなかった知らせが来ても、閉じない', () => {
    expect(settlePayList(open, { kind: '続かなかった' })).toBe(open)
  })

  it('送った答えが断られたら、選択は続いているので、開いたまま選び直せる', () => {
    expect(settlePayList(settlePayList(open, { kind: '答えた' }), { kind: '断られた' })).toEqual(open)
    expect(settlePayList(open, { kind: '断られた' })).toBe(open)
  })

  it('行動をやめたら、閉じる', () => {
    expect(settlePayList(open, { kind: 'やめた' })).toBeUndefined()
  })

  it('答えていないのに盤面が届いたら、別の盤面になったので閉じる', () => {
    expect(settlePayList(open, { kind: '盤面', actions: 0 })).toBeUndefined()
  })

  it('開いていなければ、何が届いても開かない', () => {
    expect(settlePayList(undefined, { kind: '選んでほしい', board: board(), choice: BOTH })).toBeUndefined()
  })
})
