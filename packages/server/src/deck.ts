import { checkConstructedDeck } from '@revolution/engine'
import type { Card, Deck, DeckViolation } from '@revolution/engine'
import type { RoomSetup } from './room.js'

/**
 * カードのまとまりから、部屋に渡すデッキを組む（#105）。
 *
 * **カードを知らない。** 何が入っているかは受け取ったまとまり次第で、ここが見るのは枚数だけで
 * ある。実カードを名指しするのは、これを呼ぶ側（非公開）の仕事になる。サーバがカードの実装に
 * 依存すると、カードを持たない環境（ADR-0002）で組み立てられなくなる。
 */

/**
 * 番号で引けるカードのまとまり 1 つ。セット 1 つ分にあたる。
 *
 * 鍵が何であるかは見ない。**値だけを取り出して並べる。**
 */
export type CardSet = Readonly<Record<string, Card>>

/**
 * デッキに入れる同名のカードの枚数。
 *
 * トライアルデッキの収録は 20 種なので、3 枚ずつで構築戦の最小枚数（60 枚、総合ルール 第3部
 * 第1章 3-1）にちょうど届く。同名は 4 枚までなので、3 枚は規定の内側にある。
 */
export const COPIES_PER_CARD = 3

/** セットに入っているカードを 1 種 3 枚ずつ並べた、構築戦のデッキ。 */
export function buildDeck(set: CardSet): Deck {
  return Object.values(set).flatMap((card) => Array.from({ length: COPIES_PER_CARD }, () => card))
}

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
 * セットからデッキを組んで、部屋が始まるたびに呼ばれる `RoomSetup` を返す。
 *
 * **呼ぶたびに違うシードを返す。** 同じシードを返すと、どの部屋も同じ山札の並びになる
 * （ADR-0005）。デッキそのものは組み直さない。カードの実装は 1 枚につき 1 つの値なので、
 * 使い回してよい。
 */
export function setupFromSets(sets: readonly [CardSet, CardSet]): () => RoomSetup {
  const decks: readonly [Deck, Deck] = [buildDeck(sets[0]), buildDeck(sets[1])]

  return () => ({ decks, seed: Math.floor(Math.random() * 2 ** 31) })
}
