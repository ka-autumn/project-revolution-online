import type { MoveDirection, Square } from './board.js'
import type { Attribute, Card, CardType, Color, UnitCard } from './card.js'
import type { CardId, CardInstance, DuelResult } from './duel.js'
import type { UnitOnSquare } from './effect.js'
import type { DuelEvent } from './log.js'
import type { Orientation } from './orientation.js'
import type {
  DuelPerspective,
  EffectiveUnitData,
  VisibleAbility,
  VisibleBattle,
  VisibleCard,
  VisibleCreatedAbility,
} from './perspective.js'
import { PLAYERS } from './player.js'
import type { Player } from './player.js'
import type { SmashJudgment } from './smash.js'
import type { Turn } from './turn.js'
import { PLAYER_ZONES } from './zone.js'
import type { PlayerZone } from './zone.js'

/**
 * どの種別のカードにも書かれていることのうち、通信に載せる分（総合ルール 第2部 第2章 1）。
 *
 * 載せるのは**カードに印刷されている値そのもの**であって、継続効果を適用した後の姿ではない。
 * 修整を適用するのは `view.ts` の仕事で、それには完全な盤面が要る。修整を適用した後のＢＰと
 * 属性は、カードの表記とは別の項目として盤面の側に載っている（`WirePerspective.effective`、#91）。
 */
interface WireWrittenCard {
  readonly name: string
  readonly level: number
  readonly colors: readonly Color[]
  readonly stars: number
  readonly reverseStars: number
  readonly attributes: readonly Attribute[]
}

/** 通信に載せる `UnitCard` の表記。 */
export interface WireUnitFace extends WireWrittenCard {
  readonly type: 'ユニット'
  readonly bp: number
  readonly sp: number
  readonly moveIcon: readonly MoveDirection[]
}

/** 通信に載せる `StrategyCard` の表記。 */
export interface WireStrategyFace extends WireWrittenCard {
  readonly type: 'ストラテジー' | '超必殺ストラテジー！'
}

/** 通信に載せる `TrapCard` の表記。 */
export interface WireTrapFace extends WireWrittenCard {
  readonly type: 'トラップ'
  readonly triggerIcon: readonly Square[]
}

/**
 * カードに書かれていることのうち、画面に出すもの（ADR-0010）。
 *
 * **カードの同一性を指すものではない。** 同じ名前のカードは複数あり（総合ルール 第3部 第1章 3-1
 * の「同名のカードはデッキに 4 枚まで」が成り立つのはそのためである）、表記では 1 枚を指せない。
 * 盤面の 1 枚を指すのは識別子（`CardInstance.id`）であって、こちらは「その 1 枚に何が書かれて
 * いるか」だけを持つ。
 *
 * **能力を持たない。** 能力は関数（`Ability` の `Effect`）なので通信に載らない。落としても
 * 困らないのは、クライアントがルールの判断を持たない（ADR-0010）ためである。何が起こるかは、
 * 解決した結果が次の盤面として届く。
 *
 * 種別ごとに書かれていることが違う（ムーブアイコンはユニットだけ、トリガーアイコンはトラップ
 * だけが持つ）ので、`Card` と同じく種別で分けた組にしている。持たない項目を `undefined` に
 * しないのは、JSON にすると値の無い項目が消えてしまうためである。
 */
export type WireCardFace = WireUnitFace | WireStrategyFace | WireTrapFace

/** 通信に載せる形にした `CardInstance`。カードそのものの代わりに表記を持つ。 */
export interface WireCardInstance {
  readonly id: CardId
  readonly card: WireCardFace
  readonly owner: Player
  readonly controller: Player
  readonly orientation: Orientation
  readonly damage: number
}

/** 通信に載せる形にした `VisibleCard`。見えていない側は元から表記を持たない。 */
export type WireVisibleCard =
  | { readonly kind: '見えている'; readonly instance: WireCardInstance }
  | { readonly kind: '見えていない'; readonly orientation: Orientation }

/** 通信に載せる形にした `UnitOnSquare`。 */
export interface WireUnitOnSquare {
  readonly id: CardId
  readonly square: Square
  readonly card: WireUnitFace
  readonly controller: Player
}

/** 通信に載せる形にした `TrapConditionMet`。 */
export interface WireTrapConditionMet {
  readonly trap: CardId
  readonly occasion: { readonly kind: '侵入'; readonly invader: WireUnitOnSquare }
}

/** 通信に載せる形にした `CourageConditionMet`。 */
export interface WireCourageConditionMet {
  readonly player: Player
  readonly satisfied: readonly CardId[]
  readonly placed: WireUnitOnSquare
}

/**
 * サーバがクライアントへ送る、視点ごとの盤面（ADR-0004 / ADR-0010）。
 *
 * `DuelPerspective` が「誰に何が見えてよいか」を決めた形であるのに対して、これは「それをどう
 * 送るか」を決めた形である。**違いはカードの持ち方だけで、それ以外はそのまま写している。**
 * 能力の効果はすでに射影の側で落ちている（`perspective.ts` の `VisibleAbility`）。
 *
 * 残っていた `CardInstance.card` は、カードのデータと効果（関数）を持つ `Card` そのものなので
 * 送れない。かわりに**カードに書かれていること**（`WireCardFace`）を載せる。表記はどれもただの
 * 値なので、engine がカードを知らないまま（ADR-0002）自分で書き出せる。受け取った側にカードの
 * 実装は要らず、クライアントは公開のまま作れる（ADR-0010）。
 *
 * **この型は JSON にできるものだけでできている。** 関数も `Map` も `Set` も含まない。
 */
