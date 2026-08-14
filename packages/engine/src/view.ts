import { BATTLE_SPACE } from './board.js'
import { cardsIn } from './duel.js'
import type { CardId, DuelState } from './duel.js'
import type { CardInZone, DuelView, UnitOnSquare } from './effect.js'
import { opponentOf } from './player.js'
import type { Player } from './player.js'
import type { PlayerZone } from './zone.js'

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

  const show = (units: readonly UnitOnSquare[]): readonly UnitOnSquare[] => {
    for (const unit of units) source.show(unit.id)
    return units
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
    self: () => {
      const found = source.self()
      if (found !== undefined) source.show(found.id)
      return found
    },
    allies: () => show(unitsOnSquares(currentState()).filter((unit) => unit.controller === controller)),
    enemies: () => show(unitsOnSquares(currentState()).filter((unit) => unit.controller !== controller)),
    hand: showZone('手札'),
    discardPile: showZone('捨札'),
    planZone: showZone('プランゾーン'),
  }
}
