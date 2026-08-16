import { describe, expect, it } from 'vitest'
import { indexOfSquare } from '@revolution/engine'
import type { LegalAction, Player, WireChoice, WirePerspective } from '@revolution/engine'
import { actionViews, automaticAction, choiceView } from './input-model.js'
import { applyMessage, connecting } from './session.js'
import type { Session } from './session.js'
import { emptyBoard, instance, unitFace, withZone } from './test-support.js'

/**
 * 行える手と選ぶ候補を、画面に出す形にするところ（#14）。
 *
 * **ここに「行えるか」の判断は無い**（ADR-0010）。行える手はサーバが送ってきたものをそのまま
 * 並べ、候補は届いた並びのまま番号を振る。確かめるのは、**間引いていない**ことと、**見えない
 * ものを見せていない**ことである。
 */

/** 自分の手札に 1 枚、スクエアに 1 枚ある盤面。 */
function board(viewer: Player = '先攻'): WirePerspective {
  const inHand = instance('てふだの1枚', viewer, { card: unitFace('テスト・手札の戦士') })
  const onSquare = instance('スクエアの1枚', viewer, { card: unitFace('テスト・盤上の戦士') })
  const withHand = withZone(emptyBoard(viewer), viewer, '手札', [{ kind: '見えている', instance: inHand }])

  return {
    ...withHand,
    squares: withHand.squares.map((each, index) =>
      index === indexOfSquare({ row: 1, column: 1 }) ? [onSquare] : each,
    ),
  }
}

/** その手の見出し。 */
function labelOf(action: LegalAction, viewer: Player = '先攻'): string {
  const [view] = actionViews(board(viewer), [action])
  if (view === undefined) throw new Error('1 つ返るはずだった')

  return view.label
}

describe('行える手', () => {
  /**
   * 届いたものを間引かない。
   *
   * どれを行えるかを決めているのはサーバである。ここが減らせば、行える手が画面から消える。
   */
  it('届いた数だけ並ぶ', () => {
    const actions: readonly LegalAction[] = [
      { kind: '優先権を放棄する' },
      { kind: 'プランする' },
      { kind: 'エネルギーを置く', card: 'てふだの1枚' },
    ]

    expect(actionViews(board(), actions)).toHaveLength(3)
  })

  /** 押したときに送るのは、届いたものそのままである。作り変えるとサーバに断られる。 */
  it('押したときに送る手は、届いたものそのまま', () => {
    const action: LegalAction = { kind: 'スマッシュする', unit: 'スクエアの1枚' }

    expect(actionViews(board(), [action])[0]?.action).toBe(action)
  })

  it('何も届かなければ、何も並ばない', () => {
    expect(actionViews(board(), [])).toEqual([])
  })

  it.each([
    ['優先権を放棄する', { kind: '優先権を放棄する' }, '優先権を放棄する'],
    ['プランする', { kind: 'プランする' }, 'プランする'],
    ['エネルギーを置く', { kind: 'エネルギーを置く', card: 'てふだの1枚' }, 'エネルギーを置く: テスト・手札の戦士'],
    ['スマッシュする', { kind: 'スマッシュする', unit: 'スクエアの1枚' }, 'スマッシュする: テスト・盤上の戦士'],
    [
      'トラップとしてプレイする',
      { kind: 'トラップとしてプレイする', card: 'てふだの1枚' },
      'トラップとしてプレイする: テスト・手札の戦士',
    ],
    [
      '「勇気」を起動する',
      { kind: '「勇気」を起動する', card: 'てふだの1枚' },
      '「勇気」を起動する: テスト・手札の戦士',
    ],
    [
      '起動型能力を起動する',
      { kind: '起動型能力を起動する', unit: 'スクエアの1枚', ability: 0 },
      '能力を起動する: テスト・盤上の戦士（1 個目）',
    ],
  ] as const)('%sには、どのカードのことかが出る', (_, action: LegalAction, expected) => {
    expect(labelOf(action)).toBe(expected)
  })

  /** スクエアは見る人から見た呼び名で出す（総合ルール 第2部 第22章 4・6）。 */
  it('プレイする先のスクエアは、見る人から見た呼び名で出る', () => {
    const action: LegalAction = {
      kind: 'カードをプレイする',
      declaration: { card: 'てふだの1枚', square: { row: 0, column: 0 } },
    }

    expect(labelOf(action, '先攻')).toBe('プレイする: テスト・手札の戦士（味方エリアの左ラインへ）')
  })

  /** 同じスクエアでも、後攻から見れば敵エリアの右ラインになる（同 4・6）。 */
  it('同じスクエアでも、見る人が変われば呼び名が変わる', () => {
    const action: LegalAction = { kind: 'ユニットを移動する', unit: 'スクエアの1枚', destination: { row: 0, column: 0 } }

    expect(labelOf(action, '後攻')).toBe('移動する: テスト・盤上の戦士 → 敵エリアの右ライン')
  })

  it('置く先を指さないプレイには、スクエアが出ない', () => {
    const action: LegalAction = { kind: 'カードをプレイする', declaration: { card: 'てふだの1枚', square: undefined } }

    expect(labelOf(action)).toBe('プレイする: テスト・手札の戦士')
  })

  /** 名前を作り出さない。見えないカードが指されたら、見えないままにする。 */
  it('見えていないカードが指されたら、名前を作らない', () => {
    expect(labelOf({ kind: 'エネルギーを置く', card: 'しらない1枚' })).toBe('エネルギーを置く: 見えていないカード')
  })
})

