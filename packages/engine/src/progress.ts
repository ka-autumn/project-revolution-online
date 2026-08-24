import { phaseBeginning } from './ability.js'
import { resolveFromBank } from './bank.js'
import { advanceBattle } from './battle.js'
import { draw, frozenCardsOf, hasEnded, releaseAll, removeAllDamage, topOfLibrary } from './duel.js'
import type { DuelState } from './duel.js'
import { record } from './log.js'
import type { Progress } from './log.js'
import { opponentOf } from './player.js'
import { grantPriorityToInactive, settleBeforePriority } from './priority.js'
import type { Chooser } from './resolve.js'
import { advanceSmashJudgment } from './smash.js'
import { loseCourageRightOnPass } from './courage.js'
import { loseTrapRightOnPass } from './trap.js'
import { trigger } from './trigger.js'
import { PHASES, beginPhase } from './turn.js'
import type { Phase, Turn } from './turn.js'

/**
 * 優先権を放棄した時に起きること（#130）。
 *
 * **数え上げられる。** `passPriority` が振り分ける先がそのまま並ぶので、述語ではなく値で
 * 持つ。画面はこれを言葉にするだけで、どれになるかを自分で決めない（ADR-0010）。
 */
export type PassOutcome =
  /** もう一方のプレイヤーに優先権が移るだけ（総合ルール 第3部 第4章 4）。連続した放棄の 1 回目。 */
  | { readonly kind: '相手に渡る' }
  /** バンクにある能力が 1 つ解決される（同、第4部 第5章 2）。フェイズは終わらない。 */
  | { readonly kind: 'バンクを解決する' }
  /** 進行中のバトルかスマッシュ判定のステップが進む（同 第3部 第4章 4）。 */
  | { readonly kind: 'ステップが進む' }
  /** リカバリーフェイズで「ターンの終わり」の能力が誘発する（同 第10章 3）。フェイズは終わらない。 */
  | { readonly kind: 'ターンの終わりの能力が誘発する' }
  /** そのターンの次のフェイズが始まる。とばされるフェイズは飛ばした後の名前が入る（同 第4章 5）。 */
  | { readonly kind: 'フェイズが変わる'; readonly next: Phase }
  /** ターンが終わり、相手のターンになる。 */
  | { readonly kind: 'ターンが終わる' }

/**
 * 優先権を持っているプレイヤーが、それを放棄する。
 *
 * 両方のプレイヤーが連続して放棄した時、バンクに能力があればそれを 1 つ解決し、バンクが
 * 空なら進行中のフェイズが終了する（総合ルール 第3部 第4章 4、第4部 第5章 2）。
 * そうでなければ、もう一方のプレイヤーに優先権が移るだけである。
 *
 * バトルやスマッシュ判定の最中なら、終了するのはフェイズではなくステップである
 * （同 第3部 第4章 4）。
 *
 * 勝敗が決まったデュエルでは何も起こらない。デュエルは即座に終了する（同 第3章 3）ので、
 * そこから先に優先権は発生しない。
 *
 * 誰が優先権を持っているかは盤面にあるので、放棄するプレイヤーは受け取らない。かわりに
 * `chooser` を受け取る。連続放棄でバンクにある能力を解決する時、どれを解決するかと、その
 * 能力の効果が何を選ぶかを決めるのに要るためである。
 *
 * 優先権を持っていたプレイヤーは、この放棄によって自分のトラップゾーンにあるカードが
 * 発動する権利（総合ルール 第2部 第20章 3-8）と、手札にある「勇気」を起動する権利
 * （同 第5部 第2章 2）を失う。
 */
