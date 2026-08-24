import type { Battle } from './battle.js'
import type { Attribute } from './card.js'
import { continuousData } from './continuous.js'
import { cardsIn, findAnywhere } from './duel.js'
import type {
  BankedAbility,
  CardId,
  CardInstance,
  CourageConditionMet,
  DuelResult,
  DuelState,
  TrapConditionMet,
} from './duel.js'
import type { DuelEvent, LoggedEvent, LoggedInstruction, RecordedEvent, SeenBy } from './log.js'
import type { Orientation } from './orientation.js'
import { PLAYERS } from './player.js'
import type { Player } from './player.js'
import type { SmashJudgment } from './smash.js'
import type { Turn } from './turn.js'
import { unitsOnSquares } from './view.js'
import { PLAYER_ZONES } from './zone.js'
import type { PlayerZone } from './zone.js'

/**
 * 継続効果を適用した後の、スクエアにいるユニット 1 体のデータ（総合ルール 第4部 第12章 2）。#91
 *
 * **どちらのプレイヤーにも同じものを送る。** スクエアにあるカードは公開情報であり（同 第2部
 * 第23章 1-1）、継続効果が変えた後のデータもそれを見れば分かるものだからである。
 *
 * 対象はスクエアにいるユニットだけでよい。継続効果がデータを変えるのはそこにいるユニットで
 * ある（`view.ts` の `unitsOnSquares`）。
 */
export interface EffectiveUnitData {
  readonly card: CardId
  /** 修整を適用した後のＢＰ（総合ルール 第4部 第12章 5-2 の(5)）。 */
  readonly bp: number
  /** 加わったものを含む属性（同 5-2 の(3)）。 */
  readonly attributes: readonly Attribute[]
}

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
  /**
   * 継続効果を適用した後の、スクエアにいるユニットのデータ（#91）。
   *
   * `squares` に載っている `CardInstance.card` は**カードに書かれている**データを持つ
   * （総合ルール 第2部 第2章 2）。継続効果による修整（同 第4部 第12章）は盤面に書き込まれて
   * いないので、そのまま写すと画面に出るのは印刷された数字になる。修整を集められるのは完全な
   * 盤面を持つここだけなので、**書かれている値とは別のものとして**添える。
   */
  readonly effective: readonly EffectiveUnitData[]
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
   * 落とすかどうかは、**そのできごとが積まれた時にこのプレイヤーから見えていたか**で決まる
   * （`log.ts` の `RecordedEvent.seenBy`）。見え方の決まりそのものは射影ひとつ（`seesFace`）の
   * ままで、それを読むのが「いま」ではなく「その時」になる。
   *
   * 一度も見えていないカードは、後から見えるようになっても過去の行に現れない。逆に、公開
   * されているゾーンから山札や手札へ移ったカードは、移った後も過去の行では名指しされたまま
   * になる（#129）。**ログは過去の記録であって、いまの見え方ではない。**
   *
   * どの手順の中で起きたかは落とさずに載る（`log.ts` の `LoggedEvent.during`、#133）。
   * 進行中のフェイズもステップも、誰のスマッシュ判定かも公開情報である（総合ルール
   * 第2部 第23章 1-1）。
   */
  readonly log: readonly LoggedEvent[]
  /**
   * `log` が名指ししているカードのうち、**盤面に載っていないもの**（#139）。
   *
   * ログはカードを識別子でしか指さない（ADR-0011）ので、名前を出す側は同じ盤面から引く。
   * ところが、名指しが残るのは**その時**見えていたかで決まる（`log.ts` の `RecordedEvent`）
   * のに対して、盤面に載っているのは**いま**見えているカードだけである。山札に戻ったカードの
   * ように、名指しは残っているのに引く先が無い、というずれがここで埋まる。
   *
   * **落とす判断はここでは増えない。** 載せるのは射影を通った後の `log` に残っている識別子
   * だけであり、そこに残っている時点で、このプレイヤーが見てよいことは決まっている。
   *
   * 盤面に載っているカードは含めない。二度送らずに済むからで、名前を引く側は盤面とここの
   * 両方から引く（`view-model.ts` の `namesIn`）。
   */
  readonly namedInLog: readonly CardInstance[]
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
 * 見え方の決まり（`seesFace`）を二度書かずに済むよう、**射影した結果から取り出す。** 選ぶ時の
 * 候補を落とすのにも（`protocol.ts` の `describeChoice`）、できごとを積む時に見え方を凍らせる
 * のにも（`visibleIdsOf`）、同じここを通す。
 */
