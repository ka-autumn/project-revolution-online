import { DUEL_FORMATS } from '@revolution/engine'
import type {
  Area,
  CardId,
  ChoiceAnswer,
  Color,
  DeckId,
  DuelFormat,
  LegalAction,
  MoveDirection,
  OpponentKind,
  PlanKeyword,
  Player,
  PublicShare,
  PublicShareCard,
  RecipeKey,
  RecipeListOrder,
  RestrictionChoice,
  RoomCode,
  ShareId,
  ShareKey,
  ShareVisibility,
  Square,
  WireCandidate,
  WireCardPosition,
  WireDeck,
  WireRestrictionList,
} from '@revolution/engine'
import blackLevelIcon from './assets/level-icons/黒.svg'
import blueLevelIcon from './assets/level-icons/青.svg'
import greenLevelIcon from './assets/level-icons/緑.svg'
import redLevelIcon from './assets/level-icons/赤.svg'
import whiteLevelIcon from './assets/level-icons/白.svg'
import reverseStarIcon from './assets/reverse-star.svg'
import starIcon from './assets/star.svg'
import { printedDetailsOf } from './deck-builder.js'
import type { CardDetail, CheckView, ConfirmView, DeckRow, OwnedDeckRow, PoolRow } from './deck-builder.js'
import type { ActionView, ChoiceView, DestinationView, PickView } from './input-model.js'
import { emptyFilter, isFiltering, toggled } from './pool-filter.js'
import type { FilterChoices, NumberRange, PoolFilter } from './pool-filter.js'
import type { CopyState, MyShareRow, PublicCardSection, RecipeCardRow, RecipeSummaryRow, ShareDraft, ShareRow, SharingState } from './recipe.js'
import type {
  AbilityView,
  BattleView,
  BoardView,
  CardView,
  Overlay,
  PhaseView,
  ResultView,
  RoomView,
  SideView,
  SmashJudgmentView,
  SquareView,
  TransitionView,
  ZoneView,
} from './view-model.js'
import { keyOfPosition, printedSquareLabel, zoneOf } from './view-model.js'

/**
 * 画面に出す値（`view-model.ts`）を DOM にする。
 *
 * **ここに判断を置かない。** 何を出すかはビューモデルがすでに決めていて、ここは要素を作って
 * 並べるだけである。テストがあるのはビューモデルまでで、この層は薄く保つ（#14）。
 *
 * 対戦画面のカードの詳細（`detailElement`）だけは例外で、乗せた・フォーカスしたカードを
 * 覚えておくという状態を持つ（ADR-0027）。盤面の外枠を組み立てるたびに作り直すので、
 * ビューモデルに状態を持たせる必要は無い。
 */

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text

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

/* ---------- アイコン・カードの面（ADR-0027） ---------- */

/** レベルアイコンの SVG。色ごとに形が違う（開発者が用意した原本をそのまま使う）。 */
const LEVEL_ICON_URL: Readonly<Record<Color, string>> = {
  赤: redLevelIcon,
  黒: blackLevelIcon,
  青: blueLevelIcon,
  白: whiteLevelIcon,
  緑: greenLevelIcon,
}

/**
 * カードの面の色。複数の色を持つカード・無色のカードは、いまのカードプールに無いので
 * 考えない（ADR-0027）。持っている色のうち 1 つ目で決める。
 */
function primaryColorOf(colors: readonly Color[]): Color {
  return colors[0] ?? '黒'
}

const SVG_NS = 'http://www.w3.org/2000/svg'

function svgElement(tag: string, attributes: Readonly<Record<string, string>>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value)

  return node
}

/**
 * スターアイコン。1 個なら ★ だけ、2 個以上は数字入りの ★（ダブルスター、総合ルール
 * 第2部 第7章 4）にする。持たなければ `undefined`。
 */
function starElement(count: number, reverse: boolean): HTMLElement | undefined {
  if (count <= 0) return undefined

  const node = element('span', `star${reverse ? ' star--reverse' : ''}`)
  node.setAttribute('role', 'img')
  node.setAttribute('aria-label', `${reverse ? 'リバーススター' : 'スター'} ${count}`)
  const icon = document.createElement('img')
  icon.src = reverse ? reverseStarIcon : starIcon
  icon.alt = ''
  node.append(icon)
  if (count >= 2) node.append(element('span', '', String(count)))

  return node
}

/** キーワード能力のアイコン 1 つ。 */
function keywordElement(keyword: PlanKeyword): HTMLElement {
  const node = element('span', `keyword keyword--${keyword}`)
  node.setAttribute('role', 'img')
  node.setAttribute('aria-label', keyword)
  node.append(element('span', '', keyword))

  return node
}

/** キーワード能力のアイコンの並び。持たなければ `undefined`。 */
function keywordsElement(keywords: readonly PlanKeyword[]): HTMLElement | undefined {
  if (keywords.length === 0) return undefined

  const node = element('span', 'keywords')
  for (const keyword of keywords) node.append(keywordElement(keyword))

  return node
}

/** ムーブアイコン。動ける向きだけ白く、ほかは暗くする（総合ルール 第2部 第11章）。 */
function moveIconElement(directions: readonly MoveDirection[]): SVGElement {
  const on = (direction: MoveDirection): string => (directions.includes(direction) ? '#fff' : '#4a4a4a')
  const svg = svgElement('svg', {
    class: 'move-icon',
    viewBox: '0 0 20 20',
    role: 'img',
    'aria-label': `ムーブアイコン：${directions.join('・')}`,
  })
  svg.append(
    svgElement('path', { d: 'M10 0.6 19.4 10 10 19.4 0.6 10Z', fill: '#2a2a2a', stroke: '#fff', 'stroke-width': '0.8' }),
    svgElement('path', { d: 'M10 2.6 12.4 6H7.6Z', fill: on('上') }),
    svgElement('path', { d: 'M10 17.4 12.4 14H7.6Z', fill: on('下') }),
    svgElement('path', { d: 'M2.6 10 6 7.6V12.4Z', fill: on('左') }),
    svgElement('path', { d: 'M17.4 10 14 7.6V12.4Z', fill: on('右') }),
    svgElement('circle', { cx: '10', cy: '10', r: '2.6', fill: '#c81c1c', stroke: '#fff', 'stroke-width': '0.6' }),
  )

  return svg
}

/**
 * トリガーアイコン。侵入の対象のスクエアは赤、ほかは濃い灰色にする（総合ルール 第2部
 * 第12章）。図は印刷された向き（支配者の手前を基準にした向き、`printedSquareLabel`）のまま。
 */
function triggerIconElement(cells: readonly Square[]): SVGElement {
  const label = cells.map(printedSquareLabel).join('・')
  const svg = svgElement('svg', {
    class: 'trigger-icon',
    viewBox: '0 0 20.6 20.6',
    role: 'img',
    'aria-label': `トリガーアイコン：${label}`,
  })
  svg.append(
    svgElement('rect', { x: '0', y: '0', width: '20.6', height: '20.6', rx: '1.4', fill: '#fff', stroke: '#222', 'stroke-width': '0.6' }),
  )
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      const hit = cells.some((square) => square.row === row && square.column === column)
      svg.append(
        svgElement('rect', {
          x: String(1 + column * 6.2),
          // 印刷の行 0 は支配者の味方エリア（手前）なので、図では下段に描く。
          y: String(1 + (2 - row) * 6.2),
          width: '5.6',
          height: '5.6',
          rx: '0.6',
          fill: hit ? '#e8202a' : '#4d4d4d',
        }),
      )
    }
  }

  return svg
}