export function passPriority(state: DuelState, chooser: Chooser): DuelState {
  if (hasEnded(state)) return state

  const cleared = loseCourageRightOnPass(loseTrapRightOnPass(state, state.turn.priority), state.turn.priority)
  const { turn } = cleared
  if (turn.passedBy === undefined) {
    const passed = { ...turn, priority: opponentOf(turn.priority), passedBy: turn.priority }
    return settleBeforePriority({ ...cleared, turn: passed })
  }
  if (cleared.bank.length > 0) {
    // 解決の後、非アクティブプレイヤーが優先権を獲得する（総合ルール 第4部 第5章 2）。
    // 連続した放棄はここで途切れる。
    return grantPriorityToInactive(resolveFromBank(cleared, chooser))
  }
  // バトルやスマッシュ判定の最中なら、終わるのはフェイズではなく進行中のステップである
  // （総合ルール 第3部 第4章 4）。どのステップも、進んだ後に非アクティブプレイヤーが
  // 優先権を獲得する（同 第12章 1・第13章 1・第14章 1・第15章 1・第16章 1、
  // 第18章 1・第19章 1・第20章 1）。
  //
  // 処理中のスマッシュ判定は並びの最後にある（`duel.ts` の `smashJudgments`）。バトルより
  // 先に見るのは、バトル中にスマッシュ判定が発生したならスマッシュ判定を先に処理する
  // （同 第11章 2-2）ためである。
  const judgment = cleared.smashJudgments.at(-1)
  if (judgment !== undefined) {
    return grantPriorityToInactive(advanceSmashJudgment(cleared, judgment, chooser))
  }
  if (cleared.battle !== undefined) {
    return grantPriorityToInactive(advanceBattle(cleared, cleared.battle))
  }
  if (turn.phase === 'リカバリーフェイズ' && !turn.endOfTurnTriggered) {
    return endTurnAbilities(cleared)
  }
  return beginNextPhase(cleared)
}

/**
 * いま優先権を放棄したら何が起きるか（#130）。放棄しても何も起きないなら `undefined`。
 *
 * **ルールの判断には使わない。** 押す前に「このボタンが何をするのか」を伝えるためだけに持つ
 * （`resolve.ts` の `ChoicePurpose` と同じ考え方）。`優先権を放棄する` は総合ルールの語
 * （第3部 第4章 4）そのままで、打っている側から見ると何が起きるのか分かりにくい。
 *
 * **`passPriority` のすぐ隣に置き、同じ順で振り分ける。** 画面がこれを言い当てるには
 * 分岐表とフェイズの並びが要るが、それをクライアントへ写すと進行の規則が 2 か所になる
 * （ADR-0010）。ここで 1 度だけ決めて、値として渡す。
 */
export function passOutcome(state: DuelState): PassOutcome | undefined {
  if (hasEnded(state)) return undefined

  const { turn } = state
  if (turn.passedBy === undefined) return { kind: '相手に渡る' }
  if (state.bank.length > 0) return { kind: 'バンクを解決する' }
  if (state.smashJudgments.length > 0 || state.battle !== undefined) return { kind: 'ステップが進む' }
  if (turn.phase === 'リカバリーフェイズ' && !turn.endOfTurnTriggered) {
    return { kind: 'ターンの終わりの能力が誘発する' }
  }

  const after = turnAfter(turn)
  return after.number === turn.number
    ? { kind: 'フェイズが変わる', next: after.phase }
    : { kind: 'ターンが終わる' }
}

/**
 * リカバリーフェイズで「ターンの終わり」に誘発する能力を誘発させる
 * （総合ルール 第3部 第10章 3）。
 *
 * リカバリーフェイズだけは、バンクが空で連続して優先権が放棄されてもそこでは終わらない。
 * 「ターンの終わり」の能力がバンクに入り、それらを解決した後、もう一度バンクが空で連続して
 * 放棄された時に終了する（同 3・4）。
 *
 * 同 4 には、1〜3 の間に誘発イベントかルールエフェクトが発生していた場合は 1 からやり直す
 * とある。やり直しても結果が変わらないため、まだ実装していない。やり直しで行うのは
 * ダメージの除去と「ターンの終わりまで」の効果の終了（同 1）だが、ダメージを与えるのは
 * バトルダメージだけ（`battle.ts`）で、バトルが発生するにはユニットがスクエアに置かれる
 * 必要があり、リカバリーフェイズにそれは起こらない。継続効果は盤面がまだ持っていない。
 * 「リカバリーフェイズの始め」と「ターンの終わり」の能力はそのターン中に 1 度しか誘発
 * しない（同 5）ので、能力が誘発し直すこともない。
 */
