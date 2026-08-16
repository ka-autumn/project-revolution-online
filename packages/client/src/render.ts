import type { ChoiceAnswer, LegalAction } from '@revolution/engine'
import type { ActionView, ChoiceView } from './input-model.js'
import type { BoardView, CardView, SideView, SquareView, ZoneView } from './view-model.js'

/**
 * 画面に出す値（`view-model.ts`）を DOM にする。
 *
 * **ここに判断を置かない。** 何を出すかはビューモデルがすでに決めていて、ここは要素を作って
 * 並べるだけである。テストがあるのはビューモデルまでで、この層は薄く保つ（#14）。
 */

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text

  return node
}

function cardElement(card: CardView): HTMLElement {
  if (card.kind === '裏') {
    const back = element('div', `card card--back card--${card.orientation}`)
    back.setAttribute('aria-label', `裏向きのカード（${card.orientation}）`)
    return back
  }

  const node = element('div', `card card--${card.orientation}`)
  node.append(element('span', 'card__name', card.name), element('span', 'card__detail', card.detail))
  if (card.damage > 0) node.append(element('span', 'card__damage', `ダメージ ${card.damage}`))

  return node
}

function zoneElement(zone: ZoneView): HTMLElement {
  const node = element('section', `zone zone--${zone.zone}`)
  node.append(element('h3', 'zone__title', `${zone.zone}（${zone.count}）`))

  const cards = element('div', 'zone__cards')
  for (const card of zone.cards) cards.append(cardElement(card))
  node.append(cards)

  return node
}

function sideElement(side: SideView): HTMLElement {
  const node = element('section', `side side--${side.whose}`)
  node.append(element('h2', 'side__title', `${side.whose}（${side.player}）・ダメージ ${side.damage}`))

  const zones = element('div', 'side__zones')
  for (const zone of side.zones) zones.append(zoneElement(zone))
  node.append(zones)

  return node
}

function squareElement(square: SquareView): HTMLElement {
  const node = element('div', `square square--${square.area}`)
  node.setAttribute('aria-label', `${square.area} ${square.square.row}-${square.square.column}`)
  for (const card of square.cards) node.append(cardElement(card))

  return node
}

function squaresElement(rows: BoardView['squares']): HTMLElement {
  const node = element('div', 'battle-space')
  for (const row of rows) {
    const line = element('div', 'battle-space__row')
    for (const square of row) line.append(squareElement(square))
    node.append(line)
  }

  return node
}

function button(label: string, onPress: () => void): HTMLElement {
  const node = element('button', 'choice__button', label)
  node.addEventListener('click', onPress)

  return node
}

/**
 * 行える手を並べる。
 *
 * 並べるのは届いたものだけである。**押せない手は画面に出ない**（ADR-0010）。
 */
export function actionsElement(views: readonly ActionView[], onAction: (action: LegalAction) => void): HTMLElement {
  const node = element('section', 'actions')
  node.append(element('h2', 'actions__title', '行える手'))
  if (views.length === 0) {
    node.append(element('p', 'actions__none', 'いまは行えることがありません'))
    return node
  }

  const list = element('div', 'actions__list')
  for (const view of views) list.append(button(view.label, () => onAction(view.action)))
  node.append(list)

  return node
}

/** 選ぶ候補を並べる。答えるのは番号である（ADR-0008）。 */
export function choiceElement(view: ChoiceView, onAnswer: (answer: ChoiceAnswer) => void): HTMLElement {
  const node = element('section', 'choice')
  node.append(element('h2', 'choice__title', '選んでください'))

  const list = element('div', 'choice__list')
  for (const candidate of view.candidates) list.append(button(candidate.label, () => onAnswer(candidate.index)))
  if (view.mayDecline) list.append(button('選ばない', () => onAnswer('選ばない')))
  node.append(list)

  return node
}

/** 盤面ひととおりを組み立てる。 */
export function boardElement(view: BoardView): HTMLElement {
  const node = element('div', 'board')
  node.append(element('p', 'board__turn', view.turn))
  if (view.result !== undefined) node.append(element('p', 'board__result', view.result))
  node.append(sideElement(view.opponent), squaresElement(view.squares), sideElement(view.own))

  return node
}
