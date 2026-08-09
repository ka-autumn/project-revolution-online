import { putTriggeredIntoBank } from './bank.js'
import type { DuelState } from './duel.js'
import { opponentOf } from './player.js'
import { checkRuleEffects } from './rule-effect.js'
import type { Phase } from './turn.js'

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
 * リカバリーフェイズの「ターンの終わり」と、カードのプレイや特別な行動の後だけで、どれも
 * 非アクティブプレイヤーが優先権を獲得する場面である。そのため優先権の移動は起こらず、
 * ここでは扱っていない。
 */
export function settleBeforePriority(state: DuelState): DuelState {
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
 * 優先権は非アクティブプレイヤーに発生する（総合ルール 第1部 第1章 5、第4部 第5章 2、
 * 第6章 1-5）。何かが起きた以上、連続した放棄はそこで途切れる。
 */
export function grantPriorityToInactive(state: DuelState): DuelState {
  const { turn } = state
  const granted = { ...turn, priority: opponentOf(turn.active), passedBy: undefined }
  return settleBeforePriority({ ...state, turn: granted })
}

/**
 * アクティブプレイヤーが、そのフェイズで自分の行動を行える状態にあるか。
 *
 * カードのプレイや能力の起動、フェイズごとの特別な行動は、アクティブプレイヤーが
 * 「バトル中以外の自分のそのフェイズの間、バンクが空で優先権を持っている時」に行える
 * （総合ルール 第3部 第7章 1・第8章 2、第2部 第20章 1-1・2-1・3-1）。
 *
 * バトル中かどうかは見ていない。バトルがまだ無いためである。
 */
export function activePlayerMayAct(state: DuelState, phase: Phase): boolean {
  const { turn } = state
  return turn.phase === phase && turn.priority === turn.active && state.bank.length === 0
}
