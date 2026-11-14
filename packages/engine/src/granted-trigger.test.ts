import { describe, expect, it } from 'vitest'
// 手札やエネルギーゾーンを組み立てるためだけに `putInZone` を使う。engine の中からゾーンを
// 差し替えるための関数であり、公開する API ではない（`battle.test.ts` と同じ）。
import { moveToZoneWithoutTriggers, putInZone } from './duel.js'
import { continuousData } from './continuous.js'
import {
  PLAYERS,
  abilityGranting,
  cardsOn,
  createContinuousEffect,
  damagePlayer,
  defineUnit,
  emptyDuelState,
  grantedTriggeredAbility,
  granting,
  instantiate,
  passPriority,
  perspectiveOf,
  triggeredAbility,
  putOnSquare,
  resolveEffect,
} from './index.js'
import type {
  CardId,
  Chooser,
  DuelState,
  Effect,
  GrantedTriggeredAbility,
  Player,
  ResolutionVia,
  Square,
  TriggerEvent,
  UnitCard,
} from './index.js'

// 総合ルール 第4部 第12章 5-2 の(2)、第3章 2（ADR-0071）。継続効果が与えた誘発型能力は、与えられた
// ユニットの能力として、書かれた能力と同じ経路で誘発する。カードはすべてテスト用の架空のもの。

const chooseFirst: Chooser = (candidates) => candidates[0]
const VIA: ResolutionVia = '誘発'

/** 与えられたユニットがバトルに勝つたびに、相手に 100 のダメージを与える能力。 */
const punishing: GrantedTriggeredAbility = grantedTriggeredAbility(
  'このカードがバトルに勝った時、相手に100ダメージを与える。',
  'バトルに勝った時',
  function* () {
    yield* damagePlayer('後攻', 100)
  },
)

/** バトルの中で起こる、与えられた能力が誘発する側のイベントを選んで作成する。 */
const grantedFor = (event: TriggerEvent): GrantedTriggeredAbility =>
  grantedTriggeredAbility(`テスト・${event}`, event as 'バトルの始め', function* () {})

const bigUnit = defineUnit({ name: 'テスト・大ＢＰ', level: 1, colors: ['赤'], bp: 5000, sp: 1000 })
const smallUnit = defineUnit({ name: 'テスト・小ＢＰ', level: 1, colors: ['赤'], bp: 1000, sp: 1000 })

const homeSquare: Square = { row: 0, column: 1 }
const otherSquare: Square = { row: 0, column: 2 }

const unit = (id: CardId, card: UnitCard, owner: Player): ReturnType<typeof instantiate> =>
  instantiate({ id, card, owner })

/** 山札を積んだ、カードの置かれていない盤面。山札が尽きると負けるので、優先権を動かす前に積む。 */
function stocked(): DuelState {
  return PLAYERS.reduce(
    (state, player) =>
      putInZone(
        state,
        player,
        '山札',
        Array.from({ length: 10 }, (_, index) => unit(`${player}の山札${index}`, bigUnit, player)),
      ),
    emptyDuelState(),
  )
}

/** 味方全員に、ターンの終わりまで、その能力を与える効果。 */
const grantToAllies = (ability: GrantedTriggeredAbility): Effect =>
  function* (duel) {
    yield* createContinuousEffect('ターンの終わりまで', ...duel.allies().map((ally) => granting(ally, ability)))
  }

const resolved = (state: DuelState, effect: Effect): DuelState =>
  resolveEffect(state, effect, { controller: '先攻', via: VIA, chooser: chooseFirst })

/** 先攻の `守る側` が、能力を与えられたうえで、後攻の `攻める側` に攻撃される盤面。 */
function guarded(ability: GrantedTriggeredAbility, attacker: UnitCard = smallUnit): DuelState {
  const withGuard = putOnSquare(stocked(), homeSquare, unit('守る側', bigUnit, '先攻'))
  return putOnSquare(resolved(withGuard, grantToAllies(ability)), homeSquare, unit('攻める側', attacker, '後攻'))
}