export interface WirePerspective {
  readonly viewer: Player
  readonly squares: readonly (readonly WireCardInstance[])[]
  /**
   * 継続効果を適用した後の、スクエアにいるユニットのデータ（#91）。
   *
   * 射影がすでに集めた形（`perspective.ts` の `EffectiveUnitData`）がそのまま載る。数値と
   * 属性の並びだけなので、書き出す必要が無い。
   */
  readonly effective: readonly EffectiveUnitData[]
  readonly zones: Readonly<Record<Player, Readonly<Record<PlayerZone, readonly WireVisibleCard[]>>>>
  readonly damage: Readonly<Record<Player, number>>
  readonly turn: Turn
  readonly bank: readonly VisibleAbility[]
  readonly resolveZone: readonly WireCardInstance[]
  readonly triggered: readonly VisibleAbility[]
  readonly createdAbilities: readonly VisibleCreatedAbility[]
  readonly playedIntoCenter: readonly CardId[]
  readonly trapConditionsMet: readonly WireTrapConditionMet[]
  readonly courageConditionsMet: readonly WireCourageConditionMet[]
  readonly battle: VisibleBattle | undefined
  readonly smashJudgments: readonly SmashJudgment[]
  readonly result: DuelResult | undefined
  /**
   * ここまでに起きたできごと（#95）。射影が落とした後のものがそのまま載る。
   *
   * **形を変えずに済むのは、できごとがカードを識別子でしか指していないためである**
   * （`log.ts` の `DuelEvent`）。カードそのものを持っていないので、表記に書き出す必要が無い。
   * 名前を出したければ、受け取った側が同じ盤面から引ける。名指しされているカードは、そこに
   * 見えているカードだけである（`perspective.ts` の `visibleIds`）。
   */
  readonly log: readonly DuelEvent[]
}

/** 種別によらず書かれていることを写す。**能力と効果は写さない。** */
function written(card: Card): WireWrittenCard & { readonly type: CardType } {
  return {
    type: card.type,
    name: card.name,
    level: card.level,
    colors: card.colors,
    stars: card.stars,
    reverseStars: card.reverseStars,
    attributes: card.attributes,
  }
}

/** ユニットに書かれていることを写す。 */
function unitFaceOf(card: UnitCard): WireUnitFace {
  return { ...written(card), type: 'ユニット', bp: card.bp, sp: card.sp, moveIcon: card.moveIcon }
}

/**
 * カードに書かれていることを写す（ADR-0010）。
 *
 * `{ ...card }` で写していないのは、そうすると能力と効果まで載ってしまうためである。関数は
 * `JSON.stringify` で黙って落ちるので、混ざっていても通信の相手からは見えない。**混ぜないこと
 * を型で保てるように、項目を 1 つずつ書き写している。**
 */
function faceOf(card: Card): WireCardFace {
  switch (card.type) {
    case 'ユニット':
      return unitFaceOf(card)
    case 'トラップ':
      return { ...written(card), type: 'トラップ', triggerIcon: card.triggerIcon }
    case 'ストラテジー':
    case '超必殺ストラテジー！':
      return { ...written(card), type: card.type }
  }
}

function instanceToWire(instance: CardInstance): WireCardInstance {
  return { ...instance, card: faceOf(instance.card) }
}

function unitToWire(unit: UnitOnSquare): WireUnitOnSquare {
  return { ...unit, card: unitFaceOf(unit.card) }
}

function visibleToWire(visible: VisibleCard): WireVisibleCard {
  return visible.kind === '見えている'
    ? { kind: '見えている', instance: instanceToWire(visible.instance) }
    : visible
}

/**
 * 視点ごとの盤面を、通信に載せる形にする（ADR-0004）。
 *
 * 射影（`perspectiveOf`）を通した後のものを渡す。**完全な盤面をここに渡してはならない。**
 * 落とす仕事はこの関数ではなく射影が持っていて、ここは形を変えるだけである。
 *
 * **逆向きの変換は無い。** 表記からカードには戻せず、戻せる必要も無い。受け取ったクライアントは
 * 盤面を描いて選んだものを送るだけで、デュエルを進めるのは完全な盤面を持つサーバだけである
 * （ADR-0010）。
 */
export function toWire(perspective: DuelPerspective): WirePerspective {
  const zonesOf = (owner: Player): Readonly<Record<PlayerZone, readonly WireVisibleCard[]>> =>
    Object.fromEntries(
      PLAYER_ZONES.map((zone): readonly [PlayerZone, readonly WireVisibleCard[]] => [
        zone,
        perspective.zones[owner][zone].map(visibleToWire),
      ]),
    ) as Record<PlayerZone, readonly WireVisibleCard[]>

  return {
    ...perspective,
    squares: perspective.squares.map((square) => square.map(instanceToWire)),
    effective: perspective.effective,
    zones: Object.fromEntries(PLAYERS.map((owner) => [owner, zonesOf(owner)])) as WirePerspective['zones'],
    resolveZone: perspective.resolveZone.map(instanceToWire),
    trapConditionsMet: perspective.trapConditionsMet.map((met) => ({
      ...met,
      occasion: { ...met.occasion, invader: unitToWire(met.occasion.invader) },
    })),
    courageConditionsMet: perspective.courageConditionsMet.map((met) => ({
      ...met,
      placed: unitToWire(met.placed),
    })),
  }
}
