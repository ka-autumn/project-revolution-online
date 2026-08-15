import { describe, expect, it } from 'vitest'
// ゾーンを組み立てるためだけに `putInZone` を使う。engine の中からゾーンを差し替えるための
// 関数であり、公開する API ではない（`smash.test.ts` と同じ）。
import { putInZone } from './duel.js'
import {
  defineStrategy,
  defineUnit,
  emptyDuelState,
  fromWire,
  instantiate,
  perspectiveOf,
  putOnSquare,
  toWire,
} from './index.js'
import type {
  Card,
  CardLookup,
  CardNaming,
  DuelState,
  Player,
  PlayerZone,
  UnitOnSquare,
  WirePerspective,
} from './index.js'

/**
 * カードの実装を持っている側の代わり。番号で引けるようにしてある（ADR-0002）。
 *
 * engine は番号の付け方を知らないので、テストの側がこれを渡す。実際にはカードを実装している
 * パッケージが同じことを行う。
 */
const CARDS = {
  'TEST-01': defineUnit({ name: 'テスト・スクエアのユニット', level: 1, colors: ['赤'], bp: 1000, sp: 1000 }),
  'TEST-02': defineUnit({ name: 'テスト・見えているカード', level: 1, colors: ['白'], bp: 2000, sp: 500 }),
  'TEST-03': defineUnit({ name: 'テスト・隠されるカード', level: 2, colors: ['黒'], bp: 3000, sp: 1500 }),
  'TEST-04': defineStrategy({ name: 'テスト・ユニットではないカード', level: 1, colors: ['赤'] }),
} as const satisfies Readonly<Record<string, Card>>

const numberOf: CardNaming = (card) => {
  const found = Object.entries(CARDS).find(([, each]) => each === card)
  if (found === undefined) throw new Error(`番号を知らないカード: ${card.name}`)

  return found[0]
}

const cardOf: CardLookup = (number) => {
  const found = (CARDS as Readonly<Record<string, Card>>)[number]
  if (found === undefined) throw new Error(`知らない番号: ${number}`)

  return found
}

/** カード 1 枚を、そのプレイヤーのそのゾーンに置く。 */
function place(state: DuelState, owner: Player, zone: PlayerZone, id: string, card: Card): DuelState {
  return putInZone(state, owner, zone, [...state.zones[owner][zone], instantiate({ id, card, owner })])
}

/**
 * 見えているカードと見えていないカードが両方ある盤面。
 *
 * 「隠されるカード」は後攻の手札と山札にだけ置く。先攻から見て、通信のどこにも現れては
 * ならないカードである。
 */
function filledState(): DuelState {
  const placements: readonly (readonly [Player, PlayerZone, string, Card])[] = [
    ['先攻', '手札', '先攻-手札', CARDS['TEST-02']],
    ['先攻', '捨札', '先攻-捨札', CARDS['TEST-02']],
    ['先攻', '山札', '先攻-山札', CARDS['TEST-02']],
    ['後攻', 'エネルギーゾーン', '後攻-エネルギー', CARDS['TEST-02']],
    ['後攻', '手札', '後攻-手札', CARDS['TEST-03']],
    ['後攻', '山札', '後攻-山札', CARDS['TEST-03']],
  ]
  const withZones = placements.reduce(
    (state, [owner, zone, id, card]) => place(state, owner, zone, id, card),
    emptyDuelState(),
  )

  return putOnSquare(
    withZones,
    { row: 1, column: 1 },
    instantiate({ id: '先攻-スクエア', card: CARDS['TEST-01'], owner: '先攻' }),
  )
}

const 先攻から = perspectiveOf(filledState(), '先攻')
const wire = toWire(先攻から, numberOf)

// ADR-0004。サーバがクライアントへ送る形。
describe('通信に載せる形', () => {
  /**
   * JSON にできることが、この型の存在意義そのものである。
   *
   * `DuelPerspective` には `Card` が残っていて、カードは効果を関数として持つ。関数は
   * `JSON.stringify` で黙って落ちるので、送れないものが混ざっていても気づけない。ここでは
   * 往復して同じになることで、落ちたものが無いことを見る。
   */
  it('JSON にして戻しても変わらない', () => {
    expect(JSON.parse(JSON.stringify(wire))).toEqual(wire)
  })

  it('カードは番号で載る', () => {
    const square = wire.squares.flat()[0]

    expect(square?.card).toBe('TEST-01')
  })

  /**
   * 往復すると元の射影に戻る。
   *
   * 番号からカードを引き直すのは受け取った側なので、同じカードの実装を持っている限り、
   * サーバとクライアントは同じ盤面を見る（ADR-0004）。
   */
  it('往復すると元の射影に戻る', () => {
    expect(fromWire(wire, cardOf)).toEqual(先攻から)
  })

  it('見えていないカードは、番号も持たないまま往復する', () => {
    expect(wire.zones.後攻.手札[0]).toEqual({ kind: '見えていない', orientation: 'リリース' })
  })
})

// #13 の完了条件。通信内容を見ても相手の非公開情報が復元できない。
describe('通信内容に現れないもの', () => {
  const sent = JSON.stringify(wire)

  // 下の「現れない」が、元々どこにも現れないことで通っていないことを見る。
  it('見えているカードの番号は現れる', () => {
    expect(sent).toContain('TEST-02')
  })

  it.each([
    ['番号', 'TEST-03'],
    ['カード名', 'テスト・隠されるカード'],
    ['識別子', '後攻-手札'],
  ])('相手の手札と山札にしかないカードの%sは現れない', (_, leaked) => {
    expect(sent).not.toContain(leaked)
  })
})

describe('壊れた通信', () => {
  it('知らない番号が来たら止まる', () => {
    const broken = JSON.parse(JSON.stringify(wire).replace('TEST-01', 'TEST-99')) as WirePerspective

    expect(() => fromWire(broken, cardOf)).toThrow('知らない番号')
  })

  // `UnitOnSquare` はユニットしか持てない（総合ルール 第4部 第14章 4-3）。
  it('ユニットのはずのところにユニットでないカードの番号が来たら止まる', () => {
    const state = filledState()
    const invader: UnitOnSquare = {
      id: '先攻-スクエア',
      square: { row: 1, column: 1 },
      card: CARDS['TEST-01'],
      controller: '先攻',
    }
    const met: DuelState = {
      ...state,
      trapConditionsMet: [{ trap: '先攻-手札', occasion: { kind: '侵入', invader } }],
    }
    // 先攻のトラップゾーンには何も無いので、権利は射影に残らない。トラップゾーンに置いてから写す。
    const withTrap = place(met, '先攻', 'トラップゾーン', '先攻-手札', CARDS['TEST-02'])
    const sent = toWire(perspectiveOf(withTrap, '先攻'), numberOf)
    const [only] = sent.trapConditionsMet
    if (only === undefined) throw new Error('発動条件が満たされたトラップが残ったはずだった')
    const invaderInWire = { ...only.occasion.invader, card: 'TEST-04' }
    const broken: WirePerspective = {
      ...sent,
      trapConditionsMet: [{ ...only, occasion: { ...only.occasion, invader: invaderInWire } }],
    }

    expect(() => fromWire(broken, cardOf)).toThrow('ユニットのはずだった')
  })
})
