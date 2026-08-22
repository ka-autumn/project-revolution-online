import type { PlanReplacingAbility } from './ability.js'
import { areaOf } from './board.js'
import type { Area } from './board.js'
import { planReplacingAbilitiesOf, spOf } from './card.js'
import { payPlanCost } from './cost.js'
import {
  cardsIn,
  damagePlayer,
  findInZone,
  locateOnSquares,
  moveToZone,
  setOrientationOnSquare,
  topOfLibrary,
} from './duel.js'
import type { CardId, DuelState } from './duel.js'
import { record } from './log.js'
import { opponentOf } from './player.js'
import type { Player } from './player.js'
import { activePlayerMayAct, grantPriorityToInactive } from './priority.js'
import type { Chooser } from './resolve.js'
import { unitsOnSquares } from './view.js'

/**
 * 行動が行えなかった理由。
 *
 * 行えない行動を engine が黙って無視すると、入力の誤りとルールによる禁止の区別がつかなく
 * なる。どちらもプレイヤーの入力であって呼ぶ側の誤りではないので、例外ではなく値で返す。
 */
export type ActionViolation =
  /** 優先権・フェイズ・バンクのいずれかの条件を満たしていない（総合ルール 第3部 第7章 1・第8章 2）。 */
  | '行える時ではない'
  /** そのカードが、その行動を行えるゾーンにない。 */
  | 'そのゾーンにない'
  /** 「夢」を持たないカードはプランゾーンからプレイできない（総合ルール 第5部 第1章 2）。 */
  | 'プランゾーンからプレイできない'
  /** トラップはトラップとしてしかプレイできない（総合ルール 第2部 第20章 3-1）。 */
  | 'トラップとしてしかプレイできない'
  /** 発動条件を持たないカードは発動できない（総合ルール 第2部 第20章 3-6）。 */
  | '発動できるカードではない'
  /** そのカードが、指した位置に起動型能力を持っていない（総合ルール 第4部 第2章）。 */
  | '起動できる能力がない'
  /**
   * 起動条件が満たされて起動する権利を得ていない（総合ルール 第5部 第2章 2）。バトルや
   * スマッシュ判定が進行中で権利がまだ発生していない場合（同 2 ただし書き）もこれになる。
   */
  | '起動する権利がない'
  /**
   * 発動条件が満たされて発動する権利を得ていない（総合ルール 第2部 第20章 3-8）。バトルや
   * スマッシュ判定が進行中で権利がまだ発生していない場合（同 3-8 ただし書き）もこれになる。
   */
  | '発動する権利がない'
  /** 総合ルール 第1部 第2章 3-1。 */
  | 'レベルを満たしていない'
  /** 総合ルール 第1部 第2章 3-2。 */
  | 'コストを支払えない'
  /**
   * 相手の「信頼」を持つユニットの左右に接するスクエアには、自分のユニットを移動できない
   * （総合ルール 第5部 第4章 2）。移動先として指定できないスクエアの一種だが、ムーブアイコンや
   * スクエアの空きとは別の理由なので分けている。
   */
  | '「信頼」によって移動できない'
  /** ユニットを置けないスクエアを指定した（総合ルール 第2部 第20章 1-3）。 */
  | '指定できないスクエア'
  /** すでにトラップゾーンにカードがある（総合ルール 第2部 第20章 3-1）。 */
  | 'トラップゾーンが空ではない'
  /** そのプレイヤーが支配する、リリース状態のスクエアにいるユニットではない（総合ルール 第4部 第6章 2-1）。 */
  | '移動できるユニットではない'
  /** 中央エリアまたは敵エリアにある、そのプレイヤーが支配するリリース状態のユニットではない（総合ルール 第3部 第9章 1）。 */
  | 'スマッシュできるユニットではない'
  /** ムーブアイコンの方向に隣接せず、または自分が支配する他のユニットがいる（総合ルール 第4部 第6章 2-1）。 */
  | '移動先として指定できないスクエア'

/** プレイヤーが行動を 1 つ行った結果。 */
export type ActionOutcome =
  | { readonly kind: '行った'; readonly state: DuelState }
  | { readonly kind: '行えない'; readonly violation: ActionViolation }

