import { describe, expect, it } from 'vitest'
import { CHOICE_PURPOSES, indexOfSquare } from '@revolution/engine'
import type { LegalAction, Player, WireChoice, WirePerspective } from '@revolution/engine'
import { actionViews, automaticAction, choicePicking, choiceView, pickView } from './input-model.js'
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
      purpose: '効果の対象',
      mayDecline: false,
      answered: 0,
      mayGoBack: true,
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
      purpose: '効果の対象',
      mayDecline: false,
      answered: 0,
      mayGoBack: true,
      candidates: [{ kind: '見えていない' }, { kind: '見えていない' }, { kind: '見えていない' }],
    }

    expect(choiceView(board(), choice).candidates.map((candidate) => candidate.label)).toEqual([
      '1 番目（裏向き）',
      '2 番目（裏向き）',
      '3 番目（裏向き）',
    ])
  })

  /**
   * バンクの能力はカードではないので、**どのカードから出た能力か**で指す（総合ルール 第2部
   * 第21章 11-3）。裏向きのカードと同じ出し方にすると、何を選んでいるのか分からない。
   */
  it('能力の候補には、発生源のカードが出る', () => {
    const choice: WireChoice = {
      player: '先攻',
      purpose: '解決する能力',
      mayDecline: false,
      answered: 0,
      mayGoBack: true,
      candidates: [{ kind: '能力', source: 'スクエアの1枚' }],
    }

    expect(choiceView(board(), choice).candidates[0]?.label).toBe('1 番目: テスト・盤上の戦士 の能力')
  })

  /** 作成された誘発型能力は発生源のカードを持たない（`duel.ts` の `CreatedAbilityInstance`）。 */
  it('発生源を持たない能力は、位置で示される', () => {
    const choice: WireChoice = {
      player: '先攻',
      purpose: '解決する能力',
      mayDecline: false,
      answered: 0,
      mayGoBack: true,
      candidates: [{ kind: '能力', source: undefined }],
    }

    expect(choiceView(board(), choice).candidates[0]?.label).toBe('1 番目（発生源のない能力）')
  })

  /**
   * #113。効果が置き先を選ばせる場面では、候補として並ぶのはスクエアである。カードではないので
   * 名前が無く、**どこのスクエアかを呼び名で出す**（総合ルール 第2部 第22章 4・6）。
   */
  it('スクエアの候補には、どこのスクエアかが出る', () => {
    const choice: WireChoice = {
      player: '先攻',
      purpose: '効果の対象',
      mayDecline: false,
      answered: 0,
      mayGoBack: true,
      candidates: [
        { kind: 'スクエア', square: { row: 0, column: 0 } },
        { kind: 'スクエア', square: { row: 1, column: 1 } },
      ],
    }

    expect(choiceView(board(), choice).candidates.map((candidate) => candidate.label)).toEqual([
      '1 番目: 味方エリアの左ライン',
      '2 番目: 中央エリアの中央ライン',
    ])
  })

  /**
   * 呼び名は見る人によって入れ替わる（同 4・6）。選択は選ぶプレイヤーにだけ届く（ADR-0008）
   * ので、受け取った側から見た呼び名になる。
   */
  it('同じスクエアでも、選ぶ人が変われば呼び名が変わる', () => {
    const choice: WireChoice = {
      player: '後攻',
      purpose: '効果の対象',
      mayDecline: false,
      answered: 0,
      mayGoBack: true,
      candidates: [{ kind: 'スクエア', square: { row: 0, column: 0 } }],
    }

    expect(choiceView({ ...board(), viewer: '後攻' }, choice).candidates[0]?.label).toBe('1 番目: 敵エリアの右ライン')
  })

  it('見えている候補には、どのカードかが出る', () => {
    const choice: WireChoice = {
      player: '先攻',
      purpose: '効果の対象',
      mayDecline: false,
      answered: 0,
      mayGoBack: true,
      candidates: [{ kind: '見えている', card: 'てふだの1枚' }],
    }

    expect(choiceView(board(), choice).candidates[0]?.label).toBe('1 番目: テスト・手札の戦士')
  })

  /** 「◯枚まで選び」のように、選ばないことを選べる場面がある（`resolve.ts` の `Chooser`）。 */
  it('選ばないことを選べるかが伝わる', () => {
    const choice: WireChoice = {
      player: '先攻',
      purpose: '効果の対象',
      mayDecline: true,
      answered: 0,
      mayGoBack: true,
      candidates: [{ kind: '見えていない' }],
    }

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
    const choice: WireChoice = {
      player: '先攻',
      purpose: '効果の対象',
      mayDecline: false,
      answered,
      mayGoBack: true,
      candidates: [{ kind: '見えていない' }],
    }

    expect(choiceView(board(), choice).mayRewind).toBe(expected)
  })

  /**
   * #142。行動を始めてから新しく見えたものがあれば、その行動は戻せない。決めるのはサーバで
   * （`WireChoice.mayGoBack`）、ここは届いた答えをそのまま使う（ADR-0010）。
   */
  it.each([
    ['戻れるなら、やめる側はいつでも押せる', true, true],
    ['戻れないなら、やめる側も出さない', false, false],
  ] as const)('%s', (_, mayGoBack, expected) => {
    const choice: WireChoice = {
      player: '先攻',
      purpose: '効果の対象',
      mayDecline: false,
      answered: 0,
      mayGoBack,
      candidates: [{ kind: '見えていない' }],
    }

    expect(choiceView(board(), choice).mayCancel).toBe(expected)
  })

  it('戻れないなら、答えを 1 つ済ませていても「ひとつ戻る」を出さない', () => {
    const choice: WireChoice = {
      player: '先攻',
      purpose: '効果の対象',
      mayDecline: false,
      answered: 1,
      mayGoBack: false,
      candidates: [{ kind: '見えていない' }],
    }

    expect(choiceView(board(), choice).mayRewind).toBe(false)
  })

  /**
   * 何を聞かれているかが出る。
   *
   * 候補だけを見せても、それがコストの支払いなのか効果の対象なのかは分からない。engine が
   * 持つのは種類だけ（`ChoicePurpose`）で、言葉にするのはクライアントの仕事である。
   */
  it.each([
    ['プレイのコスト', 'プレイのコストとしてフリーズするエネルギーを選んでください'],
    ['プランのコスト', 'プランのコストとしてフリーズするカードを選んでください'],
    ['移動のコスト', '移動のコストとしてフリーズするエネルギーを選んでください'],
    ['起動のコスト', '起動のコストとしてフリーズするエネルギーを選んでください'],
    ['解決する能力', '解決する能力を選んでください'],
    ['プランの置き換え', 'プランのめくりを置き換える能力を選んでください'],
    ['効果の対象', '効果の対象を選んでください'],
  ] as const)('%s なら、そう聞かれる', (purpose, expected) => {
    const choice: WireChoice = {
      player: '先攻',
      purpose,
      mayDecline: false,
      answered: 0,
      mayGoBack: true,
      candidates: [{ kind: '見えていない' }],
    }

    expect(choiceView(board(), choice).asking).toBe(expected)
  })

  /** 種類を足したら言い回しも足す。足し忘れると型検査で落ちる（`askingFor` の `switch`）。 */
  it('どの種類にも言い回しがある', () => {
    const asked = CHOICE_PURPOSES.map((purpose) => {
      const choice: WireChoice = {
        player: '先攻',
        purpose,
        mayDecline: false,
        answered: 0,
        mayGoBack: true,
        candidates: [],
      }
      return choiceView(board(), choice).asking
    })

    expect(new Set(asked).size).toBe(CHOICE_PURPOSES.length)
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
      choice: {
        player: '先攻',
        purpose: '効果の対象',
        mayDecline: false,
        answered: 0,
        mayGoBack: true,
        candidates: [{ kind: '見えていない' }],
      },
    })

    expect(automaticAction(asked)).toBeUndefined()
  })

  it('まだ席についていないなら、送らない', () => {
    expect(automaticAction(connecting())).toBeUndefined()
  })
})

