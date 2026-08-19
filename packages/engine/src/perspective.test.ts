import { describe, expect, it } from 'vitest'
// ゾーンを組み立てるためだけに `putInZone` を使う。engine の中からゾーンを差し替えるための
// 関数であり、公開する API ではない（`smash.test.ts` と同じ）。
import { putInZone } from './duel.js'
import {
  alsoTreatedAs,
  attributeAdding,
  bpModifying,
  bpPlus,
  defineUnit,
  emptyDuelState,
  instantiate,
  perspectiveOf,
  putOnSquare,
  triggeredAbility,
} from './index.js'
import type { DuelPerspective, DuelState, Player, PlayerZone, Square, UnitOnSquare, VisibleCard } from './index.js'

// 検証したいのは「どのゾーンにあるか」だけなので、カードは名前しか違わない架空のもので足りる
// （ADR-0002）。名前を全部違えているのは、射影のどこに現れたかを名前で追えるようにするため。
function testCard(name: string) {
  return defineUnit({ name: `テスト・${name}`, level: 1, colors: ['赤'], bp: 1000, sp: 1000 })
}

/** カード 1 枚を、そのプレイヤーのそのゾーンに置く。識別子は持ち主とゾーンから作る。 */
function place(state: DuelState, owner: Player, zone: PlayerZone, name: string): DuelState {
  const card = instantiate({ id: `${owner}-${name}`, card: testCard(name), owner })
  return putInZone(state, owner, zone, [...state.zones[owner][zone], card])
}

/** スクエアに置いたユニット。侵入のきっかけを組み立てるのに使う。 */
const INVADED: Square = { row: 1, column: 1 }
const INVADER: UnitOnSquare = {
  id: '先攻-スクエア',
  square: INVADED,
  card: testCard('スクエア'),
  controller: '先攻',
}

/**
 * どのゾーンにも 1 枚ずつカードがある盤面。
 *
 * 見え方はゾーン・持ち主・視点の 3 つで決まるので、両方のプレイヤーのすべてのゾーンを
 * 埋めておいて、1 つの盤面から両方の視点を取れるようにする。
 */
function filledState(): DuelState {
  const zones: readonly PlayerZone[] = [
    '山札',
    'プランゾーン',
    '手札',
    '捨札',
    'エネルギーゾーン',
    'スマッシュゾーン',
    'トラップゾーン',
    'リムーブゾーン',
  ]
  const withZones = (['先攻', '後攻'] as const).reduce(
    (state, owner) => zones.reduce((each, zone) => place(each, owner, zone, `${owner}の${zone}`), state),
    emptyDuelState(),
  )
  return putOnSquare(withZones, INVADED, instantiate({ id: INVADER.id, card: INVADER.card, owner: '先攻' }))
}

/** その視点から見た、そのプレイヤーのそのゾーンの 1 枚目。 */
function seen(perspective: DuelPerspective, owner: Player, zone: PlayerZone): VisibleCard | undefined {
  return perspective.zones[owner][zone][0]
}

/** 射影に文字列として現れるものすべて。カードの効果は関数なので落ちるが、名前と識別子は残る。 */
function everythingSent(perspective: DuelPerspective): string {
  return JSON.stringify(perspective)
}

// 総合ルール 第2部 第23章 1-1・2-1（公開情報と非公開情報）。ADR-0004。
describe('視点ごとの盤面の射影', () => {
  const state = filledState()
  const 先攻から = perspectiveOf(state, '先攻')

  // 総合ルール 第2部 第21章 2-2。持ち主であっても山札の中身を見てはならない。
  it('山札は、自分のものであっても見えない', () => {
    expect(seen(先攻から, '先攻', '山札')?.kind).toBe('見えていない')
    expect(seen(先攻から, '後攻', '山札')?.kind).toBe('見えていない')
  })

  // 総合ルール 第2部 第21章 4-3。相手の手札は見られないが、枚数はいつでも数えられる。
  it('手札は自分のものだけが見え、相手のものは枚数だけが残る', () => {
    expect(seen(先攻から, '先攻', '手札')?.kind).toBe('見えている')
    expect(seen(先攻から, '後攻', '手札')?.kind).toBe('見えていない')
    expect(先攻から.zones.後攻.手札).toHaveLength(state.zones.後攻.手札.length)
  })

  // 総合ルール 第2部 第21章 9-3。自分のトラップの表側はいつでも見られる。
  it('トラップゾーンは自分のものだけが見える', () => {
    expect(seen(先攻から, '先攻', 'トラップゾーン')?.kind).toBe('見えている')
    expect(seen(先攻から, '後攻', 'トラップゾーン')?.kind).toBe('見えていない')
  })

  // 総合ルール 第2部 第21章 7-3。どちらのスマッシュゾーンであっても裏向きのカードは見られない。
  it('スマッシュゾーンは、自分のものであっても見えない', () => {
    expect(seen(先攻から, '先攻', 'スマッシュゾーン')?.kind).toBe('見えていない')
    expect(seen(先攻から, '後攻', 'スマッシュゾーン')?.kind).toBe('見えていない')
  })

  // 総合ルール 第3部 第19章 1。希望ステップの間だけ表向きに置かれる 1 枚は、両方から見える。
  it('希望ステップで表向きに置かれたスマッシュは、両方の視点から見える', () => {
    const faceUp = state.zones.後攻.スマッシュゾーン[0]
    if (faceUp === undefined) throw new Error('スマッシュゾーンにカードを置いたはずだった')
    const judging: DuelState = {
      ...state,
      smashJudgments: [{ player: '後攻', step: '希望ステップ', repeats: 1, round: 1, faceUp: faceUp.id }],
    }

    expect(seen(perspectiveOf(judging, '先攻'), '後攻', 'スマッシュゾーン')?.kind).toBe('見えている')
    expect(seen(perspectiveOf(judging, '後攻'), '後攻', 'スマッシュゾーン')?.kind).toBe('見えている')
  })

  // 総合ルール 第2部 第21章 3-1（プラン）・5-2（捨札）・6-3（エネルギー）・10-2（リムーブ）。
  it.each(['プランゾーン', '捨札', 'エネルギーゾーン', 'リムーブゾーン'] as const)(
    '%s は、どちらのものでも見える',
    (zone) => {
      expect(seen(先攻から, '先攻', zone)?.kind).toBe('見えている')
      expect(seen(先攻から, '後攻', zone)?.kind).toBe('見えている')
    },
  )

  // 総合ルール 第2部 第23章 1-1。スクエアにあるカードは公開情報である。
  it('スクエアにあるカードはそのまま残る', () => {
    expect(先攻から.squares).toEqual(state.squares)
  })

  it('視点のプレイヤーを持つ', () => {
    expect(先攻から.viewer).toBe('先攻')
  })
})

