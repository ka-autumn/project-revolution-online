import type { Battle } from './battle.js'
import { cardsIn } from './duel.js'
import type {
  BankedAbility,
  CardId,
  CardInstance,
  CourageConditionMet,
  CreatedAbility,
  DuelResult,
  DuelState,
  TrapConditionMet,
} from './duel.js'
import type { Orientation } from './orientation.js'
import { PLAYERS } from './player.js'
import type { Player } from './player.js'
import type { SmashJudgment } from './smash.js'
import type { Turn } from './turn.js'
import { PLAYER_ZONES } from './zone.js'
import type { PlayerZone } from './zone.js'

/**
 * ある視点から見た 1 枚のカード（ADR-0004）。
 *
 * 表側が見えていなければ、そのカードが何であるかを持たない。**識別子も持たない。** 識別子は
 * シャッフル前のデッキでの番号から作られている（`setup.ts` の `library`）ため、自分のデッキの
 * 並びを知っているプレイヤーには、識別子がそのままカードの正体になる。見せてよいのは総合ルール
 * 第2部 第23章 1-1 が公開情報として挙げているもの、つまり枚数と向きだけである。
 *
 * 向きが意味を持つのはスクエア・トラップゾーン・エネルギーゾーン・スマッシュゾーンにある
 * カードだけである（同 第24章 1）。それ以外のゾーンで持っている値に意味が無いのは
 * `CardInstance.orientation` と同じで、写す側で消し込んではいない。
 */
export type VisibleCard =
  | { readonly kind: '見えている'; readonly instance: CardInstance }
  | { readonly kind: '見えていない'; readonly orientation: Orientation }

/**
 * 完全な盤面から導いた、あるプレイヤーが見てよい盤面（ADR-0004）。
 *
 * サーバだけが完全な盤面（`DuelState`）を持ち、クライアントにはこれを送る。全体を送れば
 * それだけでカンニングが成立するため、**送る前に落とすのではなく、落としたものだけを作る。**
 *
 * `DuelState` と同じ形をしているところと、違う形をしているところがある。違うのは、視点に
 * よって見え方が変わりうるところだけである。
 *
 * - `zones` は `VisibleCard` になる。ゾーンと持ち主と視点で見え方が変わる（`seesFace`）
 * - `trapConditionsMet` と `courageConditionsMet` は視点のプレイヤーのぶんだけになる。どちらも
 *   非公開のカードを名指しするうえ、相手の権利は視点のプレイヤーが行える行動を左右しない
 * - `squares` と `resolveZone` は `CardInstance` のまま。スクエアにあるカードは公開情報であり
 *   （同 第23章 1-1）、リゾルブゾーンにあるカードは表向きで置かれる（同 第21章 12-2）
 * - `bank` と `triggered` と `createdAbilities` もそのまま。誘発するのはスクエアにあるユニットの
 *   能力だけ（`trigger.ts` の `triggeredOnSquares`）で、発生源は公開情報である。バンクの中身は
 *   両方のプレイヤーが解決するものを選ぶために要る（同 第21章 11-3）
 * - `turn`・`damage`・`battle`・`smashJudgments`・`result` もそのまま。どれもカードの位置ではなく、
 *   どちらのプレイヤーにも見せてよい（`DuelState.turn` の doc）
 *
 * **これは通信の形式ではない。** `CardInstance.card` は効果を関数として持つので、そのままでは
 * 送れない。何を送り、クライアントがどうカードを引き直すかは、通信を作る時に決める。ここで
 * 決めているのは「誰に何が見えてよいか」だけである。
 */
export interface DuelPerspective {
  /** この盤面を見ているプレイヤー。 */
  readonly viewer: Player
  readonly squares: readonly (readonly CardInstance[])[]
  readonly zones: Readonly<Record<Player, Readonly<Record<PlayerZone, readonly VisibleCard[]>>>>
  readonly damage: Readonly<Record<Player, number>>
  readonly turn: Turn
  readonly bank: readonly BankedAbility[]
  readonly resolveZone: readonly CardInstance[]
  readonly triggered: readonly BankedAbility[]
  readonly createdAbilities: readonly CreatedAbility[]
  readonly playedIntoCenter: readonly CardId[]
  /** 視点のプレイヤーが持っている、発動条件が満たされているトラップ。 */
  readonly trapConditionsMet: readonly TrapConditionMet[]
  /** 視点のプレイヤーの、「勇気」の起動条件が満たされていること。 */
  readonly courageConditionsMet: readonly CourageConditionMet[]
  readonly battle: Battle | undefined
  readonly smashJudgments: readonly SmashJudgment[]
  readonly result: DuelResult | undefined
}

