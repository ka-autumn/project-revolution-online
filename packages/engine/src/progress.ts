import { phaseBeginning } from './ability.js'
import { putTriggeredIntoBank, resolveFromBank, trigger } from './bank.js'
import { draw } from './duel.js'
import type { DuelState } from './duel.js'
import { opponentOf } from './player.js'
import type { Chooser } from './resolve.js'
import { checkRuleEffects } from './rule-effect.js'
import { PHASES, beginPhase } from './turn.js'
import type { Turn } from './turn.js'

/**
 * 優先権を持っているプレイヤーが、それを放棄する。
 *
 * 両方のプレイヤーが連続して放棄した時、バンクに能力があればそれを 1 つ解決し、バンクが
 * 空なら進行中のフェイズが終了する（総合ルール 第3部 第4章 4、第4部 第5章 2）。
 * そうでなければ、もう一方のプレイヤーに優先権が移るだけである。
 *
 * バトルまたはスマッシュ判定の最中なら、終了するのはフェイズではなくステップである
 * （同 第3部 第4章 4）が、ステップはまだ無い。
 *
 * 誰が優先権を持っているかは盤面にあるので、放棄するプレイヤーは受け取らない。かわりに
 * `chooser` を受け取る。連続放棄でバンクにある能力を解決する時、どれを解決するかと、その
 * 能力の効果が何を選ぶかを決めるのに要るためである。
 */
export function passPriority(state: DuelState, chooser: Chooser): DuelState {
  const { turn } = state
  if (turn.passedBy === undefined) {
    const passed = { ...turn, priority: opponentOf(turn.priority), passedBy: turn.priority }
    return settleBeforePriority({ ...state, turn: passed })
  }
  if (state.bank.length > 0) {
    // 解決の後、非アクティブプレイヤーが優先権を獲得する（総合ルール 第4部 第5章 2）。
    // 連続した放棄はここで途切れる。
    return grantPriorityToInactive(resolveFromBank(state, chooser))
  }
  if (turn.phase === 'リカバリーフェイズ' && !turn.endOfTurnTriggered) {
    return endTurnAbilities(state)
  }
  return beginNextPhase(state)
}

/**
 * プレイヤーが優先権を獲得するにあたって、その手前で片づけておくこと
 * （総合ルール 第4部 第14章 2、第7章 2）。
 *
 * まず、すべてのルールエフェクトをチェックして解決する。それによって新しいルールエフェクト
 * が発生するなら、それも解決する。発生しなくなったら、誘発していた誘発型能力がすべて
 * バンクに入る。新しいルールエフェクトの発生も誘発型能力の誘発もなくなるまで、この手順を
 * 繰り返す。
 *
 * 誰が優先権を持つかはここでは変えない。それを決めるのは呼ぶ側である。この手順は優先権を
 * 得るのが誰であるかに影響されない（ルールエフェクトはどちらのプレイヤーにも支配されず、
 * 誘発型能力は自動的にバンクに入る）ため、プレイヤーを受け取らない。
 *
 * バンクに誘発型能力が入った時にも非アクティブプレイヤーに優先権が発生する（同 第1部
 * 第1章 5）。いま能力がバンクに入るのは、フェイズの始めと、能力を解決した後と、
 * リカバリーフェイズの「ターンの終わり」だけで、どれも非アクティブプレイヤーが優先権を
 * 獲得する場面である。そのため優先権の移動は起こらず、ここでは扱っていない。
 */
function settleBeforePriority(state: DuelState): DuelState {
  let current = state
  for (;;) {
    // 何も発生していなければ `checkRuleEffects` は渡した盤面をそのまま返すので、
    // 新しいルールエフェクトが発生したかどうかは盤面が入れ替わったかで分かる。
    // ルールエフェクトはカードをスクエアから取り除くだけなので、いつか発生しなくなる。
    const checked = checkRuleEffects(current)
    if (checked !== current) {
      current = checked
      continue
    }
    if (current.triggered.length === 0) return current
    current = putTriggeredIntoBank(current)
  }
}

/**
 * 非アクティブプレイヤーが優先権を獲得する。
 *
 * カードや能力が解決された時、バンクに誘発型能力が入った時、特別な行動を行った時に、
 * 優先権は非アクティブプレイヤーに発生する（総合ルール 第1部 第1章 5、第4部 第5章 2）。
 * 何かが起きた以上、連続した放棄はそこで途切れる。
 */
function grantPriorityToInactive(state: DuelState): DuelState {
  const { turn } = state
  const granted = { ...turn, priority: opponentOf(turn.active), passedBy: undefined }
  return settleBeforePriority({ ...state, turn: granted })
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
 * ダメージの除去と「ターンの終わりまで」の効果の終了（同 1）だが、盤面はダメージも継続効果
 * もまだ持っていない。「リカバリーフェイズの始め」と「ターンの終わり」の能力はそのターン中
 * に 1 度しか誘発しない（同 5）ので、能力が誘発し直すこともない。
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
 * 行うのは今のところドローフェイズのドロー（同 第6章 1-1）だけである。リリースフェイズ
 * のリリース（同 第5章 1）はカードの向きを、リカバリーフェイズのダメージの除去
 * （同 第10章 1）はダメージを、それぞれ盤面が持つようになってから足す。
 */
function takeBeginningAction(state: DuelState): DuelState {
  if (state.turn.phase === 'ドローフェイズ') return draw(state, state.turn.active)
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
