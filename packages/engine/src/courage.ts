import { cannot, done } from './action.js'
import type { ActionOutcome } from './action.js'
import { mayActivate, payActivationCost } from './activate.js'
import { areaOf } from './board.js'
import { courageOf } from './card.js'
import { satisfiesLevel } from './cost.js'
import { cardsIn, findInZone } from './duel.js'
import type { CardId, CourageConditionMet, DuelState } from './duel.js'
import { damageUnit } from './effect.js'
import type { UnitOnSquare } from './effect.js'
import { opponentOf } from './player.js'
import type { Player } from './player.js'
import { deferringRights, grantPriorityToInactive } from './priority.js'
import { resolveEffect } from './resolve.js'
import type { Chooser } from './resolve.js'

/**
 * 相手のユニットが味方エリアか中央エリアに置かれたことで、「勇気」の起動条件が満たされる
 * （総合ルール 第5部 第2章 2）。
 *
 * 見るのは置いた側から見た相手、つまり置かれたユニットを支配していないプレイヤーである。
 * 「相手のユニットが」なので、置いた本人の起動条件は満たされない。エリアの呼び名は見る
 * プレイヤーによって入れ替わる（同 第2部 第22章 6）ので、判定はそのプレイヤーから見て行う
 * （同 6-1）。中央エリアはどちらから見ても中央エリアである。
 *
 * トラップの発動条件（`trap.ts` の `checkIntrusion`）と同じ場面で満たされるが、どのスクエアが
 * 対象かの決まり方が違う。あちらはトラップのトリガーアイコンに描かれたスクエア、こちらは
 * エリアである。呼ぶのはユニットをスクエアに置いた側（`play.ts` の登場・`move.ts` の移動）
 * だけで、そこも同じである。
 *
 * すでに満たされている場合は、そのままにする。`checkIntrusion` と同じ理由で、古いできごとと
 * 新しいできごとのどちらを持つかがまだ分かれようがないためである。
 *
 * **エネルギーの条件もここで判定する。** 起動条件は「置かれた時、……ならば」という 1 つの
 * まとまりなので、できごとが起きたその瞬間に判定される。エネルギーの条件は「このカード」の
 * 色とレベルを見るため、手札にある「勇気」を 1 枚ずつ見て、満たしたものを覚えておく。1 枚も
 * 満たさなければ起動条件は満たされず、何も持たない。
 */
export function checkCourageCondition(state: DuelState, placed: UnitOnSquare): DuelState {
  const player = opponentOf(placed.controller)
  const area = areaOf(player, placed.square)
  if (area !== '味方エリア' && area !== '中央エリア') return state
  if (state.courageConditionsMet.some((met) => met.player === player)) return state

  const satisfied = cardsIn(state, player, '手札')
    .filter((instance) => courageOf(instance.card) !== undefined && satisfiesLevel(state, player, instance.card))
    .map((instance) => instance.id)
  if (satisfied.length === 0) return state

  return { ...state, courageConditionsMet: [...state.courageConditionsMet, { player, placed, satisfied }] }
}

/**
 * そのプレイヤーがいま「勇気」を起動する権利を得ている、満たされた起動条件すべて
 * （総合ルール 第5部 第2章 2）。得ていなければ空。
 *
 * 起動条件が満たされていることに加えて、バトルもスマッシュ判定も進行中でないことが要る
 * （同 2 ただし書き、`priority.ts` の `deferringRights`）。
 *
 * 条文の「優先権を持った時に」は見ていない。優先権を持っているプレイヤーだけがこれを呼ぶ
 * ためで、トラップの発動する権利（`trap.ts` の `trapRightOf`）と同じ扱いである。
 *
 * 満たされた条件を並びで返すのは、**起動しても条件が消えない**ためである。同一のイベントに
 * よって複数の勇気を起動できる（同 3）ので、1 つ起動しても残りの勇気は同じ条件で起動できる。
 */
export function courageRightsOf(state: DuelState, player: Player): readonly CourageConditionMet[] {
  if (deferringRights(state)) return []
  return state.courageConditionsMet.filter((met) => met.player === player)
}

