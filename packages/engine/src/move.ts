import type { MovementOccasion } from './ability.js'
import { cannot, done } from './action.js'
import type { ActionOutcome } from './action.js'
import { triggerMovement } from './bank.js'
import { indexOfSquare, squareInDirection, squaresBeside } from './board.js'
import type { MoveDirection, Square } from './board.js'
import { hasTrust, moveCostingAbilitiesOf } from './card.js'
import type { UnitCard } from './card.js'
import { continuousData } from './continuous.js'
import { freezeEnergies } from './cost.js'
import { cardsOn, locateOnSquares, moveToSquare } from './duel.js'
import type { CardId, DuelState } from './duel.js'
import type { Player } from './player.js'
import { activePlayerMayAct, grantPriorityToInactive } from './priority.js'
import type { Chooser } from './resolve.js'
import { checkCourageCondition } from './courage.js'
import { checkIntrusion } from './trap.js'
import { duelView, unitsOnSquares } from './view.js'

/**
 * ユニットを移動する（総合ルール 第4部 第2章 3、第6章 2）。
 *
 * ルールによって認められた起動型能力であり、「プランする」と同様に、アクティブプレイヤーが
 * バトル中以外の自分のメインフェイズの間、バンクが空で優先権を持っている時に起動できる
 * （同 第2章 4）。
 *
 * 宣言してからバンクを使用せず直ちに解決され（同 第6章 2-1〜2-4）、解決の最後に指定した
 * スクエアにリリース状態で置かれる（同 第8章 3）。移動が起動されたことで、移動したそのユニット
 * 自身の「移動が起動された時」に誘発する能力が誘発する（`triggerMovement`）。その後、
 * 非アクティブプレイヤーが優先権を獲得する（同 第6章 2-5）。
 *
 * 常在型能力が課す追加コスト（同 2-2・2-3）は支払う。代替コストと、変数を含む使用コストは
 * まだ書けないため扱わない。
 *
 * 移動先が相手のトラップのトリガーアイコンのスクエアなら「侵入」になり、そのトラップの
 * 支配者が発動する権利を得る（同 第2部 第20章 3-6）。
 */
export function moveUnit(
  state: DuelState,
  unit: CardId,
  destination: Square,
  chooser: Chooser,
): ActionOutcome {
  if (!activePlayerMayAct(state, 'メインフェイズ')) return cannot('行える時ではない')

  const player = state.turn.active
  const moving = movableUnit(state, player, unit)
  if (moving === undefined) return cannot('移動できるユニットではない')

  if (!isMoveDestination(state, player, moving.square, destination, moving.card.moveIcon)) {
    return cannot('移動先として指定できないスクエア')
  }

  if (blockedByTrust(state, player, destination)) return cannot('「信頼」によって移動できない')

  const declared = { id: unit, square: moving.square, card: moving.card }
  const paid = payMoveCosts(state, player, declared, destination, chooser)
  if (paid === undefined) return cannot('コストを支払えない')

  const moved = moveToSquare(paid, unit, destination, { controller: player, orientation: 'リリース' })
  const triggered = triggerMovement(moved, unit)
  const invader = { id: unit, square: destination, card: moving.card, controller: player }
  // 移動もユニットがスクエアに置かれることなので、トラップの発動条件（総合ルール 第2部
  // 第20章 3-6）と「勇気」の起動条件（同 第5部 第2章 2）のどちらも満たしうる。
  const placed = checkCourageCondition(checkIntrusion(triggered, invader), invader)
  return done(grantPriorityToInactive(placed))
}

/**
 * その移動に課されている追加コストをすべて支払う（総合ルール 第4部 第6章 2-2・2-3）。
 * 支払えなければ `undefined`。
 *
 * 支払うのは移動するプレイヤーである。**移動を妨げるものはこの関数と `blockedByTrust` の
 * 2 つだけで、どちらも `moveUnit` から呼ぶ。** 移動できるかどうかを決める場所が散らばると、
 * 後から矛盾する。
 *
 * コストを課すのはスクエアにいるユニットの常在型能力である（同 第4章 1）。カードに見せる
 * のは継続効果を適用した後の盤面（同 第12章 2）で、移動するユニットもその姿で渡す。
 *
 * 支払えなかった場合、途中まで支払った盤面は捨てられる。呼ぶ側は返ってきた盤面だけを使う。
 */
function payMoveCosts(
  state: DuelState,
  player: Player,
  moving: { readonly id: CardId; readonly square: Square; readonly card: UnitCard },
  destination: Square,
  chooser: Chooser,
): DuelState | undefined {
  const data = continuousData(state)
  const occasion: MovementOccasion = {
    kind: '移動',
    unit: { id: moving.id, square: moving.square, card: data(moving.id, moving.card), controller: player },
    destination,
  }

  let current = state
  for (const source of unitsOnSquares(state)) {
    for (const ability of moveCostingAbilitiesOf(source.card)) {
      const duel = duelView(() => current, {
        controller: source.controller,
        self: () => source,
        show: () => {},
        data: continuousData,
      })

      const cost = ability.moveCost(duel, occasion)
      if (cost === undefined) continue

      const paid = freezeEnergies(current, player, cost.energiesFrozen, chooser)
      if (paid === undefined) return undefined
      current = paid
    }
  }
  return current
}

/**
 * 移動できるユニット（総合ルール 第4部 第6章 2-1）。そのプレイヤーが支配するリリース状態の
 * ユニットでなければ `undefined`。
 */
function movableUnit(
  state: DuelState,
  player: Player,
  id: CardId,
): { readonly card: UnitCard; readonly square: Square } | undefined {
  const located = locateOnSquares(state, id)
  if (located === undefined) return undefined

  const { instance, square } = located
  if (instance.controller !== player) return undefined
  if (instance.card.type !== 'ユニット') return undefined
  if (instance.orientation !== 'リリース') return undefined
  return { card: instance.card, square }
}

/**
 * その移動先が、ムーブアイコンの方向にあり隣接し、同じプレイヤーが支配する他のユニットの
 * ないスクエアか（総合ルール 第4部 第6章 2-1）。
 */
function isMoveDestination(
  state: DuelState,
  player: Player,
  current: Square,
  destination: Square,
  moveIcon: readonly MoveDirection[],
): boolean {
  const reachable = moveIcon.some((direction) => {
    const target = squareInDirection(player, current, direction)
    return target !== undefined && indexOfSquare(target) === indexOfSquare(destination)
  })
  if (!reachable) return false

  return !cardsOn(state, destination).some((each) => each.controller === player && each.card.type === 'ユニット')
}

/**
 * その移動先が、相手の「信頼」を持つユニットの左右に接するスクエアか
 * （総合ルール 第5部 第4章 2）。
 *
 * 「このカードの左右に接するスクエア」かどうかは、移動先の左右に「信頼」を持つ相手の
 * ユニットがいるかを見るのと同じことなので、盤面を端から探さずに移動先の隣だけを見る。
 *
 * 制限されるのは移動だけで、ユニットのプレイやカードや能力によるゾーン移動は制限されない
 * （同 3）。この判定を移動の経路にだけ置いているのがその区別にあたる。
 */
function blockedByTrust(state: DuelState, player: Player, destination: Square): boolean {
  return squaresBeside(destination).some((beside) =>
    cardsOn(state, beside).some(
      (each) => each.controller !== player && each.card.type === 'ユニット' && hasTrust(each.card),
    ),
  )
}