/** バトルが終わり、誘発した能力がすべて解決されるまで、優先権を放棄し続ける。 */
function settled(state: DuelState): DuelState {
  let current = state
  for (let step = 0; step < 60; step += 1) {
    current = passPriority(current, chooseFirst)
    if (current.battles.length === 0 && current.bank.length === 0 && current.triggered.length === 0) break
  }
  return current
}

/** 先攻から相手に与えられたダメージ。`punishing` は 1 回につき 100 を与える。 */
const damageToOpponent = (state: DuelState): number => state.damage['後攻']

describe('与えられた誘発型能力が誘発する', () => {
  it('与えられたユニットがバトルに勝つと、効果が解決される', () => {
    expect(damageToOpponent(settled(guarded(punishing)))).toBe(100)
  })

  it('与えられていなければ、同じバトルに勝っても何も起こらない', () => {
    const board = putOnSquare(stocked(), homeSquare, unit('守る側', bigUnit, '先攻'))
    const state = settled(putOnSquare(board, homeSquare, unit('攻める側', smallUnit, '後攻')))

    expect(damageToOpponent(state)).toBe(0)
  })

  it('同じターンに 2 回勝てば、2 回誘発する', () => {
    const first = settled(guarded(punishing))
    const second = settled(putOnSquare(first, homeSquare, unit('次の攻める側', smallUnit, '後攻')))

    expect(damageToOpponent(second)).toBe(200)
  })

  it('敵がバトルに勝っても、誘発しない', () => {
    const strongEnemy = defineUnit({ name: 'テスト・敵', level: 1, colors: ['赤'], bp: 9000, sp: 1000 })
    const weakGuard = defineUnit({ name: 'テスト・弱い守り手', level: 1, colors: ['赤'], bp: 1000, sp: 1000 })
    const board = putOnSquare(stocked(), homeSquare, unit('守る側', weakGuard, '先攻'))
    const granted = resolved(board, grantToAllies(punishing))
    const state = settled(putOnSquare(granted, homeSquare, unit('攻める側', strongEnemy, '後攻')))

    // 敵が勝った。守る側は捨札に置かれている。
    expect(cardsOn(state, homeSquare).map((each) => each.id)).toEqual(['攻める側'])
    expect(damageToOpponent(state)).toBe(0)
    expect(state.damage['先攻']).toBe(0)
  })

  it('解決した後にスクエアに置かれたユニットは、与えられていない', () => {
    const granted = resolved(putOnSquare(stocked(), homeSquare, unit('守る側', bigUnit, '先攻')), grantToAllies(punishing))
    const later = putOnSquare(granted, otherSquare, unit('後から置かれた味方', bigUnit, '先攻'))

    expect(continuousData(later)('守る側', bigUnit).abilities).toContain(punishing)
    expect(continuousData(later)('後から置かれた味方', bigUnit).abilities).not.toContain(punishing)
    // 書かれたカードは変更されない。
    expect(bigUnit.abilities).not.toContain(punishing)
  })

  it('ターンが終わると、与えられた能力は無くなり、誘発しない', () => {
    let state = guarded(punishing, defineUnit({ name: 'テスト・まだ来ない', level: 1, colors: ['赤'], bp: 1, sp: 1 }))
    // 攻めてくるユニットを、ターンが終わった後に置く。まず敵を取り除いて、期限が来るまで進める。
    state = moveToZoneWithoutTriggers(state, '攻める側', '捨札')
    while (state.turn.number === 1) state = passPriority(state, chooseFirst)

    expect(state.createdContinuousEffects).toEqual([])
    expect(continuousData(state)('守る側', bigUnit).abilities).not.toContain(punishing)

    const later = settled(putOnSquare(state, homeSquare, unit('次のターンの敵', smallUnit, '後攻')))
    // 守る側がバトルに勝った。能力は無いので、ダメージを与えない。
    expect(cardsOn(later, homeSquare).map((each) => each.id)).toEqual(['守る側'])
    expect(damageToOpponent(later)).toBe(0)
  })

  it('スクエアを離れて出し直されたユニットは、与えられていない', () => {
    const granted = guarded(punishing)
    const left = moveToZoneWithoutTriggers(granted, '守る側', '手札')
    const returned = putOnSquare(left, otherSquare, unit('守る側', bigUnit, '先攻'))

    expect(continuousData(returned)('守る側', bigUnit).abilities).not.toContain(punishing)
  })

  // 「バトルに勝った時」に限らず、誘発イベントごとに同じ経路で誘発する。
  it.each<TriggerEvent>(['バトルの始め', '攻撃された時', '第１バトルステップの始め'])(
    '「%s」の能力を与えても、そのイベントで誘発する',
    (event) => {
      let state = passPriority(guarded(grantedFor(event)), chooseFirst)
      // 優先権を獲得する時にバンクへ入る。入ったところで止めて、ソースを参照する。
      const seen: (string | undefined)[] = []
      for (let step = 0; step < 20 && seen.length === 0; step += 1) {
        seen.push(
          ...state.bank.flatMap((each) =>
            each.ability.kind === '誘発型能力' && each.ability.event === event ? [each.source] : [],
          ),
        )
        state = passPriority(state, chooseFirst)
      }

      expect(seen).toEqual(['守る側'])
    },
  )

  // Issue #394。与えられた「気合」で、「あなたの「気合」が誘発した時」の能力が誘発する。
  it('与えられた「気合」が誘発すると、味方の「あなたの「気合」が誘発した時」の能力も誘発する', () => {
    const grantedSpirit: GrantedTriggeredAbility = {
      ...grantedTriggeredAbility('テスト・気合', 'バトルの始め', function* () {}),
      keyword: '気合',
    }
    const watcher = defineUnit({
      name: 'テスト・気合を見張る味方',
      level: 1,
      colors: ['赤'],
      bp: 1000,
      sp: 1000,
      abilities: [triggeredAbility('あなたの「気合」が誘発した時', function* () {})],
    })
    const board = putOnSquare(stocked(), otherSquare, unit('見張る味方', watcher, '先攻'))
    const state = putOnSquare(
      resolved(putOnSquare(board, homeSquare, unit('守る側', bigUnit, '先攻')), grantToAllies(grantedSpirit)),
      homeSquare,
      unit('攻める側', smallUnit, '後攻'),
    )
    // 優先権を獲得する時にバンクへ入る。入った能力のうち、与えられた気合と、それに反応する能力を探す。
    let current = passPriority(state, chooseFirst)
    const events = new Set<string>()
    for (let step = 0; step < 20; step += 1) {
      for (const each of current.bank) {
        if (each.ability.kind === '誘発型能力') events.add(`${each.source}／${each.ability.event}`)
      }
      current = passPriority(current, chooseFirst)
    }

    expect(events.has('守る側／バトルの始め')).toBe(true)
    expect(events.has('見張る味方／あなたの「気合」が誘発した時')).toBe(true)
  })

  // 「このカードが捨札に置かれた時」は、書かれた能力ではなく置かれるカード自身の能力から探す別の経路を通る（ADR-0059）。
  it('「このカードが捨札に置かれた時」の能力を与えても、置かれた時に誘発する', () => {
    const whenDiscarded = grantedTriggeredAbility('このカードが捨札に置かれた時、相手に100ダメージを与える。', 'このカードが捨札に置かれた時', function* () {
      yield* damagePlayer('後攻', 100)
    })
    // 守る側が負けて、捨札に置かれる。
    const board = putOnSquare(stocked(), homeSquare, unit('守る側', smallUnit, '先攻'))
    const granted = resolved(board, grantToAllies(whenDiscarded))
    const state = settled(putOnSquare(granted, homeSquare, unit('攻める側', bigUnit, '後攻')))

    expect(cardsOn(state, homeSquare).map((each) => each.id)).toEqual(['攻める側'])
    expect(damageToOpponent(state)).toBe(100)
  })

  // Issue #394。誘発した後に、そのユニットがスクエアを離れても、バンクに入った能力は解決される。
  it('誘発した後に、与えられたユニットがスクエアを離れても、バンクの能力は解決される', () => {
    let state = guarded(punishing)
    // バトルに勝って、「バトルに勝った時」の能力がバンクに入るまで進める。
    for (let step = 0; step < 60 && !state.bank.some((each) => each.source === '守る側'); step += 1) {
      state = passPriority(state, chooseFirst)
    }
    expect(state.bank.some((each) => each.source === '守る側')).toBe(true)

    const left = moveToZoneWithoutTriggers(state, '守る側', '捨札')

    expect(damageToOpponent(settled(left))).toBe(100)
  })

  // ADR-0070。能力を与える常在型能力が返す値は、作成された継続効果と同じ `granting` である。
  it('能力を与える常在型能力から与えられても、誘発する', () => {
    const granter = defineUnit({
      name: 'テスト・誘発型能力を与えるユニット',
      level: 1,
      colors: ['赤'],
      bp: 5000,
      sp: 1000,
      abilities: [abilityGranting((duel) => duel.allies().map((ally) => granting(ally, punishing)))],
    })
    const board = putOnSquare(stocked(), homeSquare, unit('守る側', granter, '先攻'))
    const state = settled(putOnSquare(board, homeSquare, unit('攻める側', smallUnit, '後攻')))

    expect(damageToOpponent(state)).toBe(100)
    expect(cardsOn(state, homeSquare).map((each) => each.id)).toEqual(['守る側'])
  })
})

