import type { CardId, ChoiceAnswer, LegalAction, Square, WireCardPosition } from '@revolution/engine'
import type { ActionView, ChoiceView, DestinationView, PickView } from './input-model.js'
import type {
  AbilityView,
  BattleView,
  BoardView,
  CardView,
  Overlay,
  SideView,
  SmashJudgmentView,
  SquareView,
  TransitionView,
  ZoneView,
} from './view-model.js'
import { keyOfPosition } from './view-model.js'

/**
 * 画面に出す値（`view-model.ts`）を DOM にする。
 *
 * **ここに判断を置かない。** 何を出すかはビューモデルがすでに決めていて、ここは要素を作って
 * 並べるだけである。テストがあるのはビューモデルまでで、この層は薄く保つ（#14）。
 *
 * 例外は詳細の札を右に出すか左に出すか（`panelSide`）だけである。これは画面の幅と、カードが
 * いまどこにあるかで決まるもので、ビューモデルには測りようがない。**それでも判断そのものは
 * 数値だけの関数に出してあり**、DOM から測る部分（`placePanel`）と分けてある。
 */

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text

  return node
}

/** 詳細の札を出す側。 */
export type PanelSide = '右' | '左'

/**
 * 詳細の札を右と左のどちらに出すか。単位は px で、どれも `placePanel` が測ったものである。
 *
 * 既定は右。**入りきらない側には出さない**——札のぶんだけ画面が横に伸びると、盤面の位置が
 * 動いてしまう。両側とも足りないときは、広いほうに出す（どちらでもはみ出すが、隠れる量が
 * 少ない）。
 */
export function panelSide(room: {
  /** カードの右端から画面の右端まで。 */
  readonly right: number
  /** 画面の左端からカードの左端まで。 */
  readonly left: number
  /** 札を出すのに要る幅。札の幅と、カードから離すぶんの合計。 */
  readonly needed: number
}): PanelSide {
  if (room.right >= room.needed) return '右'

  return room.left > room.right ? '左' : '右'
}

/**
 * 詳細の札を出す側を決めて、印を付ける（`style.css` の `.card__panel--左`）。
 *
 * **ここだけは実際の寸法を見る。** 出す直前に測るのは、画面の幅も盤面の並びも変わるためで、
 * 作る時に決めてしまうと横に伸ばした後で合わなくなる。
 */
function placePanel(card: HTMLElement, panel: HTMLElement): void {
  const box = card.getBoundingClientRect()
  const side = panelSide({
    right: document.documentElement.clientWidth - box.right,
    left: box.left,
    // カードから離すぶんは、フリーズがはみ出す量に合わせてある（`style.css` の `.card__panel`）。
    needed: Number.parseFloat(getComputedStyle(panel).width) + box.width / 4,
  })
  panel.classList.toggle('card__panel--左', side === '左')
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

  // 印刷されているテキスト（#93）。改行ごとに別の能力になる（総合ルール 第2部 第10章 1、
  // 第4部 第1章 3）ので、1 行ずつ別の段落にして改行を潰さない。
  if (card.text.length > 0) {
    const text = element('div', 'card__panel-text')
    for (const line of card.text) text.append(element('p', 'card__panel-line', line))
    node.append(text)
  }

  return node
}

/**
 * 盤面をクリックして操作するための手がかり（#94）。押していない時は `undefined`。
 *
 * **どれを押せるかはここで決めない。** 届いた手が指しているところを `input-model.ts` が
 * すでに並べていて（`pickView`）、ここはそれを描くだけである。
 */
/**
 * 押せるスクエア 1 つ。**押した時に何を送るかはここに無い。** 置き先なら手を送り
 * （`input-model.ts` の `DestinationView`）、効果が選ばせているなら候補の番号で答える
 * （同 `ChoiceSquareView`）。どちらかは渡す側が知っている。
 */
export interface PickableSquare {
  readonly square: Square
  readonly label: string
}

export interface BoardPicking {
  readonly pickable: readonly CardId[]
  readonly picked: CardId | undefined
  /** 光らせるスクエア。押す先がカードだけの場面では空か、渡されない。 */
  readonly squares?: readonly PickableSquare[]
  /**
   * 押せる裏向きのカードの置き場所（#127）。行える手を選ぶ場面では渡されない。
   *
   * 裏向きのカードは識別子を持たない（`view-model.ts` の `CardView`）ので、押せるかどうかも
   * 置き場所で引く。**どれが押せるかはここで決めない**のは、表向きのカードと同じである。
   */
  readonly hidden?: readonly WireCardPosition[]
  readonly onCard: (card: CardId) => void
  readonly onSquare?: (square: Square) => void
  readonly onHidden?: (at: WireCardPosition) => void
}