export function done(state: DuelState): ActionOutcome {
  return { kind: '行った', state }
}

export function cannot(violation: ActionViolation): ActionOutcome {
  return { kind: '行えない', violation }
}

/**
 * 自分の手札を 1 枚選んで、持ち主のエネルギーゾーンに表向きにリリース状態で置く
 * （総合ルール 第3部 第7章 1）。この特別な行動はバンクを使用しない。
 *
 * 置けるのはそのエネルギーフェイズに 1 枚だけである（同）。行った後もバンクは空のまま
 * 優先権が戻ってくるので、行ったかどうかを `Turn` が覚えている。
 *
 * 特別な行動を行った後、非アクティブプレイヤーが優先権を獲得する（同 第4部 第5章 2）。
 */
export function placeEnergy(state: DuelState, card: CardId): ActionOutcome {
  if (!activePlayerMayAct(state, 'エネルギーフェイズ')) return cannot('行える時ではない')
  if (state.turn.energyPlaced) return cannot('行える時ではない')

  const player = state.turn.active
  if (findInZone(state, player, '手札', card) === undefined) return cannot('そのゾーンにない')

  const placed = moveToZone(state, card, 'エネルギーゾーン')
  return done(grantPriorityToInactive({ ...placed, turn: { ...placed.turn, energyPlaced: true } }))
}

/**
 * プランする（総合ルール 第3部 第8章 2-3）。
 *
 * コストとして自分のエネルギーかスマッシュを 1 枚フリーズし、効果として自分の山札の
 * 1 番上のカードを表返す。すでにプランゾーンにカードがあるなら、そのカードを捨札に置いて
 * から、次の山札の 1 番上のカードを表返す。
 *
 * 「プランする」ことは起動型能力である（同）ため、バンクを使用せず直ちに解決され、その後
 * 非アクティブプレイヤーが優先権を獲得する（同 第4部 第6章 1-4・1-5）。
 *
 * 山札が空なら表返すカードが無い。実行できない行動は実行されない（同 第1部 第1章 3）
 * だけで、コストはすでに支払われている。
 *
 * 表返すことは置換効果によって置き換えられることがある（同 第4部 第13章、`turnUpForPlan`）。
 */
export function plan(state: DuelState, chooser: Chooser): ActionOutcome {
  if (!activePlayerMayAct(state, 'メインフェイズ')) return cannot('行える時ではない')

  const player = state.turn.active
  const paid = payPlanCost(state, player, chooser)
  if (paid === undefined) return cannot('コストを支払えない')

  return done(grantPriorityToInactive(turnUpForPlan(paid, player, chooser)))
}

/**
 * プランの効果として山札の 1 番上を表返す。置換効果があれば、それに置き換える
 * （総合ルール 第4部 第13章 2）。
 *
 * 置き換えるかどうかは、影響を受けるプレイヤー（プランしたプレイヤー）が選ぶ。いま書ける
 * テキストが「かわりに〜してよい」の形だからである。
 *
 * **複数の置換効果が 1 つの置換イベントを置き換えようとする場合の順序（同 7-1・7-2）は
 * 扱わない。** 候補として並べて 1 つまで選ばせ、選ばれたものだけを適用する。1 つ置き換え
 * られた時点で元の置換イベントは起きたことにならない（同 4）ので、残りが何を置き換える
 * ことになるのかは、そういうテキストが 2 枚以上書けるようになってから決める。
 *
 * 置き換えた後は、条件を満たすカードが表返るまで繰り返す。山札が尽きればそこで止まる
 * （同 第1部 第1章 3）。プランゾーンにあるカードは山札の 1 番上でもある（同 第2部
 * 第21章 3-1）ので、表返すたびに山札は 1 枚減り、必ず終わる。
 */
