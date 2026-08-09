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
 * 発動条件が満たされた後にバトルまたはスマッシュ判定が発生していた場合、その終了まで権利の
 * 発生を遅らせる規定（同 3-8 ただし書き）は、バトル・スマッシュ判定がまだ無いため実装して
 * いない（`priority.ts` の `activePlayerMayAct` と同じ理由）。
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
    .filter((id) => !state.trapRights.includes(id))

  if (invaded.length === 0) return state
  return { ...state, trapRights: [...state.trapRights, ...invaded] }
}

/**
 * 優先権をパスしたプレイヤーは、自分のトラップゾーンにあるカードが発動する権利を失う
 * （総合ルール 第2部 第20章 3-8「１度でも優先権をパスすると...権利を失います」）。
 *
 * 「同じイベントで起動条件を満たした勇気を起動する」場合の権利喪失（同 3-8）は、キーワード
 * 能力「勇気」がまだ無いため実装していない。
 */
export function loseTrapRightOnPass(state: DuelState, player: Player): DuelState {
  const ownIds: readonly CardId[] = cardsIn(state, player, 'トラップゾーン').map((trap) => trap.id)
  if (!state.trapRights.some((id) => ownIds.includes(id))) return state
  return { ...state, trapRights: state.trapRights.filter((id) => !ownIds.includes(id)) }
}