/**
 * そのカードの表側が、その視点から見えるか。
 *
 * 表向きか裏向きかを盤面が持っていない（`play.ts` の `playAsTrap`）ので、置かれている場所から
 * 決まる。スマッシュゾーンだけは、希望ステップで表向きに置かれた 1 枚を判定が覚えている
 * （`smash.ts` の `SmashJudgment.faceUp`）ので、そこを見る。
 */
function seesFace(state: DuelState, viewer: Player, owner: Player, zone: PlayerZone, card: CardInstance): boolean {
  switch (zone) {
    // 持ち主であっても山札の中身を見てはならない（総合ルール 第2部 第21章 2-2）。
    case '山札':
      return false
    // 自分の手札は見られる。相手の手札は見られず、枚数だけを数えられる（同 4-3）。
    case '手札':
      return owner === viewer
    // どちらのスマッシュゾーンであっても、裏向きのカードの表側は見られない（同 7-3）。
    // 希望ステップの間だけ表向きに置かれる 1 枚は見える（同 第3部 第19章 1）。
    case 'スマッシュゾーン':
      return state.smashJudgments.some((judgment) => judgment.faceUp === card.id)
    // 自分のトラップゾーンにあるカードの表側はいつでも見られる。相手のトラップゾーンに
    // 裏向きで置かれているカードの表側は見られない（同 第2部 第21章 9-3）。
    case 'トラップゾーン':
      return owner === viewer
    // プランは山札の 1 番上が表向きになったものである（同 3-1）。
    case 'プランゾーン':
    // 捨札はすべてのカードをいつでも見られる（同 5-2）。
    case '捨札':
    // 両方のエネルギーゾーンにあるカードを見られる（同 6-3）。
    case 'エネルギーゾーン':
    // リムーブゾーンに置かれたカードは表向きである（同 10-2）。裏向きで置く経路は無い。
    case 'リムーブゾーン':
    // パートナーアバターは開始から終わりまで置かれたままになる（同 13-2）。パートナーバトル
    // 自体が未実装（#18）なので、いまはどの盤面でも空である。
    case 'パートナーゾーン':
      return true
  }
}

function project(state: DuelState, viewer: Player, owner: Player, zone: PlayerZone): readonly VisibleCard[] {
  return cardsIn(state, owner, zone).map((instance) =>
    seesFace(state, viewer, owner, zone, instance)
      ? { kind: '見えている', instance }
      : { kind: '見えていない', orientation: instance.orientation },
  )
}

function projectZones(state: DuelState, viewer: Player): DuelPerspective['zones'] {
  const zonesOf = (owner: Player): Readonly<Record<PlayerZone, readonly VisibleCard[]>> =>
    Object.fromEntries(PLAYER_ZONES.map((zone) => [zone, project(state, viewer, owner, zone)])) as Record<
      PlayerZone,
      readonly VisibleCard[]
    >

  return Object.fromEntries(PLAYERS.map((owner) => [owner, zonesOf(owner)])) as DuelPerspective['zones']
}

/** そのトラップが視点のプレイヤーのトラップゾーンにあるか。 */
function ownsTrap(state: DuelState, viewer: Player, met: TrapConditionMet): boolean {
  return cardsIn(state, viewer, 'トラップゾーン').some((card) => card.id === met.trap)
}

/**
 * 完全な盤面から、そのプレイヤーが見てよい盤面を導く（ADR-0004）。
 *
 * サーバがクライアントへ送る前に必ず通す。**盤面を変える側はこれを知らない。** 射影は読み取り
 * だけで、ここを通した結果からデュエルを進めることはできない。進められるのは完全な盤面を持つ
 * サーバだけである。
 */
export function perspectiveOf(state: DuelState, viewer: Player): DuelPerspective {
  return {
    viewer,
    squares: state.squares,
    zones: projectZones(state, viewer),
    damage: state.damage,
    turn: state.turn,
    bank: state.bank,
    resolveZone: state.resolveZone,
    triggered: state.triggered,
    createdAbilities: state.createdAbilities,
    playedIntoCenter: state.playedIntoCenter,
    trapConditionsMet: state.trapConditionsMet.filter((met) => ownsTrap(state, viewer, met)),
    courageConditionsMet: state.courageConditionsMet.filter((met) => met.player === viewer),
    battle: state.battle,
    smashJudgments: state.smashJudgments,
    result: state.result,
  }
}
