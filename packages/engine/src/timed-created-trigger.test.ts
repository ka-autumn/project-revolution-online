import { describe, expect, it } from 'vitest'
// 盤面を組み立てるためだけに使う。engine の中から盤面を組み替えるための関数であり、公開する API ではない
// （`smash.test.ts` と同じ）。
import { putInZone } from './duel.js'
import { durationEnds } from './effect.js'
import {
  applyWithAnswers,
  cardsIn,
  createUntargetedTriggeredAbility,
  defineStrategy,
  defineUnit,
  drawCards,
  emptyDuelState,
  instantiate,
  mayDo,
  passPriority,
  perspectiveOf,
  placeInZone,
  putOnSquare,
  resolveEffect,
  smash,
} from './index.js'
import type { ActionOutcome, ActionProgress, Chooser, CreatedAbility, DuelState, Duration, LegalAction, Player, Square, Turn } from './index.js'

const chooseFirst: Chooser = (candidates) => candidates[0]

// 検証したいルールだけを持つ架空のテストカード（ADR-0002）。
const filler = defineUnit({ name: 'テスト・山札', level: 1, colors: ['赤'], bp: 1000, sp: 1000 })
const sp1500 = defineUnit({ name: 'テスト・ＳＰ1500', level: 1, colors: ['赤'], bp: 1000, sp: 1500 })

/** 支配者が 1 枚引く、対象を持たない作成された誘発型能力。 */
function watcher(duration: Duration | undefined, controller: Player = '後攻', createdIn = 1): CreatedAbility {
  return {
    ability: {
      kind: '作成された誘発型能力',
      place: 'なし',
      trigger: 'あなたのカードがスマッシュゾーンに置かれた時',
      description: '1枚引く',
      duration,
      effect: function* () {
        yield* drawCards(controller, 1)
      },
    },
    controller,
    affecting: undefined,
    createdBy: undefined,
    createdIn,
  }
}

const LIBRARY_SIZE = 10

function stocked(): DuelState {
  return (['先攻', '後攻'] as const).reduce(
    (state, player) =>
      putInZone(
        state,
        player,
        '山札',
        Array.from({ length: LIBRARY_SIZE }, (_, index) =>
          instantiate({ id: `${player}の山札${index}`, card: filler, owner: player }),
        ),
      ),
    emptyDuelState(),
  )
}

const enemySquare: Square = { row: 2, column: 1 }

/** スマッシュ判定が終わるまで、両方が優先権を放棄し続けた盤面。 */
function finishJudgment(state: DuelState): DuelState {
  let current = state
  for (let steps = 0; steps < 200 && current.smashJudgments.length > 0 && current.result === undefined; steps += 1) {
    current = passPriority(current, chooseFirst)
  }
  return current
}

/** 先攻が敵エリアのユニットでスマッシュし、後攻が 2000 のダメージを受けた盤面。能力を持たせて渡す。 */
function smashedFor2000(abilities: readonly CreatedAbility[]): DuelState {
  let current: DuelState = putOnSquare(stocked(), enemySquare, instantiate({ id: 'スマッシュ役', card: sp1500, owner: '先攻' }))
  while (current.turn.phase !== 'スマッシュフェイズ') current = passPriority(current, chooseFirst)
  current = passPriority(current, chooseFirst)

  const smashed: ActionOutcome = smash({ ...current, createdAbilities: abilities }, 'スマッシュ役')
  if (smashed.kind !== '行った') throw new Error(`スマッシュできるはずだった: ${smashed.violation}`)
  return smashed.state
}

const handSize = (state: DuelState, player: Player) => cardsIn(state, player, '手札').length

const recoveryOf = (number: number, active: Player): Turn => ({
  ...emptyDuelState().turn,
  number,
  active,
  phase: 'リカバリーフェイズ',
  priority: active,
})

