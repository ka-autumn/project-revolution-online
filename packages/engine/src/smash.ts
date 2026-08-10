import { hopeOf } from './card.js'
import { satisfiesLevel } from './cost.js'
import { cardsIn, moveToZone, recoverDamage, topOfLibrary } from './duel.js'
import type { CardId, CardInstance, DuelState } from './duel.js'
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
  }
  // 回復ステップの処理には選択が要らないので、ここは `chooser` を持たずに始められる。
  return beginRecoveryStep({ ...state, smashJudgments: [...state.smashJudgments, judgment] }, judgment)
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
  if (next === undefined) {
    return { ...state, smashJudgments: state.smashJudgments.slice(0, -1) }
  }

  // 希望ステップに入るたびに 1 回繰り返したことになる（総合ルール 第3部 第17章 3）。
  const round = next === '希望ステップ' ? judgment.round + 1 : judgment.round
  return beginStep(state, { ...judgment, step: next, round }, chooser)
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
  switch (judgment.step) {
    case '回復ステップ':
      return beginRecoveryStep(state, judgment)
    case '希望ステップ':
      return beginHopeStep(state, judgment, chooser)
    case '確定ステップ':
      // 表向きで置かれているカードを裏返す。裏向きになったカードはスマッシュとして扱われる
      // （総合ルール 第3部 第20章 1）。
      return withJudgment(state, { ...judgment, faceUp: undefined })
  }
}

/**
 * 回復ステップの始めの処理（総合ルール 第3部 第18章 1）。
 *
 * 受けたダメージを、この時に発生した希望ステップの回数 1 回につき 1000 回復する。
 */
function beginRecoveryStep(state: DuelState, judgment: SmashJudgment): DuelState {
  const recovered = recoverDamage(state, judgment.player, judgment.repeats * SMASH_JUDGMENT_DAMAGE)
  return withJudgment(recovered, judgment)
}

/**
 * 希望ステップの始めの処理（総合ルール 第3部 第19章 1）。
 *
 * ダメージを受けたプレイヤーが、自分の山札の 1 番上のカードを、自分のスマッシュゾーンに
 * リリース状態で表向きに置く。プランゾーンにカードがあるならそれが山札の 1 番上なので
 * （同 第2部 第21章 3-1）、それが置かれる（同 7-3 の【例】）。
 *
 * 山札が空なら置くカードが無い。そのプレイヤーは次に優先権が発生した時に敗北する
 * （同 第3部 第3章 2）ので、このスマッシュ判定はそこで終わる。
 */
function beginHopeStep(state: DuelState, judgment: SmashJudgment, chooser: Chooser): DuelState {
  const top = topOfLibrary(state, judgment.player)
  if (top === undefined) return withJudgment(state, { ...judgment, faceUp: undefined })

  const placed = withJudgment(moveToZone(state, top.id, 'スマッシュゾーン'), { ...judgment, faceUp: top.id })
  return resolveHope(placed, top, chooser)
}

/**
 * スマッシュゾーンに表向きで置かれたカードが「希望」を持っていれば、その効果を解決する
 * （総合ルール 第3部 第19章 1、第5部 第3章）。
 *
 * 解決するのは、そのカードの支配者のエネルギーゾーンにそのカードと同じ色のカードがあり、
 * かつレベル以上の枚数のカードがある場合だけである（同 第5部 第3章 2）。これはカードを
 * プレイするためにレベルを満たす条件（同 第1部 第2章 3-1）と同じなので、`satisfiesLevel`
 * を使う。「希望」は特別な行動であり、解決にはバンクを使用しない（同 第3部 第19章 1）。
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

  return resolveEffect(state, hope.effect, { controller, chooser })
}

/** 処理中のスマッシュ判定を差し替える。 */
function withJudgment(state: DuelState, judgment: SmashJudgment): DuelState {
  return {
    ...state,
    smashJudgments: [...state.smashJudgments.slice(0, -1), judgment],
  }
}