function endTurnAbilities(state: DuelState): DuelState {
  const triggered = trigger(state, 'ターンの終わり')
  return grantPriorityToInactive({
    ...triggered,
    turn: { ...triggered.turn, endOfTurnTriggered: true },
  })
}

/**
 * 進行中のフェイズを終え、次のフェイズを始める。
 *
 * すべてのフェイズが終了したらそのターンは終了し、アクティブプレイヤーが交代して次の
 * ターンに移る（総合ルール 第3部 第4章 6）。
 *
 * **移り変わりをログに積むのはここだけである**（#133）。ターンの境目もフェイズの移り変わりも
 * `turnAfter` が 1 つの遷移として決めるので、積まれるできごとも 1 件になる。フェイズの始めの
 * 処理（`beginCurrentPhase`）より前に積むことで、そのフェイズで起きたことが後ろに並ぶ。
 */
function beginNextPhase(state: DuelState): DuelState {
  const after = turnAfter(state.turn)
  const changed = record(state, { kind: '進行が変わった', from: progressOf(state.turn), to: progressOf(after) })
  return beginCurrentPhase({ ...changed, turn: after })
}

/** ターンのうち、進行がどこまで来ているかを表すところだけ（`log.ts` の `Progress`）。 */
function progressOf(turn: Turn): Progress {
  return { turn: turn.number, active: turn.active, phase: turn.phase }
}

/**
 * 次に始まるフェイズ。とばされるフェイズは存在しないものとして飛ばす（総合ルール 第3部
 * 第4章 5）。最後のフェイズの次はターンの境目で、相手のターンの最初のフェイズになる。
 *
 * **どのフェイズが次に来るかを決めるのはここだけである。** 実際に始める側（`beginNextPhase`）
 * と、押す前に何が起きるかを言う側（`passOutcome`）が同じところを通る。片方だけ直すと、
 * 画面が言うことと実際の進み方がずれる。
 */
function turnAfter(turn: Turn): Turn {
  const next = PHASES[PHASES.indexOf(turn.phase) + 1]
  const begun =
    next === undefined
      ? beginPhase(turn.number + 1, opponentOf(turn.active), PHASES[0])
      : beginPhase(turn.number, turn.active, next)

  return isSkipped(begun) ? turnAfter(begun) : begun
}

/**
 * 始まったフェイズの、始めの処理を行う。
 *
 * とばされるフェイズはここへ来ない。飛ばすのは次のフェイズを決めるところ（`turnAfter`）の
 * 仕事である（総合ルール 第3部 第4章 5）。
 *
 * どのフェイズも、始めの特別な行動を行い、次に「～の始め」に誘発する能力をバンクに入れ、
 * その後に非アクティブプレイヤーに優先権が発生する、という順で始まる（同 第5章 1・
 * 第6章 1-1・第7章 1・第8章 1・第9章 1・第10章 1）。誰が優先権を持つかは `beginPhase`
 * がすでに決めているので、ここでは行動と誘発だけを順に行う。
 *
 * エネルギーフェイズとスマッシュフェイズのアクティブプレイヤーの行動（同 第7章 1・
 * 第9章 1）はここには来ない。どちらも優先権が発生して「それらを解決した後」に、バンクが
 * 空で優先権を持っている時に行うものであって、フェイズの始めの処理ではない。
 */
function beginCurrentPhase(state: DuelState): DuelState {
  return settleBeforePriority(triggerBeginning(takeBeginningAction(state)))
}