// 総合ルール 第4部 第3章 4（ADR-0065）
describe('期限を持つ、対象を持たない作成された誘発型能力', () => {
  describe('誘発', () => {
    it('期限があれば、スマッシュゾーンにカードが置かれるたびに誘発する（2000 のダメージなら 2 回）', () => {
      const before = smashedFor2000([watcher('次の相手のターンの終わりまで')])
      const handBefore = handSize(before, '後攻')

      const done = finishJudgment(before)

      expect(handSize(done, '後攻') - handBefore).toBe(2)
    })

    it('期限があれば、誘発した後も盤面に残る', () => {
      const done = finishJudgment(smashedFor2000([watcher('次の相手のターンの終わりまで')]))

      expect(done.createdAbilities).toHaveLength(1)
    })

    it('期限が無ければ、1 度だけ誘発して取り除かれる（同 4 の 1 文目）', () => {
      const before = smashedFor2000([watcher(undefined)])
      const handBefore = handSize(before, '後攻')

      const done = finishJudgment(before)

      expect(handSize(done, '後攻') - handBefore).toBe(1)
      expect(done.createdAbilities).toEqual([])
    })

    it('支配者のスマッシュゾーンにカードが置かれた時だけ誘発する（相手のカードが置かれても誘発しない）', () => {
      // 先攻が支配者の能力。スマッシュゾーンにカードが置かれるのは後攻である。
      const before = smashedFor2000([watcher('次の相手のターンの終わりまで', '先攻')])
      const handBefore = handSize(before, '先攻')

      const done = finishJudgment(before)

      expect(handSize(done, '先攻')).toBe(handBefore)
    })

    // 希望ステップのほかに、効果でスマッシュゾーンへ置かれる経路もある（ADR-0065）。
    it('効果で、持ち主のスマッシュゾーンに置かれた時も、1 枚につき 1 回誘発する', () => {
      const placing = defineStrategy({
        name: 'テスト・スマッシュゾーンへ置く',
        level: 0,
        effect: function* (duel) {
          const [card] = duel.hand().filter((each) => each.id === '置かれるカード')
          if (card !== undefined) yield* placeInZone(card, 'スマッシュゾーン', 'リリース')
        },
      })
      let current = stocked()
      while (current.turn.phase !== 'メインフェイズ') current = passPriority(current, chooseFirst)
      current = passPriority(current, chooseFirst)
      const start: DuelState = {
        ...putInZone(current, '先攻', '手札', [
          instantiate({ id: 'ストラテジー', card: placing, owner: '先攻' }),
          instantiate({ id: '置かれるカード', card: filler, owner: '先攻' }),
        ]),
        createdAbilities: [watcher('次の相手のターンの終わりまで', '先攻')],
      }
      const handBefore = handSize(start, '先攻')

      const played = applyWithAnswers(start, { kind: 'カードをプレイする', declaration: { card: 'ストラテジー' } }, [])
      if (played.kind !== '進んだ') throw new Error(`進んだはずだった: ${played.kind}`)
      let done = played.state
      for (let steps = 0; steps < 50 && (done.triggered.length > 0 || done.bank.length > 0); steps += 1) {
        done = passPriority(done, chooseFirst)
      }

      // ストラテジーと置かれるカードが手札を出る（-2）。置かれたことで 1 枚引く（+1）。
      expect(handSize(done, '先攻')).toBe(handBefore - 2 + 1)
      expect(cardsIn(done, '先攻', 'スマッシュゾーン').map((card) => card.id)).toEqual(['置かれるカード'])
    })

    it('能力を 2 つ作成していれば、1 枚置かれるたびに 2 回誘発する', () => {
      const before = smashedFor2000([watcher('次の相手のターンの終わりまで'), watcher('次の相手のターンの終わりまで')])
      const handBefore = handSize(before, '後攻')

      const done = finishJudgment(before)

      expect(handSize(done, '後攻') - handBefore).toBe(4)
    })
  })

  // 総合ルール 第3部 第10章 1（ターンの終わりまでの効果は、リカバリーフェイズの始めに終了する）
  describe('期限', () => {
    it('「ターンの終わりまで」は、作成されたターンに関わらず、そのリカバリーフェイズの始めに終了する', () => {
      expect(durationEnds('ターンの終わりまで', 1, '先攻', recoveryOf(1, '先攻'))).toBe(true)
    })

    it('「次の相手のターンの終わりまで」は、支配者のターンに作成されれば、続く相手のターンで終了する', () => {
      expect(durationEnds('次の相手のターンの終わりまで', 1, '先攻', recoveryOf(1, '先攻'))).toBe(false)
      expect(durationEnds('次の相手のターンの終わりまで', 1, '先攻', recoveryOf(2, '後攻'))).toBe(true)
    })

    it('相手のターンに作成されれば、そのターンではなく、次の相手のターンで終了する', () => {
      // 先攻が支配者で、後攻のターン（第 2 ターン）に作成された。
      expect(durationEnds('次の相手のターンの終わりまで', 2, '先攻', recoveryOf(2, '後攻'))).toBe(false)
      expect(durationEnds('次の相手のターンの終わりまで', 2, '先攻', recoveryOf(3, '先攻'))).toBe(false)
      expect(durationEnds('次の相手のターンの終わりまで', 2, '先攻', recoveryOf(4, '後攻'))).toBe(true)
    })

    it('期限が終了した、作成された誘発型能力は、リカバリーフェイズの始めに取り除かれる', () => {
      // 先攻が支配者で、第 1 ターンに作成された。第 2 ターン（後攻）のリカバリーフェイズで終了する。
      let current: DuelState = { ...stocked(), createdAbilities: [watcher('次の相手のターンの終わりまで', '先攻', 1)] }
      const remaining = new Map<number, number>()
      for (let steps = 0; steps < 200 && current.turn.number < 3; steps += 1) {
        if (current.turn.phase === 'リカバリーフェイズ') remaining.set(current.turn.number, current.createdAbilities.length)
        current = passPriority(current, chooseFirst)
      }

      expect(remaining.get(1)).toBe(1)
      expect(remaining.get(2)).toBe(0)
    })

    /** 盤面を進めながら、各ターンの指定したフェイズの始めに、作成された誘発型能力がいくつ残っているかを取得する。 */
    function remainingAt(start: DuelState, phase: DuelState['turn']['phase'], untilTurn: number): Map<number, number> {
      let current = start
      const remaining = new Map<number, number>()
      for (let steps = 0; steps < 400 && current.turn.number <= untilTurn; steps += 1) {
        if (current.turn.phase === phase && !remaining.has(current.turn.number)) {
          remaining.set(current.turn.number, current.createdAbilities.length)
        }
        current = passPriority(current, chooseFirst)
      }
      return remaining
    }

    it('期限の間（支配者の相手のターンのメインフェイズ）は、残っている', () => {
      const start: DuelState = { ...stocked(), createdAbilities: [watcher('次の相手のターンの終わりまで', '先攻', 1)] }

      expect(remainingAt(start, 'メインフェイズ', 2).get(2)).toBe(1)
    })

    it('相手のターンに作成された能力は、そのターンのリカバリーフェイズでは終了せず、次の相手のターンで終了する', () => {
      // 先攻が支配者で、後攻のターン（第 2 ターン）に作成された。
      const start: DuelState = { ...stocked(), createdAbilities: [watcher('次の相手のターンの終わりまで', '先攻', 2)] }
      const atTurn2 = ((): DuelState => {
        let current = start
        while (current.turn.number < 2) current = passPriority(current, chooseFirst)
        return current
      })()

      const remaining = remainingAt(atTurn2, 'リカバリーフェイズ', 4)

      expect(remaining.get(2)).toBe(1)
      expect(remaining.get(3)).toBe(1)
      expect(remaining.get(4)).toBe(0)
    })

    it('作成された継続効果も、同じ時点で終了する', () => {
      const effect = {
        target: 'ユニット',
        change: { kind: 'ＢＰの変更', amount: 1000 } as const,
        until: '次の相手のターンの終わりまで' as const,
        controller: '先攻' as const,
        createdIn: 1,
      }
      let current: DuelState = { ...stocked(), createdContinuousEffects: [effect] }
      const remaining = new Map<number, number>()
      for (let steps = 0; steps < 400 && current.turn.number < 3; steps += 1) {
        if (current.turn.phase === 'リカバリーフェイズ' && !remaining.has(current.turn.number)) {
          remaining.set(current.turn.number, current.createdContinuousEffects.length)
        }
        current = passPriority(current, chooseFirst)
      }

      expect(remaining.get(1)).toBe(1)
      expect(remaining.get(2)).toBe(0)
    })
  })

  describe('作成', () => {
    const makeWatcher = function* () {
      yield* createUntargetedTriggeredAbility(
        'あなたのカードがスマッシュゾーンに置かれた時',
        '1枚引く',
        function* () {},
        '次の相手のターンの終わりまで',
      )
    }

    it('作成すると、対象を持たず、作成されたターンを持つ能力が盤面に残る', () => {
      const state = stocked()

      const created = resolveEffect(state, makeWatcher, { controller: '先攻', via: '誘発', chooser: chooseFirst })

      expect(created.createdAbilities).toHaveLength(1)
      expect(created.createdAbilities[0]).toMatchObject({ controller: '先攻', affecting: undefined, createdIn: state.turn.number })
      expect(created.createdAbilities[0]?.ability).toMatchObject({ place: 'なし', duration: '次の相手のターンの終わりまで' })
    })

    it('作成の行は、いつ・何をするか・期限を持ち、対象のカードを持たない', () => {
      const created = resolveEffect(stocked(), makeWatcher, { controller: '先攻', via: '誘発', chooser: chooseFirst })

      const logged = created.log.flatMap(({ event }) => (event.kind === '命令を実行した' ? [event.instruction] : []))
      expect(logged).toEqual([
        {
          kind: '対象を持たない誘発型能力を作る',
          trigger: 'あなたのカードがスマッシュゾーンに置かれた時',
          description: '1枚引く',
          duration: '次の相手のターンの終わりまで',
        },
      ])
    })

    it('通信の盤面（射影）には含まれない', () => {
      const state: DuelState = { ...stocked(), createdAbilities: [watcher('次の相手のターンの終わりまで')] }

      expect(perspectiveOf(state, '先攻').createdAbilities).toEqual([])
      expect(perspectiveOf(state, '後攻').createdAbilities).toEqual([])
    })
  })

  describe('「してもよい」の聞き方', () => {
    function mainPhaseWith(strategy: ReturnType<typeof defineStrategy>): DuelState {
      let current = stocked()
      while (current.turn.phase !== 'メインフェイズ') current = passPriority(current, chooseFirst)
      current = passPriority(current, chooseFirst)
      return putInZone(current, '先攻', '手札', [instantiate({ id: 'ストラテジー', card: strategy, owner: '先攻' })])
    }

    const PLAY: LegalAction = { kind: 'カードをプレイする', declaration: { card: 'ストラテジー' } }

    function advanced(progress: ActionProgress): DuelState {
      if (progress.kind !== '進んだ') throw new Error(`進んだはずだった: ${progress.kind}`)
      return progress.state
    }

    const mayDrawOnly = defineStrategy({
      name: 'テスト・引いてもよい',
      level: 0,
      effect: function* () {
        yield* mayDo([], '1枚引く')
      },
    })

    it('対象が無い動きでも、聞く', () => {
      const asked = applyWithAnswers(mainPhaseWith(mayDrawOnly), PLAY, [])

      expect(asked.kind).toBe('選んでほしい')
    })

    it('「いいえ」なら、何も引かない。聞いた行だけが積まれる', () => {
      const start = mainPhaseWith(mayDrawOnly)

      const done = advanced(applyWithAnswers(start, PLAY, ['選ばない']))

      // プレイしたストラテジーが手札から出る分だけ減る。
      expect(handSize(done, '先攻')).toBe(handSize(start, '先攻') - 1)
      const kinds = done.log.flatMap(({ event }) => (event.kind === '命令を実行した' ? [event.instruction.kind] : []))
      expect(kinds).toEqual(['してもよいか聞く'])
    })

    it('「はい」なら、動きの命令が実行され、その行が積まれる', () => {
      const start = mainPhaseWith(mayDrawOnly)

      const done = advanced(applyWithAnswers(start, PLAY, [0]))

      // プレイしたストラテジーが手札から出る分（-1）と、引いた分（+1）。
      expect(handSize(done, '先攻')).toBe(handSize(start, '先攻'))
      const kinds = done.log.flatMap(({ event }) => (event.kind === '命令を実行した' ? [event.instruction.kind] : []))
      expect(kinds).toEqual(['してもよいか聞く', 'カードを引く'])
    })

    // 総合ルール 第1部 第1章 3。引く・山札の 1 番上を置くは、山札が空なら実行できないので、聞かない。
    it('山札が空なら、聞かずに「いいえ」として進む', () => {
      const start = putInZone(mainPhaseWith(mayDrawOnly), '先攻', '山札', [])

      const done = advanced(applyWithAnswers(start, PLAY, []))

      const kinds = done.log.flatMap(({ event }) => (event.kind === '命令を実行した' ? [event.instruction.kind] : []))
      expect(kinds).toEqual([])
    })

    it('山札の 1 番上をエネルギーゾーンにフリーズして置く動きは、「はい」で実行される', () => {
      const placing = defineStrategy({
        name: 'テスト・置いてもよい',
        level: 0,
        effect: function* () {
          yield* mayDo([], '山札の1番上のカードをエネルギーゾーンにフリーズして置く')
        },
      })
      const start = mainPhaseWith(placing)

      const done = advanced(applyWithAnswers(start, PLAY, [0]))

      const energy = cardsIn(done, '先攻', 'エネルギーゾーン')
      expect(energy).toHaveLength(cardsIn(start, '先攻', 'エネルギーゾーン').length + 1)
      expect(energy.at(-1)?.orientation).toBe('フリーズ')
    })
  })
})
