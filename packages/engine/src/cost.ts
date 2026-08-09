import type { Card } from './card.js'
import { cardsIn, putInZone } from './duel.js'
import type { CardInstance, DuelState } from './duel.js'
import type { Player } from './player.js'
import type { Chooser } from './resolve.js'
import type { PlayerZone } from './zone.js'

/**
 * そのプレイヤーが、そのカードのレベルを満たしているか（総合ルール 第1部 第2章 3-1）。
 *
 * エネルギーゾーンにレベル以上の枚数のカードがあり、かつ、レベルに含まれる色付きの
 * エネルギー・シンボルそれぞれについて、同じ色のカードが 1 枚以上ある必要がある。
 *
 * 数えるのは枚数だけで、向きは見ない。フリーズしているエネルギーもレベルの充足には
 * 数える。向きが関わるのは実際に支払う時（同 3-2）である。スマッシュゾーンにあるカードは
 * 数えない（同 3-3）。
 */
export function satisfiesLevel(state: DuelState, player: Player, card: Card): boolean {
  const energy = cardsIn(state, player, 'エネルギーゾーン')
  if (energy.length < card.level) return false

  // 「レベルに同じエネルギー・シンボルが書かれているカード」が、その色のカードである
  // （総合ルール 第1部 第2章 3-1）。
  return card.colors.every((color) => energy.some((each) => each.card.colors.includes(color)))
}

/**
 * そのカードをプレイまたは発動するためのコストを、エネルギーをフリーズして支払う
 * （総合ルール 第1部 第2章 3-2）。支払えなければ `undefined`。
 *
 * フリーズするのはエネルギー 1 枚である（同 第2部 第20章 1-3・2-3・3-10）。色付きの
 * カードならそのカードと同じ色のエネルギーを、無色のカードなら任意の色のエネルギーを
 * フリーズする。フリーズするのは支払うプレイヤーのエネルギーゾーンにあるカードだけであり
 * （同 第1部 第3章 1-1）、スマッシュゾーンにあるカードでは、たとえ無色のコストであっても
 * 支払えない（同 第1部 第2章 3-3）。
 *
 * どのエネルギーをフリーズするかは支払うプレイヤーが選ぶ。すでにフリーズしているカードを
 * フリーズすることはできない（同 第2部 第24章 1-1）ので、候補はリリース状態のものだけに
 * なる。
 *
 * 0 エネルギーはコストを必要としないカードのコストとして書かれる（同 第1部 第2章 3-4）
 * ため、レベルが 0 なら何もフリーズしない。
 */
export function payEnergyCost(
  state: DuelState,
  player: Player,
  card: Card,
  chooser: Chooser,
): DuelState | undefined {
  if (card.level === 0) return state

  return chooseAndFreeze(state, player, ['エネルギーゾーン'], (energy) => paysFor(card, energy), chooser)
}

/**
 * プランするためのコストを支払う（総合ルール 第3部 第8章 2-3）。支払えなければ `undefined`。
 *
 * プランは、スマッシュゾーンにあるカードでエネルギーを支払えない規定（総合ルール 第1部
 * 第2章 3-3）の例外である。エネルギーかスマッシュを 1 枚フリーズする（同 第2部 第21章 7-5）。
 * 色は問わない。
 */
export function payPlanCost(state: DuelState, player: Player, chooser: Chooser): DuelState | undefined {
  return chooseAndFreeze(state, player, ['エネルギーゾーン', 'スマッシュゾーン'], () => true, chooser)
}

/**
 * そのカードのコストを、そのエネルギーで支払えるか（総合ルール 第1部 第2章 3-2）。
 *
 * 無色のカードは「レベルに任意の色のエネルギー・シンボルが書かれているカード」で支払う
 * とあるが、これは色を問わないという意味に取る。そう読まないと、無色のカードだけを
 * エネルギーに置いたプレイヤーが無色のコストすら支払えなくなる。
 *
 * 色付きのカードは「そのカードと同じ色」のエネルギーで支払う（同 第2部 第20章 1-3）。
 * 複数の色を持つカードなら、そのいずれかの色を持つエネルギー 1 枚でよい。
 */
function paysFor(card: Card, energy: CardInstance): boolean {
  if (card.colors.length === 0) return true
  return card.colors.some((color) => energy.card.colors.includes(color))
}

/**
 * 支払いに使えるカードを 1 枚選んでフリーズする。候補が無ければ `undefined`。
 *
 * 選ぶのはコストを支払うプレイヤーである（総合ルール 第1部 第3章 1-1）。
 */
function chooseAndFreeze(
  state: DuelState,
  player: Player,
  zones: readonly PlayerZone[],
  accepts: (card: CardInstance) => boolean,
  chooser: Chooser,
): DuelState | undefined {
  const candidates = zones.flatMap((zone) =>
    cardsIn(state, player, zone)
      .filter((card) => card.orientation === 'リリース' && accepts(card))
      .map((card) => ({ zone, card })),
  )
  const [first] = candidates
  if (first === undefined) return undefined

  const chosen = chooser(
    candidates.map(({ card }) => card),
    player,
  )
  const found = candidates.find(({ card }) => card === chosen)
  if (found === undefined) throw new Error('候補にないカードが選ばれた')

  return freeze(state, player, found.zone, found.card)
}

/** リリース状態のカードをフリーズ状態にする（総合ルール 第2部 第24章 1）。 */
function freeze(state: DuelState, player: Player, zone: PlayerZone, card: CardInstance): DuelState {
  return putInZone(
    state,
    player,
    zone,
    cardsIn(state, player, zone).map((each) => (each === card ? { ...each, orientation: 'フリーズ' } : each)),
  )
}
