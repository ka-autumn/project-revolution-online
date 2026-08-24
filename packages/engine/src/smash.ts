import { hopeOf } from './card.js'
import { satisfiesLevel } from './cost.js'
import { cardsIn, moveToZone, recoverDamage, topOfLibrary } from './duel.js'
import type { BankedAbility, CardId, CardInstance, DuelState } from './duel.js'
import { record } from './log.js'
import { PLAYERS } from './player.js'
import type { Player } from './player.js'
import { resolveEffect } from './resolve.js'
import type { Chooser } from './resolve.js'

/**
 * スマッシュ判定を構成するステップ（総合ルール 第3部 第17章 3）。
 *
 * それぞれのステップは、何も起こらない場合でも存在する（同）。並びは総合ルールの順の
 * ままだが、バトルのステップ（`battle.ts` の `BATTLE_STEPS`）と違って一直線には進まない。
 * 回復ステップは 1 回だけで、希望ステップと確定ステップは受けたダメージ 1000 ごとに 1 回
 * 繰り返される。
 */
export const SMASH_JUDGMENT_STEPS = ['回復ステップ', '希望ステップ', '確定ステップ'] as const

export type SmashJudgmentStep = (typeof SMASH_JUDGMENT_STEPS)[number]

/**
 * 発生しているスマッシュ判定 1 つ（総合ルール 第3部 第17章）。
 *
 * プレイヤーが合計 1000 以上のダメージを受けた時に発生する特別な手順であり、バンクを
 * 使用しないルールエフェクトである（同 1、第4部 第14章 4-12）。
 *
 * バトル（`battle.ts` の `Battle`）と同じように、待機させたバンクを持つ（同 第3部 第17章 2）。
 * **効果がプレイヤーにダメージを与える**（`effect.ts` の `damagePlayer`）ので、判定が発生する
 * 時点でバンクが空とは限らない。効果はバンクから解決されるためである。
 */
export interface SmashJudgment {
  /** ダメージを受けたプレイヤー。 */
  readonly player: Player
  readonly step: SmashJudgmentStep
  /**
   * 繰り返す希望ステップと確定ステップの回数（総合ルール 第3部 第17章 3）。
   *
   * 発生した時に受けていたダメージ 1000 ごとに 1 回である。回復ステップで回復する量も
   * この回数で決まる（同 第18章 1）ので、回復した後も持ち続ける。
   */
  readonly repeats: number
  /**
   * いま何回目の希望ステップと確定ステップか（同 3 の「第１希望ステップ」）。回復ステップの
   * 間は 0。
   */
  readonly round: number
  /**
   * 希望ステップでスマッシュゾーンに表向きで置かれたカード（総合ルール 第3部 第19章 1）。
   * 置かれていなければ `undefined`。
   *
   * スマッシュゾーンにあるカードが表向きか裏向きかを盤面が持っていない（`play.ts` の
   * `playAsTrap` 参照。置かれている場所から決まるものとして扱っている）ため、スマッシュ
   * ゾーンで唯一その区別が要るこの 1 枚をここで覚える。確定ステップで裏返されると
   * `undefined` に戻り、そのカードはスマッシュになる（同 第20章 1）。
   */
  readonly faceUp: CardId | undefined
  /**
   * スマッシュ判定によって待機中のバンク（総合ルール 第3部 第17章 2）。
   *
   * 判定が発生した時にバンクが使用中なら、そのバンクは待機中になり、解決する前にスマッシュ
   * 判定を開始する。待機中のバンクは判定が終了するまで存在しないものとして扱われ、判定中に
   * 誘発した能力は別の新しいバンク（`DuelState.bank`）で解決される。判定が終了した後、
   * 通常のバンクに戻って処理される（同 4）。バトルの `heldBank`（`battle.ts`）と同じ形。
   */
  readonly heldBank: readonly BankedAbility[]
  /**
   * バンクに入ることが予約されている状態で待機させられた能力（同 第17章 2）。
   *
   * 誘発しただけでまだバンクに入っていない能力（`DuelState.triggered`）も、判定が発生した
   * 時点で待機中のバンクと同じ扱いになる。バトルの `heldTriggered` と同じ。
   */
  readonly heldTriggered: readonly BankedAbility[]
}

/**
 * スマッシュ判定が発生するダメージの量（総合ルール 第4部 第14章 4-12）。希望ステップと
 * 確定ステップを 1 回繰り返す単位でもあり、回復ステップで回復する量でもある
 * （同 第3部 第17章 3、第18章 1）。
 */
const SMASH_JUDGMENT_DAMAGE = 1000

