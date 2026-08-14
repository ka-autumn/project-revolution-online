import { BATTLE_SPACE } from './board.js'
import type { UnitCard } from './card.js'
import { cardsIn } from './duel.js'
import type { CardId, DuelState } from './duel.js'
import type { CardInZone, DuelView, UnitOnSquare } from './effect.js'
import { opponentOf } from './player.js'
import type { Player } from './player.js'
import type { PlayerZone } from './zone.js'

/**
 * スクエアにいるユニットのデータを、いま効果に見せる姿に写す。
 *
 * 継続効果はカードのデータを変える（総合ルール 第4部 第12章 2）が、盤面には書き込まれて
 * いない。**書かれているデータを持つのは盤面で、効果に見せる写しは適用した後のデータを
 * 持つ。** 実際に何を適用するかは `continuous.ts` が決める。ここが関数を受け取るだけに
 * しているのは、継続効果を集める側もこの写しを使う（適用の途中の姿を見せる必要がある）
 * ためで、写す側が集める側を知っていると輪になる。
 */
export type UnitData = (id: CardId, written: UnitCard) => UnitCard

/**
 * 盤面を誰の目から写すか。`duelView` に渡す。
 *
 * 効果の解決（`resolve.ts`）と、常在型能力が生み出す継続効果を集めるところ
 * （`continuous.ts`）の 2 つが、同じ写し方を必要とする。カードに見せてよいものの範囲は
 * どちらでも同じ（ADR-0002）なので、写す側を 1 か所にまとめている。
 */
export interface ViewSource {
  /** 能力の支配者（総合ルール 第4部 第7章 1）。味方・敵はこのプレイヤーから見た呼び方になる。 */
  readonly controller: Player
  /**
   * この能力の発生源。スクエアにいなければ `undefined`。
   *
   * 解決する時に盤面から引き直すかどうかは経路によって違う（総合ルール 第4部 第8章 2-5 は
   * 誘発型能力についての規定である）ので、引き直しは呼ぶ側が済ませてから渡す。
   */
  self(): UnitOnSquare | undefined
  /**
   * カードを 1 枚見せたことを記録する。
   *
   * 効果が命令の対象にできるのは engine が見せたカードだけである（`resolve.ts` の
   * `shown`）。問い合わせるだけで命令を出さない経路では、記録する必要が無いので何もしない。
   */
  show(id: CardId): void
  /**
   * その盤面で、ユニットのデータをどう写すか。
   *
   * 盤面を受け取るのは、命令を実行するたびに盤面が入れ替わり、そのたびに継続効果を集め直す
   * ことになるためである（`continuous.ts` の `continuousData`）。
   */
  data(state: DuelState): UnitData
}

/**
 * スクエアにいるユニットすべてを、効果に見せる形で写す。
 *
 * スクエアにあってもユニット以外のカードは「味方」「敵」ではない
 * （総合ルール 第2部 第21章 8-2）ので含めない。
 */
export function unitsOnSquares(state: DuelState): readonly UnitOnSquare[] {
  return state.squares.flatMap((cards, index) => {
    const square = BATTLE_SPACE[index]
    if (square === undefined) return []
    return cards.flatMap((instance) =>
      instance.card.type === 'ユニット'
        ? [{ id: instance.id, square, card: instance.card, controller: instance.controller }]
        : [],
    )
  })
}

/**
 * 盤面を、ある発生源から見た `DuelView` に写す。
 *
 * 命令を実行するたびに盤面は入れ替わるので、盤面そのものではなく読み直す手段を受け取り、
 * 問い合わせのたびに最新のものを読む。
 *
 * 見せたカードはすべて `source.show` に通す。カードに渡ったものと、対象に取れるものとが
 * ずれないようにするためで、ここを通らずにカードへ渡す経路は `EffectContext.handed` だけで
 * ある（`resolve.ts`）。
 */
export function duelView(currentState: () => DuelState, source: ViewSource): DuelView {
  const { controller } = source

  /** スクエアにいるユニットを、継続効果を適用した後の姿で写す。 */
  const units = (): readonly UnitOnSquare[] => {
    const state = currentState()
    const data = source.data(state)
    return unitsOnSquares(state).map((unit) => ({ ...unit, card: data(unit.id, unit.card) }))
  }

  const show = (found: readonly UnitOnSquare[]): readonly UnitOnSquare[] => {
    for (const unit of found) source.show(unit.id)
    return found
  }

  // 支配者自身のゾーンだけを見せる。相手の手札は非公開の情報なので、渡す手段を持たせない
  // （`effect.ts` の `DuelView.hand`）。
  const showZone = (zone: PlayerZone) => (): readonly CardInZone[] => {
    const cards = cardsIn(currentState(), controller, zone).map((instance) => ({
      id: instance.id,
      zone,
      card: instance.card,
    }))
    for (const card of cards) source.show(card.id)
    return cards
  }

  return {
    controller,
    opponent: opponentOf(controller),
    /**
     * 発生源も、スクエアにいる間は継続効果を適用した後の姿で写す。
     *
     * スクエアを離れていれば渡された写しをそのまま返す。そのカードにはもう継続効果が
     * 及んでいない（総合ルール 第4部 第12章 4-1）ためで、返るのは離れる直前の姿になる
     * （同 第8章 2-5）。
     */
    self: () => {
      const found = source.self()
      if (found === undefined) return undefined

      source.show(found.id)
      return units().find((unit) => unit.id === found.id) ?? found
    },
    allies: () => show(units().filter((unit) => unit.controller === controller)),
    enemies: () => show(units().filter((unit) => unit.controller !== controller)),
    hand: showZone('手札'),
    discardPile: showZone('捨札'),
    planZone: showZone('プランゾーン'),
  }
}
