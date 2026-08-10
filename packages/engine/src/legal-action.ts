import { discardTrap, placeEnergy, plan, smash } from './action.js'
import type { ActionOutcome } from './action.js'
import { BATTLE_SPACE } from './board.js'
import type { Square } from './board.js'
import { cardsIn, cardsOn, hasEnded } from './duel.js'
import type { CardId, CardInstance, DuelState } from './duel.js'
import { moveUnit } from './move.js'
import type { Player } from './player.js'
import { activateTrap, playAsTrap, playCard } from './play.js'
import type { PlayDeclaration } from './play.js'
import { passPriority } from './progress.js'
import type { Chooser } from './resolve.js'

/**
 * その時点で行える行動 1 つの宣言（ADR-0005）。
 *
 * 「合法手を列挙する」機能は、AI のためではなくエンジンの必須機能になる（同）。人間の入力にも
 * ファザにも、視点ごとに射影した盤面（ADR-0004）を通してこの並びを見せる使い道がある。「移動」
 * はユニットがスクエア間を動くこと（`move.ts` の `moveUnit`）を指す既存の用語（ADR-0003）なので、
 * 行動 1 つを指すこの型は `Move` ではなく `LegalAction` と呼ぶ。
 *
 * `優先権を放棄する` は必ず候補に入る（`legalActions`）。他に行える行動が無くても優先権の放棄
 * だけは行えるため、デュエルが終了していない限り `legalActions` の結果は空にならない。
 */
export type LegalAction =
  | { readonly kind: '優先権を放棄する' }
  | { readonly kind: 'エネルギーを置く'; readonly card: CardId }
  | { readonly kind: 'プランする' }
  | { readonly kind: 'スマッシュする'; readonly unit: CardId }
  | { readonly kind: 'トラップを廃棄する'; readonly card: CardId }
  | { readonly kind: 'カードをプレイする'; readonly declaration: PlayDeclaration }
  | { readonly kind: 'トラップとしてプレイする'; readonly card: CardId }
  | { readonly kind: 'トラップを発動する'; readonly card: CardId }
  | { readonly kind: 'ユニットを移動する'; readonly unit: CardId; readonly destination: Square }

/** 選択を求められたら常に最初の候補を選ぶ。`legalActions` が合法性だけを確かめるのに使う。 */
const chooseFirst: Chooser = (candidates) => candidates[0]

/**
 * いまの盤面で行える行動をすべて列挙する（ADR-0005）。
 *
 * 行動が実際に成功するかどうかは、コストの支払いや対象の有無まで含めて行動そのもの
 * （`action.ts`・`play.ts`・`move.ts`）が知っている。ここではその判定を再実装せず、候補となる
 * 宣言を組み立てて実際に試し、成功したものだけを残す。どの候補を選んでも結果に関わらない
 * コストの支払い（同じ色のエネルギーが複数あるなど）はどれを選んでもよいので、`chooseFirst`
 * で試す。実際にどれを選ぶかは、これを呼んだ側が `applyLegalAction` に渡す `chooser` で決める。
 *
 * デュエルが終了していれば、それ以上優先権も発生しない（総合ルール 第3部 第3章 3）ので
 * 何も返さない。
 */
export function legalActions(state: DuelState): readonly LegalAction[] {
  if (hasEnded(state)) return []

  const active = state.turn.active
  const priority = state.turn.priority
  // 手札とスクエア上のユニットは複数の行動の候補になるので、ここで 1 度だけ求めておく。
  const hand = cardsIn(state, active, '手札')
  const units = unitsOnSquares(state, active)

  return [
    { kind: '優先権を放棄する' as const },
    ...hand.flatMap((card) =>
      tryAction({ kind: 'エネルギーを置く', card: card.id }, () => placeEnergy(state, card.id)),
    ),
    ...tryAction({ kind: 'プランする' }, () => plan(state, chooseFirst)),
    ...units.flatMap((unit) =>
      tryAction({ kind: 'スマッシュする', unit: unit.id }, () => smash(state, unit.id)),
    ),
    ...cardsIn(state, active, 'トラップゾーン').flatMap((card) =>
      tryAction({ kind: 'トラップを廃棄する', card: card.id }, () => discardTrap(state, card.id)),
    ),
    ...[...hand, ...cardsIn(state, active, 'プランゾーン')].flatMap((card) => playCandidates(state, card)),
    ...hand.flatMap((card) =>
      tryAction({ kind: 'トラップとしてプレイする', card: card.id }, () => playAsTrap(state, card.id)),
    ),
    ...cardsIn(state, priority, 'トラップゾーン').flatMap((card) =>
      tryAction({ kind: 'トラップを発動する', card: card.id }, () => activateTrap(state, card.id, chooseFirst)),
    ),
    ...units.flatMap((unit) => moveCandidates(state, unit.id)),
  ]
}