/** ムーブアイコン（ユニット）・トリガーアイコン（トラップ）を、右寄せの枠に入れる。どちらも無ければ `undefined`。 */
function iconsElement(card: CardView & { readonly kind: '表' }): HTMLElement | undefined {
  const icon =
    card.moveIcon.length > 0
      ? moveIconElement(card.moveIcon)
      : card.triggerIcon.length > 0
        ? triggerIconElement(card.triggerIcon)
        : undefined
  if (icon === undefined) return undefined

  const node = element('div', 'card__icons')
  node.append(icon)

  return node
}

/**
 * ＢＰ・ＳＰ 1 つ。継続効果で元の値から変わっていれば、上がった・下がったを色と▲▼で示す。
 * 色だけに頼らないので、読み上げには元の値も伝える（#91）。上がった・下がったは
 * `view-model.ts`（`ModifiedData.bpDirection`）がすでに決めており、ここでは受け取った値を
 * 描くだけである（#207）。
 */
function statElement(
  kind: 'bp' | 'sp',
  label: string,
  base: number,
  modified: number | undefined,
  direction: '上' | '下' | undefined,
): HTMLElement {
  const value = modified ?? base
  const node = element('span', `card__${kind}${direction === undefined ? '' : ` card__${kind}--${direction}`}`, String(value))
  node.setAttribute('aria-label', `${label} ${value}${direction === undefined ? '' : `（元は ${base}）`}`)

  return node
}

/** 属性（継続効果で加わった分は `+` を付ける、#91）とＢＰ・ＳＰを面の下段に足す。 */
function appendTraitsAndStats(bottom: HTMLElement, card: CardView & { readonly kind: '表' }): void {
  const added = (card.modified?.addedAttributes ?? []).map((attribute) => `+${attribute}`)
  const traits = [...card.attributes, ...added]
  if (traits.length > 0) bottom.append(element('span', 'card__traits', traits.join('・')))

  if (card.type === 'ユニット' && card.bp !== undefined && card.sp !== undefined) {
    const stats = element('div', 'card__stats')
    stats.append(
      statElement('bp', 'ＢＰ', card.bp, card.modified?.bp, card.modified?.bpDirection),
      statElement('sp', 'ＳＰ', card.sp, undefined, undefined),
    )
    bottom.append(stats)
  }
}

/** 面を組み立てるときのオプション。 */
interface FaceOptions {
  /** 詳細（拡大）として出すか。テキストの枠が付き、並びが変わる。 */
  readonly big?: boolean
  /**
   * 山札の場所に見せているプランのカードか。
   *
   * 小さな面では、このカードにだけキーワード能力のアイコンを名前の下の行に出す。
   */
  readonly plan?: boolean
}

/**
 * カードの見える面。**詳細の札はこの外側に置く**（`cardElement`）。
 *
 * フリーズを横倒しにする（総合ルール 第2部 第24章）のはこの要素で、外枠の `card` は回らない。
 * 裏向きなら中身は空にする（裏面の絵柄は CSS が受け持つ）。
 */
function faceElement(card: CardView, options: FaceOptions = {}): HTMLElement {
  const node = element('div', 'card__face')
  if (card.kind === '裏') return node

  const top = element('div', 'card__top')
  const level = element('span', 'card__level')
  const levelIconImg = document.createElement('img')
  levelIconImg.src = LEVEL_ICON_URL[primaryColorOf(card.colors)]
  levelIconImg.alt = ''
  level.append(levelIconImg, element('span', '', String(card.level)))
  top.append(level, element('span', 'card__kind', card.type))
  node.append(top)

  const stars = [starElement(card.stars, false), starElement(card.reverseStars, true)].filter(
    (each): each is HTMLElement => each !== undefined,
  )
  const keywords = keywordsElement(card.keywords)
  const icons = iconsElement(card)

  const title = element('div', 'card__title')
  title.append(...stars, element('span', 'card__name', card.name))

  const bottom = element('div', 'card__bottom')
  if (options.big) {
    if (keywords !== undefined) title.append(keywords)
    bottom.append(title)

    const text = element('div', 'card__text')
    const lines = element('div', 'card__lines')
    for (const paragraph of card.text) lines.append(element('p', '', paragraph))
    text.append(lines)
    if (icons !== undefined) text.append(icons)
    bottom.append(text)

    appendTraitsAndStats(bottom, card)
    node.append(bottom)
  } else {
    node.append(title)
    if (options.plan && keywords !== undefined) {
      const row = element('div', 'card__keywords-row')
      row.append(keywords)
      node.append(row)
    }

    if (icons !== undefined) bottom.append(icons)
    appendTraitsAndStats(bottom, card)
    node.append(bottom)
  }

  if (card.damage > 0) node.append(element('span', 'card__damage', `ダメージ ${card.damage}`))

  return node
}

function cardElement(card: CardView, picking?: BoardPicking, options: FaceOptions = {}): HTMLElement {
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
    back.append(faceElement(card))
    return back
  }

  // 継続効果でデータが変わっていることは、文字（`BP1000→2000`）で分かる。色は添えるだけで、
  // それだけに頼らない（#91）。
  const modified = card.modified === undefined ? '' : ' card--修整あり'
  // 押せるかどうかも色だけで区別させない。押せるカードは `aria-label` にもそう出す（#94）。
  const pickable = picking?.pickable.includes(card.id) ?? false
  const picked = picking?.picked === card.id
  const state = `${pickable ? ' card--押せる' : ''}${picked ? ' card--選択中' : ''}`
  const color = `card--色-${primaryColorOf(card.colors)}`
  const node = element('div', `card card--${card.orientation} card--${card.controlledBy}${modified}${state} ${color}`)
  // 乗せた・フォーカスしたカードをカードの詳細に出すための手がかり（`wireCardDetailHover`）。
  node.dataset.cardId = card.id
  // キーボードでも詳細を出せるようにする。マウスを乗せるだけの形にすると触れない人が出る。
  node.tabIndex = 0
  const how = picked ? '（選択中）' : pickable ? '（押せます）' : ''
  node.setAttribute('aria-label', `${card.controlledBy}の${card.name}${how}`)
  if (pickable && picking !== undefined) {
    const id = card.id
    node.addEventListener('click', () => picking.onCard(id))
  }

  node.append(faceElement(card, options))
  // 色だけで区別させない。色を見分けられない人にも分かるように、文字でも出す。面の外側に
  // 置くので、フリーズで面が寝ても札は寝ない（ADR-0027）。
  node.append(element('span', 'card__whose', card.controlledBy))

  return node
}

/** 裏面（山札の見せ方）。 */
function backCardElement(): HTMLElement {
  const node = element('div', 'card card--back')
  node.append(element('div', 'card__face'))

  return node
}

function zoneElement(zone: ZoneView, picking?: BoardPicking, options: FaceOptions = {}): HTMLElement {
  const node = element('section', `zone zone--${zone.zone}`)
  const title = element('h3', 'zone__title', zone.zone)
  title.append(element('span', '', `（${zone.count}）`))
  node.append(title)

  const cards = element('div', 'zone__cards')
  if (zone.cards.length === 0) cards.append(element('div', 'zone__empty'))
  for (const card of zone.cards) cards.append(cardElement(card, picking, options))
  node.append(cards)

  return node
}

/**
 * 束（捨札・リムーブ）。見せるのは一番上の 1 枚と枚数だけ（ADR-0027）。中身があれば押せ、
 * 押すと中身の一覧が開く（`pickerElement` の「見る」）。
 */
