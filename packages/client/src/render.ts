import { DUEL_FORMATS } from '@revolution/engine'
import type {
  CardId,
  ChoiceAnswer,
  DeckId,
  DuelFormat,
  LegalAction,
  OpponentKind,
  RestrictionChoice,
  RoomCode,
  Square,
  WireCardPosition,
  WireDeck,
  WireRestrictionList,
} from '@revolution/engine'
import type { CardDetail, CheckView, ConfirmView, DeckRow, OwnedDeckRow, PoolRow } from './deck-builder.js'
import type { ActionView, ChoiceView, DestinationView, PickView } from './input-model.js'
import { emptyFilter, isFiltering, toggled } from './pool-filter.js'
import type { FilterChoices, NumberRange, PoolFilter } from './pool-filter.js'
import type {
  AbilityView,
  BattleView,
  BoardView,
  CardView,
  Overlay,
  RoomView,
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

/** ロビーで押せるもの（#175）。 */
export interface LobbyHandlers {
  /** 部屋を作って入る。名前は空でもよい。 */
  readonly onCreate: (name: string, against: OpponentKind) => void
  /** 相手を待っている部屋に入る。 */
  readonly onJoin: (code: RoomCode) => void
  /** 打ち込んだ名前が変わった。**画面は描き直されるので、覚えておくのは呼ぶ側である。** */
  readonly onName: (name: string) => void
  /** 持ち込むデッキを選び直した（ADR-0021）。名前と同じく、覚えておくのは呼ぶ側である。 */
  readonly onDeck: (deck: DeckId) => void
  /** CPU の席に座らせるデッキを選び直した（#195）。`onDeck` と同じく、覚えておくのは呼ぶ側である。 */
  readonly onCpuDeck: (deck: DeckId) => void
  /** 作る部屋の形式を選び直した（ADR-0021）。覚えておくのは呼ぶ側である。 */
  readonly onFormat: (format: DuelFormat) => void
  /** 作る部屋に当てる禁止／制限リストを選び直した（ADR-0021）。覚えておくのは呼ぶ側である。 */
  readonly onRestriction: (restriction: RestrictionChoice) => void
  /**
   * デッキを組むところを開く（#193）。**組めない立て方では渡さない**——カードプールも自分のデッキも
   * 届かず、組んでも残す場所が無い（ADR-0021）。
   */
  readonly onBuild?: () => void
}

/**
 * 作る部屋のルールとして、ロビーで選んでいるもの（ADR-0021）。まだ選んでいなければ `undefined`。
 *
 * **選ばないまま作ってもよい。** 選ばなかったものは、サーバが既定を当てる（`server` の `room.ts`
 * の `rulesFor`）。画面はどれが既定かを決めない（ADR-0010）。
 */
export interface ChosenRules {
  readonly format: DuelFormat | undefined
  readonly restriction: RestrictionChoice | undefined
}

/** 禁止／制限リストを当てないことを指す `select` の値。**リストの識別子とは重ならない**——リストは番号で指す。 */
const UNRESTRICTED_VALUE = '制限なし'

/**
 * 作る部屋のルールを選ぶところ（ADR-0021）。**選べるものは届いたものだけである。**
 *
 * 形式が 1 つしか無くても出す。**どの形式で打つ部屋かは、作る人にも分かっていなければならない。**
 */
function rulesPicker(
  restrictions: readonly WireRestrictionList[],
  chosen: ChosenRules,
  handlers: Pick<LobbyHandlers, 'onFormat' | 'onRestriction'>,
): HTMLElement {
  const node = element('div', 'lobby__rules')

  const formatLabel = element('label', 'lobby__rule')
  formatLabel.append(element('span', 'lobby__rule-label', '形式'))
  const formats = document.createElement('select')
  formats.className = 'lobby__rule-select'
  for (const format of DUEL_FORMATS) {
    const option = document.createElement('option')
    option.value = format
    option.textContent = format
    // 選ばれていなければ先頭が選ばれた形になる。サーバも選ばれなかった形式を構築戦にする。
    option.selected = format === chosen.format
    formats.append(option)
  }
  formats.addEventListener('change', () => {
    const format = DUEL_FORMATS.find((each) => each === formats.value)
    if (format !== undefined) handlers.onFormat(format)
  })
  formatLabel.append(formats)
  node.append(formatLabel)

  const restrictionLabel = element('label', 'lobby__rule')
  restrictionLabel.append(element('span', 'lobby__rule-label', '禁止／制限リスト'))
  const lists = document.createElement('select')
  lists.className = 'lobby__rule-select'
  // **渡されたリストを先に、制限なしを後に並べる。** 選ばれていなければ先頭が選ばれた形になり、
  // サーバも選ばれなかった部屋に渡された先頭のリストを当てる（リストが無ければ制限なし）ので、
  // 出ているものと当たるものがずれない。
  restrictions.forEach((list, index) => {
    const option = document.createElement('option')
    option.value = String(index)
    option.textContent = list.name
    option.selected = chosen.restriction?.kind === '禁止／制限リスト' && chosen.restriction.id === list.id
    lists.append(option)
  })
  const unrestricted = document.createElement('option')
  unrestricted.value = UNRESTRICTED_VALUE
  unrestricted.textContent = '制限なし'
  unrestricted.selected = chosen.restriction?.kind === '制限なし'
  lists.append(unrestricted)
  lists.addEventListener('change', () => {
    if (lists.value === UNRESTRICTED_VALUE) return handlers.onRestriction({ kind: '制限なし' })

    const list = restrictions[Number(lists.value)]
    if (list !== undefined) handlers.onRestriction({ kind: '禁止／制限リスト', id: list.id })
  })
  restrictionLabel.append(lists)
  node.append(restrictionLabel)

  return node
}

/** 持ち込むデッキを選ぶところ（ADR-0021）。**選べるものは届いたものだけである。** */
function deckPicker(
  decks: readonly WireDeck[],
  chosen: DeckId | undefined,
  onDeck: (deck: DeckId) => void,
  label = '持ち込むデッキ',
  className = 'lobby__deck',
): HTMLElement {
  const node = element('label', className)
  node.append(element('span', 'lobby__deck-label', label))

  const select = document.createElement('select')
  select.className = 'lobby__deck-select'
  // **どれも選ばれていないなら、選ばれていないことを出す**（#194）。前に選んでいたデッキを消した
  // 人がここへ来る（`seatedChoice`）。空の選択肢を置かないと、ブラウザが先頭を選んだ形にしてしまい、
  // **選んだ覚えのないデッキが選ばれて見える。** サーバもこの席を断る（`server` の `room.ts` の
  // `refusalOfDeck`）ので、出ているものと座れるものがずれない。
  if (chosen === undefined) {
    const empty = document.createElement('option')
    empty.value = ''
    empty.textContent = 'デッキを選んでください'
    empty.selected = true
    select.append(empty)
  }
  for (const deck of decks) {
    const option = document.createElement('option')
    option.value = deck.id
    option.textContent = deck.name
    option.selected = deck.id === chosen
    select.append(option)
  }
  select.addEventListener('change', () => onDeck(select.value))
  node.append(select)

  return node
}

/** 部屋の名前として受け取る長さの上限（`server` の `room.ts` の `NAME_LIMIT` と同じ）。 */
const NAME_LIMIT = 24

/**
 * ロビー（#175）。開いている部屋を並べ、作る口と入る口を出す。
 *
 * **打つ前に相手と合言葉を決めておく必要が無い**のがここの値である。合言葉を決めるのはサーバ
 * で（ADR-0009、#175）、画面が出すのは名前と様子だけである。
 *
 * `name` は打ち込みかけの部屋の名前。**画面は届いたものが変わるたびに丸ごと描き直される**
 * （`index.ts` の `draw`）ので、打ち込みかけを消さないために、呼ぶ側が覚えて渡す。
 */
export function lobbyElement(
  views: readonly RoomView[],
  name: string,
  decks: readonly WireDeck[],
  chosenDeck: DeckId | undefined,
  chosenCpuDeck: DeckId | undefined,
  restrictions: readonly WireRestrictionList[],
  chosenRules: ChosenRules,
  handlers: LobbyHandlers,
  focused = false,
): HTMLElement {
  const node = element('section', 'lobby')
  if (handlers.onBuild !== undefined) {
    const building = element('div', 'lobby__build')
    building.append(button('デッキを組む', handlers.onBuild))
    node.append(building)
  }
  node.append(element('h2', 'lobby__title', '対戦を始める'))

  // **デッキを選ぶところは、作る口と入る口の両方の上に置く。** どちらで座るかはここで決まる
  // （ADR-0021）ので、どちらか一方に付けると、もう一方から選べないように見える。
  if (decks.length > 0) node.append(deckPicker(decks, chosenDeck, handlers.onDeck))

  // **ルールを選ぶところは、作る口の上にだけ置く。** ルールを決めるのは部屋を作る人で、入る人は
  // 一覧に出ている部屋のルールを見て選ぶ（ADR-0021）。
  node.append(rulesPicker(restrictions, chosenRules, handlers))

  const making = element('div', 'lobby__make')
  const input = document.createElement('input')
  input.className = 'lobby__name'
  input.type = 'text'
  input.maxLength = NAME_LIMIT
  input.placeholder = '部屋の名前（無くてもかまいません）'
  input.value = name
  input.addEventListener('input', () => handlers.onName(input.value))
  making.append(input)
  // 押した時の入力欄の中身を読む。**渡された `name` ではない。** あれは描き直した時点の値で、
  // その後に打ち込まれた分が入っていない（打っている間は描き直さない）。
  making.append(button('人と対戦する', () => handlers.onCreate(input.value, '人間')))
  node.append(making)

  // **CPU 戦は、部屋の名前を付けずに作る**（#195）。相手は 1 人（CPU）で、ロビーに並べて呼び込む
  // 部屋ではない。代わりに、CPU の席のデッキを選ぶ。選べるのは自分のデッキだけで、持てない立て方では
  // 既製デッキが並ぶ（`deck.ts` の `withOwnedDecks`）。
  const againstCpu = element('div', 'lobby__make lobby__make--cpu')
  if (decks.length > 0) {
    againstCpu.append(deckPicker(decks, chosenCpuDeck, handlers.onCpuDeck, 'CPU のデッキ', 'lobby__deck lobby__deck--cpu'))
  }
  againstCpu.append(button('CPU と対戦する', () => handlers.onCreate('', 'CPU')))
  node.append(againstCpu)

  node.append(element('h2', 'lobby__title', 'いま開いている部屋'))
  if (views.length === 0) {
    node.append(element('p', 'lobby__none', 'まだ部屋がありません。作ると、ほかの人からも見えます'))
  }

  const list = element('div', 'lobby__rooms')
  for (const view of views) {
    const row = element('div', 'lobby__room')
    row.append(element('span', 'lobby__room-name', view.name))
    // 誰がいるかを出す（ADR-0020）。名乗りが席に座れる合言葉だった頃は出せなかった（ADR-0009）。
    if (view.occupants !== undefined) row.append(element('span', 'lobby__room-occupants', view.occupants))
    // その部屋のルール（ADR-0021）。**入る前に分からなければならない**——選んだデッキが通るかは
    // 部屋のルールで決まる。
    if (view.rules !== undefined) row.append(element('span', 'lobby__room-rules', view.rules))
    row.append(element('span', 'lobby__room-status', view.status))
    // 入れない部屋には押す口を出さない。断られる手を画面に出さないのは盤面と同じである。
    if (view.joinable) row.append(button('入る', () => handlers.onJoin(view.code)))
    list.append(row)
  }
  node.append(list)

  // 描き直しで打ち込みかけの場所を見失わないように、打っていた人には返す。
  if (focused) {
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }

  return node
}

/** デッキを選ぶところで押せるもの（#193）。 */
export interface DeckListHandlers {
  readonly onOpen: (deck: DeckId) => void
  readonly onNew: () => void
  /** 既製デッキをコピーして、そのまま組み始める（ADR-0022）。 */
  readonly onCopy: (preset: DeckId) => void
  /** 自分のデッキを消す。**最後の 1 つは消せない**が、断るのはサーバである。 */
  readonly onDelete: (deck: DeckId, name: string) => void
  readonly onClose: () => void
}

/**
 * 絵文字だけのボタン。**何をするかは読み上げと、カーソルを合わせた時の説明に書く。**
 *
 * 絵文字は目で見れば分かるが、読み上げでは「鉛筆」「ごみ箱」としか伝わらず、どのデッキに何をするかが
 * 分からない。
 */
function iconButton(icon: string, label: string, onPress: () => void): HTMLElement {
  const node = button(icon, onPress)
  node.classList.add('icon-button')
  node.setAttribute('aria-label', label)
  node.title = label

  return node
}

/**
 * どのデッキを組むかを選ぶところ（#193）。自分のデッキと、コピーできる既製デッキを並べる。
 *
 * `waiting` の間は、コピー・削除の返事を待っている。**重ねて押させない**——コピーを 2 度押すと
 * デッキが 2 つできる。
 */
export function deckListElement(
  decks: readonly OwnedDeckRow[],
  presets: readonly WireDeck[],
  waiting: boolean,
  refusal: string | undefined,
  handlers: DeckListHandlers,
): HTMLElement {
  const node = element('section', 'decks')
  const head = element('div', 'decks__head')
  head.append(element('h2', 'decks__title', '自分のデッキ'), button('ロビーに戻る', handlers.onClose))
  node.append(head)

  const list = element('div', 'decks__list')
  for (const deck of decks) {
    const row = element('div', 'decks__row')
    row.append(element('span', 'decks__name', deck.name), element('span', 'decks__count', `${deck.count} 枚`))
    const open = iconButton('✏️', `「${deck.name}」を組む`, () => handlers.onOpen(deck.id))
    const remove = iconButton('🗑️', `「${deck.name}」を削除する`, () => handlers.onDelete(deck.id, deck.name))
    remove.toggleAttribute('disabled', waiting)
    row.append(open, remove)
    list.append(row)
  }
  node.append(list)
  node.append(button('新しく作る', handlers.onNew))

  if (presets.length > 0) {
    node.append(element('h2', 'decks__title', '既製デッキからコピーして作る'))
    const presetList = element('div', 'decks__list')
    for (const preset of presets) {
      const row = element('div', 'decks__row')
      row.append(element('span', 'decks__name', preset.name))
      const copy = button('コピーして組む', () => handlers.onCopy(preset.id))
      copy.toggleAttribute('disabled', waiting)
      row.append(copy)
      presetList.append(row)
    }
    node.append(presetList)
  }

  if (refusal !== undefined) node.append(element('p', 'refusal', `行えませんでした: ${refusal}`))

  return node
}

/** デッキを組むところで押せるもの（#193）。 */
export interface DeckEditorHandlers extends Pick<LobbyHandlers, 'onFormat' | 'onRestriction'> {
  /** 名前を打ち込んだ。**画面は描き直されるので、覚えておくのは呼ぶ側である**（`LobbyHandlers`）。 */
  readonly onName: (name: string) => void
  readonly onDescription: (description: string) => void
  /** 打ち終えた（入力欄を離れた）。保存していない変更があるかを出し直すのに使う。 */
  readonly onEdited: () => void
  readonly onAdd: (key: string) => void
  readonly onRemove: (key: string) => void
  /** 詳しく出したままにするカードを決める。同じカードをもう一度押したら、やめる。 */
  readonly onPin: (key: string) => void
  readonly onSave: () => void
  /** デッキの一覧に戻る。**保存していない変更を捨てるかを尋ねるのは呼ぶ側である。** */
  readonly onBack: () => void
  /** 絞り込みの条件を変えた。**覚えておくのも、絞り込むのも呼ぶ側である**（`pool-filter.ts`）。 */
  readonly onFilter: (filter: PoolFilter) => void
  /** 詳しく絞り込むところを開く・閉じる。 */
  readonly onFilterOpen: (open: boolean) => void
}

/** デッキを組むところに出すもの（#193）。どれも `deck-builder.ts` がすでに組み立てている。 */
export interface DeckEditorView {
  readonly name: string
  readonly description: string
  readonly count: number
  readonly unsaved: boolean
  /** 保存できるか。返事を待っている間と、使えないカードが入っている間は押せない。 */
  readonly savable: boolean
  readonly check: CheckView
  /** 絞り込んだ後のプール。 */
  readonly pool: readonly PoolRow[]
  /** 絞り込む前のプールの種類の数。「何種のうち何種」を出す。 */
  readonly poolTotal: number
  readonly filter: PoolFilter
  readonly filterChoices: FilterChoices
  /** 詳しく絞り込むところを開いているか。 */
  readonly filterOpen: boolean
  readonly deck: readonly DeckRow[]
  readonly detail: (key: string) => CardDetail | undefined
  readonly pinned: string | undefined
  readonly restrictions: readonly WireRestrictionList[]
  readonly rules: ChosenRules
  readonly refusal: string | undefined
}

/** デッキの名前として受け取る長さの上限（`server` の `owned-deck.ts` の `DECK_NAME_LIMIT` と同じ）。 */
const DECK_NAME_LIMIT = 40

/** デッキの解説として受け取る長さの上限（`server` の `owned-deck.ts` の `DECK_DESCRIPTION_LIMIT` と同じ）。 */
const DECK_DESCRIPTION_LIMIT = 1000

/**
 * 描き直しても、スクロールした位置を戻す印（`index.ts` の `draw`）。
 *
 * **画面は丸ごと描き直される。** 1 枚入れるたびに、確かめた結果が届くたびに作り直すので、長い
 * 一覧が毎回先頭へ戻ると、続けて入れられない。
 */
export const KEEP_SCROLL = 'keepScroll'

/**
 * 描き直しても、打ち込んでいた入力欄に手を戻す印（`index.ts` の `draw`）。
 *
 * 絞り込みの文字は 1 文字打つたびに一覧を作り直すので、戻さないと 1 文字ごとに打つ場所を見失う。
 * 値は画面の中で重ならない名前にする。
 */
export const KEEP_FOCUS = 'keepFocus'

/** 選んでいるかどうかで見た目の変わるボタン。絞り込みの値を 1 つ選ぶのに使う。 */
function chip(label: string, pressed: boolean, onPress: () => void): HTMLElement {
  const node = button(label, onPress)
  node.classList.add('chip')
  node.classList.toggle('chip--選択中', pressed)
  node.setAttribute('aria-pressed', String(pressed))

  return node
}

/** 絞り込みの軸 1 つ。選べるものが無ければ出さない。 */
function chipRow<T extends string | number>(
  label: string,
  choices: readonly T[],
  chosen: readonly T[],
  onToggle: (value: T) => void,
): HTMLElement | undefined {
  if (choices.length === 0) return undefined

  const row = element('div', 'filter__row')
  row.append(element('span', 'filter__label', label))
  const values = element('div', 'filter__chips')
  for (const value of choices) {
    values.append(chip(typeof value === 'number' ? `Lv${value}` : value, chosen.includes(value), () => onToggle(value)))
  }
  row.append(values)

  return row
}

/** 数の範囲を打ち込むところ（ＢＰ・ＳＰ）。空にすると、その側は区切らない。 */
function rangeRow(label: string, range: NumberRange, focusKey: string, onRange: (range: NumberRange) => void): HTMLElement {
  const row = element('div', 'filter__row')
  row.append(element('span', 'filter__label', label))
  const inputs = element('div', 'filter__range')

  const input = (side: 'min' | 'max'): HTMLInputElement => {
    const node = document.createElement('input')
    node.className = 'filter__number'
    node.type = 'number'
    node.min = '0'
    node.step = '500'
    node.placeholder = side === 'min' ? '下限' : '上限'
    node.setAttribute('aria-label', `${label}の${side === 'min' ? '下限' : '上限'}`)
    node.value = range[side] === undefined ? '' : String(range[side])
    node.dataset[KEEP_FOCUS] = `${focusKey}-${side}`
    node.addEventListener('input', () => {
      const value = node.value === '' ? undefined : Number(node.value)
      onRange({ ...range, [side]: value !== undefined && Number.isFinite(value) ? value : undefined })
    })
    return node
  }
  inputs.append(input('min'), element('span', 'filter__between', '〜'), input('max'))
  row.append(inputs)

  return row
}

/**
 * プールを絞り込むところ（#193）。**よく使う軸だけを出しておき、残りは開いて出す。**
 *
 * 軸はカードに印刷されている項目と、エキスパンションである（ADR-0021）。何種が残ったかも出す。
 */
function filterElement(view: DeckEditorView, handlers: DeckEditorHandlers): HTMLElement {
  const { filter, filterChoices: choices } = view
  const change = (next: Partial<PoolFilter>): void => handlers.onFilter({ ...filter, ...next })
  const node = element('div', 'filter')

  const top = element('div', 'filter__top')
  const search = document.createElement('input')
  search.className = 'filter__search'
  search.type = 'search'
  search.placeholder = '名前・テキストで探す'
  search.setAttribute('aria-label', '名前・テキストで探す')
  search.value = filter.text
  search.dataset[KEEP_FOCUS] = '絞り込みの文字'
  // **変換している間は絞り込まない。** 1 文字ごとに一覧を作り直すと入力欄も作り直され、変換中の
  // 文字が消える。確定してから絞り込む。
  search.addEventListener('input', (event) => {
    if (!(event instanceof InputEvent && event.isComposing)) change({ text: search.value })
  })
  search.addEventListener('compositionend', () => change({ text: search.value }))
  top.append(search)
  top.append(element('span', 'filter__count', `${view.pool.length} / ${view.poolTotal} 種`))
  if (isFiltering(filter)) top.append(button('絞り込みを外す', () => handlers.onFilter(emptyFilter())))
  node.append(top)

  const rows: (HTMLElement | undefined)[] = [
    chipRow('種別', choices.types, filter.types, (value) => change({ types: toggled(filter.types, value) })),
    chipRow('色', choices.colors, filter.colors, (value) => change({ colors: toggled(filter.colors, value) })),
    chipRow('レベル', choices.levels, filter.levels, (value) => change({ levels: toggled(filter.levels, value) })),
  ]
  for (const row of rows) if (row !== undefined) node.append(row)

  const more = button(view.filterOpen ? '詳しい絞り込みを閉じる' : '詳しく絞り込む', () =>
    handlers.onFilterOpen(!view.filterOpen),
  )
  more.classList.add('filter__more')
  more.setAttribute('aria-expanded', String(view.filterOpen))
  node.append(more)

  if (view.filterOpen) {
    const details: (HTMLElement | undefined)[] = [
      rangeRow('ＢＰ', filter.bp, 'ＢＰ', (bp) => change({ bp })),
      rangeRow('ＳＰ', filter.sp, 'ＳＰ', (sp) => change({ sp })),
      chipRow('属性', choices.attributes, filter.attributes, (value) =>
        change({ attributes: toggled(filter.attributes, value) }),
      ),
      chipRow('スター', choices.stars, filter.stars, (value) => change({ stars: toggled(filter.stars, value) })),
      chipRow('ムーブ', choices.moveIcons, filter.moveIcons, (value) =>
        change({ moveIcons: toggled(filter.moveIcons, value) }),
      ),
      chipRow('トリガー', choices.triggerIcons, filter.triggerIcons, (value) =>
        change({ triggerIcons: toggled(filter.triggerIcons, value) }),
      ),
      chipRow('エキスパンション', choices.expansions, filter.expansions, (value) =>
        change({ expansions: toggled(filter.expansions, value) }),
      ),
    ]
    for (const row of details) if (row !== undefined) node.append(row)
  }

  return node
}

/** 詳しく出すところの中身を入れ替える。 */
function fillDetail(node: HTMLElement, detail: CardDetail | undefined): void {
  if (detail === undefined) {
    node.replaceChildren(element('p', 'builder__detail-none', 'カードの名前にカーソルを合わせると、ここに出ます'))
    return
  }

  const rows = element('dl', 'card__panel-rows')
  for (const row of detail.rows) {
    rows.append(element('dt', 'card__panel-label', row.label), element('dd', 'card__panel-value', row.value))
  }
  const parts: HTMLElement[] = [element('div', 'card__panel-name', detail.name), rows]
  // 改行ごとに別の能力になる（総合ルール 第2部 第10章 1、第4部 第1章 3）ので、1 行ずつ出す。
  if (detail.text.length > 0) {
    const text = element('div', 'card__panel-text')
    for (const line of detail.text) text.append(element('p', 'card__panel-line', line))
    parts.push(text)
  }
  node.replaceChildren(...parts)
}

/** 1 種ぶんの行。名前・1 行の要約・枚数と、増やす・減らす口。 */
function cardRow(
  row: PoolRow,
  pinned: boolean,
  handlers: DeckEditorHandlers,
  onHover: (key: string) => void,
): HTMLElement {
  const node = element('div', `builder__row${row.count > 0 ? ' builder__row--入っている' : ''}`)
  const name = element('button', `builder__name${pinned ? ' builder__name--選択中' : ''}`, row.name)
  name.setAttribute('aria-pressed', String(pinned))
  name.addEventListener('click', () => handlers.onPin(row.key))
  node.addEventListener('mouseenter', () => onHover(row.key))
  node.append(name, element('span', 'builder__summary', row.summary), element('span', 'builder__count', String(row.count)))

  const minus = button('−', () => handlers.onRemove(row.key))
  minus.setAttribute('aria-label', `「${row.name}」を 1 枚抜く`)
  minus.toggleAttribute('disabled', row.count === 0)
  const plus = button('＋', () => handlers.onAdd(row.key))
  plus.setAttribute('aria-label', `「${row.name}」を 1 枚入れる`)
  node.append(minus, plus)

  return node
}

/** 確かめた結果（ADR-0021）。 */
function checkElement(check: CheckView): HTMLElement {
  const node = element('div', `builder__check builder__check--${check.kind}`)
  switch (check.kind) {
    case '確かめている':
      node.append(element('p', 'builder__check-line', '確かめています'))
      break
    case '確かめられない':
      node.append(element('p', 'builder__check-line', check.reason))
      break
    case '満たしている':
      node.append(element('p', 'builder__check-line', '規定を満たしています'))
      break
    case '満たしていない':
      for (const line of check.lines) node.append(element('p', 'builder__check-line', line))
      break
  }

  return node
}

/**
 * デッキを組むところ（#193）。左にプール、右にデッキを並べ、その上に規定を確かめた結果を出す。
 *
 * **不備があっても保存できる**（ADR-0021）。確かめた結果は読むためのもので、保存を止めない。
 *
 * 打ち込む欄には `KEEP_FOCUS` を付ける。描き直した後に、打っていた人の手を戻すのは `index.ts` である。
 */
export function deckEditorElement(view: DeckEditorView, handlers: DeckEditorHandlers): HTMLElement {
  const node = element('section', 'builder')

  const head = element('div', 'builder__head')
  head.append(button('デッキの一覧に戻る', handlers.onBack))
  const name = document.createElement('input')
  name.className = 'builder__deck-name'
  name.type = 'text'
  name.maxLength = DECK_NAME_LIMIT
  name.placeholder = 'デッキの名前'
  name.value = view.name
  name.dataset[KEEP_FOCUS] = 'デッキの名前'
  name.addEventListener('input', () => handlers.onName(name.value))
  name.addEventListener('change', handlers.onEdited)
  head.append(name)
  const save = button('保存する', handlers.onSave)
  save.toggleAttribute('disabled', !view.savable)
  head.append(save)
  if (view.unsaved) head.append(element('span', 'builder__unsaved', '保存していない変更があります'))
  node.append(head)

  const description = document.createElement('textarea')
  description.className = 'builder__description'
  description.maxLength = DECK_DESCRIPTION_LIMIT
  description.placeholder = '解説（無くてもかまいません）'
  description.rows = 2
  description.value = view.description
  description.dataset[KEEP_FOCUS] = 'デッキの解説'
  description.addEventListener('input', () => handlers.onDescription(description.value))
  description.addEventListener('change', handlers.onEdited)
  node.append(description)

  node.append(rulesPicker(view.restrictions, view.rules, handlers))
  node.append(checkElement(view.check))
  if (view.refusal !== undefined) node.append(element('p', 'refusal', `行えませんでした: ${view.refusal}`))

  const detail = element('div', 'builder__detail')
  const showPinned = (): void => fillDetail(detail, view.pinned === undefined ? undefined : view.detail(view.pinned))
  showPinned()
  // カーソルを合わせている間は仮に出し、離れたらクリックで決めたものに戻す。**描き直さない**——
  // 一覧を丸ごと作り直すほどのことではない。
  const hover = (key: string): void => fillDetail(detail, view.detail(key))

  const columns = element('div', 'builder__columns')

  const poolPane = element('div', 'builder__pane')
  poolPane.append(element('h2', 'builder__title', 'カードプール'))
  poolPane.append(filterElement(view, handlers))
  const poolList = element('div', 'builder__list')
  poolList.dataset[KEEP_SCROLL] = 'プール'
  if (view.pool.length === 0) poolList.append(element('p', 'builder__none', '条件に合うカードがありません'))
  for (const row of view.pool) poolList.append(cardRow(row, row.key === view.pinned, handlers, hover))
  poolList.addEventListener('mouseleave', showPinned)
  poolPane.append(poolList)

  const deckPane = element('div', 'builder__pane')
  deckPane.append(element('h2', 'builder__title', `デッキ（${view.count} 枚）`))
  const deckList = element('div', 'builder__list')
  deckList.dataset[KEEP_SCROLL] = 'デッキ'
  if (view.deck.length === 0) deckList.append(element('p', 'builder__none', 'まだカードが入っていません'))
  for (const row of view.deck) {
    if (row.kind === '使える') {
      deckList.append(cardRow(row, row.key === view.pinned, handlers, hover))
      continue
    }
    const unusable = element('div', 'builder__row builder__row--使えない')
    unusable.append(
      element('span', 'builder__name', '使えないカード'),
      element('span', 'builder__count', String(row.count)),
      button('抜く', () => handlers.onRemove(row.key)),
    )
    deckList.append(unusable)
  }
  deckList.addEventListener('mouseleave', showPinned)
  deckPane.append(deckList)

  columns.append(poolPane, deckPane, detail)
  node.append(columns)

  return node
}

/**
 * 押す前に尋ねるところ（#193）。**ブラウザの確認ダイアログは使わない。**
 *
 * 画面の上に重ね、答えるまで下を押せなくする。尋ねている間に描き直されても、呼ぶ側が状態として
 * 持っているので消えない（`deck-builder.ts` の `BuilderConfirm`）。**初めにやめる側に手を置く**——
 * 戻せないことを尋ねているので、Enter を押しただけで進まないようにする。Escape でもやめられる。
 */
export function confirmElement(view: ConfirmView, onConfirm: () => void, onCancel: () => void): HTMLElement {
  const layer = element('div', 'confirm')
  const box = element('div', 'confirm__box')
  box.setAttribute('role', 'alertdialog')
  box.setAttribute('aria-modal', 'true')
  const message = element('p', 'confirm__message', view.message)
  message.id = 'confirm-message'
  box.setAttribute('aria-describedby', message.id)
  box.append(message)

  const buttons = element('div', 'confirm__buttons')
  const cancel = button(view.cancelLabel, onCancel)
  const confirm = button(view.confirmLabel, onConfirm)
  confirm.classList.add('confirm__danger')
  buttons.append(cancel, confirm)
  box.append(buttons)
  layer.append(box)

  layer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') onCancel()
  })
  // 重ねた層の外側（暗くしたところ）を押しても、やめる。
  layer.addEventListener('click', (event) => {
    if (event.target === layer) onCancel()
  })
  // 付け終わってから手を置く。まだ文書に無い要素には置けない。
  queueMicrotask(() => cancel.focus())

  return layer
}