/** そのスクエアが押せるなら、その 1 つ。押せなければ `undefined`。 */
function pickableAt(picking: BoardPicking | undefined, square: Square): PickableSquare | undefined {
  return picking?.squares?.find((each) => each.square.row === square.row && each.square.column === square.column)
}

/** その置き場所の裏向きのカードが押せるか。 */
function picksHidden(picking: BoardPicking | undefined, at: WireCardPosition): boolean {
  const key = keyOfPosition(at)
  return picking?.hidden?.some((each) => keyOfPosition(each) === key) ?? false
}

/**
 * カードの見える面。**詳細の札はこの外側に置く**（`cardElement`）。
 *
 * フリーズを横倒しにする（総合ルール 第2部 第24章）のはこの要素で、外枠の `card` は回らない。
 * 札まで一緒に回ってしまうと、横倒しのカードだけ詳細が寝て出る（#93）。
 */
function faceElement(): HTMLElement {
  return element('div', 'card__face')
}

function cardElement(card: CardView, picking?: BoardPicking): HTMLElement {
  if (card.kind === '裏') {
    // 裏向きのカードも候補になる（プランのコストのスマッシュ、#127）。押せるかどうかは
    // 置き場所で引く。識別子は届いていない。
    const pickable = picksHidden(picking, card.at)
    const back = element('div', `card card--back card--${card.orientation}${pickable ? ' card--押せる' : ''}`)
    // 押せることを色だけで区別させないのは、表向きのカードと同じである（#94）。
    back.setAttribute('aria-label', `裏向きのカード（${card.orientation}）${pickable ? '（押せます）' : ''}`)
    if (pickable && picking?.onHidden !== undefined) {
      const at = card.at
      const onHidden = picking.onHidden
      back.addEventListener('click', () => onHidden(at))
    }
    back.append(faceElement())
    return back
  }

  // 継続効果でデータが変わっていることは、文字（`BP1000→2000`・`+夢`）で分かる。色は添えるだけ
  // で、それだけに頼らない（#91）。
  const modified = card.modified === undefined ? '' : ' card--修整あり'
  // 押せるかどうかも色だけで区別させない。押せるカードは `aria-label` にもそう出す（#94）。
  const pickable = picking?.pickable.includes(card.id) ?? false
  const picked = picking?.picked === card.id
  const state = `${pickable ? ' card--押せる' : ''}${picked ? ' card--選択中' : ''}`
  const node = element('div', `card card--${card.orientation} card--${card.controlledBy}${modified}${state}`)
  // キーボードでも詳細を出せるようにする。マウスを乗せるだけの形にすると触れない人が出る。
  node.tabIndex = 0
  const how = picked ? '（選択中）' : pickable ? '（押せます）' : ''
  node.setAttribute('aria-label', `${card.controlledBy}の${card.name}${how}`)
  if (pickable && picking !== undefined) {
    const id = card.id
    node.addEventListener('click', () => picking.onCard(id))
  }

  const face = faceElement()
  // 色だけで区別させない。色を見分けられない人にも分かるように、文字でも出す。
  face.append(element('span', 'card__whose', card.controlledBy))
  face.append(element('span', 'card__name', card.name), element('span', 'card__detail', card.summary))
  if (card.damage > 0) face.append(element('span', 'card__damage', `ダメージ ${card.damage}`))
  node.append(face)

  const panel = panelElement(card)
  node.append(panel)
  // 出す側は、出る直前に決める。マウスでもキーボードでも同じところに出す。
  const place = (): void => placePanel(node, panel)
  node.addEventListener('mouseenter', place)
  node.addEventListener('focusin', place)

  return node
}

function zoneElement(zone: ZoneView, picking?: BoardPicking): HTMLElement {
  const node = element('section', `zone zone--${zone.zone}`)
  node.append(element('h3', 'zone__title', `${zone.zone}（${zone.count}）`))

  const cards = element('div', 'zone__cards')
  for (const card of zone.cards) cards.append(cardElement(card, picking))
  node.append(cards)

  return node
}