/**
 * フェイズの始めの特別な行動。この行動はバンクを使用しない（総合ルール 第3部 第5章 1
 * ほか、各フェイズの 1）。
 *
 * 行うのはリリースフェイズのリリース（同 第5章 1）と、ドローフェイズのドロー（同
 * 第6章 1-1）と、リカバリーフェイズのダメージの除去（同 第10章 1）である。ダメージと
 * 同時に終了する「ターンの終わりまで」「このターンの間」の効果（同）は、継続効果を盤面が
 * 持つようになってから足す。
 *
 * **どれも積む（#157）。** 自動で行われる処理は、盤面だけを見ても何が起きたのか読めない。
 * ただし**行われなかった処理は積まない**——リリースするカードが無いフェイズに「リリース
 * した」とは書かない。フェイズがあったこと自体は `進行が変わった` が言っている。
 */
function takeBeginningAction(state: DuelState): DuelState {
  if (state.turn.phase === 'リリースフェイズ') return release(state)
  if (state.turn.phase === 'ドローフェイズ') return drawOne(state)
  if (state.turn.phase === 'リカバリーフェイズ') return removeDamage(state)
  return state
}

/**
 * リリースフェイズのリリース（総合ルール 第3部 第5章 1）。
 *
 * リリースするカードは、盤面を変える前にゾーンごとに数え上げる（`frozenCardsOf`）。向きが
 * 変わるだけなので、後から見比べても「どれが変わったか」は読めないためである。
 */
function release(state: DuelState): DuelState {
  const player = state.turn.active
  const frozen = frozenCardsOf(state, player)
  if (frozen.length === 0) return state

  const released = frozen.map(({ zone, cards }) => ({ zone, count: cards.length, cards }))
  return record(releaseAll(state, player), { kind: 'リリースした', player, released }, state)
}

/**
 * ドローフェイズのドロー（総合ルール 第3部 第6章 1-1）。
 *
 * 山札が空なら引けず、何も積まない。山札が 0 枚になったプレイヤーが敗北すること（同
 * 第3章 2）は別のルールエフェクトである（`rule-effect.ts`）。
 *
 * 引いたカードは識別子で持つ。誰から見えるかを決めるのは射影であって、ここではない
 * （ADR-0011、`perspective.ts`）。
 */
function drawOne(state: DuelState): DuelState {
  const player = state.turn.active
  const top = topOfLibrary(state, player)
  if (top === undefined) return state

  return record(draw(state, player), { kind: 'カードを引いた', player, card: top.id }, state)
}

/**
 * リカバリーフェイズのダメージの除去（総合ルール 第3部 第10章 1）。
 *
 * どこにもダメージが無ければ盤面は変わらない（`removeAllDamage`）ので、そのまま返して
 * 何も積まない。
 */
function removeDamage(state: DuelState): DuelState {
  const removed = removeAllDamage(state)
  if (removed === state) return state

  return record(removed, { kind: 'ダメージが取り除かれた' }, state)
}

/**
 * フェイズの始めに誘発する能力を誘発させる。
 *
 * ターンの始めに誘発する能力はリリースフェイズの始めに誘発する（総合ルール 第3部
 * 第5章 1）。ターンの始めはリリースフェイズの始めとは別のできごとなので、別に誘発させる。
 *
 * リリースによる「リリースした時」（同 第5章 1）やドローによる「カードを引いた時」
 * （同 第6章 1-1）は、その行動そのものが誘発イベントであり、フェイズの始めに限って
 * 起こるわけではない。それぞれの行動を実装する時に、行動の側から誘発させる。
 */
function triggerBeginning(state: DuelState): DuelState {
  const { phase } = state.turn
  const begun = phase === 'リリースフェイズ' ? trigger(state, 'ターンの始め') : state
  return trigger(begun, phaseBeginning(phase))
}

/**
 * 先攻のプレイヤーは第 1 ターンのドローフェイズをとばす（総合ルール 第3部 第2章 2、
 * 第6章 1-2）。第 1 ターンは必ず先攻のターンである（同 第4章 1）。
 */
function isSkipped(turn: Turn): boolean {
  return turn.phase === 'ドローフェイズ' && turn.number === 1
}
