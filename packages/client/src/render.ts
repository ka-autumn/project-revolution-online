import type { ChoiceAnswer, LegalAction } from '@revolution/engine'
import type { ActionView, ChoiceView } from './input-model.js'
import type {
  AbilityView,
  BattleView,
  BoardView,
  CardView,
  Overlay,
  SideView,
  SquareView,
  TransitionView,
  ZoneView,
} from './view-model.js'

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

/**
 * 詳しく見たときに出す札。
 *
 * 出す・隠すは CSS に任せている（`style.css` の `.card:hover` / `.card:focus-within`）。
 * 押した時だけ出す形にすると、押すことが操作（#94）とぶつかる。
 */
function panelElement(card: CardView & { readonly kind: '表' }): HTMLElement {
  const node = element('div', 'card__panel')
  node.append(element('div', 'card__panel-name', card.name))

  const rows = element('dl', 'card__panel-rows')
  for (const row of card.details) {
    rows.append(element('dt', 'card__panel-label', row.label), element('dd', 'card__panel-value', row.value))
  }
  node.append(rows)

  return node
}

function cardElement(card: CardView): HTMLElement {
  if (card.kind === '裏') {
    const back = element('div', `card card--back card--${card.orientation}`)
    back.setAttribute('aria-label', `裏向きのカード（${card.orientation}）`)
    return back
  }

  const node = element('div', `card card--${card.orientation} card--${card.controlledBy}`)
  // キーボードでも詳細を出せるようにする。マウスを乗せるだけの形にすると触れない人が出る。
  node.tabIndex = 0
  node.setAttribute('aria-label', `${card.controlledBy}の${card.name}`)
  // 色だけで区別させない。色を見分けられない人にも分かるように、文字でも出す。
  node.append(element('span', 'card__whose', card.controlledBy))
  node.append(element('span', 'card__name', card.name), element('span', 'card__detail', card.summary))
  if (card.damage > 0) node.append(element('span', 'card__damage', `ダメージ ${card.damage}`))
  node.append(panelElement(card))

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

/** 選ぶところで押せる、答える以外のもの。 */
export interface ChoiceHandlers {
  readonly onAnswer: (answer: ChoiceAnswer) => void
  /** 直前に答えたものを取り消す。 */
  readonly onRewind: () => void
  /** 行動そのものを取り消す。 */
  readonly onCancel: () => void
}

/** 選ぶ候補を並べる。答えるのは番号である（ADR-0008）。 */
export function choiceElement(view: ChoiceView, handlers: ChoiceHandlers): HTMLElement {
  const node = element('section', 'choice')
  node.append(element('h2', 'choice__title', view.asking))

  const list = element('div', 'choice__list')
  for (const candidate of view.candidates) {
    list.append(button(candidate.label, () => handlers.onAnswer(candidate.index)))
  }
  if (view.mayDecline) list.append(button('選ばない', () => handlers.onAnswer('選ばない')))
  node.append(list)

  // 戻る側は、答える側と並べない。押し間違えると選びかけたものが消える。
  const back = element('div', 'choice__back')
  if (view.mayRewind) back.append(button('ひとつ戻る', handlers.onRewind))
  back.append(button('この行動をやめる', handlers.onCancel))
  node.append(back)

  return node
}

/** バトルの様子（総合ルール 第3部 第11章）。 */
function battleElement(battle: BattleView): HTMLElement {
  return element(
    'p',
    'board__battle',
    `バトル: ${battle.where}・${battle.step}（攻撃 ${battle.attacker} / 被攻撃 ${battle.attacked}）`,
  )
}

/** 解決を待っている能力の並び。何をする能力かは出せない（`view-model.ts` の `AbilityView`）。 */
function abilitiesElement(title: string, abilities: readonly AbilityView[]): HTMLElement {
  const node = element('section', 'bank')
  node.append(element('h3', 'bank__title', `${title}（${abilities.length}）`))

  const list = element('ul', 'bank__list')
  for (const ability of abilities) {
    list.append(element('li', 'bank__item', `${ability.whose}: ${ability.source ?? '発生源なし'}`))
  }
  node.append(list)

  return node
}

/**
 * 起きたできごとを並べる（#95）。新しいものを先頭に置く（#111）。
 *
 * 出せるのは届いた分だけである。見てはならないカードは名指しされないまま届く
 * （`perspective.ts` の `DuelPerspective.log`）ので、ここで隠すことは無い。
 *
 * 並びを逆にしても番号は起きた順のままにするため、`<ol>` の `reversed` 属性に任せる
 * （`lines` の並びは `view-model.ts` の `logLines` がすでに新しい順にしている）。
 */
function logElement(lines: BoardView['log']): HTMLElement {
  const node = element('section', 'log')
  node.append(element('h2', 'log__title', `操作ログ（${lines.length}）`))

  const list = element('ol', 'log__list')
  list.setAttribute('reversed', '')
  for (const line of lines) {
    const item = element('li', `log__item${line.whose === undefined ? '' : ` log__item--${line.whose}`}`)
    // 誰のできごとかを色だけで区別させない。文字でも出す。
    if (line.whose !== undefined) item.append(element('span', 'log__whose', line.whose))
    item.append(element('span', 'log__text', line.text))
    list.append(item)
  }
  node.append(list)

  return node
}

/** フェイズ・ターンの切り替わりを知らせる 1 行（#96）。 */
function transitionElement(view: TransitionView): HTMLElement {
  return element('p', 'transition-banner', view.heading)
}

/**
 * 演出を重ねる層（#96・#104）。
 *
 * 盤面の上に重ねるだけで、**押せる場所は塞がない**（`style.css` の `.overlay-layer` の
 * `pointer-events: none`）。いつ消すかはここでは決めない。溜めない出し方の管理は
 * `index.ts` のタイマーの仕事である——フェイズ・ターンの切り替わりも効果解決のカットインも、
 * 同じ待ち行列を通って出る（`view-model.ts` の `Overlay`）。
 */
export function overlayElement(overlay: Overlay): HTMLElement {
  const node = element('div', 'overlay-layer')
  for (const view of overlay.transitions) node.append(transitionElement(view))

  for (const view of overlay.cutIns) {
    const cutIn = element('div', `cut-in cut-in--${view.whose}`)
    // 誰の効果かを色だけで区別させない。文字でも出す。
    cutIn.append(element('span', 'cut-in__whose', view.whose))
    cutIn.append(element('p', 'cut-in__heading', view.heading))

    const lines = element('div', 'cut-in__lines')
    for (const line of view.lines) lines.append(element('p', 'cut-in__line', line))
    cutIn.append(lines)

    node.append(cutIn)
  }

  return node
}

/** 盤面ひととおりを組み立てる。 */
export function boardElement(view: BoardView): HTMLElement {
  const node = element('div', 'board')
  node.append(element('p', 'board__turn', view.turn))
  if (view.battle !== undefined) node.append(battleElement(view.battle))
  if (view.result !== undefined) node.append(element('p', 'board__result', view.result))

  if (view.bank.length > 0 || view.triggered.length > 0) {
    const waiting = element('div', 'board__waiting')
    if (view.bank.length > 0) waiting.append(abilitiesElement('バンク', view.bank))
    if (view.triggered.length > 0) waiting.append(abilitiesElement('誘発した能力', view.triggered))
    node.append(waiting)
  }

  node.append(sideElement(view.opponent), squaresElement(view.squares), sideElement(view.own))
  node.append(logElement(view.log))

  return node
}