/** 表示名として受け取る長さの上限（`server` の `name.ts` の `NAME_LIMIT` と同じ）。 */
const DISPLAY_NAME_LIMIT = 20

/** 名前を決めるところで押せるもの（ADR-0020）。 */
export interface NamingHandlers {
  /** 打ち込んだものが変わった。**画面は描き直されるので、覚えておくのは呼ぶ側である。** */
  readonly onDraft: (value: string) => void
  /** これで決める。**通るかどうかを決めるのはサーバである**（`server` の `name.ts`）。 */
  readonly onDecide: (name: string) => void
}

/**
 * 表示名を決めるところ（ADR-0020）。**決まるまで、ほかへは進めない。**
 *
 * ここに決まりの判断は無い。**上限を入力欄に持たせているのは打ち込みかけを切るためだけ**で、
 * 断るのはサーバである（ADR-0010）。通らなかった理由も、こちらで作らずに届いたものを出す。
 */
export function nameElement(
  draft: string,
  reason: string | undefined,
  handlers: NamingHandlers,
  focused = false,
): HTMLElement {
  const node = element('section', 'naming')
  node.append(element('h2', 'naming__title', '名前を決める'))
  node.append(element('p', 'naming__lead', 'ロビーと対戦相手のところに出る名前です。後から変えられます'))

  const input = document.createElement('input')
  input.className = 'naming__input'
  input.type = 'text'
  input.maxLength = DISPLAY_NAME_LIMIT
  input.placeholder = '名前'
  input.value = draft
  input.addEventListener('input', () => handlers.onDraft(input.value))
  // 打ち終わってそのまま押せるようにする。**押す口も残す**——鍵盤が出ている画面では、
  // Enter が送るものだと読み取れないことがある。
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') handlers.onDecide(input.value)
  })
  node.append(input)
  // 押した時の入力欄の中身を読む。渡された `draft` は描き直した時点の値である（`lobbyElement`）。
  node.append(button('これにする', () => handlers.onDecide(input.value)))

  if (reason !== undefined) node.append(element('p', 'naming__refusal', reason))

  // 描き直しで打ち込みかけの場所を見失わないように、打っていた人には返す（`lobbyElement`）。
  if (focused) {
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }

  return node
}

/** ロビーに戻る口（#175）。相手を待っている間と、投げ出せる対戦の間に出す。 */
export function leaveElement(label: string, onLeave: () => void): HTMLElement {
  const node = element('div', 'leave')
  node.append(button(label, onLeave))

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