/**
 * そのプレイヤーのスマッシュ（総合ルール 第2部 第21章 7-2）。
 *
 * スマッシュゾーンにある「裏向きの」カードだけがスマッシュである。希望ステップで表向きに
 * 置かれているカードはスマッシュではない（同 第3部 第19章 1）ので、7 枚以上で敗北する
 * ルールエフェクト（同 第4部 第14章 4-1）はこれを数える。
 */
export function smashesOf(state: DuelState, player: Player): readonly CardInstance[] {
  const faceUp = state.smashJudgments.map((judgment) => judgment.faceUp)
  return cardsIn(state, player, 'スマッシュゾーン').filter((card) => !faceUp.includes(card.id))
}

/**
 * 1000 以上のダメージを受けているプレイヤーがいれば、そのスマッシュ判定を始める
 * （総合ルール 第3部 第17章 1、第4部 第14章 4-12）。いなければ盤面はそのまま。
 *
 * 呼ぶのはプレイヤーが優先権を獲得する時だけである（`priority.ts` の
 * `settleBeforePriority`）。スマッシュ判定が進行中でも、新しく発生したならそちらを先に
 * 処理する（同 第3部 第17章 2-2）ので、進行中かどうかは見ない。回復ステップでダメージが
 * 1000 未満まで回復する（同 第18章 1）ため、同じダメージで二重に発生することはない。
 *
 * 複数のプレイヤーが同時にダメージを受けた場合は、それぞれのスマッシュ判定が同時に処理
 * される（同 第17章 3 の【例】）。プレイヤーにダメージを与えるのはスマッシュ（同 第9章 1）
 * だけで、それが与える相手は 1 人なので、いまは同時に発生しない。ここでは先攻から順に
 * 見て 1 つだけ始める。
 *
 * 優先権をここでは動かさない。ステップの始めに非アクティブプレイヤーが優先権を獲得する
 * （同 第18章 1）のは呼ぶ側の仕事である。
 */
export function startSmashJudgmentIfAny(state: DuelState): DuelState {
  const damaged = PLAYERS.find((player) => state.damage[player] >= SMASH_JUDGMENT_DAMAGE)
  if (damaged === undefined) return state

  const judgment: SmashJudgment = {
    player: damaged,
    step: '回復ステップ',
    repeats: Math.floor(state.damage[damaged] / SMASH_JUDGMENT_DAMAGE),
    round: 0,
    faceUp: undefined,
    // バンクとバンクに入ることが予約されている能力を、判定が終わるまで待機させる
    // （総合ルール 第3部 第17章 2）。この後で誘発する能力は新しいバンクに入る。
    heldBank: state.bank,
    heldTriggered: state.triggered,
  }

  // 判定を盤面に載せる**前に**積む。そうすると、この行は自分自身の判定の中には入らず、手順の
  // 見出しとして外側に立つ（`log.ts` の `LoggedEvent.during`、#133）。処理中の判定があれば、
  // それはこの判定が終わるまで待機中になる（総合ルール 第3部 第17章 2-2）。
  const held = state.smashJudgments.at(-1)
  const waiting =
    held === undefined ? state : record(state, { kind: 'スマッシュ判定が待機中になった', player: held.player })
  const announced = record(waiting, {
    kind: 'スマッシュ判定が始まった',
    player: damaged,
    repeats: judgment.repeats,
  })

  const started = {
    ...announced,
    smashJudgments: [...announced.smashJudgments, judgment],
    bank: [],
    triggered: [],
  }
  // 回復ステップの処理には選択が要らないので、ここは `chooser` を持たずに始められる。
  return beginRecoveryStep(recordStep(started, judgment), judgment)
}

/**
 * 処理中のスマッシュ判定を 1 ステップ進める。
 *
 * 呼ぶのは、バンクが空で両方のプレイヤーが連続して優先権を放棄した時だけである
 * （総合ルール 第3部 第4章 4）。フェイズのかわりに、進行中のステップが終了する。
 *
 * 確定ステップを終えた時、繰り返しが残っていれば次の希望ステップに戻り、残っていなければ
 * そのスマッシュ判定が終了する（同 第17章 3）。待機中のスマッシュ判定があれば、それが
 * 通常のスマッシュ判定に戻って残りの手順が処理される（同 2-2）。
 *
 * ステップが進んだ後は、どのステップでも非アクティブプレイヤーが優先権を獲得する
 * （同 第18章 1・第19章 1・第20章 1）。それは呼ぶ側（`progress.ts`）が行う。
 */
