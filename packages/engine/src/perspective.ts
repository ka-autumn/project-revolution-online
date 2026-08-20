import type { Battle } from './battle.js'
import { cardsIn } from './duel.js'
import type {
  BankedAbility,
  CardId,
  CardInstance,
  CourageConditionMet,
  DuelResult,
  DuelState,
  TrapConditionMet,
} from './duel.js'
import type { DuelEvent, LoggedInstruction } from './log.js'
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
 * ある視点から見た、解決を待っている能力 1 つ（ADR-0004）。
 *
 * **効果そのものを持たない。** 効果は関数（`Effect`）なので通信に載らず、クライアントに渡す
 * 手立てが無い。作成された誘発型能力（`duel.ts` の `CreatedAbilityInstance`）にいたっては、
 * 効果が実行中に作った能力なので、カードを指す名前すら持たない。
 *
 * 落としても困らないのは、バンクについて両方のプレイヤーが必要とするのが「誰が支配している
 * 能力がいくつあるか」までだからである。どれを解決するかは支配者で決まり（総合ルール 第2部
 * 第21章 11-3）、バンクに能力があるかどうかがスマッシュを行えるかを左右する（`priority.ts` の
 * `activePlayerMayAct`）。効果が何をするかは、解決した結果が次の盤面として届く。
 */
export interface VisibleAbility {
  readonly controller: Player
  /** 発生源のカード。作成された誘発型能力は持たない。 */
  readonly source: CardId | undefined
}

/**
 * ある視点から見た、まだ誘発していない、作成された誘発型能力（総合ルール 第4部 第3章 4）。
 *
 * `VisibleAbility` と同じ理由で効果を持たない。影響を与える特定のカード（同 4-1）は、スクエアに
 * あるカードなので公開情報である。
 */
export interface VisibleCreatedAbility {
  readonly controller: Player
  readonly affecting: CardId
}

/**
 * ある視点から見たバトル。待機中のバンクだけが形を変える。
 *
 * バトルが持つそれ以外のもの（スクエア・2 つのユニット・ステップ）は公開情報である。
 */
export type VisibleBattle = Omit<Battle, 'heldBank' | 'heldTriggered'> & {
  readonly heldBank: readonly VisibleAbility[]
  readonly heldTriggered: readonly VisibleAbility[]
}

/**
 * ある視点から見たスマッシュ判定。バトルと同じく、待機中のバンクだけが形を変える（#103）。
 *
 * 判定が持つそれ以外のもの（誰の判定か・ステップ・繰り返しの回数・表向きに置かれたカード）は
 * 公開情報である。表向きに置かれるカードは、規定によって表向きである（総合ルール 第3部
 * 第19章 1）。
 */
export type VisibleSmashJudgment = Omit<SmashJudgment, 'heldBank' | 'heldTriggered'> & {
  readonly heldBank: readonly VisibleAbility[]
  readonly heldTriggered: readonly VisibleAbility[]
}

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
 * - `bank`・`triggered`・`createdAbilities`、そしてバトルとスマッシュ判定が持つ待機中のバンクは、効果を落とした
 *   `VisibleAbility` になる。効果は関数なので渡す手立てが無く、落としても困らない（同型の doc）
 * - `turn`・`damage`・`result` はそのまま。どれもカードの位置ではなく、どちらの
 *   プレイヤーにも見せてよい（`DuelState.turn` の doc）
 *
 * **これは通信の形式そのものではない。** 残っている `CardInstance.card` も効果を関数として持つ
 * ので、そのままでは送れない。カードをどう名指しし、クライアントがどう引き直すかは `wire.ts`
 * が決める。ここで決めているのは「誰に何が見えてよいか」である。
 */