describe('選ぶ候補', () => {
  /** どれを選んだかは番号で答える（ADR-0008）。 */
  it('届いた並びのまま番号が振られる', () => {
    const choice: WireChoice = {
      player: '先攻',
      mayDecline: false,
      answered: 0,
      candidates: [{ kind: '見えていない' }, { kind: '見えている', card: 'スクエアの1枚' }, { kind: '見えていない' }],
    }

    expect(choiceView(board(), choice).candidates.map((candidate) => candidate.index)).toEqual([0, 1, 2])
  })

  /**
   * 見えないものもそのまま候補になる。プランのコストとして自分の裏向きのスマッシュを
   * フリーズできる（総合ルール 第2部 第21章 7-5）が、スマッシュはどちらのプレイヤーにも
   * 見えない（同 7-3）。**何であるかを出せないので、位置で示す。**
   */
  it('見えない候補は、位置で示される', () => {
    const choice: WireChoice = {
      player: '先攻',
      mayDecline: false,
      answered: 0,
      candidates: [{ kind: '見えていない' }, { kind: '見えていない' }, { kind: '見えていない' }],
    }

    expect(choiceView(board(), choice).candidates.map((candidate) => candidate.label)).toEqual([
      '1 番目（裏向き）',
      '2 番目（裏向き）',
      '3 番目（裏向き）',
    ])
  })

  it('見えている候補には、どのカードかが出る', () => {
    const choice: WireChoice = {
      player: '先攻',
      mayDecline: false,
      answered: 0,
      candidates: [{ kind: '見えている', card: 'てふだの1枚' }],
    }

    expect(choiceView(board(), choice).candidates[0]?.label).toBe('1 番目: テスト・手札の戦士')
  })

  /** 「◯枚まで選び」のように、選ばないことを選べる場面がある（`resolve.ts` の `Chooser`）。 */
  it('選ばないことを選べるかが伝わる', () => {
    const choice: WireChoice = { player: '先攻', mayDecline: true, answered: 0, candidates: [{ kind: '見えていない' }] }

    expect(choiceView(board(), choice).mayDecline).toBe(true)
  })

  /**
   * 戻れるかどうかを数えているのはサーバである（ADR-0008）。クライアントは何度答えたかを
   * 覚えていない。**切れて入り直しても正しく出る**のはそのためである。
   */
  it.each([
    ['まだ答えていなければ、戻る先が無い', 0, false],
    ['1 つ答えていれば、戻れる', 1, true],
    ['2 つ答えていても、戻れる', 2, true],
  ] as const)('%s', (_, answered, expected) => {
    const choice: WireChoice = { player: '先攻', mayDecline: false, answered, candidates: [{ kind: '見えていない' }] }

    expect(choiceView(board(), choice).mayRewind).toBe(expected)
  })
})

/**
 * 押させずに送ってよい手。
 *
 * **ルールの判断ではない**（ADR-0010）。届いた並びの中身を見ているだけで、何が行えるかを
 * 決めているのはサーバである。
 */
describe('自動で送る手', () => {
  /** 席についたうえで、その手が届いた状態。 */
  function receiving(actions: readonly LegalAction[]): Session {
    const seated = applyMessage(connecting(), { kind: '席についた', seat: '先攻' })
    return applyMessage(seated, { kind: '盤面', perspective: board(), actions })
  }

  /** 放棄しか行えないなら、選ぶ余地が無い。 */
  it('放棄しか行えないなら、それを送る', () => {
    expect(automaticAction(receiving([{ kind: '優先権を放棄する' }]))).toEqual({ kind: '優先権を放棄する' })
  })

  it('ほかにも行えることがあれば、送らない', () => {
    const session = receiving([{ kind: '優先権を放棄する' }, { kind: 'プランする' }])

    expect(automaticAction(session)).toBeUndefined()
  })

  /** 優先権を持っていない側には空で届く（`server` の `room.ts` の `boards`）。 */
  it('何も行えないなら、送らない', () => {
    expect(automaticAction(receiving([]))).toBeUndefined()
  })

  /** 1 つでも、放棄でなければ選ばせる。打つ手を勝手に打ってはならない。 */
  it('1 つでも放棄でなければ、送らない', () => {
    expect(automaticAction(receiving([{ kind: 'プランする' }]))).toBeUndefined()
  })

  /**
   * 選ぶのを待たれている間は送らない。サーバも `選ぶのを待っている` として断る（`room.ts` の
   * `act`）。
   */
  it('選ぶのを待たれている間は、送らない', () => {
    const acting = receiving([{ kind: '優先権を放棄する' }])
    const asked = applyMessage(acting, {
      kind: '選んでほしい',
      choice: { player: '先攻', mayDecline: false, answered: 0, candidates: [{ kind: '見えていない' }] },
    })

    expect(automaticAction(asked)).toBeUndefined()
  })

  it('まだ席についていないなら、送らない', () => {
    expect(automaticAction(connecting())).toBeUndefined()
  })
})
