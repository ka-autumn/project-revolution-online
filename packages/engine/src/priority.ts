import { putTriggeredIntoBank } from './bank.js'
import { startBattleIfAny } from './battle.js'
import { hasEnded } from './duel.js'
import type { DuelState } from './duel.js'
import { opponentOf } from './player.js'
import { checkRuleEffects } from './rule-effect.js'
import { startSmashJudgmentIfAny } from './smash.js'
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
 * バトル発生のルールエフェクトだけは、他のルールエフェクトをすべて解決し終えた後に処理する
 * （同 第14章 4-4-1、第3部 第11章 1-1）。スマッシュ判定の発生（同 第14章 4-12）はその
 * 「他のルールエフェクト」の 1 つなので、バトルより先に見る。どちらも、始まると非アクティブ
 * プレイヤーに優先権が発生する（同 第3部 第12章 1・第18章 1）ので、誰が得るはずだったかに
 * 関わらずそこへ移す。
 *
 * 勝敗が決まったら、そこで終わる。デュエルは即座に終了する（同 第3章 3）ので、残りの
 * ルールエフェクトも誘発型能力も処理しない。
 *
 * 誰が優先権を持つかは、バトルが始まった場合を除いてここでは変えない。それを決めるのは
 * 呼ぶ側である。この手順は優先権を得るのが誰であるかに影響されない（ルールエフェクトは
 * どちらのプレイヤーにも支配されず、誘発型能力は自動的にバンクに入る）ため、プレイヤーを
 * 受け取らない。
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
    if (hasEnded(current)) return current
    // 何も発生していなければ `checkRuleEffects` は渡した盤面をそのまま返すので、
    // 新しいルールエフェクトが発生したかどうかは盤面が入れ替わったかで分かる。
    // ルールエフェクトはカードをスクエアから取り除くだけなので、いつか発生しなくなる。
    const checked = checkRuleEffects(current)
    if (checked !== current) {
      current = checked
      continue
    }
    // 回復ステップでダメージが 1000 未満に戻る（総合ルール 第3部 第18章 1）ので、
    // 同じダメージで何度も発生することはなく、この繰り返しはいつか終わる。
    const judging = startSmashJudgmentIfAny(current)
    if (judging !== current) {
      current = toInactive(judging)
      continue
    }
    const started = startBattleIfAny(current)
    if (started !== current) {
      current = toInactive(started)
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
  return settleBeforePriority(toInactive(state))
}

/** 優先権を非アクティブプレイヤーに移すだけ。盤面の片づけは行わない。 */
function toInactive(state: DuelState): DuelState {
  const { turn } = state
  return { ...state, turn: { ...turn, priority: opponentOf(turn.active), passedBy: undefined } }
}

/**
 * アクティブプレイヤーが、そのフェイズで自分の行動を行える状態にあるか。
 *
 * カードのプレイや能力の起動、フェイズごとの特別な行動は、アクティブプレイヤーが
 * 「バトル中以外の自分のそのフェイズの間、バンクが空で優先権を持っている時」に行える
 * （総合ルール 第3部 第7章 1・第8章 2、第2部 第20章 1-1・2-1・3-1）。
 *
 * バトル中は、優先権を持っていても行えない（同 第2部 第20章 1-1・3-1「バトル中以外の
 * 自分のメインフェイズの間」）。バトル中に行える行動はここを通らない。トラップの発動は
 * 自分のメインフェイズであることもバンクが空であることも要らない（同 3-8）ため、
 * `play.ts` の `activateTrap` がこの判定を使っていない。バトル中にトラップを発動できない
 * のは、発動する権利がそもそも発生していない（同 3-8 ただし書き、`trap.ts` の
 * `trapRightOf`）ためであって、行動そのものが禁じられているからではない。
 *
 * スマッシュ判定中は見ない。スマッシュ（同 第3部 第9章 1）には「バトル中以外」にあたる
 * 制限が書かれておらず、スマッシュ判定の最中も行えるためである（`action.ts` の `smash`）。
 * スマッシュ判定はスマッシュフェイズにしか発生しないので、他のフェイズの行動はフェイズの
 * 判定で弾かれる。
 *
 * 勝敗が決まったデュエルでは何も行えない。デュエルは即座に終了する（同 第3章 3）。
 */
export function activePlayerMayAct(state: DuelState, phase: Phase): boolean {
  const { turn } = state
  return (
    !hasEnded(state) &&
    state.battle === undefined &&
    turn.phase === phase &&
    turn.priority === turn.active &&
    state.bank.length === 0
  )
}