/**
 * #94。盤面をクリックして操作する。
 *
 * **ルールの判断は増やさない**（ADR-0010）。押せるカードも光らせるスクエアも、届いた手が
 * 指しているところだけから決まる。ここで確かめるのは、**届いた手に無いものを押させていない**
 * ことである。
 */
describe('クリックで操作する', () => {
  const PASS: LegalAction = { kind: '優先権を放棄する' }
  const PLACE: LegalAction = { kind: 'エネルギーを置く', card: 'てふだの1枚' }
  const PLAY_LEFT: LegalAction = {
    kind: 'カードをプレイする',
    declaration: { card: 'てふだの1枚', square: { row: 0, column: 0 } },
  }
  const PLAY_RIGHT: LegalAction = {
    kind: 'カードをプレイする',
    declaration: { card: 'てふだの1枚', square: { row: 0, column: 2 } },
  }
  const SMASH: LegalAction = { kind: 'スマッシュする', unit: 'スクエアの1枚' }

  const pick = (actions: readonly LegalAction[], picked?: string) => pickView(board(), actions, picked)

  it('手が紐づいているカードだけが押せる', () => {
    expect(pick([PASS, PLACE, PLAY_LEFT]).pickable).toEqual(['てふだの1枚'])
  })

  it('対象を持たない手は、カードとは別に出る', () => {
    const view = pick([PASS, PLACE])

    expect(view.untargeted.map((each) => each.action)).toEqual([PASS])
  })

  /** 何も選んでいなければ、盤面の上に置き先は出ない。 */
  it('カードを選ぶまでは、置き先を光らせない', () => {
    expect(pick([PLAY_LEFT, PLAY_RIGHT]).destinations).toEqual([])
  })

  it('カードを選ぶと、そのカードの手だけになる', () => {
    const view = pick([PLACE, SMASH], 'てふだの1枚')

    expect(view.picked).toBe('てふだの1枚')
    expect(view.direct.map((each) => each.action)).toEqual([PLACE])
  })

  /**
   * 選び直すのに、いま選んでいるカードをもう一度押して外させない。押したカードがそのまま
   * 次の選択になる。
   */
  it('カードを選んでいる間も、ほかのカードは押せる', () => {
    const view = pick([PLACE, SMASH], 'てふだの1枚')

    expect(view.pickable).toEqual(['てふだの1枚', 'スクエアの1枚'])
  })

  it('置き先を選ぶ手は、置ける先が盤面の上に出る', () => {
    const view = pick([PLAY_LEFT, PLAY_RIGHT], 'てふだの1枚')

    expect(view.destinations.map((each) => each.square)).toEqual([
      { row: 0, column: 0 },
      { row: 0, column: 2 },
    ])
    // 盤面の上で示せるので、ボタンとしては出ない。
    expect(view.direct).toEqual([])
  })

  /** 光らせた場所を押したら、その手をそのまま送る。組み立て直さない。 */
  it('置き先には、そこを押した時に送る手が付いている', () => {
    const view = pick([PLAY_LEFT], 'てふだの1枚')

    expect(view.destinations[0]?.action).toBe(PLAY_LEFT)
  })

  /**
   * 届いた手が指していないスクエアは光らない。**クライアントが「ここに置けるはず」を
   * 計算していない**ことがここで見える。
   */
  it('届いた手が指していないスクエアは光らない', () => {
    const view = pick([PLAY_LEFT], 'てふだの1枚')

    expect(view.destinations).toHaveLength(1)
    expect(view.destinations.some((each) => each.square.column === 1)).toBe(false)
  })

  /**
   * 同じスクエアを指す手が 2 つ以上あるなら、押した場所だけでは決まらない。ボタンとして出す。
   */
  it('同じ場所を指す手が 2 つあれば、盤面では示さない', () => {
    const move: LegalAction = { kind: 'ユニットを移動する', unit: 'てふだの1枚', destination: { row: 0, column: 0 } }
    const view = pick([PLAY_LEFT, move], 'てふだの1枚')

    expect(view.destinations).toEqual([])
    expect(view.direct.map((each) => each.action)).toEqual([PLAY_LEFT, move])
  })

  /** 選んだカードの手が届かなくなったら、選んでいない状態と同じになる。 */
  it('選んだカードに手が無くなれば、選んでいないことになる', () => {
    const view = pick([SMASH], 'てふだの1枚')

    expect(view.picked).toBeUndefined()
    expect(view.pickable).toEqual(['スクエアの1枚'])
  })

  it('カードに紐づかない手は、カードを選んでいる間も押せる', () => {
    const view = pick([PASS, PLACE], 'てふだの1枚')

    expect(view.untargeted.map((each) => each.action)).toEqual([PASS])
  })
})