export function advanceSmashJudgment(
  state: DuelState,
  judgment: SmashJudgment,
  chooser: Chooser,
): DuelState {
  const next = nextStep(judgment)
  if (next === undefined) return endSmashJudgment(state, judgment)

  // 希望ステップに入るたびに 1 回繰り返したことになる（総合ルール 第3部 第17章 3）。
  const round = next === '希望ステップ' ? judgment.round + 1 : judgment.round
  return beginStep(state, { ...judgment, step: next, round }, chooser)
}

/**
 * スマッシュ判定を終了する（総合ルール 第3部 第17章 3・4）。
 *
 * 待機していたバンク（及びバンクに乗ることが予約されている能力）は、通常のバンクに戻って
 * 処理される（同 4、第17章 2）。判定中のバンクはこの時点で空である（空でなければ連続した
 * 放棄にならず、ここへは来ない）。バトルの `endBattle`（`battle.ts`）と同じ形。
 *
 * **終わらせるのは並びの最後の判定である。** 判定中にもう 1 つ発生した場合（同 2-2）、
 * 後から発生したほうが先に終わり、待機していた前の判定が残りの手順を続ける。それぞれが
 * 自分の待機中のバンクを持っているので、戻す先を取り違えることはない。
 */
function endSmashJudgment(state: DuelState, judgment: SmashJudgment): DuelState {
  const ended = {
    ...state,
    smashJudgments: state.smashJudgments.slice(0, -1),
    bank: [...state.bank, ...judgment.heldBank],
    triggered: [...state.triggered, ...judgment.heldTriggered],
  }
  // 並びから外した**後に**積む。見出しは手順の外側に立つ（`log.ts` の `LoggedEvent.during`）。
  const closed = record(ended, { kind: 'スマッシュ判定が終わった', player: judgment.player })
  const resumed = closed.smashJudgments.at(-1)
  return resumed === undefined
    ? closed
    : record(closed, { kind: 'スマッシュ判定が戻った', player: resumed.player })
}

/** 次に進むステップ。そのスマッシュ判定が終わるなら `undefined`。 */
function nextStep(judgment: SmashJudgment): SmashJudgmentStep | undefined {
  if (judgment.step !== '確定ステップ') {
    return SMASH_JUDGMENT_STEPS[SMASH_JUDGMENT_STEPS.indexOf(judgment.step) + 1]
  }
  return judgment.round < judgment.repeats ? '希望ステップ' : undefined
}

/**
 * 始まったステップの、始めの処理を行う。
 *
 * 回復ステップはダメージを回復し（総合ルール 第3部 第18章 1）、希望ステップは山札の
 * 1 番上をスマッシュゾーンに表向きで置いて「希望」をチェックし（同 第19章 1）、確定ステップは
 * それを裏返す（同 第20章 1）。バトルにおける `battle.ts` の `beginStep` と同じ位置づけ。
 */
function beginStep(state: DuelState, judgment: SmashJudgment, chooser: Chooser): DuelState {
  const begun = recordStep(state, judgment)
  switch (judgment.step) {
    case '回復ステップ':
      return beginRecoveryStep(begun, judgment)
    case '希望ステップ':
      return beginHopeStep(begun, judgment, chooser)
    case '確定ステップ':
      // 表向きで置かれているカードを裏返す。裏向きになったカードはスマッシュとして扱われる
      // （総合ルール 第3部 第20章 1）。
      return withJudgment(begun, { ...judgment, faceUp: undefined })
  }
}

/**
 * ステップが始まったことを積む（総合ルール 第3部 第17章 3、#133）。
 *
 * 判定が始まった時の回復ステップ（`startSmashJudgmentIfAny`）と、進んだ先のステップ
 * （`beginStep`）の両方がここを通る。始めの処理より前に積むので、そのステップで起きたことが
 * 後ろに並ぶ。
 */
function recordStep(state: DuelState, judgment: SmashJudgment): DuelState {
  return record(state, {
    kind: 'スマッシュ判定のステップが変わった',
    player: judgment.player,
    step: judgment.step,
    round: judgment.round,
  })
}

/**
 * 回復ステップの始めの処理（総合ルール 第3部 第18章 1）。
 *
 * 受けたダメージを、この時に発生した希望ステップの回数 1 回につき 1000 回復する。
 *
 * **積むのは実際に減った量である（#157）。** 受けているダメージより多く回復することは
 * ないので、回数から決まる回復量をそのまま積むと、減っていない分まで数えてしまう。
 *
 * 1 も減らなければ何も積まない。いまのところそこへは来ない——判定はダメージが 1000 以上
 * ある時にしか発生せず、回数はそのダメージを 1000 で割った数（`startSmashJudgmentIfAny`）
 * なので、回復量が 0 になることも、受けている量を超えることもない。回復ステップがあった
 * こと自体は `スマッシュ判定のステップが変わった` が言っている。
 */