/**
 * 優先権をパスしたプレイヤーは、「勇気」を起動する権利を失う（総合ルール 第5部 第2章 2
 * 「１度でも優先権をパスすると……起動する権利を失います」）。権利を失うと、再び起動条件を
 * 満たすまで起動できないので、満たされた起動条件を取り除く。
 *
 * バトルやスマッシュ判定が進行中の間は何も失わない。条文が権利を失わせるのは「権利を獲得
 * した後」であり、その間は権利がそもそも発生していない（`courageRightsOf`）ためである。
 * トラップの発動する権利（`trap.ts` の `loseTrapRightOnPass`）と同じ読み方をしている。
 */
export function loseCourageRightOnPass(state: DuelState, player: Player): DuelState {
  if (deferringRights(state)) return state
  if (!state.courageConditionsMet.some((met) => met.player === player)) return state

  return { ...state, courageConditionsMet: state.courageConditionsMet.filter((met) => met.player !== player) }
}

/**
 * 手札にある「勇気」を起動する（総合ルール 第5部 第2章 2）。
 *
 * 起動するのは優先権を持っているプレイヤーである。カードのプレイと違い、自分のメインフェイズ
 * であることもバンクが空であることも要らない（同 2「自分のメインフェイズ中に限らずいつでも」、
 * `activate.ts` の `mayActivate`）。
 *
 * **スクエアにいるユニットの起動型能力とは別の行動になっている**（`activate.ts` の
 * `activateAbility`）。起動できるゾーンも、権利を要ることも、効果の対象の決まり方も違うため
 * である。共通なのは、起動できる時の判定（`mayActivate`）とコストの支払い
 * （`payActivationCost`）の 2 つだけで、どちらも `activate.ts` から使う。
 *
 * 起動できるのは、そのカードについて起動条件が満たされて権利を得ている間だけである。エネルギー
 * の条件は起動条件が満たされたその瞬間に判定済みなので（`checkCourageCondition`）、ここでは
 * 見ない。**その後にエネルギーが減っていても起動できる。**
 *
 * コストを支払い（「このカードと同じ色のエネルギーを１支払い、このカードを捨札にする」）、
 * その味方エリアか中央エリアに置かれた相手のユニットにＸダメージを与える。起動型能力はバンクを
 * 使用しない（同 第4部 第2章 5）ので、その場で解決される。
 *
 * **起動しても起動条件は残る。** 同一のイベントによって複数の勇気を起動できる（同 第5部
 * 第2章 3）ためである。行動の後は非アクティブプレイヤーに優先権が戻る（同 第4部 第5章 2）ので、
 * 権利を持つ側はパスを挟まずに続けて起動できる。
 *
 * 同 4 の「一度勇気を起動すると、同じイベントによってトラップを発動することはできない」は
 * まだ実装していない。できごとの同一性を盤面が持っていないためである。
 */
export function activateCourage(state: DuelState, card: CardId, chooser: Chooser): ActionOutcome {
  const player = state.turn.priority
  const instance = findInZone(state, player, '手札', card)
  if (instance === undefined) return cannot('そのゾーンにない')

  const ability = courageOf(instance.card)
  if (ability === undefined) return cannot('起動できる能力がない')
  // 優先権を持っているプレイヤーの手札から探しているので、`mayActivate` がここで見るのは
  // 実質的に「勝敗が決まっていないこと」（総合ルール 第3部 第3章 3）である。それでも通すのは、
  // その時に起動できるかの判定を 1 か所に置いておくためである。
  if (!mayActivate(state, ability.timing, player)) return cannot('行える時ではない')

  const met = courageRightsOf(state, player).find((each) => each.satisfied.includes(card))
  if (met === undefined) return cannot('起動する権利がない')

  const paid = payActivationCost(state, instance, ability.cost, chooser)
  if (paid === undefined) return cannot('コストを支払えない')

  // 対象は起動条件を満たしたできごとから決まる。盤面への問い合わせでは取れないので手渡す
  // （`resolve.ts` の `EffectContext.handed`）。すでにスクエアを離れていれば、ダメージを
  // 与える行動が実行されないだけである（同 第1部 第1章 3）。
  const { placed } = met
  const resolved = resolveEffect(
    paid,
    function* () {
      yield* damageUnit(placed, ability.amount)
    },
    { controller: player, chooser, handed: [placed] },
  )
  return done(grantPriorityToInactive(resolved))
}