/**
 * 選ぶのを待たれている間、盤面のカードを押して答える（#94）。
 *
 * **答えるのは番号のまま**（ADR-0008）で、押したカードがどの番号かを結び付けるだけである。
 */
describe('候補を盤面から押す', () => {
  const choice = (candidates: WireChoice['candidates']): WireChoice => ({
    player: '先攻',
    purpose: 'プレイのコスト',
    mayDecline: false,
    answered: 0,
    mayGoBack: true,
    candidates,
  })

  it('見えている候補のカードが押せる', () => {
    const picking = choicePicking(
      board(),
      choice([
        { kind: '見えている', card: 'てふだの1枚' },
        { kind: '見えている', card: 'スクエアの1枚' },
      ]),
    )

    expect(picking.pickable).toEqual(['てふだの1枚', 'スクエアの1枚'])
  })

  it('押したカードは、その候補の番号で答える', () => {
    const picking = choicePicking(
      board(),
      choice([{ kind: '見えていない' }, { kind: '見えている', card: 'スクエアの1枚' }]),
    )

    expect(picking.answerOf('スクエアの1枚')).toBe(1)
  })

  it('候補になっていないカードは押せない', () => {
    const picking = choicePicking(board(), choice([{ kind: '見えている', card: 'スクエアの1枚' }]))

    expect(picking.pickable).not.toContain('てふだの1枚')
    expect(picking.answerOf('てふだの1枚')).toBeUndefined()
  })

  /**
   * 裏向きのスマッシュも候補になる（プランのコスト、総合ルール 第2部 第21章 7-5）が、通信に
   * 載るのは見えていないということだけ（`protocol.ts` の `WireCandidate`）で、盤面のどの札の
   * ことかを結び付けられない。**ボタンのままにする。**
   */
  it('見えていない候補は、盤面からは押せない', () => {
    const picking = choicePicking(board(), choice([{ kind: '見えていない' }, { kind: '見えていない' }]))

    expect(picking.pickable).toEqual([])
  })

  /** 能力の候補は、押す先が盤面に無い。 */
  it('能力の候補は、盤面からは押せない', () => {
    const picking = choicePicking(board(), choice([{ kind: '能力', source: 'スクエアの1枚' }]))

    expect(picking.pickable).toEqual([])
    expect(picking.squares).toEqual([])
  })

  /**
   * #113。効果が置き先を選ばせている場面では、候補として並ぶのはスクエアである。カードを
   * 置く時（`pickView` の `destinations`）と同じように、盤面のそこを押して答えられる。
   */
  it('スクエアの候補は、盤面のそこが押せる', () => {
    const picking = choicePicking(
      board(),
      choice([
        { kind: 'スクエア', square: { row: 0, column: 0 } },
        { kind: 'スクエア', square: { row: 1, column: 1 } },
      ]),
    )

    expect(picking.squares.map((each) => each.square)).toEqual([
      { row: 0, column: 0 },
      { row: 1, column: 1 },
    ])
  })

  it('押したスクエアは、その候補の番号で答える', () => {
    const picking = choicePicking(
      board(),
      choice([{ kind: '見えていない' }, { kind: 'スクエア', square: { row: 1, column: 1 } }]),
    )

    expect(picking.answerOfSquare({ row: 1, column: 1 })).toBe(1)
  })

  it('候補になっていないスクエアは押せない', () => {
    const picking = choicePicking(board(), choice([{ kind: 'スクエア', square: { row: 1, column: 1 } }]))

    expect(picking.answerOfSquare({ row: 0, column: 0 })).toBeUndefined()
  })

  /** 呼び名は見る人によって入れ替わる（総合ルール 第2部 第22章 4・6）。 */
  it('スクエアの見出しは、選ぶ人から見た呼び名になる', () => {
    const forFirst = choicePicking(board(), choice([{ kind: 'スクエア', square: { row: 0, column: 0 } }]))
    const forSecond = choicePicking(
      { ...board(), viewer: '後攻' },
      choice([{ kind: 'スクエア', square: { row: 0, column: 0 } }]),
    )

    expect(forFirst.squares[0]?.label).toBe('味方エリアの左ラインを選ぶ')
    expect(forSecond.squares[0]?.label).toBe('敵エリアの右ラインを選ぶ')
  })
})