describe('与えられた誘発型能力の表示用の文', () => {
  it('ログには、能力そのものではなく表示のための文が含まれる', () => {
    const state = guarded(punishing)
    const instructions = state.log.flatMap((recorded) =>
      recorded.event.kind === '命令を実行した' ? [recorded.event.instruction] : [],
    )

    expect(instructions).toContainEqual(
      expect.objectContaining({
        kind: '継続効果を作成する',
        card: '守る側',
        change: { kind: '誘発型能力の付与', description: 'このカードがバトルに勝った時、相手に100ダメージを与える。' },
      }),
    )
    // 通信に含まれる形なので、関数を含まない。
    expect(JSON.parse(JSON.stringify(instructions))).toEqual(instructions)
  })
})

describe('与えられた誘発型能力を、視点のデータが運ぶ', () => {
  it('与えられたユニットの分だけ、表示のための文と期限が含まれる。能力そのものは含まれない', () => {
    const projected = perspectiveOf(guarded(punishing), '後攻')
    const guard = projected.effective.find((each) => each.card === '守る側')
    const enemy = projected.effective.find((each) => each.card === '攻める側')

    expect(guard?.grantedAbilities).toEqual([
      { text: 'このカードがバトルに勝った時、相手に100ダメージを与える。', until: 'ターンの終わりまで' },
    ])
    expect(enemy).not.toHaveProperty('grantedAbilities')
    // 2 人に同じ内容が届き、JSON を通る。
    expect(perspectiveOf(guarded(punishing), '先攻').effective).toEqual(projected.effective)
    expect(JSON.parse(JSON.stringify(projected.effective))).toEqual(projected.effective)
  })

  it('常在型能力が与えた分は、期限を持たない', () => {
    const granter = defineUnit({
      name: 'テスト・誘発型能力を与えるユニット',
      level: 1,
      colors: ['赤'],
      bp: 5000,
      sp: 1000,
      abilities: [abilityGranting((duel) => duel.allies().map((ally) => granting(ally, punishing)))],
    })
    const board = putOnSquare(stocked(), homeSquare, unit('与える側', granter, '先攻'))

    expect(perspectiveOf(board, '先攻').effective[0]?.grantedAbilities).toEqual([
      { text: 'このカードがバトルに勝った時、相手に100ダメージを与える。' },
    ])
  })
})