function turnUpForPlan(state: DuelState, player: Player, chooser: Chooser): DuelState {
  const replacement = chosenPlanReplacement(state, player, chooser)
  if (replacement === undefined) return turnUpTopOfLibrary(state, player)

  let current = state
  for (;;) {
    current = turnUpTopOfLibrary(current, player)

    const [top] = cardsIn(current, player, 'プランゾーン')
    if (top === undefined || replacement.turnsUpUntil(top.card)) return current
    // 次に表返すカードが無ければ、そこで止める。1 度でも多く表返そうとすると、表返せない
    // のにプランゾーンのカードだけが捨札に置かれることになる。
    //
    // ここで見るのは山札そのものである。`topOfLibrary` はプランゾーンにあるカードを
    // 山札の 1 番上として返す（総合ルール 第2部 第21章 3-1）ので、いま表返したばかりの
    // カードを数えてしまう。
    if (cardsIn(current, player, '山札').length === 0) return current
  }
}

/**
 * 選ばせる時の、プランのめくりの置換効果 1 つ。
 *
 * 能力そのものではなく、**どのユニットが生み出しているか**と組にして渡す。常在型能力は
 * カードに書かれたものがそのまま働くので（総合ルール 第4部 第4章 1）、能力の側は自分が
 * どのカードから出たかを覚えていない。選ぶ側には「どのユニットの能力か」が要る（#110）。
 *
 * `source` という名前で持つのは、解決を待っている能力（`duel.ts` の `TriggeredInstance`）と
 * 揃えるためである。**選ばせる時に見せる形は、能力の並ぶ場面すべてで同じになる**
 * （`protocol.ts` の `sourceOf`）。
 */
interface PlanReplacementCandidate {
  readonly ability: PlanReplacingAbility
  readonly source: CardId
}

/**
 * そのプレイヤーが適用することを選んだ、プランのめくりの置換効果。選ばなければ `undefined`。
 *
 * 置換効果を生み出しているのは、そのプレイヤーが支配するスクエアにあるユニットの常在型能力
 * である（総合ルール 第4部 第4章 1）。テキストが「あなたがプランをして」と書いているので、
 * 支配者自身がプランした時だけ働く。
 */
function chosenPlanReplacement(
  state: DuelState,
  player: Player,
  chooser: Chooser,
): PlanReplacingAbility | undefined {
  const candidates: readonly PlanReplacementCandidate[] = unitsOnSquares(state)
    .filter((unit) => unit.controller === player)
    .flatMap((unit) => planReplacingAbilitiesOf(unit.card).map((ability) => ({ ability, source: unit.id })))
  if (candidates.length === 0) return undefined

  // 「かわりに〜してよい」なので、選ばないことを選べる。
  const chosen = chooser(candidates, player, 'プランの置き換え', state, true)
  if (chosen === undefined) return undefined
  if (!candidates.includes(chosen as PlanReplacementCandidate)) throw new Error('候補にない置換効果が選ばれた')

  return (chosen as PlanReplacementCandidate).ability
}

/**
 * 敵エリアにあるユニットでスマッシュした時に、ＳＰに加えて与えるダメージ
 * （総合ルール 第3部 第9章 1 の (2) の行動）。
 */
const ENEMY_AREA_BONUS = 500

/**
 * スマッシュする（総合ルール 第3部 第9章 1）。
 *
 * アクティブプレイヤーが、自分のスマッシュフェイズの間、バンクが空で優先権を持っている時に
 * 行える特別な行動である。中央エリアにある自分のユニットを 1 枚フリーズすればそのユニットの
 * ＳＰと同じダメージを、敵エリアにある自分のユニットなら ＳＰ＋500 のダメージを、相手に
 * 与える。好きな順番で好きな回数行える（同）ので、行ったかどうかは覚えない。フリーズした
 * ユニットは同じフェイズにもう一度は選べないので、回数はそれで頭打ちになる。
 *
 * この特別な行動はバンクを使用せず、行った後は非アクティブプレイヤーが優先権を獲得する
 * （同 第4部 第5章 2）。与えたダメージが合計 1000 以上になっていれば、そこでスマッシュ判定が
 * 発生する（同 第14章 4-12、`smash.ts`）。
 *
 * スマッシュ判定の最中は行えない（ADR-0012、`priority.ts` の `activePlayerMayAct`）。
 * 同 第3部 第9章 1 には「バトル中以外」のような断りが無いが、バトル中に行えないのと同じ
 * 理由で、判定中にも行えない。スマッシュ判定中のスマッシュ判定（同 第17章 2-2）は、判定の
 * 中で解決される効果が与えるダメージから起こる（同 第20章 1 の【例】の「希望」）。
 */
