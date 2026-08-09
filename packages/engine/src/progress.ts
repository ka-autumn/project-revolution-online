import { draw } from './duel.js'
import type { DuelState } from './duel.js'
import { opponentOf } from './player.js'
import { PHASES, beginPhase } from './turn.js'
import type { Turn } from './turn.js'

/**
 * 優先権を持っているプレイヤーが、それを放棄する。
 *
 * 両方のプレイヤーが連続して放棄したら、進行中のフェイズが終了して次のフェイズに移る
 * （総合ルール 第3部 第4章 4）。そうでなければ、もう一方のプレイヤーに優先権が移るだけ。
 *
 * フェイズが終了する条件にはバンクが空であることも含まれる（同 4）が、バンクはまだ
 * 無いため常に空として扱う。バトルまたはスマッシュ判定の最中なら、終了するのはフェイズ
 * ではなくステップである（同 4）が、そちらもまだ無い。
 *
 * 誰が優先権を持っているかは盤面にあるので、放棄するプレイヤーは受け取らない。
 */
export function passPriority(state: DuelState): DuelState {
  const { turn } = state
  if (turn.passedBy === undefined) {
    return { ...state, turn: { ...turn, priority: opponentOf(turn.priority), passedBy: turn.priority } }
  }
  return beginNextPhase(state)
}

/**
 * 進行中のフェイズを終え、次のフェイズを始める。
 *
 * すべてのフェイズが終了したらそのターンは終了し、アクティブプレイヤーが交代して次の
 * ターンに移る（総合ルール 第3部 第4章 6）。
 *
 * リカバリーフェイズだけは、両方が放棄した後に「ターンの終わり」に誘発する能力をバンクに
 * 乗せ、もう一度両方が放棄するまで終わらない（同 第10章 3・4）。ここでは他のフェイズと
 * 同じく 1 巡で終えている。乗せる先のバンクも、繰り返すかどうかを決める誘発イベントも
 * まだ無いため、バンクを実装する時に足す。
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
 * 行うのは今のところドローフェイズのドロー（同 第6章 1-1）だけである。リリースフェイズ
 * のリリース（同 第5章 1）はカードの向きを、リカバリーフェイズのダメージの除去
 * （同 第10章 1）はダメージを、それぞれ盤面が持つようになってから足す。「〜の始め」に
 * 誘発する能力をバンクに入れることも、バンクを実装する時に足す。
 *
 * エネルギーフェイズとスマッシュフェイズのアクティブプレイヤーの行動（同 第7章 1・
 * 第9章 1）はここには来ない。どちらも優先権が発生して「それらを解決した後」に、バンクが
 * 空で優先権を持っている時に行うものであって、フェイズの始めの処理ではない。
 */
function beginCurrentPhase(state: DuelState): DuelState {
  if (isSkipped(state.turn)) return beginNextPhase(state)
  if (state.turn.phase === 'ドローフェイズ') return draw(state, state.turn.active)
  return state
}

/**
 * 先攻のプレイヤーは第 1 ターンのドローフェイズをとばす（総合ルール 第3部 第2章 2、
 * 第6章 1-2）。第 1 ターンは必ず先攻のターンである（同 第4章 1）。
 */
function isSkipped(turn: Turn): boolean {
  return turn.phase === 'ドローフェイズ' && turn.number === 1
}