function sideElement(side: SideView, picking?: BoardPicking): HTMLElement {
  const node = element('section', `side side--${side.whose}`)
  node.append(element('h2', 'side__title', `${side.whose}（${side.player}）・ダメージ ${side.damage}`))

  const zones = element('div', 'side__zones')
  for (const zone of side.zones) zones.append(zoneElement(zone, picking))
  node.append(zones)

  return node
}

function squareElement(square: SquareView, picking?: BoardPicking): HTMLElement {
  const pickable = pickableAt(picking, square.square)
  const node = element('div', `square square--${square.area}${pickable === undefined ? '' : ' square--置き先'}`)
  // 押せることを色だけで区別させない。読み上げにも出す。
  const where = pickable === undefined ? '' : `（${pickable.label}）`
  node.setAttribute('aria-label', `${square.area} ${square.square.row}-${square.square.column}${where}`)
  const onSquare = picking?.onSquare
  if (pickable !== undefined && onSquare !== undefined) {
    const picked = pickable.square
    node.tabIndex = 0
    node.addEventListener('click', () => onSquare(picked))
  }
  for (const card of square.cards) node.append(cardElement(card, picking))

  return node
}

function squaresElement(rows: BoardView['squares'], picking?: BoardPicking): HTMLElement {
  const node = element('div', 'battle-space')
  for (const row of rows) {
    const line = element('div', 'battle-space__row')
    for (const square of row) line.append(squareElement(square, picking))
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
/**
 * 見出しの行（#128）。
 *
 * `aside` を渡すと、見出しと同じ行の右端に置く。操作するところは器ひとつにまとめてあり
 * （`index.ts` の `controls`）、その高さは決め打ちなので、**行を増やさずに済ませたい**。
 * 操作のしかたの切り替え（#94）は行える手に添えるものなので、ここに入る。
 */
function titleRow(className: string, text: string, aside: HTMLElement | undefined): HTMLElement {
  const row = element('div', 'panel__head')
  row.append(element('h2', className, text))
  if (aside !== undefined) row.append(aside)

  return row
}

export function actionsElement(
  views: readonly ActionView[],
  onAction: (action: LegalAction) => void,
  aside?: HTMLElement,
): HTMLElement {
  const node = element('section', 'actions')
  node.append(titleRow('actions__title', '行える手', aside))
  if (views.length === 0) {
    node.append(element('p', 'actions__none', 'いまは行えることがありません'))
    return node
  }

  const list = element('div', 'actions__list')
  for (const view of views) list.append(button(view.label, () => onAction(view.action)))
  node.append(list)

  return node
}

/** クリックで操作する時に、行える手のところへ出すもの（#94）。 */
export interface PickHandlers {
  readonly onAction: (action: LegalAction) => void
  /** 選びかけをやめる。 */
  readonly onCancel: () => void
}

/**
 * クリックで操作する時の、行える手のところ（#94）。
 *
 * 盤面の上で示せない手だけをここに出す。**カードを選ぶ前は、対象を持たない手だけ**が並び、
 * カードを選んだ後はその 1 枚の手が並ぶ。置き先を選ぶ手は盤面の上にあるので、ここには出ない。
 */
export function pickElement(view: PickView, handlers: PickHandlers, aside?: HTMLElement): HTMLElement {
  const node = element('section', 'actions')
  node.append(titleRow('actions__title', '行える手', aside))

  const guide =
    view.picked === undefined
      ? view.pickable.length > 0
        ? 'カードを押すと、そのカードで行える手が出ます'
        : '押せるカードがありません'
      : view.destinations.length > 0
        ? '光っているスクエアを押すと、そこへ置きます'
        : 'このカードで行える手を選んでください'
  node.append(element('p', 'actions__none', guide))

  const list = element('div', 'actions__list')
  for (const view_ of [...view.direct, ...view.untargeted]) {
    list.append(button(view_.label, () => handlers.onAction(view_.action)))
  }
  node.append(list)

  if (view.picked !== undefined) {
    const back = element('div', 'choice__back')
    back.append(button('選ぶのをやめる', handlers.onCancel))
    node.append(back)
  }

  return node
}

/**
 * 演出が出ている間、行える手のかわりに出すもの（#115）。
 *
 * 待ち行列は実際の盤面より遅れているので、出ている演出のフェイズと、行える手が指すフェイズが
 * 食い違う。手を出さないことで、**画面が実際と違うことを言っている**状態を作らない。
 */
export function waitingForOverlayElement(aside?: HTMLElement): HTMLElement {
  const node = element('section', 'actions')
  node.append(titleRow('actions__title', '行える手', aside))
  node.append(element('p', 'actions__none', '演出が終わるまで待ってください'))

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

/**
 * 選ぶ候補を並べる。答えるのは番号である（ADR-0008）。
 *
 * クリックで操作している間、盤面から押せる候補はここに出ない（#150、`input-model.ts` の
 * `choiceView`）。**どれを出すかはすでに決まっている**ので、ここでは残ったものを並べるだけで
 * ある（#14）。
 */
export function choiceElement(view: ChoiceView, handlers: ChoiceHandlers, aside?: HTMLElement): HTMLElement {
  const node = element('section', 'choice')
  node.append(titleRow('choice__title', view.asking, aside))
  if (view.guide !== undefined) node.append(element('p', 'choice__none', view.guide))

  const list = element('div', 'choice__list')
  for (const candidate of view.candidates) {
    list.append(button(candidate.label, () => handlers.onAnswer(candidate.index)))
  }
  if (view.mayDecline) list.append(button('選ばない', () => handlers.onAnswer('選ばない')))
  node.append(list)

  // 戻る側は、答える側と並べない。押し間違えると選びかけたものが消える。
  //
  // 戻れない場面ではどちらも出さない（#142）。押せば断られるボタンを並べない。
  const back = element('div', 'choice__back')
  if (view.mayRewind) back.append(button('ひとつ戻る', handlers.onRewind))
  if (view.mayCancel) back.append(button('この行動をやめる', handlers.onCancel))
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

/**
 * スマッシュ判定の様子（総合ルール 第3部 第17章）。#102。
 *
 * 希望ステップで表向きに置かれているカードは、**規定によって表向きなのだと分かる形**で出す
 * （同 第19章 1）。ただ名前が出ているだけだと、スマッシュゾーンの中身が見えているように読める。
 */
function smashJudgmentElement(judgment: SmashJudgmentView): HTMLElement {
  const round = judgment.round === undefined ? '' : `・${judgment.repeats} 回中 ${judgment.round} 回目`
  const faceUp = judgment.faceUp === undefined ? '' : `・規定により表向き: ${judgment.faceUp}`

  return element(
    'p',
    'board__smash-judgment',
    `スマッシュ判定: ${judgment.whose}のダメージ・${judgment.step}${round}${faceUp}`,
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
    // 入れ子になった手順の中を字下げする（#133）。深さに上限が無いので、深さごとの
    // クラスを並べるかわりに数として渡す（`style.css` の `.log__item`）。
    item.style.setProperty('--log-depth', String(line.depth))
    // 誰のできごとかを色だけで区別させない。文字でも出す。区切りの行は文の中で言っている
    // （`view-model.ts` の `separator`）ので、重ねて添えない。
    if (line.whose !== undefined && line.kind === 'できごと') {
      item.append(element('span', 'log__whose', line.whose))
    }
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

/**
 * 盤面ひととおりを組み立てる。
 *
 * `picking` を渡すと、押せるカードと置き先が盤面の上で分かるようになる（#94）。渡さなければ
 * これまで通り、盤面はただ見るだけのものになる。
 */
export function boardElement(view: BoardView, picking?: BoardPicking): HTMLElement {
  const node = element('div', 'board')
  if (view.battle !== undefined) node.append(battleElement(view.battle))
  for (const judgment of view.smashJudgments) node.append(smashJudgmentElement(judgment))
  if (view.result !== undefined) node.append(element('p', 'board__result', view.result))

  if (view.bank.length > 0 || view.triggered.length > 0) {
    const waiting = element('div', 'board__waiting')
    if (view.bank.length > 0) waiting.append(abilitiesElement('バンク', view.bank))
    if (view.triggered.length > 0) waiting.append(abilitiesElement('誘発した能力', view.triggered))
    node.append(waiting)
  }

  node.append(
    sideElement(view.opponent, picking),
    squaresElement(view.squares, picking),
    sideElement(view.own, picking),
  )
  node.append(logElement(view.log))

  return node
}