// 効果は関数なので通信に載らない（ADR-0004、`VisibleAbility`）。
describe('解決を待っている能力', () => {
  /** 「登場した時」に何もしない誘発型能力。効果が落ちることだけを見るので中身は要らない。 */
  const ability = triggeredAbility('登場した時', function* () {})

  it('バンクにある能力は、支配者と発生源だけになる', () => {
    const state: DuelState = {
      ...filledState(),
      bank: [{ ability, source: INVADER.id, controller: '先攻', self: INVADER }],
    }

    expect(perspectiveOf(state, '先攻').bank).toEqual([{ controller: '先攻', source: INVADER.id }])
  })

  // 作成された誘発型能力は、効果が実行中に作ったものでカードを指す名前を持たない
  // （`duel.ts` の `CreatedAbilityInstance`）。
  it('作成された誘発型能力は、発生源を持たないまま渡る', () => {
    const created = { kind: '作成された誘発型能力', trigger: 'あなたのターンの終わり', effect: function* () {} } as const
    const state: DuelState = {
      ...filledState(),
      triggered: [{ ability: created, controller: '後攻', affected: INVADER }],
    }

    expect(perspectiveOf(state, '先攻').triggered).toEqual([{ controller: '後攻', source: undefined }])
  })

  // 総合ルール 第3部 第11章 2。バトル中は、それまでのバンクが待機中になる。
  it('バトルの待機中のバンクも同じ形になる', () => {
    const state: DuelState = {
      ...filledState(),
      battle: {
        square: INVADED,
        attacker: INVADER.id,
        attacked: INVADER.id,
        step: '第１バトルステップ',
        dealtDamage: [],
        endOfBattleTriggered: false,
        result: undefined,
        heldBank: [{ ability, source: INVADER.id, controller: '先攻', self: INVADER }],
        heldTriggered: [],
      },
    }

    expect(perspectiveOf(state, '先攻').battle?.heldBank).toEqual([{ controller: '先攻', source: INVADER.id }])
  })
})