export interface DuelPerspective {
  /** この盤面を見ているプレイヤー。 */
  readonly viewer: Player
  readonly squares: readonly (readonly CardInstance[])[]
  readonly zones: Readonly<Record<Player, Readonly<Record<PlayerZone, readonly VisibleCard[]>>>>
  readonly damage: Readonly<Record<Player, number>>
  readonly turn: Turn
  readonly bank: readonly VisibleAbility[]
  readonly resolveZone: readonly CardInstance[]
  readonly triggered: readonly VisibleAbility[]
  readonly createdAbilities: readonly VisibleCreatedAbility[]
  readonly playedIntoCenter: readonly CardId[]
  /** 視点のプレイヤーが持っている、発動条件が満たされているトラップ。 */
  readonly trapConditionsMet: readonly TrapConditionMet[]
  /** 視点のプレイヤーの、「勇気」の起動条件が満たされていること。 */
  readonly courageConditionsMet: readonly CourageConditionMet[]
  readonly battle: VisibleBattle | undefined
  readonly smashJudgments: readonly VisibleSmashJudgment[]
  readonly result: DuelResult | undefined
  /**
   * ここまでに起きたできごと（ADR-0011）。**見てはならないカードは名指ししない。**
   *
   * 落とすかどうかは、射影したこの盤面から表側が見えるかどうかで決まる（`visibleIds`）。
   * **見え方の決まりを二度書かないための形である。** ログのために `seesFace` を読み直すと、
   * 片方だけ直した時に漏れる。
   *
   * 見えなくなったカードは、そのできごとの時に見えていても落ちる。落とすのは「いま」の
   * 見え方で決まるためで、**少なく見せる側に倒している**（`protocol.ts` の `describeChoice`
   * と同じ）。
   */
  readonly log: readonly DuelEvent[]
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

/** 解決を待っている能力から、効果を落とす。 */
function visibleAbility(banked: BankedAbility): VisibleAbility {
  return { controller: banked.controller, source: banked.source }
}

function visibleBattle(battle: Battle): VisibleBattle {
  return {
    ...battle,
    heldBank: battle.heldBank.map(visibleAbility),
    heldTriggered: battle.heldTriggered.map(visibleAbility),
  }
}

/** バトルと同じく、待機中のバンクから効果を落とす（#103）。 */
function visibleSmashJudgment(judgment: SmashJudgment): VisibleSmashJudgment {
  return {
    ...judgment,
    heldBank: judgment.heldBank.map(visibleAbility),
    heldTriggered: judgment.heldTriggered.map(visibleAbility),
  }
}

/**
 * その射影から表側が見えているカードの識別子すべて。
 *
 * 見え方の決まり（`seesFace`）を二度書かずに済むよう、**射影した結果から取り出す。** ログを
 * 落とすのにも（`projectEvent`）、選ぶ時の候補を落とすのにも（`protocol.ts` の
 * `describeChoice`）、同じここを通す。
 */
export function visibleIds(perspective: DuelPerspective): ReadonlySet<CardId> {
  return new Set([
    ...Object.values(perspective.zones).flatMap((zones) =>
      Object.values(zones).flatMap((cards) =>
        cards.flatMap((card) => (card.kind === '見えている' ? [card.instance.id] : [])),
      ),
    ),
    ...perspective.squares.flat().map((card) => card.id),
    ...perspective.resolveZone.map((card) => card.id),
  ])
}

/** 見えているならその識別子、見えていなければ `undefined`。 */
function seen(card: CardId | undefined, visible: ReadonlySet<CardId>): CardId | undefined {
  return card !== undefined && visible.has(card) ? card : undefined
}

/**
 * できごと 1 つから、見えていないカードの名指しを落とす。
 *
 * 落とした結果は「そのできごとがカードを指していない」場合と同じ形になる。読む側から見れば
 * どちらも「名指しできるカードが無い」ことであり、区別する必要は無い。
 */
function projectEvent(event: DuelEvent, visible: ReadonlySet<CardId>): DuelEvent {
  switch (event.kind) {
    case '行動した':
      return { ...event, card: seen(event.card, visible) }
    case '能力を解決した':
      return { ...event, source: seen(event.source, visible) }
    case '命令を実行した':
      return { ...event, instruction: projectInstruction(event.instruction, visible) }
    case 'バトルが始まった':
      return { ...event, attacker: seen(event.attacker, visible), attacked: seen(event.attacked, visible) }
    case 'バトルダメージを与えた':
      return { ...event, from: seen(event.from, visible), to: seen(event.to, visible) }
    // 捨札はすべてのカードをいつでも見られる（総合ルール 第2部 第21章 5-2）ので、置かれた
    // カードは普通そのまま残る。後から捨札を離れて見えなくなったものだけが落ちる。
    case 'ルールで捨札に置かれた':
      return { ...event, cards: event.cards.filter((card) => visible.has(card)) }
    case 'バトルが終わった':
      return { ...event, winner: seen(event.winner, visible) }
    case 'コストを支払った':
      return { ...event, card: seen(event.card, visible) }
    case 'プランをめくった':
      return { ...event, card: seen(event.card, visible), discarded: seen(event.discarded, visible) }
    // 一度表向きに置かれたことは取り消せない事実なので、裏返された後もそのまま残す
    // （`log.ts` の `希望ステップでめくった`）。ここだけ「いま」の見え方から名指しを落とさない。
    case '希望ステップでめくった':
    case 'ダメージを受けた':
    case '決着した':
      return event
  }
}

/**
 * 命令 1 つから、見えていないカードの名指しを落とす。
 *
 * カードを指すところの名前が `card` に揃えてある（`log.ts` の `LoggedInstruction`）ので、
 * 命令の種類ごとに書き分ける必要が無い。
 */
function projectInstruction(instruction: LoggedInstruction, visible: ReadonlySet<CardId>): LoggedInstruction {
  return 'card' in instruction ? { ...instruction, card: seen(instruction.card, visible) } : instruction
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
  const board = projectBoard(state, viewer)
  // ログを落とすのに、落とし終えた盤面が要る（`DuelPerspective.log`）。同じ射影を二度
  // 作らずに済むよう、盤面を先に組み立ててからログを足す。
  return { ...board, log: state.log.map((event) => projectEvent(event, visibleIds(board))) }
}

/** ログ以外の射影。 */
function projectBoard(state: DuelState, viewer: Player): DuelPerspective {
  return {
    viewer,
    squares: state.squares,
    zones: projectZones(state, viewer),
    damage: state.damage,
    turn: state.turn,
    bank: state.bank.map(visibleAbility),
    resolveZone: state.resolveZone,
    triggered: state.triggered.map(visibleAbility),
    createdAbilities: state.createdAbilities.map(({ controller, affecting }) => ({ controller, affecting })),
    playedIntoCenter: state.playedIntoCenter,
    trapConditionsMet: state.trapConditionsMet.filter((met) => ownsTrap(state, viewer, met)),
    courageConditionsMet: state.courageConditionsMet.filter((met) => met.player === viewer),
    battle: state.battle === undefined ? undefined : visibleBattle(state.battle),
    smashJudgments: state.smashJudgments.map(visibleSmashJudgment),
    result: state.result,
    log: [],
  }
}
