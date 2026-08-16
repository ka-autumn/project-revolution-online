import { checkConstructedDeck } from '@revolution/engine'
import type { Deck, DeckViolation } from '@revolution/engine'
import type { RoomSetup } from './room.js'

/**
 * 持ち込まれたデッキを、部屋に渡せる形にする（#105）。
 *
 * **カードを知らないし、デッキの組み方も持たない。** 受け取るのは組み上がったデッキ（`Deck`、
 * ただのカードの並び）で、ここが見るのは規定への適合だけである。何をどの枚数入れるかは持ち込む
 * 側が決めることで、サーバの関心事ではない。サーバがカードの実装に依存すると、カードを持たない
 * 環境（ADR-0002）で組み立てられなくなる。
 */

/** デッキ 1 つ分の不備。どちらのデッキかが分かるように、席の番号を添える。 */
export interface SeatedDeckViolation {
  /** `decks` の何番目か。 */
  readonly seat: number
  readonly violation: DeckViolation
}

/**
 * 組んだデッキが構築戦の規定を満たしているか（総合ルール 第3部 第1章 3）。満たしていれば空。
 *
 * **立てる時に確かめるためにある。** 確かめずに立てても、2 人目が入ってデュエルを始める時に
 * `prepareDuel` が同じことを見つける（`room.ts` の `start`）が、それでは対戦しようとした人が
 * 断られて初めて分かる。
 */
export function checkDecks(decks: readonly Deck[]): readonly SeatedDeckViolation[] {
  return decks.flatMap((deck, seat) =>
    checkConstructedDeck(deck).map((violation): SeatedDeckViolation => ({ seat, violation })),
  )
}

/**
 * デッキ 2 つから、部屋が始まるたびに呼ばれる `RoomSetup` を返す。
 *
 * **受け取るのはデッキであって、カードのまとまりではない。** デッキはただのカードの並び
 * （`Deck`）なので、何をどの枚数入れるかは渡す側が決められる。
 *
 * **呼ぶたびに違うシードを返す。** 同じシードを返すと、どの部屋も同じ山札の並びになる
 * （ADR-0005）。デッキそのものは組み直さない。カードの実装は 1 枚につき 1 つの値なので、
 * 使い回してよい。
 */
export function setupFromDecks(decks: readonly [Deck, Deck]): () => RoomSetup {
  return () => ({ decks, seed: Math.floor(Math.random() * 2 ** 31) })
}