export function smash(state: DuelState, unit: CardId): ActionOutcome {
  if (!activePlayerMayAct(state, 'スマッシュフェイズ')) return cannot('行える時ではない')

  const player = state.turn.active
  const smashing = smashingUnit(state, player, unit)
  if (smashing === undefined) return cannot('スマッシュできるユニットではない')

  const frozen = setOrientationOnSquare(state, unit, 'フリーズ')
  // 与えた量をログに残す（#95）。行った手そのものは `applyLegalAction` が残しているが、
  // どれだけのダメージになったかはユニットのＳＰと置かれているエリアで決まるので、盤面を
  // 見比べても分からない。
  const damaged = record(damagePlayer(frozen, opponentOf(player), smashing.damage), {
    kind: 'ダメージを受けた',
    player: opponentOf(player),
    amount: smashing.damage,
  })
  return done(grantPriorityToInactive(damaged))
}

/**
 * スマッシュできるユニットと、それが相手に与えるダメージ（総合ルール 第3部 第9章 1）。
 * スマッシュできるユニットでなければ `undefined`。
 *
 * 選べるのは、そのプレイヤーが支配する、中央エリアまたは敵エリアにあるユニットである。
 * エリアはスマッシュするプレイヤーから見て判断する（同 第2部 第22章 6-1）。フリーズ
 * できないユニットは選べない（同 第24章 1-1）ので、リリース状態のものだけを見る。
 */
function smashingUnit(
  state: DuelState,
  player: Player,
  id: CardId,
): { readonly damage: number } | undefined {
  const located = locateOnSquares(state, id)
  if (located === undefined) return undefined

  const { instance, square } = located
  if (instance.controller !== player) return undefined
  if (instance.card.type !== 'ユニット') return undefined
  if (instance.orientation !== 'リリース') return undefined

  const area: Area = areaOf(player, square)
  if (area === '味方エリア') return undefined

  return { damage: spOf(instance.card) + (area === '敵エリア' ? ENEMY_AREA_BONUS : 0) }
}

/**
 * トラップの廃棄（総合ルール 第2部 第20章 3-12）。自分のトラップゾーンにあるカードを
 * 自分の捨札に置く。
 *
 * バンクを使用せず即座に解決される（同 3-13）。
 */
export function discardTrap(state: DuelState, card: CardId): ActionOutcome {
  if (!activePlayerMayAct(state, 'メインフェイズ')) return cannot('行える時ではない')

  const player = state.turn.active
  if (findInZone(state, player, 'トラップゾーン', card) === undefined) return cannot('そのゾーンにない')

  return done(grantPriorityToInactive(moveToZone(state, card, '捨札')))
}

/**
 * 山札の 1 番上のカードを表返してプランゾーンに置く。
 *
 * すでにプランゾーンにカードがあるなら、先にそれを捨札に置く（総合ルール 第3部
 * 第8章 2-3）。プランゾーンにあるカードは同時に山札の 1 番上のカードでもある
 * （同 第2部 第21章 3-1）ので、それを取り除いて初めて次のカードが 1 番上になる。
 */
function turnUpTopOfLibrary(state: DuelState, player: Player): DuelState {
  const [current] = cardsIn(state, player, 'プランゾーン')
  const cleared = current === undefined ? state : moveToZone(state, current.id, '捨札')

  const top = topOfLibrary(cleared, player)
  // 何もめくれず、置き換えられたプランもなければ、この呼び出しは何もしていない（#111）。
  if (top === undefined && current === undefined) return cleared

  const placed = top === undefined ? cleared : moveToZone(cleared, top.id, 'プランゾーン')
  return record(placed, { kind: 'プランをめくった', player, card: top?.id, discarded: current?.id })
}