/**
 * 実際に選ばれた行動を盤面に適用する。
 *
 * `action` は `legalActions` が返したものだけを渡す前提であり、その時と盤面が変わっていなければ
 * 必ず成功する。コストの支払いや効果の中の選択は `chooser` に委ねる。
 */
export function applyLegalAction(state: DuelState, action: LegalAction, chooser: Chooser): DuelState {
  switch (action.kind) {
    case '優先権を放棄する':
      return passPriority(state, chooser)
    case 'エネルギーを置く':
      return outcomeState(placeEnergy(state, action.card))
    case 'プランする':
      return outcomeState(plan(state, chooser))
    case 'スマッシュする':
      return outcomeState(smash(state, action.unit))
    case 'トラップを廃棄する':
      return outcomeState(discardTrap(state, action.card))
    case 'カードをプレイする':
      return outcomeState(playCard(state, action.declaration, chooser))
    case 'トラップとしてプレイする':
      return outcomeState(playAsTrap(state, action.card))
    case 'トラップを発動する':
      return outcomeState(activateTrap(state, action.card, chooser))
    case 'ユニットを移動する':
      return outcomeState(moveUnit(state, action.unit, action.destination))
  }
}

/** その行動が試しに行えるなら、その宣言を含む 1 要素の並び。行えなければ空の並び。 */
function tryAction(action: LegalAction, attempt: () => ActionOutcome): readonly LegalAction[] {
  return attempt().kind === '行った' ? [action] : []
}

/** 行えたはずの行動の結果の盤面。`legalActions` が合法だと確かめた行動でなければ例外になる。 */
function outcomeState(outcome: ActionOutcome): DuelState {
  if (outcome.kind !== '行った') throw new Error(`合法手のはずが行えなかった: ${outcome.violation}`)
  return outcome.state
}

/** そのプレイヤーが支配する、スクエアにあるユニット。スマッシュ・移動の候補になる。 */
function unitsOnSquares(state: DuelState, controller: Player): readonly CardInstance[] {
  return BATTLE_SPACE.flatMap((square) => cardsOn(state, square)).filter(
    (instance) => instance.controller === controller && instance.card.type === 'ユニット',
  )
}

/**
 * 手札またはプランゾーンにあるそのカードをプレイする候補。
 *
 * ユニットならスクエアを 1 つ指定する必要がある（総合ルール 第2部 第20章 1-3）ので、
 * 9 つのスクエアそれぞれについて試す。ユニット以外はスクエアを指定しない。呼び出し側
 * （`legalActions`）がすでに手札・プランゾーンを走査してこの `instance` を得ているので、
 * ここで同じカードを探し直すことはしない。
 */
function playCandidates(state: DuelState, instance: CardInstance): readonly LegalAction[] {
  const card = instance.id

  if (instance.card.type !== 'ユニット') {
    return tryAction({ kind: 'カードをプレイする', declaration: { card } }, () => playCard(state, { card }, chooseFirst))
  }
  return BATTLE_SPACE.flatMap((square) =>
    tryAction({ kind: 'カードをプレイする', declaration: { card, square } }, () =>
      playCard(state, { card, square }, chooseFirst),
    ),
  )
}

/** そのユニットを移動する候補。9 つのスクエアそれぞれについて試す。 */
function moveCandidates(state: DuelState, unit: CardId): readonly LegalAction[] {
  return BATTLE_SPACE.flatMap((destination) =>
    tryAction({ kind: 'ユニットを移動する', unit, destination }, () => moveUnit(state, unit, destination)),
  )
}
