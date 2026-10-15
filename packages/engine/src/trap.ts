import type { IntrusionOccasion } from './ability.js'
import { indexOfSquare, squareFromView } from './board.js'
import { cardsIn } from './duel.js'
import type { CardId, DuelState, TrapConditionMet } from './duel.js'
import type { UnitOnSquare } from './effect.js'
import { opponentOf } from './player.js'
import type { Player } from './player.js'
import { deferringRights } from './priority.js'

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
 * 判定するのは、侵入のトリガーアイコンを持つトラップだけである。攻撃・スマッシュのトラップ
 * の発動条件は、ここでは満たされない（足すのは単位 5。ADR-0039）。
 *
 * トリガーアイコンに印刷されたスクエアは、そのトラップの支配者（＝相手のトラップゾーンの
 * 持ち主）から見た向きで持っている（`IntrusionIcon` 参照）ため、`squareFromView`
 * で盤面に固定した絶対のスクエアに変換してから比べる。
 *
 * ここで満たされるのは発動条件であって、発動する権利そのものではない。権利が発生するのは
 * 優先権を得る時であり、その時にバトルやスマッシュ判定が発生していれば遅れる（同 3-8 の
 * ただし書き、`trapRightsOf`）。
 *
 * 侵入してきたユニットは、置かれたその瞬間の姿を写して満たされた発動条件と一緒に持つ
 * （`IntrusionOccasion`）。発動した効果がそれを見る（`effect.ts` の `TrapEffect`）。
 *
 * 呼ぶのはユニットをスクエアに置いた側である。条文は置き方を限っていないので、`play.ts` の
 * 登場、`move.ts` の移動、効果によって置かれる場合（`resolve.ts` の `スクエアへ置く`）の
 * いずれからも呼ぶ。
 */
export function checkIntrusion(state: DuelState, invader: UnitOnSquare): DuelState {
  const opponent = opponentOf(invader.controller)
  const invaded = cardsIn(state, opponent, 'トラップゾーン')
    .filter(
      (trap) =>
        trap.card.type === 'トラップ' &&
        trap.card.triggerIcon.kind === '侵入' &&
        trap.card.triggerIcon.squares.some(
          (printed) =>
            indexOfSquare(squareFromView(opponent, printed)) === indexOfSquare(invader.square),
        ),
    )
    .map((trap) => trap.id)

  if (invaded.length === 0) return state

  // 満たされるたびに 1 件ずつ足す。すでに満たされているトラップが、パスを挟まずに満たし直される
  // ことがある（1 つの効果が続けてユニットを置く場合、バトルやスマッシュ判定の途中に効果で
  // 置かれる場合、権利が止まっている間に置かれる場合）。きっかけごとに持つので、どれかを
  // 捨てることはしない（ADR-0039）。
  const occasion: IntrusionOccasion = { kind: '侵入', invader }
  const metAt = state.log.length
  return {
    ...state,
    trapConditionsMet: [...state.trapConditionsMet, ...invaded.map((trap) => ({ trap, occasion, metAt }))],
  }
}

/**
 * そのトラップを発動する権利がいま発生している、満たされた発動条件すべて
 * （総合ルール 第2部 第20章 3-8）。発生していなければ空。
 *
 * 権利ときっかけを一緒に返すのは、発動した効果がきっかけを必要とする（`play.ts` の
 * `activateTrap`）ためである。権利が無いことと、渡せるきっかけが無いことは同じである。
 * 件が複数あれば、発動する時に支配者が 1 つ選ぶ。
 *
 * 発動条件が満たされていること（`checkIntrusion`）に加えて、その条件が満たされた後に発生
 * したバトルもスマッシュ判定も進行中でないことが要る。発動条件が満たされた後、優先権を得る
 * 時にバトルまたはスマッシュ判定が発生した場合、それが終了するまで権利は発生しない（同 3-8
 * ただし書き、第3部 第11章 5・第17章 4）。その判定は「勇気」を起動する権利と共通なので、
 * `priority.ts` の `deferringRights` に置いてある。条件より前から進行中のものは権利を
 * 止めない（ADR-0039）。
 */
export function trapRightsOf(state: DuelState, id: CardId): readonly TrapConditionMet[] {
  return state.trapConditionsMet.filter((met) => met.trap === id && !deferringRights(state, met.metAt))
}

/**
 * 優先権をパスしたプレイヤーは、自分のトラップゾーンにあるカードが発動する権利を失う
 * （総合ルール 第2部 第20章 3-8「１度でも優先権をパスすると...権利を失います」）。権利を
 * 失うと、再び発動条件を満たすまで発動できない（同）ので、満たされた発動条件を取り除く。
 *
 * 失うのは、権利が発生している件だけである。同 3-8 が権利を失わせるのは「権利を獲得した
 * 後」であり、その条件が満たされた後に発生したバトルやスマッシュ判定が進行中の間は、その
 * 件の権利はそもそも発生していない（`trapRightsOf`）。止まっている件は残る。バトルも
 * スマッシュ判定もステップが連続した優先権の放棄で進む（同 第3部 第4章 4）ので、止まっている
 * 件をここで失っていたら、終了まで権利の発生を遅らせる意味が無くなる。
 *
 * バトルが始まる前にすでに権利を得ていたトラップも、そのバトルが条件の後に始まったのなら、
 * そのバトルが終わるまで権利が止まり、パスしても失わない。権利を持つ側の効果がユニットを
 * 置いてバトルを起こす場面で起こる。バトルが条件より前から進行中だったなら、権利は止まって
 * いないので、パスで失う。
 *
 * 「同じイベントで起動条件を満たした勇気を起動する」場合の権利喪失（同 第2部 第20章 3-8）は、
 * できごとの同一性を盤面が持っていないため、まだ実装していない（`courage.ts` の
 * `activateCourage`）。
 */
export function loseTrapRightOnPass(state: DuelState, player: Player): DuelState {
  const ownIds: readonly CardId[] = cardsIn(state, player, 'トラップゾーン').map((trap) => trap.id)
  const lost = (met: TrapConditionMet): boolean => ownIds.includes(met.trap) && !deferringRights(state, met.metAt)
  if (!state.trapConditionsMet.some(lost)) return state
  return { ...state, trapConditionsMet: state.trapConditionsMet.filter((met) => !lost(met)) }
}
