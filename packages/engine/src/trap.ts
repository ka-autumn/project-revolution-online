import type { IntrusionOccasion } from './ability.js'
import { indexOfSquare, squareFromView } from './board.js'
import { cardsIn } from './duel.js'
import type { CardId, DuelState } from './duel.js'
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
 * トリガーアイコンに印刷されたスクエアは、そのトラップの支配者（＝相手のトラップゾーンの
 * 持ち主）から見た向きで持っている（`TrapCard.triggerIcon` 参照）ため、`squareFromView`
 * で盤面に固定した絶対のスクエアに変換してから比べる。
 *
 * ここで満たされるのは発動条件であって、発動する権利そのものではない。権利が発生するのは
 * 優先権を得る時であり、その時にバトルやスマッシュ判定が発生していれば遅れる（同 3-8 の
 * ただし書き、`trapRightOf`）。
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
        trap.card.triggerIcon.some(
          (printed) =>
            indexOfSquare(squareFromView(opponent, printed)) === indexOfSquare(invader.square),
        ),
    )
    .map((trap) => trap.id)
    // すでに発動条件が満たされているトラップは、そのままにし、最初のきっかけを持ち続ける。
    // 支配者がパスすれば発動条件は取り除かれる（`loseTrapRightOnPass`）が、パスを挟まずに
    // 満たし直されることがある。1 つの効果が続けてユニットを置く場合、相手が優先権を持った
    // まま続けて行動し、それぞれの効果でユニットを置く場合、バトルやスマッシュ判定の途中に
    // 効果で置かれる場合（その間のパスでは発動条件を失わない）である。ADR-0039 は
    // 満たされた発動条件をきっかけごとに 1 件ずつ持つと決めている。その形は、権利の判定を
    // きっかけごとにする時に一緒に入れる。持つ件数だけを先に増やしても、どのきっかけで
    // 発動するかを選べないためである。
    .filter((id) => !state.trapConditionsMet.some((met) => met.trap === id))

  if (invaded.length === 0) return state

  const occasion: IntrusionOccasion = { kind: '侵入', invader }
  return {
    ...state,
    trapConditionsMet: [...state.trapConditionsMet, ...invaded.map((trap) => ({ trap, occasion }))],
  }
}

/**
 * そのトラップを発動する権利がいま発生しているなら、その権利のもとになった発動条件の
 * きっかけ（総合ルール 第2部 第20章 3-8）。発生していなければ `undefined`。
 *
 * 権利の有無ときっかけを一緒に返すのは、発動した効果がきっかけを必要とする（`play.ts` の
 * `activateTrap`）ためである。権利が無いことと、渡せるきっかけが無いことは同じである。
 *
 * 発動条件が満たされていること（`checkIntrusion`）に加えて、バトルもスマッシュ判定も
 * 進行中でないことが要る。発動条件が満たされた後、優先権を得る時にバトルまたはスマッシュ
 * 判定が発生した場合、それが終了するまで権利は発生しない（同 3-8 ただし書き、第3部
 * 第11章 5・第17章 4）。その判定は「勇気」を起動する権利と共通なので、`priority.ts` の
 * `deferringRights` に置いてある。
 *
 * 進行中のバトルやスマッシュ判定は、発動条件が満たされたのがその前か途中かを問わず、権利の
 * 発生を止める。登場と移動は進行中には行えない（ADR-0012、`priority.ts` の
 * `activePlayerMayAct`）が、効果でユニットを置くことは進行中にも起こる。その場合も、終わる
 * まで権利は発生しない。ADR-0039 は、止めるのを条件が満たされた後に発生したものだけに改める
 * と決めている。
 */
export function trapRightOf(state: DuelState, id: CardId): IntrusionOccasion | undefined {
  if (deferringRights(state)) return undefined
  return state.trapConditionsMet.find((met) => met.trap === id)?.occasion
}

/**
 * 優先権をパスしたプレイヤーは、自分のトラップゾーンにあるカードが発動する権利を失う
 * （総合ルール 第2部 第20章 3-8「１度でも優先権をパスすると...権利を失います」）。権利を
 * 失うと、再び発動条件を満たすまで発動できない（同）ので、満たされた発動条件を取り除く。
 *
 * バトルやスマッシュ判定が進行中の間は何も失わない。同 3-8 が権利を失わせるのは「権利を
 * 獲得した後」であり、その間は権利がそもそも発生していない（`trapRightOf`）ためである。
 * バトルもスマッシュ判定もステップが連続した優先権の放棄で進む（同 第3部 第4章 4）ので、
 * ここで失っていたら終了まで権利の発生を遅らせる意味が無くなる。
 *
 * バトルが始まる前にすでに権利を得ていたトラップも、この扱いでは失わずに残る。権利の発生を
 * 進行中のバトルすべてで止める `trapRightOf` の読み方に合わせた形であり、そちらと同じく、
 * いまはどちらの読み方でも結果が変わらない。バトルが始まるにはユニットがスクエアに置かれる
 * 必要があり、権利を持っているプレイヤーがパスしない限り相手はその行動を行えないためである。
 *
 * 「同じイベントで起動条件を満たした勇気を起動する」場合の権利喪失（同 第2部 第20章 3-8）は、
 * できごとの同一性を盤面が持っていないため、まだ実装していない（`courage.ts` の
 * `activateCourage`）。
 */
export function loseTrapRightOnPass(state: DuelState, player: Player): DuelState {
  if (deferringRights(state)) return state

  const ownIds: readonly CardId[] = cardsIn(state, player, 'トラップゾーン').map((trap) => trap.id)
  if (!state.trapConditionsMet.some((met) => ownIds.includes(met.trap))) return state
  return {
    ...state,
    trapConditionsMet: state.trapConditionsMet.filter((met) => !ownIds.includes(met.trap)),
  }
}