function pileZoneElement(zone: ZoneView, onOpen: (() => void) | undefined): HTMLElement {
  const node = element('section', `zone zone--${zone.zone}`)
  const title = element('h3', 'zone__title', zone.zone)
  title.append(element('span', '', `（${zone.count}）`))
  node.append(title)

  const cardsWrap = element('div', 'zone__cards')
  const pile = element('div', 'pile')
  const top = zone.cards[0]
  if (onOpen !== undefined && zone.count > 0) {
    pile.classList.add('pile--開ける')
    pile.setAttribute('role', 'button')
    pile.tabIndex = 0
    pile.setAttribute('aria-label', `${zone.zone}の一覧を開く（${zone.count} 枚）`)
    pile.addEventListener('click', onOpen)
    pile.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      onOpen()
    })
  }
  pile.append(top !== undefined ? cardElement(top) : element('div', 'zone__empty'))
  if (zone.count > 0) pile.append(element('span', 'pile__count', String(zone.count)))
  cardsWrap.append(pile)
  node.append(cardsWrap)

  return node
}

/**
 * 山札。プランゾーンにカードがあれば、裏面のかわりにそのカードを表で見せる（ADR-0027）。
 * 有る・無しで山札の位置は動かさない。
 */
function deckZoneElement(deck: ZoneView, plan: CardView | undefined, picking: BoardPicking | undefined): HTMLElement {
  const node = element('section', 'zone zone--山札')
  const title = element('h3', 'zone__title', '山札')
  title.append(element('span', '', `（${deck.count}）`))
  node.append(title)

  const cardsWrap = element('div', 'zone__cards')
  const pile = element('div', 'pile')
  // プランゾーンのカードは公開情報だが、念のため見えている時だけ表で見せる。見えていなければ
  // 裏面のままにする（表に出せないものを表として描かない）。
  const hasCard = plan !== undefined || deck.count > 0
  if (plan !== undefined && plan.kind === '表') {
    pile.append(cardElement(plan, picking, { plan: true }))
    pile.append(element('span', 'pile__plan', 'プラン（1）'))
  } else if (hasCard) {
    pile.append(backCardElement())
  } else {
    pile.append(element('div', 'zone__empty'))
  }
  if (hasCard) pile.append(element('span', 'pile__count', String(deck.count)))
  cardsWrap.append(pile)
  node.append(cardsWrap)

  return node
}

/** 置き場のまとまりを囲む枠。エネルギー・スマッシュ／捨札・リムーブをまとめる（ADR-0027）。 */
function groupElement(whose: '自分' | '相手', kind: string, children: readonly HTMLElement[]): HTMLElement {
  const node = element('div', `group group--${whose} group--${kind}`)
  for (const child of children) node.append(child)

  return node
}

function areaLabelElement(area: Area): HTMLElement {
  return element('div', `area-label area-label--${area}`, area)
}

/** バンク・誘発した能力。どちらも両者で共有する「解決を待つ能力」（ADR-0027）。 */
function waitingElement(title: string, abilities: readonly AbilityView[]): HTMLElement {
  const node = element('section', 'waiting')
  const heading = element('h3', 'waiting__title', title)
  heading.append(element('span', '', `（${abilities.length}）`))
  node.append(heading)

  if (abilities.length === 0) {
    node.append(element('p', 'waiting__none', 'なし'))
    return node
  }

  const list = element('ol', 'waiting__list')
  for (const ability of abilities) {
    list.append(element('li', `waiting--${ability.whose}`, `${ability.whose}: ${ability.source ?? '発生源なし'}`))
  }
  node.append(list)

  return node
}

/**
 * スクエア 1 つ。バトルが起きているスクエアには、上端にも「バトル中」の帯を出し、枠を
 * 赤く光らせる（ADR-0027）。
 */
