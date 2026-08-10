import { indexOfSquare, squareFromView } from './board.js'
import type { Square } from './board.js'
import { cardsIn } from './duel.js'
import type { CardId, DuelState } from './duel.js'
import { opponentOf } from './player.js'
import type { Player } from './player.js'

/**
 * 相手のユニットがそのスクエアに置かれたことで、トリガーアイコンにそのスクエアが描かれた
 * トラップが「侵入される」（総合ルール 第2部 第20章 3-6）。これによってそのトラップの
 * 発動条件が満たされ、支配者はそのトラップを発動する権利を得る（同 3-8・3-8-a）。
 *
 * `invader` から見た相手のトラップゾーンだけを見る。「相手のユニットが」なので、置いた
 * 本人が支配するトラップは対象にならない。トラップゾーンには 1 プレイヤーにつき 1 枚しか
 * カードを置けない（同 3-1）ので、対象になり得るトラップは高々 1 枚である。
 *
 * トリガーアイコンを持てるのはトラップだけである（`card.ts` の `TrapCard.triggerIcon`）。
 * トラップ以外のカードがトラップゾーンにあっても対象にならない。
 *
 * トリガーアイコンに印刷されたスクエアは、そのトラップの支配者（＝相手のトラップゾーンの
 * 持ち主）から見た向きで持っている（`TrapCard.triggerIcon` 参照）ため、`squareFromView`
 * で盤面に固定した絶対のスクエアに変換してから比べる。
 *
 * ここで満たされるのは発動条件であって、発動する権利そのものではない。権利が発生するのは
 * 優先権を得る時であり、その時にバトルやスマッシュ判定が発生していれば遅れる（同 3-8 の
 * ただし書き、`hasTrapRight`）。
 *
 * 呼ぶのはユニットをスクエアに置いた側（`play.ts` の登場・`move.ts` の移動）だけである。
 * 効果によってスクエアに置かれる場合はまだそのような効果が無いため扱っていない。
 */
export function checkIntrusion(state: DuelState, invader: Player, square: Square): DuelState {
  const opponent = opponentOf(invader)
  const invaded = cardsIn(state, opponent, 'トラップゾーン')
    .filter(
      (trap) =>
        trap.card.type === 'トラップ' &&
        trap.card.triggerIcon.some(
          (printed) => indexOfSquare(squareFromView(opponent, printed)) === indexOfSquare(square),
        ),
    )
    .map((trap) => trap.id)
    .filter((id) => !state.trapConditionsMet.includes(id))

  if (invaded.length === 0) return state
  return { ...state, trapConditionsMet: [...state.trapConditionsMet, ...invaded] }
}

/**
 * そのトラップを発動する権利が、いま発生しているか（総合ルール 第2部 第20章 3-8）。
 *
 * 発動条件が満たされていること（`checkIntrusion`）に加えて、バトルもスマッシュ判定も
 * 進行中でないことが要る。発動条件が満たされた後、優先権を得る時にバトルまたはスマッシュ
 * 判定が発生した場合、それが終了するまで権利は発生しない（同 3-8 ただし書き、第3部
 * 第11章 5・第17章 4）。
 *
 * 条文の「優先権を得る時」ではなく、発動しようとする時に見ている。バトルもスマッシュ判定も、
 * 始まるのも終わるのも優先権を獲得する手前（`priority.ts` の `settleBeforePriority`）
 * なので、優先権を得た後は次に得るまで結果が変わらない。
 *
 * 「優先権を得る時に発生した」バトルだけでなく、進行中のバトルすべてで権利を止めている。
 * 進行中のバトルやスマッシュ判定の最中に発動条件が満たされることは、いまは無いためである。
 * 発動条件のうち実装しているのは侵入だけで（`checkIntrusion`）、その侵入を起こす登場と移動は
 * バトル中には行えず（`priority.ts` の `activePlayerMayAct`）、スマッシュ判定が発生する
 * スマッシュフェイズにはどちらも行えない。効果でユニットをスクエアに置けるようになったら、
 * どちらの読み方を採るかを決める必要が出る。
 *
 * 同じ遅延は手札にある「勇気－Ｘ」の起動する権利にもかかる（同 第3部 第11章 5・第17章 4）が、
 * キーワード能力「勇気」がまだ無いため実装していない。
 */
export function hasTrapRight(state: DuelState, id: CardId): boolean {
  return state.trapConditionsMet.includes(id) && !deferringTrapRights(state)
}

/**
 * 優先権をパスしたプレイヤーは、自分のトラップゾーンにあるカードが発動する権利を失う
 * （総合ルール 第2部 第20章 3-8「１度でも優先権をパスすると...権利を失います」）。権利を
 * 失うと、再び発動条件を満たすまで発動できない（同）ので、満たされた発動条件を取り除く。
 *
 * バトルやスマッシュ判定が進行中の間は何も失わない。同 3-8 が権利を失わせるのは「権利を
 * 獲得した後」であり、その間は権利がそもそも発生していない（`hasTrapRight`）ためである。
 * バトルもスマッシュ判定もステップが連続した優先権の放棄で進む（同 第3部 第4章 4）ので、
 * ここで失っていたら終了まで権利の発生を遅らせる意味が無くなる。
 *
 * バトルが始まる前にすでに権利を得ていたトラップも、この扱いでは失わずに残る。権利の発生を
 * 進行中のバトルすべてで止める `hasTrapRight` の読み方に合わせた形であり、そちらと同じく、
 * いまはどちらの読み方でも結果が変わらない。バトルが始まるにはユニットがスクエアに置かれる
 * 必要があり、権利を持っているプレイヤーがパスしない限り相手はその行動を行えないためである。
 *
 * 「同じイベントで起動条件を満たした勇気を起動する」場合の権利喪失（同 第2部 第20章 3-8）は、
 * キーワード能力「勇気」がまだ無いため実装していない。
 */
export function loseTrapRightOnPass(state: DuelState, player: Player): DuelState {
  if (deferringTrapRights(state)) return state

  const ownIds: readonly CardId[] = cardsIn(state, player, 'トラップゾーン').map((trap) => trap.id)
  if (!state.trapConditionsMet.some((id) => ownIds.includes(id))) return state
  return { ...state, trapConditionsMet: state.trapConditionsMet.filter((id) => !ownIds.includes(id)) }
}

/**
 * バトルまたはスマッシュ判定が進行中で、トラップを発動する権利の発生が遅れているか
 * （総合ルール 第2部 第20章 3-8 ただし書き）。
 */
function deferringTrapRights(state: DuelState): boolean {
  return state.battle !== undefined || state.smashJudgments.length > 0
}