export function visibleIds(
  perspective: Pick<DuelPerspective, 'zones' | 'squares' | 'resolveZone'>,
): ReadonlySet<CardId> {
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

/**
 * そのプレイヤーから表側が見えているカードの識別子すべて（#129）。
 *
 * 射影した盤面から取り出すので、見え方の決まり（`seesFace`）はここでも二度書かれない。
 * できごとを積む時に見え方を凍らせるのに使う（`log.ts` の `record`）。
 *
 * 盤面をまるごと射影するかわりに、見え方が変わりうるところ（`zones`）だけを射影する。
 * できごとを積むたびに通るので、継続効果の計算（`effectiveUnitData`）まで走らせない。
 */
export function visibleIdsOf(state: DuelState, viewer: Player): ReadonlySet<CardId> {
  const { squares, resolveZone } = state
  return visibleIds({ zones: projectZones(state, viewer), squares, resolveZone })
}

/**
 * そのできごとが名指しするカードのうち、そのできごとの前後どちらかでそのプレイヤーから
 * 見えていたもの（`log.ts` の `SeenBy`）。
 *
 * ここだけが「そのできごとが起きた時にどう見えていたか」を決める。後から盤面を読み直す
 * 手立ては無い——見えなくなったカードがどこから来たのかは、いまの盤面には残らない。
 */
export function seenByOf(state: DuelState, before: DuelState, event: DuelEvent): SeenBy {
  const named = cardsNamedBy(event)
  const seenBy = PLAYERS.map((viewer): readonly [Player, readonly CardId[]] => {
    if (named.length === 0) return [viewer, []]

    const after = visibleIdsOf(state, viewer)
    const visible = before === state ? after : new Set([...visibleIdsOf(before, viewer), ...after])
    return [viewer, named.filter((card) => visible.has(card))]
  })
  return Object.fromEntries(seenBy) as SeenBy
}

/** そのできごとが名指ししているカード。落とせるところだけを数える（`mapEventCards`）。 */
function cardsNamedBy(event: DuelEvent): readonly CardId[] {
  const named: CardId[] = []
  mapEventCards(event, (card) => {
    if (card !== undefined) named.push(card)
    return card
  })
  return named
}

/**
 * できごと 1 つから、見えていなかったカードの名指しを落とす。
 *
 * 落とすかどうかは、**積まれた時の見え方**（`log.ts` の `RecordedEvent.seenBy`）で決まる。
 * いまの盤面からは決めない。ログは過去の記録であって、いまの見え方ではない（#129）。
 *
 * 落とした結果は「そのできごとがカードを指していない」場合と同じ形になる。読む側から見れば
 * どちらも「名指しできるカードが無い」ことであり、区別する必要は無い。
 */
function projectEvent(recorded: RecordedEvent, viewer: Player): DuelEvent {
  const seen = new Set(recorded.seenBy[viewer])
  return mapEventCards(recorded.event, (card) => (card !== undefined && seen.has(card) ? card : undefined))
}

/** できごとが名指しするカードに手を入れる関数。`undefined` を返すと、その名指しが落ちる。 */
type CardMapping = (card: CardId | undefined) => CardId | undefined

/**
 * できごと 1 つが名指ししているカードすべてに、同じ手当てをする。
 *
 * **どのできごとがどこでカードを名指ししているかを知っているのはここだけである。** 名指しを
 * 落とすのにも（`projectEvent`）、見え方を凍らせるのに数えるのにも（`cardsNamedBy`）同じ
 * ここを通す。二度書くと、片方だけ直した時に漏れる。
 *
 * `希望ステップでめくった` だけはカードを渡さない。一度表向きに置かれたことは取り消せない
 * 事実なので、裏返された後もそのまま残る（`log.ts` の `希望ステップでめくった`）。
 */
function mapEventCards(event: DuelEvent, map: CardMapping): DuelEvent {
  switch (event.kind) {
    case '行動した':
      return { ...event, card: map(event.card) }
    case '能力を解決した':
      return { ...event, source: map(event.source) }
    case '命令を実行した':
      return { ...event, instruction: mapInstructionCard(event.instruction, map) }
    case 'バトルが始まった':
      return { ...event, attacker: map(event.attacker), attacked: map(event.attacked) }
    case 'バトルダメージを与えた':
      return { ...event, from: map(event.from), to: map(event.to) }
    case 'ルールで捨札に置かれた':
      return { ...event, cards: event.cards.flatMap((card) => mapped(map(card))) }
    case 'バトルの勝敗が決まった':
      return { ...event, winner: map(event.winner) }
    case 'コストを支払った':
      return { ...event, card: map(event.card) }
    case 'プランをめくった':
      return { ...event, card: map(event.card), discarded: map(event.discarded) }
    // 落とすのは名指しだけで、枚数（`count`）はそのまま残る（`log.ts` の `リリースした`）。
    case 'リリースした':
      return { ...event, cards: event.cards.flatMap((card) => mapped(map(card))) }
    case 'カードを引いた':
      return { ...event, card: map(event.card) }
    // 進行そのもののできごと（#133）はカードを名指ししない。フェイズもステップも誰の
    // スマッシュ判定かも公開情報である（総合ルール 第2部 第23章 1-1）。
    case '進行が変わった':
    case 'バトルが終わった':
    case 'バトルのステップが変わった':
    case 'スマッシュ判定が始まった':
    case 'スマッシュ判定が終わった':
    case 'スマッシュ判定のステップが変わった':
    case 'スマッシュ判定が待機中になった':
    case 'スマッシュ判定が戻った':
    case '希望ステップでめくった':
    case 'ダメージを受けた':
    // リリース以外の自動で行われる処理（#157）はカードを名指ししない。ダメージの除去も
    // 回復も、量が公開情報である（総合ルール 第2部 第23章 1-1）だけである。
    case 'ダメージが取り除かれた':
    case 'ダメージを回復した':
    case '決着した':
      return event
  }
}

/** 有るならその 1 つ、無いなら空。有無で伸び縮みする並びを `flatMap` でつなぐのに使う。 */
function mapped<T>(value: T | undefined): readonly T[] {
  return value === undefined ? [] : [value]
}

/**
 * 命令 1 つが名指ししているカードに、同じ手当てをする。
 *
 * カードを指すところの名前が `card` に揃えてある（`log.ts` の `LoggedInstruction`）ので、
 * 命令の種類ごとに書き分ける必要が無い。何枚かをまとめて指すものだけが `cards` を持ち、
 * そちらは名指しだけが減って枚数（`count`）は残る（同 `カードを引く`）。
 */
function mapInstructionCard(instruction: LoggedInstruction, map: CardMapping): LoggedInstruction {
  if ('cards' in instruction) {
    return { ...instruction, cards: instruction.cards.flatMap((card) => mapped(map(card))) }
  }
  return 'card' in instruction ? { ...instruction, card: map(instruction.card) } : instruction
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
  // `during` はそのまま写す。落とすものが無い（`DuelPerspective.log`）ので、射影を通す先は
  // できごとの側だけである。
  const log = state.log.map((recorded): LoggedEvent => ({
    event: projectEvent(recorded, viewer),
    during: recorded.during,
  }))
  return { ...board, log, namedInLog: namedInLogOf(state, board, log) }
}

/**
 * 射影したログが名指ししているカードのうち、盤面に載っていないもの
 * （`DuelPerspective.namedInLog`）。
 *
 * 渡すログは**射影を通った後のもの**でなければならない。落とす判断はそこで済んでおり、ここは
 * 残った識別子を引き直すだけである。完全なログから作ると、そのまま漏れる。
 */
function namedInLogOf(
  state: DuelState,
  board: Pick<DuelPerspective, 'zones' | 'squares' | 'resolveZone'>,
  log: readonly LoggedEvent[],
): readonly CardInstance[] {
  const onBoard = visibleIds(board)
  const named = new Set(log.flatMap(({ event }) => cardsNamedBy(event)))
  return [...named].flatMap((id) => (onBoard.has(id) ? [] : mapped(findAnywhere(state, id))))
}

/**
 * 継続効果を適用した後の、スクエアにいるユニットのデータ（#91）。
 *
 * 適用するのは `continuous.ts` である。ここでするのは、それをスクエアにいるユニットの分だけ
 * 呼んで並べることだけで、**修整の集め方をここに書き直さない**。
 */
function effectiveUnitData(state: DuelState): readonly EffectiveUnitData[] {
  const data = continuousData(state)

  return unitsOnSquares(state).map((unit) => {
    const applied = data(unit.id, unit.card)
    return { card: unit.id, bp: applied.bp, attributes: applied.attributes }
  })
}

/** ログ以外の射影。 */
function projectBoard(state: DuelState, viewer: Player): DuelPerspective {
  return {
    viewer,
    squares: state.squares,
    effective: effectiveUnitData(state),
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
    // ログと、それが名指しするカードは `perspectiveOf` が足す。ログを落とすのに、落とし
    // 終えた盤面が要る（`namedInLogOf`）ので、盤面を先に組み立てる。
    log: [],
    namedInLog: [],
  }
}