function squareElement(square: SquareView, picking: BoardPicking | undefined, battle: BattleView | undefined): HTMLElement {
  const pickable = pickableAt(picking, square.square)
  const inBattle =
    battle !== undefined && battle.square.row === square.square.row && battle.square.column === square.square.column
  const node = element(
    'div',
    `square square--${square.area}${pickable === undefined ? '' : ' square--置き先'}${inBattle ? ' square--バトル中' : ''}`,
  )
  if (inBattle) node.append(element('span', 'square__battle', 'バトル中'))
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

/**
 * 盤面の空間配置（ADR-0027）。バトルスペースの 3×3 を狭め、その両脇と上下に置き場を並べる。
 * 相手の側は自分の側と点対称にする（向かい合って座った卓の見え方）。自分から見て：
 *
 * | 行 | 左の脇 | | 3×3 | 右の脇 |
 * | 1 | ［相手：リムーブ｜捨札］ | ［相手：スマッシュ｜エネルギー］ | | |
 * | 2 | 相手の山札 | 敵エリア | □□□ | 相手のトラップ |
 * | 3 | バンク | 中央エリア | □□□ | 誘発した能力 |
 * | 4 | 自分のトラップ | 味方エリア | □□□ | 自分の山札 |
 * | 5 | ［自分：エネルギー｜スマッシュ］ | | | ［自分：捨札｜リムーブ］ |
 */
function boardGridElement(
  view: BoardView,
  picking: BoardPicking | undefined,
  onOpenPile: (player: Player, zone: '捨札' | 'リムーブゾーン') => void,
): HTMLElement {
  const node = element('div', 'board')
  const place = (child: HTMLElement, area: string): HTMLElement => {
    child.style.gridArea = area
    return child
  }
  const openerOf = (side: SideView, zone: '捨札' | 'リムーブゾーン'): (() => void) => () => onOpenPile(side.player, zone)
  const planOf = (side: SideView): CardView | undefined => zoneOf(side, 'プランゾーン').cards[0]

  const opponentStrip = element('div', 'strip strip--相手')
  opponentStrip.append(
    groupElement('相手', '捨札', [
      pileZoneElement(zoneOf(view.opponent, 'リムーブゾーン'), openerOf(view.opponent, 'リムーブゾーン')),
      pileZoneElement(zoneOf(view.opponent, '捨札'), openerOf(view.opponent, '捨札')),
    ]),
    groupElement('相手', 'エネルギーゾーン', [
      zoneElement(zoneOf(view.opponent, 'スマッシュゾーン'), picking),
      zoneElement(zoneOf(view.opponent, 'エネルギーゾーン'), picking),
    ]),
  )
  node.append(opponentStrip)

  const ownStrip = element('div', 'strip strip--自分')
  ownStrip.append(
    groupElement('自分', 'エネルギーゾーン', [
      zoneElement(zoneOf(view.own, 'エネルギーゾーン'), picking),
      zoneElement(zoneOf(view.own, 'スマッシュゾーン'), picking),
    ]),
    groupElement('自分', '捨札', [
      pileZoneElement(zoneOf(view.own, '捨札'), openerOf(view.own, '捨札')),
      pileZoneElement(zoneOf(view.own, 'リムーブゾーン'), openerOf(view.own, 'リムーブゾーン')),
    ]),
  )
  node.append(ownStrip)

  node.append(place(deckZoneElement(zoneOf(view.opponent, '山札'), planOf(view.opponent), picking), '2 / 1'))
  node.append(place(zoneElement(zoneOf(view.opponent, 'トラップゾーン'), picking), '2 / 6'))
  node.append(place(zoneElement(zoneOf(view.own, 'トラップゾーン'), picking), '4 / 1'))
  node.append(place(deckZoneElement(zoneOf(view.own, '山札'), planOf(view.own), picking), '4 / 6'))

  node.append(place(waitingElement('バンク', view.bank), '3 / 1'))
  node.append(place(waitingElement('誘発した能力', view.triggered), '3 / 6'))

  view.squares.forEach((row, r) => {
    const first = row[0]
    if (first === undefined) return
    node.append(place(areaLabelElement(first.area), `${r + 2} / 2`))
    row.forEach((square, i) => node.append(place(squareElement(square, picking, view.battle), `${r + 2} / ${i + 3}`)))
  })

  return node
}

function button(label: string, onPress: () => void, primary = false): HTMLElement {
  const node = element('button', `choice__button${primary ? ' button--primary' : ''}`, label)
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
  for (const view of views) list.append(button(view.label, () => onAction(view.action), view.primary))
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
    if (view.name !== undefined) row.append(element('span', 'lobby__room-name', view.name))
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
  /** 自分が出した共有を並べるところを開く（ADR-0022）。 */
  readonly onMyShares: () => void
  /** 「一覧に載せる」共有があるレシピの一覧を開く（ADR-0022）。 */
  readonly onRecipeList: () => void
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
  head.append(
    element('h2', 'decks__title', '自分のデッキ'),
    button('自分の共有', handlers.onMyShares),
    button('共有されたレシピ', handlers.onRecipeList),
    button('ロビーに戻る', handlers.onClose),
  )
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
  /** 共有する下書きを開く（ADR-0022）。**保存してあるデッキにしか出さない**（`view.canShare`）。 */
  readonly onShare: () => void
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
  /** 共有する口を出すか（ADR-0022）。**保存してあるデッキだけ共有できる**——まだ無い識別子は渡せない。 */
  readonly canShare: boolean
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
  // 保存してあるデッキだけ共有できる（ADR-0022）。まだ無い識別子は渡せない。
  if (view.canShare) head.append(button('共有する', handlers.onShare))
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

/** 公開の段階を選ぶところ（ADR-0022）。**選べるのは 2 つだけ**なので、`select` ではなくボタンで選ばせる。 */
function visibilityPicker(chosen: ShareVisibility, onVisibility: (visibility: ShareVisibility) => void): HTMLElement {
  const node = element('div', 'share__visibility')
  node.append(element('span', 'share__visibility-label', '公開の段階'))
  const options: readonly ShareVisibility[] = ['リンクを知っている人だけ', '一覧に載せる']
  for (const option of options) node.append(chip(option, option === chosen, () => onVisibility(option)))

  return node
}

/** 共有するダイアログと、自分の共有・レシピの一覧・レシピの画面で押せるもの（ADR-0022）。 */
export interface ShareDialogHandlers {
  readonly onName: (name: string) => void
  readonly onDescription: (description: string) => void
  readonly onVisibility: (visibility: ShareVisibility) => void
  readonly onFormat: (format: DuelFormat) => void
  readonly onRestriction: (restriction: RestrictionChoice) => void
  readonly onShare: () => void
  /** リンクをコピーする。**組み立てるのは呼ぶ側**（`recipe.ts` の `recipeLinkOf`）。 */
  readonly onCopyLink: (link: string) => void
  readonly onClose: () => void
}

/**
 * デッキを共有するダイアログ（ADR-0022）。**確認ダイアログと同じく、画面の中に重ねる**——ブラウザの
 * 確認ダイアログは使わない（`confirmElement` と同じ理由）。
 *
 * 共有できたら、打ち込むところの代わりにリンクを出す。**リンクは呼ぶ側が組み立てて渡す**——渡す人が
 * アドレスバーをコピーすると `?participant=` まで付いてきて、席に座れる合言葉を渡すことになる
 * （ADR-0022）ため、ここでは打ち込んだ値をそのまま出さない。
 */
export function shareDialogElement(state: SharingState, restrictions: readonly WireRestrictionList[], link: string | undefined, handlers: ShareDialogHandlers): HTMLElement {
  const layer = element('div', 'confirm')
  const box = element('div', 'confirm__box share')
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-modal', 'true')
  layer.append(box)

  if (state.kind === '共有した') {
    box.append(element('p', 'share__done', '共有しました。このリンクを渡せます'))
    if (link !== undefined) {
      const field = document.createElement('input')
      field.className = 'share__link'
      field.type = 'text'
      field.readOnly = true
      field.value = link
      field.setAttribute('aria-label', '共有のリンク')
      box.append(field)
    }
    const buttons = element('div', 'confirm__buttons')
    buttons.append(
      button('リンクをコピーする', () => link !== undefined && handlers.onCopyLink(link)),
      button('閉じる', handlers.onClose),
    )
    box.append(buttons)
    return layer
  }

  const { draft } = state
  box.append(element('h2', 'share__title', 'デッキを共有する'))

  const name = document.createElement('input')
  name.className = 'share__name'
  name.type = 'text'
  name.maxLength = DECK_NAME_LIMIT
  name.value = draft.name
  name.setAttribute('aria-label', '共有する名前')
  name.dataset[KEEP_FOCUS] = '共有する名前'
  name.addEventListener('input', () => handlers.onName(name.value))
  box.append(name)

  const description = document.createElement('textarea')
  description.className = 'share__description'
  description.maxLength = DECK_DESCRIPTION_LIMIT
  description.rows = 2
  description.placeholder = '解説（無くてもかまいません）'
  description.value = draft.description
  description.setAttribute('aria-label', '共有する解説')
  description.dataset[KEEP_FOCUS] = '共有する解説'
  description.addEventListener('input', () => handlers.onDescription(description.value))
  box.append(description)

  box.append(visibilityPicker(draft.visibility, handlers.onVisibility))
  // **共有する人が形式と禁止／制限リストを選んで規定を確かめる**（ADR-0022）。部屋を作る時と同じ
  // 選び方（`rulesPicker`）を使う。
  box.append(rulesPicker(restrictions, { format: draft.format, restriction: draft.restriction }, handlers))

  if (state.refusal !== undefined) box.append(element('p', 'refusal', `行えませんでした: ${state.refusal}`))

  const buttons = element('div', 'confirm__buttons')
  const share = button('共有する', handlers.onShare)
  share.toggleAttribute('disabled', state.sending)
  buttons.append(button('やめる', handlers.onClose), share)
  box.append(buttons)

  return layer
}

/** 自分の共有を並べるところで押せるもの（ADR-0022）。 */
export interface MyShareHandlers {
  readonly onVisibility: (share: ShareId, visibility: ShareVisibility) => void
  readonly onRevoke: (share: ShareId, name: string) => void
  readonly onCopyLink: (link: string) => void
  readonly onClose: () => void
}

/**
 * 自分が出した共有を並べ、公開の段階を変えたり取り消したりするところ（ADR-0022）。
 *
 * **取り消したものも並べる**——取り消した本人には、取り消したことが見えたままでよい
 * （`Session.myShares`）。
 */
export function myShareListElement(rows: readonly MyShareRow[], linkOf: (key: ShareKey) => string, handlers: MyShareHandlers): HTMLElement {
  const node = element('section', 'decks')
  const head = element('div', 'decks__head')
  head.append(element('h2', 'decks__title', '自分の共有'), button('デッキの一覧に戻る', handlers.onClose))
  node.append(head)

  if (rows.length === 0) node.append(element('p', 'decks__none', 'まだ何も共有していません'))

  const list = element('div', 'decks__list')
  for (const row of rows) {
    const item = element('div', 'decks__row share__row')
    item.append(element('span', 'decks__name', row.name))
    if (row.revoked) {
      item.append(element('span', 'share__revoked', '取り消し済み'))
      list.append(item)
      continue
    }

    item.append(button('リンクをコピーする', () => handlers.onCopyLink(linkOf(row.key))))

    const visibility = document.createElement('select')
    visibility.className = 'share__visibility-select'
    visibility.setAttribute('aria-label', `「${row.name}」の公開の段階`)
    for (const option of ['リンクを知っている人だけ', '一覧に載せる'] as const) {
      const choice = document.createElement('option')
      choice.value = option
      choice.textContent = option
      choice.selected = option === row.visibility
      visibility.append(choice)
    }
    visibility.addEventListener('change', () => {
      const value = visibility.value
      if (value === 'リンクを知っている人だけ' || value === '一覧に載せる') handlers.onVisibility(row.id, value)
    })
    item.append(visibility)
    item.append(button('取り消す', () => handlers.onRevoke(row.id, row.name)))
    list.append(item)
  }
  node.append(list)

  return node
}

/** レシピの一覧で押せるもの（ADR-0022）。 */
export interface RecipeListHandlers {
  readonly onOrder: (order: RecipeListOrder) => void
  readonly onOpen: (key: RecipeKey) => void
  readonly onClose: () => void
}

/**
 * 「一覧に載せる」共有があるレシピの一覧（ADR-0022）。
 *
 * **絞り込みは作らない**（範囲外、ADR-0022）。並べ方だけ、新着順とコピー数順を切り替えられる。
 */
export function recipeListElement(rows: readonly RecipeSummaryRow[], order: RecipeListOrder, handlers: RecipeListHandlers): HTMLElement {
  const node = element('section', 'decks')
  const head = element('div', 'decks__head')
  head.append(element('h2', 'decks__title', '共有されたレシピ'), button('デッキの一覧に戻る', handlers.onClose))
  node.append(head)

  const orderRow = element('div', 'share__order')
  const orders: readonly RecipeListOrder[] = ['新着', 'コピー数']
  for (const option of orders) orderRow.append(chip(option, option === order, () => handlers.onOrder(option)))
  node.append(orderRow)

  if (rows.length === 0) node.append(element('p', 'decks__none', 'まだ一覧に載っているレシピがありません'))

  const list = element('div', 'decks__list')
  for (const row of rows) {
    const item = element('div', 'decks__row')
    item.append(element('span', 'decks__name', row.name))
    if (row.description !== '') item.append(element('span', 'share__description-preview', row.description))
    item.append(element('span', 'share__copies', `コピー ${row.copies} 回`))
    item.append(button('見る', () => handlers.onOpen(row.key)))
    list.append(item)
  }
  node.append(list)

  return node
}

/** レシピの画面で押せるもの（ADR-0022）。 */
export interface RecipeViewHandlers {
  readonly onCopy: (share: ShareId) => void
  readonly onClose: () => void
}

/**
 * `/recipe/<鍵>` の画面（ADR-0022）。**開けるのはログインしている人だけ**——ここに渡す `cards` は
 * カードプールを引いた後の形で、それが届くのは席に着ける人だけである。
 *
 * **共有を全部並べる。** 同じ中身に複数の人の読みが並びうる。共有ごとにコピーできる。
 */
export function recipeElement(
  cards: readonly RecipeCardRow[],
  shares: readonly ShareRow[],
  copying: boolean,
  handlers: RecipeViewHandlers,
): HTMLElement {
  const node = element('section', 'decks')
  const head = element('div', 'decks__head')
  head.append(element('h2', 'decks__title', 'レシピ'), button('デッキの一覧に戻る', handlers.onClose))
  node.append(head)

  const cardList = element('div', 'decks__list')
  for (const row of cards) {
    const item = element('div', 'decks__row')
    item.append(element('span', 'decks__name', row.name), element('span', 'decks__count', `${row.count} 枚`))
    cardList.append(item)
  }
  node.append(cardList)

  node.append(element('h2', 'decks__title', '共有'))
  const shareList = element('div', 'decks__list')
  for (const share of shares) {
    const item = element('div', 'decks__row')
    item.append(element('span', 'decks__name', `${share.name}（${share.sharer}）`))
    if (share.description !== '') item.append(element('span', 'share__description-preview', share.description))
    // **書き込むだけで読み出す経路が無かった**ので、確かめた形式とリストを添える（ADR-0022）。
    item.append(element('span', 'share__rules', share.rulesLabel))
    const copy = button('コピーして自分のデッキにする', () => handlers.onCopy(share.id))
    copy.toggleAttribute('disabled', copying)
    item.append(copy)
    shareList.append(item)
  }
  node.append(shareList)

  return node
}

/** カード 1 種の行。`detail` があれば表記の全部を出し、無ければレベル・色だけの要約にする。 */
function publicShareCardElement(card: PublicShareCard): HTMLElement {
  const item = element('div', 'decks__row public-share__card')
  item.append(element('span', 'decks__name', card.name), element('span', 'decks__count', `${card.count} 枚`))

  if (card.detail !== undefined) {
    // 能力テキストとその他の表記は、ログインした人にだけ入る（ADR-0022）。`deck-builder.ts`
    // の `printedDetailsOf`・`fillDetail` と同じ書き出し方に揃える——詳しく出す形をここで
    // 作り直さない。
    const detail = element('div', 'public-share__detail')
    const rows = element('dl', 'card__panel-rows')
    for (const row of printedDetailsOf(card.detail)) {
      rows.append(element('dt', 'card__panel-label', row.label), element('dd', 'card__panel-value', row.value))
    }
    detail.append(rows)
    // 改行ごとに別の能力になる（総合ルール 第2部 第10章 1、第4部 第1章 3）ので、1 行ずつ出す。
    if (card.detail.text.length > 0) {
      const text = element('div', 'card__panel-text')
      for (const line of card.detail.text) text.append(element('p', 'card__panel-line', line))
      detail.append(text)
    }
    item.append(detail)
  } else if (card.type !== undefined) {
    const colors = card.colors.length === 0 ? '無色' : card.colors.join('・')
    item.append(element('span', 'public-share__summary', `Lv.${card.level}・${colors}`))
  }

  return item
}

/**
 * 「コピーする」の進み具合を出す（ADR-0022、#197）。
 *
 * 押すまでは `onCopy` を呼ぶだけのボタンで、繋ぐのは呼ぶ側（`public-share.ts`）の仕事。
 * ここは `CopyState` をそのまま描き分けるだけで、いつ繋ぐかの判断は持たない。
 */
function publicShareCopyElement(copyState: CopyState, onCopy: () => void): HTMLElement {
  const node = element('div', 'public-share__copy')

  if (copyState.kind === 'コピーできた') {
    node.append(element('p', 'public-share__copy-done', 'コピーしました。自分のデッキに入っています'))
    return node
  }
  if (copyState.kind === '名前が要る') {
    // この公開ページの中に名前を決める口は作らない。名前は ADR-0020 の持ち物で、入口を
    // 増やすと決め方が 2 か所になる。ふだんの画面（`/`）への導線だけを添える。
    node.append(element('p', 'public-share__copy-refusal', 'コピーするには、まず表示名を決めてください'))
    const link = document.createElement('a')
    link.className = 'public-share__copy-link'
    link.href = '/'
    link.textContent = 'ふだんの画面を開く'
    node.append(link)
    return node
  }
  if (copyState.kind === '行えなかった') {
    node.append(element('p', 'public-share__copy-refusal', copyState.reason))
    return node
  }

  const copyButton = button(copyState.kind === '繋いでいます' ? '繋いでいます…' : 'コピーする', onCopy)
  copyButton.toggleAttribute('disabled', copyState.kind === '繋いでいます')
  node.append(copyButton)
  return node
}

/**
 * `/share/<鍵>` の公開ページ（ADR-0022、#197）。ここだけ、ログインしていなくても開ける。
 *
 * 未ログインでは、名前・枚数・色・レベル・種別と、共有者・解説までしか出ない
 * （`PublicShareCard.detail` が無い）。ログインしていれば、能力テキストとその他の表記まで
 * 出る——出してよい量を決めるのは対戦サーバ（`server` の `recipe.ts` の `publicShareOf`）で、
 * ここは届いた形をそのまま描くだけである。
 */
export function publicShareElement(
  share: PublicShare,
  sections: readonly PublicCardSection[],
  signInUrl: string,
  onLogin: () => void,
  copyState: CopyState,
  onCopy: () => void,
): HTMLElement {
  const node = element('section', 'decks public-share')
  const head = element('div', 'decks__head')
  head.append(element('h2', 'decks__title', share.name))
  node.append(head)

  node.append(element('p', 'public-share__sharer', `共有者: ${share.sharer}`))
  if (share.description !== '') node.append(element('p', 'public-share__description', share.description))

  const rules = share.restriction === undefined ? share.format : `${share.format}・${share.restriction.name}`
  node.append(element('p', 'public-share__rules', `確かめた規定: ${rules}`))

  if (!share.authenticated) {
    const invite = element('div', 'public-share__invite')
    invite.append(element('p', 'public-share__invite-text', 'ログインすると、能力テキストまで見られます'))
    const link = document.createElement('a')
    link.className = 'public-share__invite-link'
    link.href = signInUrl
    link.textContent = 'ログインする'
    // 移る前に、開いている共有の鍵を預ける（ADR-0022、#197）。既定のナビゲーションは
    // 止めない——`href` どおりに Google へ移りつつ、`onLogin` は同期で先に済ませる。
    link.addEventListener('click', onLogin)
    invite.append(link)
    node.append(invite)
  }

  // 未ログインには出ない（`share.share` が無い）。「コピーする」はログインした人にだけ出す。
  if (share.share !== undefined) node.append(publicShareCopyElement(copyState, onCopy))

  for (const section of sections) {
    node.append(element('h3', 'decks__title', section.type ?? '取り下げられたカード'))
    const list = element('div', 'decks__list')
    for (const card of section.cards) list.append(publicShareCardElement(card))
    node.append(list)
  }

  return node
}

/** `/share/<鍵>` を読んでいる間（`public-share.ts` の `mountPublicShare`）。 */
export function publicShareLoadingElement(): HTMLElement {
  return element('section', 'decks public-share', '読み込んでいます…')
}

/**
 * `/share/<鍵>` が開けなかった時（ADR-0022、#197）。取り消された共有と、知らない鍵は同じ形で
 * 出す——対戦サーバの返事（404）の時点ですでに見分けが付かない（`serve.ts`）。
 */
export function publicShareNotFoundElement(): HTMLElement {
  return element('section', 'decks public-share', 'この共有は見つかりませんでした。取り消されたか、URL が違います。')
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
    list.append(button(view_.label, () => handlers.onAction(view_.action), view_.primary))
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

/**
 * 進行中の手順の帯（バトル・スマッシュ判定）。出ていない時も高さを取っておく（ADR-0027）。
 * 帯が出た時に盤面が上下に跳ねないようにするためと、盤面を常に縦いっぱいに広げるためである。
 *
 * バトルとスマッシュ判定が同時に進行することもある（総合ルール 第3部 第17章 2-2）が、帯は
 * 1 つしか無いので、バトルを優先する——バトルが起きているスクエアは `square--バトル中` で
 * 別に示している（`squareElement`）ので、ここで両方言わなくても手順が見えなくなることはない。
 */
function procedureElement(battle: BattleView | undefined, smashJudgments: readonly SmashJudgmentView[]): HTMLElement {
  const node = element('div', 'procedure')
  const judgment = smashJudgments.at(-1)
  if (battle === undefined && judgment === undefined) return node

  node.classList.add('procedure--出ている')
  if (battle !== undefined) {
    node.append(element('span', 'procedure__kind', 'バトル'))
    node.append(document.createTextNode(`${battle.where}：${battle.attacker} と ${battle.attacked} がバトル中`))
    return node
  }

  // ここに来る時点で judgment は必ずある（上の早期リターンで battle・judgment 両方無い場合を外している）。
  if (judgment === undefined) return node
  const round = judgment.round === undefined ? '' : `・${judgment.repeats} 回中 ${judgment.round} 回目`
  const faceUp = judgment.faceUp === undefined ? '' : `・規定により表向き: ${judgment.faceUp}`
  node.append(element('span', 'procedure__kind', 'スマッシュ'))
  node.append(document.createTextNode(`${judgment.whose}のダメージ・${judgment.step}${round}${faceUp}`))

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
    // 区切りの行は、進行の切れ目として中央寄せの見た目にする（ADR-0027）。誰のものかは
    // whose のクラスと重ねて付く——区切りの中にも「自分の第2ターン終了」のように持ち主はいる。
    const kindClass = line.kind === '区切り' ? ' log__item--区切り' : ''
    const item = element('li', `log__item${line.whose === undefined ? '' : ` log__item--${line.whose}`}${kindClass}`)
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

/** 決着。画面全体を暗くし、光条を背負った大きな文字と帯で出す（ADR-0027）。 */
function resultElement(result: ResultView): HTMLElement {
  const node = element('div', `result result--${result.kind}`)
  const burst = element('div', 'result__burst')
  burst.setAttribute('aria-hidden', 'true')
  node.append(burst)

  const ribbon = element('div', 'result__ribbon')
  ribbon.append(element('p', 'result__label', result.label))
  node.append(ribbon)

  return node
}

/**
 * 演出を重ねる層（#96・#104）。
 *
 * 盤面の上に重ねるだけで、**押せる場所は塞がない**（`style.css` の `.overlay-layer` の
 * `pointer-events: none`）。いつ消すかはここでは決めない。溜めない出し方の管理は
 * `index.ts` のタイマーの仕事である——フェイズ・ターンの切り替わりも効果解決のカットインも、
 * 同じ待ち行列を通って出る（`view-model.ts` の `Overlay`）。
 *
 * `result` を渡すと、決着の帯も同じ層に重ねる。こちらは溜めない演出とは別で、消えずに
 * 出続ける——決着した後は打てる手が無くなる（ADR-0010）ので、時間で消す理由が無い。
 */
export function overlayElement(overlay: Overlay, result?: ResultView): HTMLElement {
  const kind = result === undefined ? '' : ` overlay-layer--結果-${result.kind}`
  const node = element('div', `overlay-layer${kind}`)
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

  if (result !== undefined) node.append(resultElement(result))

  return node
}

/** フェイズの一覧。済んだもの・今のものを見分けられるようにする（ADR-0027）。 */
function phasesElement(phases: readonly PhaseView[]): HTMLElement {
  const node = element('ol', 'phases')
  node.setAttribute('aria-label', 'フェイズ')
  for (const phase of phases) {
    const className = phase.status === 'これから' ? 'phases__item' : `phases__item phases__item--${phase.status}`
    const item = element('li', className, phase.phase)
    if (phase.status === '今') {
      item.setAttribute('aria-current', 'step')
      item.append(element('span', 'phases__now', 'いま'))
    }
    node.append(item)
  }

  return node
}

/**
 * プレイヤーの枠（ADR-0027）。立ち絵の場所（胸から上のシルエット）・名前・ダメージを置く。
 *
 * `partner` はパートナーゾーンの中身。空ならパートナーの場所ごと詰める——パートナー
 * バトルでない対局ではこのゾーンが常に空になるので、渡す側で対局の形式を気にしなくてよい。
 */
function playerPanelElement(
  whose: '自分' | '相手',
  name: string,
  damage: number,
  partner: (CardView & { readonly kind: '表' }) | undefined,
  picking: BoardPicking | undefined,
): HTMLElement {
  const node = element('section', `panel player player--${whose}`)
  node.setAttribute('aria-label', whose)

  const portrait = element('div', 'player__portrait')
  portrait.setAttribute('aria-hidden', 'true')
  node.append(portrait)

  const body = element('div', 'player__body')
  body.append(element('span', 'player__whose', whose))
  body.append(element('p', 'player__name', name))
  const damageLine = element('p', 'player__damage', 'ダメージ ')
  damageLine.append(element('strong', '', String(damage)))
  body.append(damageLine)
  node.append(body)

  if (partner !== undefined) {
    const wrap = element('div', 'player__partner')
    wrap.append(element('span', 'player__partner-label', 'パートナー'))
    wrap.append(cardElement(partner, picking))
    node.append(wrap)
  }

  return node
}

/**
 * 手札。画面の端から上半分だけを出す扇（ADR-0027）。乗せる・フォーカスすると全体が浮き上がる
 * （`style.css` の `:hover`/`:focus-within`）。
 *
 * 相手の手札は表側が見えていない（`裏`）カードの並びとして届く（`zoneOf` がそのまま返す）ので、
 * ここで裏向きを作り出す必要は無い。
 */
function handElement(whose: '自分' | '相手', hand: ZoneView, picking: BoardPicking | undefined): HTMLElement {
  const node = element('div', `hand hand--${whose}`)
  node.setAttribute('aria-label', `${whose}の手札`)
  node.append(element('span', 'hand__label', `${whose}の手札（${hand.count}）`))

  const step = whose === '相手' ? -3 : 4
  const mid = (hand.cards.length - 1) / 2
  hand.cards.forEach((card, i) => {
    const cardNode = cardElement(card, picking)
    const offset = i - mid
    cardNode.style.setProperty('--r', `${offset * step}deg`)
    cardNode.style.setProperty('--y', `${offset * offset * 0.12}rem`)
    node.append(cardNode)
  })

  return node
}

/** 何も乗せていない時に、カードの詳細に出す案内。 */
function detailGuideElement(): HTMLElement {
  return element('p', 'detail__none', 'カードにマウスを乗せるか、フォーカスすると、ここに詳細が出ます。')
}

/** カードの詳細の、拡大した面の下に添える補足の 1 行。 */
function detailNoteOf(card: CardView & { readonly kind: '表' }): string {
  const notes = [`${card.controlledBy}のカード`]
  if (card.ownedBy !== undefined) notes.push(`持ち主：${card.ownedBy}`)
  if (card.orientation === 'フリーズ') notes.push('フリーズ')
  if (card.modified?.bp !== undefined) notes.push(`ＢＰ ${card.bp}→${card.modified.bp}`)
  if (card.damage > 0) notes.push(`ダメージ ${card.damage}`)

  return notes.join('／')
}

/**
 * カードの詳細（右の列、ADR-0027）。カードの詳細を浮かせて出す仕組みは要らない——固定の
 * 高さで 1 か所に置く。中身の出し入れは `wireCardDetailHover` が行う。
 */
function detailPanelElement(): HTMLElement {
  const node = element('section', 'panel detail')
  node.setAttribute('aria-label', 'カードの詳細')
  node.setAttribute('aria-live', 'polite')
  node.append(detailGuideElement())

  return node
}

function fillDetailPanel(node: HTMLElement, card: (CardView & { readonly kind: '表' }) | undefined): void {
  if (card === undefined) {
    node.replaceChildren(detailGuideElement())
    return
  }

  const big = element('div', `card card--${card.controlledBy} card--色-${primaryColorOf(card.colors)} card--拡大`)
  big.append(faceElement(card, { big: true }))
  node.replaceChildren(big, element('p', 'detail__note', detailNoteOf(card)))
}

/**
 * 乗せた・フォーカスしたカードをカードの詳細に出す配線（ADR-0027）。選んでいる間は、
 * 選んでいるカードが既定になる。別のカードに乗せる（フォーカスする）とそれに切り替わり、
 * 外れると既定に戻る。
 *
 * 組み終わった DOM 全体から、識別子（`data-card-id`）を頼りに拾う。面を組み立てる関数
 * （`cardElement`）ごとに配線すると、盤面・手札・一覧のどこに出てきても同じ動きにするための
 * 配線を何か所にも書くことになる。
 */
function wireCardDetailHover(
  root: HTMLElement,
  detail: HTMLElement,
  cardsById: ReadonlyMap<CardId, CardView>,
  defaultId: CardId | undefined,
): void {
  const nodes = [...root.querySelectorAll<HTMLElement>('[data-card-id]')]
  const elementsById = new Map<CardId, HTMLElement[]>()
  for (const node of nodes) {
    const id = node.dataset.cardId
    if (id === undefined) continue
    elementsById.set(id, [...(elementsById.get(id) ?? []), node])
  }

  const show = (id: CardId | undefined): void => {
    for (const marked of root.querySelectorAll('.card--詳細中')) marked.classList.remove('card--詳細中')
    if (id !== undefined) for (const node of elementsById.get(id) ?? []) node.classList.add('card--詳細中')
    const card = id === undefined ? undefined : cardsById.get(id)
    fillDetailPanel(detail, card?.kind === '表' ? card : undefined)
  }
  const restore = (): void => show(defaultId)
  restore()

  for (const node of nodes) {
    const id = node.dataset.cardId
    if (id === undefined) continue
    node.addEventListener('mouseenter', () => show(id))
    node.addEventListener('focus', () => show(id))
    node.addEventListener('mouseleave', restore)
    node.addEventListener('blur', restore)
  }
}

/**
 * カードの一覧を包む枠（ADR-0027）。捨札・リムーブを見る一覧と、効果で選ばせる一覧の両方が使う。
 * ブラウザ標準のダイアログは使わず、画面の中に重ねる。右の列（カードの詳細）は覆わない
 * ——一覧のカードに乗せて詳細を読みながら選べる（`wireCardDetailHover` が拾う）。
 */
function pickerElement(
  kind: '見る' | '選ぶ',
  title: string,
  lead: string | undefined,
  cards: readonly HTMLElement[],
  foot: HTMLElement,
): HTMLElement {
  const node = element('div', `picker picker--${kind}`)
  node.setAttribute('role', 'dialog')
  node.setAttribute('aria-modal', 'true')
  node.setAttribute('aria-label', title)

  const box = element('div', 'picker__box')
  const head = element('div', 'picker__head')
  head.append(element('h2', 'picker__title', title))
  if (lead !== undefined) head.append(element('p', 'picker__lead', lead))
  box.append(head)

  const list = element('div', 'picker__cards')
  for (const card of cards) list.append(card)
  box.append(list)

  box.append(foot)
  node.append(box)

  return node
}

/** 捨札・リムーブの中身を見る一覧（ADR-0027）。並べて、「閉じる」だけを置く。 */
export function viewPileElement(zone: ZoneView, onClose: () => void): HTMLElement {
  const cards = zone.cards.map((card) => cardElement(card))
  const foot = element('div', 'picker__foot')
  foot.append(button('閉じる', onClose))

  return pickerElement('見る', `${zone.zone}（${zone.count}）`, '上にあるカードほど後から置かれたカード', cards, foot)
}

/** 「選ぶ」一覧で押せるもの。 */
export interface ChoosePickerHandlers {
  /** カードを押した。もう一度押すと選び直しになる（`choosePickerElement` が渡す番号）。 */
  readonly onPick: (index: number | undefined) => void
  readonly onConfirm: (index: number) => void
  readonly onDecline: () => void
  readonly onRewind: () => void
  readonly onCancel: () => void
}

/**
 * 効果で山札などから選ばせる一覧（ADR-0027）。盤面に見えていない置き場から選ぶ場面だけに
 * 使う。盤面のユニットを選ぶ場合は盤面・ボタンのままである（`showsChoicePicker`）。
 *
 * 見えている候補はカードの面をそのまま並べる。見えていない候補（`WireCandidate` の
 * `見えていない`）は中身を見せられないので、裏面と位置を示す読み上げの文だけにする。
 *
 * 押すと選びかけになり（`onPick`）、もう一度「これに決める」を押して答える（ADR-0008）。
 */
export function choosePickerElement(
  asking: string,
  candidates: readonly { readonly index: number; readonly candidate: WireCandidate }[],
  cardOf: (id: CardId) => CardView | undefined,
  picked: number | undefined,
  /**
   * この行動でここまでに答えた数（`WireChoice.answered`）。
   *
   * 上限は通信に載っていない（`WireChoice` は 1 回に 1 つ答える形なので、載せられるのは
   * ここまでの数だけである）ので、「/ 3 枚」のような分母は出さない。何枚目を選んでいるかだけを
   * 出す（#207）。
   */
  answered: number,
  mayDecline: boolean,
  mayRewind: boolean,
  mayCancel: boolean,
  handlers: ChoosePickerHandlers,
): HTMLElement {
  const cards = candidates.map(({ index, candidate }) => {
    const isPicked = picked === index
    const how = isPicked ? '（選択中）' : '（押せます）'
    const node =
      candidate.kind === '見えている'
        ? (() => {
            const found = cardOf(candidate.card)
            const card = found?.kind === '表' ? found : undefined
            const built = card !== undefined ? cardElement(card) : backCardElement()
            if (card !== undefined) built.setAttribute('aria-label', `${card.controlledBy}の${card.name}${how}`)
            return built
          })()
        : (() => {
            const built = backCardElement()
            built.setAttribute('aria-label', `${index + 1} 番目（裏向き）${how}`)
            return built
          })()

    node.classList.add('card--押せる')
    node.classList.toggle('card--選択中', isPicked)
    node.setAttribute('role', 'button')
    node.tabIndex = 0
    const pick = (): void => handlers.onPick(isPicked ? undefined : index)
    node.addEventListener('click', pick)
    // Tab でたどり着けても、Enter・Space が無ければキーボードでは選べない（#207）。
    node.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      pick()
    })

    return node
  })

  const foot = element('div', 'picker__foot')
  foot.append(element('span', 'picker__count', `${answered + 1} 枚目を選んでいます`))
  if (mayDecline) foot.append(button('選ばない', handlers.onDecline))
  if (mayRewind) foot.append(button('ひとつ戻る', handlers.onRewind))
  if (mayCancel) foot.append(button('この行動をやめる', handlers.onCancel))
  const decide = button('これに決める', () => {
    if (picked !== undefined) handlers.onConfirm(picked)
  })
  decide.classList.add('button--primary')
  decide.toggleAttribute('disabled', picked === undefined)
  foot.append(decide)

  return pickerElement('選ぶ', '候補から選ぶ', asking, cards, foot)
}

/** 対戦画面で押せるもの・出すものをまとめて渡す（ADR-0027）。 */
export interface DuelElementProps {
  readonly view: BoardView
  readonly ownName: string
  readonly opponentName: string
  /**
   * 操作するところの中身（見出し・フェイズの下）。行える手・選ぶ候補・演出待ちのいずれかと、
   * 部屋を出る口を、届いた状況に応じて呼ぶ側（`index.ts`）が組み立てて渡す。
   */
  readonly controlsChildren: readonly HTMLElement[]
  readonly picking?: BoardPicking
  readonly onOpenPile: (player: Player, zone: '捨札' | 'リムーブゾーン') => void
  /** 開いている「見る」一覧。無ければ `undefined`。 */
  readonly viewingPile?: HTMLElement
  /** 開いている「選ぶ」一覧。無ければ `undefined`。 */
  readonly choosePicker?: HTMLElement
  /** 演出・決着の層。出すものが無ければ `undefined`。 */
  readonly overlay?: HTMLElement
  /** 表側が見えているカードすべて（`view-model.ts` の `visibleCardViewsIn`）。詳細の配線に使う。 */
  readonly cardsById: ReadonlyMap<CardId, CardView>
}

function partnerOf(side: SideView): (CardView & { readonly kind: '表' }) | undefined {
  const card = zoneOf(side, 'パートナーゾーン').cards[0]
  return card?.kind === '表' ? card : undefined
}

/**
 * 対戦画面ひととおり（ADR-0027）。3 列に分け、画面の高さにぴったり収める。
 *
 * `picking` を渡すと、押せるカードと置き先が盤面の上で分かるようになる（#94）。渡さなければ
 * これまで通り、盤面はただ見るだけのものになる。
 */
export function duelElement(props: DuelElementProps): HTMLElement {
  const { view } = props
  const root = element('main', 'duel')

  const left = element('aside', 'duel__left')
  left.append(playerPanelElement('相手', props.opponentName, view.opponent.damage, partnerOf(view.opponent), props.picking))

  const controls = element('section', 'panel controls')
  controls.append(element('p', 'controls__turn', view.turnNumber))
  controls.append(element('p', 'controls__priority', view.priority))
  controls.append(phasesElement(view.phases))
  const actions = element('div', 'controls__actions')
  for (const child of props.controlsChildren) actions.append(child)
  controls.append(actions)
  left.append(controls)

  left.append(playerPanelElement('自分', props.ownName, view.own.damage, partnerOf(view.own), props.picking))
  root.append(left)

  const center = element('section', 'duel__center')
  center.setAttribute('aria-label', '盤面')
  center.append(handElement('相手', zoneOf(view.opponent, '手札'), props.picking))
  center.append(procedureElement(view.battle, view.smashJudgments))
  center.append(boardGridElement(view, props.picking, props.onOpenPile))
  center.append(handElement('自分', zoneOf(view.own, '手札'), props.picking))
  root.append(center)

  const right = element('aside', 'duel__right')
  right.append(logElement(view.log))
  const detail = detailPanelElement()
  right.append(detail)
  root.append(right)

  if (props.overlay !== undefined) root.append(props.overlay)
  if (props.viewingPile !== undefined) root.append(props.viewingPile)
  if (props.choosePicker !== undefined) root.append(props.choosePicker)

  wireCardDetailHover(root, detail, props.cardsById, props.picking?.picked)

  return root
}
