import { phaseBeginning } from './ability.js'
import { resolveFromBank, trigger } from './bank.js'
import { advanceBattle } from './battle.js'
import { draw, hasEnded, releaseAll, removeAllDamage } from './duel.js'
import type { DuelState } from './duel.js'
import { opponentOf } from './player.js'
import { grantPriorityToInactive, settleBeforePriority } from './priority.js'
import type { Chooser } from './resolve.js'
import { advanceSmashJudgment } from './smash.js'
import { loseTrapRightOnPass } from './trap.js'
import { PHASES, beginPhase } from './turn.js'
import type { Turn } from './turn.js'

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
 * 発動する権利を失う（総合ルール 第2部 第20章 3-8）。
 */
export function passPriority(state: DuelState, chooser: Chooser): DuelState {
  if (hasEnded(state)) return state

  const cleared = loseTrapRightOnPass(state, state.turn.priority)
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
 */
function beginNextPhase(state: DuelState): DuelState {
  const { turn } = state
  const next = PHASES[PHASES.indexOf(turn.phase) + 1]
  const begun =
    next === undefined
      ? beginPhase(turn.number + 1, opponentOf(turn.active), PHASES[0])
      : beginPhase(turn.number, turn.active, next)

  return beginCurrentPhase({ ...state, turn: begun })
}

/**
 * 始まったフェイズの、始めの処理を行う。
 *
 * とばされるフェイズなら、そのフェイズは存在しないものとして次のフェイズに進む
 * （総合ルール 第3部 第4章 5）。
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
  if (isSkipped(state.turn)) return beginNextPhase(state)

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
 */
function takeBeginningAction(state: DuelState): DuelState {
  if (state.turn.phase === 'リリースフェイズ') return releaseAll(state, state.turn.active)
  if (state.turn.phase === 'ドローフェイズ') return draw(state, state.turn.active)
  if (state.turn.phase === 'リカバリーフェイズ') return removeAllDamage(state)
  return state
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