function beginRecoveryStep(state: DuelState, judgment: SmashJudgment): DuelState {
  const { player } = judgment
  const recovered = recoverDamage(state, player, judgment.repeats * SMASH_JUDGMENT_DAMAGE)
  const amount = state.damage[player] - recovered.damage[player]
  const applied = withJudgment(recovered, judgment)
  if (amount === 0) return applied

  return record(applied, { kind: 'ダメージを回復した', player, amount }, state)
}

/**
 * 希望ステップの始めの処理（総合ルール 第3部 第19章 1）。
 *
 * ダメージを受けたプレイヤーが、自分の山札の 1 番上のカードを、自分のスマッシュゾーンに
 * リリース状態で表向きに置く。プランゾーンにカードがあるならそれが山札の 1 番上なので
 * （同 第2部 第21章 3-1）、それが置かれる（同 7-3 の【例】）。
 *
 * 山札が空なら置くカードが無い。実際にはそこへ来ない。山札が 0 枚以下になったプレイヤーは
 * 次に優先権が発生した時に敗北する（同 第3部 第3章 2）ので、最後の 1 枚を置いた希望ステップ
 * の後の優先権でデュエルが終わり、次の希望ステップは始まらないためである。
 *
 * 表向きに置いたことをログに残す。確定ステップで裏返されればスマッシュとして誰からも
 * 見えなくなる（同 第20章 1）ので、このできごとが唯一その正体を見せる機会になる。**名前を
 * 焼き込んで持つ。** 一度見せたものを、裏返された後の見え方から改めて引き直しはしない
 * （`log.ts` の `DuelEvent`）。
 */
function beginHopeStep(state: DuelState, judgment: SmashJudgment, chooser: Chooser): DuelState {
  const top = topOfLibrary(state, judgment.player)
  if (top === undefined) return withJudgment(state, { ...judgment, faceUp: undefined })

  const moved = withJudgment(moveToZone(state, top.id, 'スマッシュゾーン'), { ...judgment, faceUp: top.id })
  const placed = record(moved, {
    kind: '希望ステップでめくった',
    player: judgment.player,
    card: top.id,
    name: top.card.name,
  })
  return resolveHope(placed, top, chooser)
}

/**
 * スマッシュゾーンに表向きで置かれたカードが「希望」を持っていれば、その効果を解決する
 * （総合ルール 第3部 第19章 1、第5部 第3章）。
 *
 * 解決するのは、そのカードの支配者のエネルギーゾーンにそのカードと同じ色のカードがあり、
 * かつレベル以上の枚数のカードがある場合だけである（同 第5部 第3章 2）。この 2 つは、
 * カードをプレイするために「レベルを満たす」条件（同 第1部 第2章 3-1）を言い換えたもの
 * なので、`satisfiesLevel` を使う。レベルに色付きのエネルギー・シンボルが複数ある場合に
 * そのすべてを要求するかどうかは同 3-1 の読み方の問題であり、`cost.ts` の読み方に合わせて
 * いる。コストの支払いは要らない（同 第5部 第3章 3）。
 *
 * 「希望」は特別な能力であり、解決にはバンクを使用しない（同 第3部 第19章 1、第5部
 * 第3章 1）。
 *
 * 複数プレイヤーのカードが同時に表向きで置かれた場合、アクティブプレイヤーの「希望」から
 * 先に解決する（同 1-2）が、いまスマッシュ判定は 1 人にしか発生しない
 * （`startSmashJudgmentIfAny`）ため、解決するのは 1 つだけである。
 */
function resolveHope(state: DuelState, placed: CardInstance, chooser: Chooser): DuelState {
  const hope = hopeOf(placed.card)
  if (hope === undefined) return state

  // スマッシュゾーンに置かれたカードの支配者は持ち主に戻っている（`duel.ts` の `moveToZone`）。
  const controller = placed.owner
  if (!satisfiesLevel(state, controller, placed.card)) return state

  return resolveEffect(state, hope.effect, { controller, via: '希望', source: placed.id, chooser })
}

/** 処理中のスマッシュ判定を差し替える。 */
function withJudgment(state: DuelState, judgment: SmashJudgment): DuelState {
  return {
    ...state,
    smashJudgments: [...state.smashJudgments.slice(0, -1), judgment],
  }
}