// #13 の完了条件。通信内容を見ても相手の非公開情報が復元できない。
describe('射影が渡さないもの', () => {
  const 先攻から = perspectiveOf(filledState(), '先攻')
  const sent = everythingSent(先攻から)

  // 下の「現れない」が、名前が元々どこにも現れないことで通っていないことを見る。見えている
  // カードの名前は現れる。
  it('見えているカードの名前は現れる', () => {
    expect(sent).toContain('先攻の手札')
    expect(sent).toContain('後攻の捨札')
  })

  it.each([
    ['後攻の手札', '後攻の手札'],
    ['後攻のトラップゾーン', '後攻のトラップゾーン'],
    ['後攻の山札', '後攻の山札'],
    ['自分の山札', '先攻の山札'],
    ['自分のスマッシュゾーン', '先攻のスマッシュゾーン'],
  ])('%s のカード名は現れない', (_, name) => {
    expect(sent).not.toContain(name)
  })

  /**
   * 識別子も渡さない。
   *
   * 識別子はシャッフル前のデッキでの番号から作られている（`setup.ts` の `library`）ため、自分の
   * デッキの並びを知っているプレイヤーには、識別子がそのままカードの正体になる。ここでは
   * 識別子にカード名を使っているので、上のテストが名前を見ていることでこれも見ている。
   * 見えていないカードが `instance` を持たないことを、型ではなく値でも確かめておく。
   */
  it('見えていないカードは、カードそのものを持たない', () => {
    const hidden = 先攻から.zones.後攻.手札[0]

    expect(hidden).toEqual({ kind: '見えていない', orientation: 'リリース' })
  })

  // 相手のトラップの発動する権利は、視点のプレイヤーが行える行動を左右しない。裏向きの
  // トラップを名指しするので、渡せばそれだけでどのカードかの手がかりになる。
  it('相手のトラップの発動条件が満たされていることは渡さない', () => {
    const state = filledState()
    const trap = state.zones.後攻.トラップゾーン[0]
    if (trap === undefined) throw new Error('トラップを置いたはずだった')
    const met: DuelState = {
      ...state,
      trapConditionsMet: [{ trap: trap.id, occasion: { kind: '侵入', invader: INVADER } }],
    }

    expect(perspectiveOf(met, '先攻').trapConditionsMet).toEqual([])
    expect(perspectiveOf(met, '後攻').trapConditionsMet).toHaveLength(1)
  })

  // 「勇気」の起動条件は、満たした手札のカードを名指しする（`duel.ts` の `CourageConditionMet`）。
  it('相手の「勇気」の起動条件が満たされていることは渡さない', () => {
    const state = filledState()
    const courage = state.zones.後攻.手札[0]
    if (courage === undefined) throw new Error('手札にカードを置いたはずだった')
    const met: DuelState = {
      ...state,
      courageConditionsMet: [{ player: '後攻', satisfied: [courage.id], placed: INVADER }],
    }

    expect(perspectiveOf(met, '先攻').courageConditionsMet).toEqual([])
    expect(perspectiveOf(met, '後攻').courageConditionsMet).toHaveLength(1)
  })
})

/**
 * #91。継続効果を適用した後のデータ（総合ルール 第4部 第12章 2）を、盤面と一緒に送る。
 *
 * 盤面（`DuelState`）が持つのはカードに書かれているデータ（同 第2部 第2章 2）で、修整は
 * 書き込まれていない。修整を集められるのは完全な盤面を持つ射影の側だけである。
 */
describe('継続効果を適用した後のデータ', () => {
  /** 「すべての味方のＢＰを＋2000」を持つユニット。自分自身も味方に含まれる。 */
  const boosting = defineUnit({
    name: 'テスト・味方強化',
    level: 1,
    colors: ['赤'],
    bp: 1000,
    sp: 1000,
    abilities: [bpModifying((duel) => duel.allies().map((ally) => bpPlus(ally, 2000)))],
  })

  /** 「すべての味方に「テスト属性」を加える」ユニット。 */
  const granting = defineUnit({
    name: 'テスト・属性付与',
    level: 1,
    colors: ['赤'],
    bp: 1000,
    sp: 1000,
    abilities: [attributeAdding((duel) => duel.allies().map((ally) => alsoTreatedAs(ally, 'テスト属性')))],
  })

  /** 修整を生む側と、受ける側が、どちらもスクエアにいる盤面。 */
  function withModifier(source: ReturnType<typeof defineUnit>): DuelState {
    const placed = putOnSquare(
      emptyDuelState(),
      { row: 0, column: 0 },
      instantiate({ id: '発生源', card: source, owner: '先攻' }),
    )
    return putOnSquare(placed, { row: 0, column: 1 }, instantiate({ id: '受ける側', card: testCard('受ける側'), owner: '先攻' }))
  }

  function effectiveOf(perspective: DuelPerspective, card: string) {
    return perspective.effective.find((each) => each.card === card)
  }

  it('修整を適用した後のＢＰが載る', () => {
    const perspective = perspectiveOf(withModifier(boosting), '先攻')

    expect(effectiveOf(perspective, '受ける側')?.bp).toBe(3000)
  })

  /** 加わった属性も、書かれている属性と一緒に載る（総合ルール 第4部 第12章 5-2 の(3)）。 */
  it('加わった属性が載る', () => {
    const perspective = perspectiveOf(withModifier(granting), '先攻')

    expect(effectiveOf(perspective, '受ける側')?.attributes).toEqual(['テスト属性'])
  })

  /** スクエアにあるカードは公開情報である（総合ルール 第2部 第23章 1-1）。 */
  it('相手にも同じものが届く', () => {
    const state = withModifier(boosting)

    expect(perspectiveOf(state, '後攻').effective).toEqual(perspectiveOf(state, '先攻').effective)
  })

  /** 継続効果がデータを変えるのはスクエアにいるユニットである（`view.ts` の `unitsOnSquares`）。 */
  it('スクエアにいないカードは載らない', () => {
    const perspective = perspectiveOf(filledState(), '先攻')

    expect(perspective.effective.map((each) => each.card)).toEqual([INVADER.id])
  })

  /** 修整を受けていないユニットも、書かれているとおりの値で載る。読む側で場合分けが要らない。 */
  it('修整を受けていなくても、そのユニットの分は載る', () => {
    const perspective = perspectiveOf(filledState(), '先攻')

    expect(perspective.effective[0]).toEqual({ card: INVADER.id, bp: 1000, attributes: [] })
  })
})
