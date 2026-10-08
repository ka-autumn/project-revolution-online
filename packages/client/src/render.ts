import { COLORS, DUEL_FORMATS } from '@revolution/engine'
import { FOCUS_KEY_ATTRIBUTE, REGION_ATTRIBUTE, type Region, wireBoardKeyboard } from './board-keyboard.js'
import { ignoreKeyRepeat, onLayerEscape } from './dialog-focus.js'
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
  WireCardFace,
  WireCardPosition,
  WireLobbyRestrictionList,
  WireRestrictionList,
  WireRoomRules,
} from '@revolution/engine'
import blackLevelIcon from './assets/level-icons/黒.svg'
import blueLevelIcon from './assets/level-icons/青.svg'
import greenLevelIcon from './assets/level-icons/緑.svg'
import redLevelIcon from './assets/level-icons/赤.svg'
import whiteLevelIcon from './assets/level-icons/白.svg'
import reverseStarIcon from './assets/reverse-star.svg'
import starIcon from './assets/star.svg'
import {
  DECK_NAME_LIMIT,
  POOL_BATCH,
  UNUSABLE_REASON,
  cpuRefusal,
  createRefusal,
  isChoosable,
  isCpuChoosable,
  noDeckReason,
  printedDetailsOf,
} from './deck-builder.js'
import type {
  AutoDeckLabel,
  CardDetail,
  CheckView,
  ConfirmView,
  DeckColor,
  DeckEditorModal,
  DeckRow,
  LevelBar,
  LobbyDeck,
  OwnedDeckRow,
  PresetRow,
  PoolRow,
  PoolView,
  TypeCount,
} from './deck-builder.js'
import type { ActionView, AskOption, AskView, ChoiceView, DestinationView, PickView } from './input-model.js'
import { countName, DISPLAY_NAME_LIMIT } from './name-count.js'
import { PHONE_BACKDROP, PHONE_OPENER, PHONE_SHEET, rulesSummaryOf, tabAfterKey } from './phone.js'
import type { BuilderTab, LobbyMode, PhoneControl } from './phone.js'
import { COLORLESS, emptyFilter, isFiltering, MOVE_SHAPES, toggled, typeShownAs } from './pool-filter.js'
import type { FilterChoices, MoveShape, NumberRange, PoolFilter, StarChoice } from './pool-filter.js'
import type { CopyState, MyShareRow, PublicCardSection, RecipeCardRow, RecipeSummaryRow, ShareDraft, ShareRow, SharingState } from './recipe.js'
import type {
  AbilityView,
  BattleView,
  BoardView,
  CardView,
  FaceFields,
  ModifiedData,
  Overlay,
  Paged,
  PhaseView,
  ResultView,
  RoomTab,
  HandRefusal,
  RoomView,
  SideView,
  SmashJudgmentView,
  SquareView,
  TransitionView,
  ZoneView,
} from './view-model.js'
import {
  DECKS_PER_PAGE,
  faceFieldsOf,
  keyOfPosition,
  pagedOf,
  primaryColorOf,
  printedSquareLabel,
  ROOM_TABS,
  roomListView,
  zoneOf,
} from './view-model.js'

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
  /**
   * 光らせる自分のトラップゾーン（#249）。`トラップとしてプレイする` を行える時だけ渡される。
   * 押した時に何を送るかはここに無い（`onTrapZone`）。
   */
  readonly trapZone?: { readonly label: string }
  readonly onTrapZone?: () => void
  /**
   * 山札を押せる（#249）。プランゾーンにカードが無く、プランする手が届いている時だけ渡される。
   * プランゾーンにカードがあれば、山札の場所に見えているそのカードを押す（`pickable`）。
   */
  readonly deck?: { readonly picked: boolean }
  readonly onDeck?: () => void
  readonly onCard: (card: CardId) => void
  /**
   * 選んでいる行動をやめる。コストなど中のカードから選ぶゾーンの枠の近くに出す。やめられない場面
   * （戻れない選択）では渡されない。
   */
  readonly onCancelChoice?: () => void
  readonly onSquare?: (square: Square) => void
  readonly onHidden?: (at: WireCardPosition) => void
  /**
   * 押せるもの以外のところが押された。カードを選んでいる間だけ渡され、選びかけを外す（#249）。
   * 何を押せるかはここで決めない（`keepsPicking` が DOM の目印で見分ける）。
   */
  readonly onBlank?: () => void
}

/**
 * カードを選んでいる間の「押せるもの」の目印。押されたものがこれらの中にあれば、選びかけを外さない。
 *
 * 中身は ADR-0031 の「押せるもの」の一覧と 1 対 1 で対応する。どれが押せるかはここで決めず、
 * 描いた側の目印に頼る——押せるかどうかを 2 か所で決めない（ADR-0010、`input-model.ts` の
 * `choicePicking` と同じ考え方）。
 */
const KEEPS_PICKING = [
  'button', // ボタン
  '[role="button"]', // ボタンのように振る舞うもの全般（捨札・リムーブの束を開くもの、山札、トラップゾーン）
  '.card--押せる', // 押せるカード
  '.square--置き先', // 光っている行き先（スクエア）
  '.zone--置き先', // 光っている行き先（自分のトラップゾーン）
  '.pile--押せる', // 押せる山札
  '.picker', // カードの一覧（捨札・リムーブを見る一覧と、効果で選ぶ一覧）
  '.dialog', // 手を聞くダイアログ
  '.duel__right', // 右の列（カードの詳細）
].join(', ')

/** 押されたものが、カードを選んでいる間の「押せるもの」か。そうなら選びかけを外さない。 */
function keepsPicking(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(KEEPS_PICKING) !== null
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

/** そのカードが押せるか。表向きは識別子で、裏向きは置き場所で引く。 */
function isPickable(card: CardView, picking: BoardPicking | undefined): boolean {
  return card.kind === '裏' ? picksHidden(picking, card.at) : (picking?.pickable.includes(card.id) ?? false)
}

/**
 * 押せるものが 1 つでもあるか。ある間だけ、押せないカード・スクエアを読み上げで「押せません」と
 * 言う（ADR-0033）。何も押せない間（相手の番など）は、全部に付けると耳障りになる。
 */
function hasPressable(picking: BoardPicking | undefined): boolean {
  return (
    picking !== undefined &&
    (picking.pickable.length > 0 ||
      (picking.squares?.length ?? 0) > 0 ||
      (picking.hidden?.length ?? 0) > 0 ||
      picking.trapZone !== undefined ||
      picking.deck !== undefined)
  )
}

/** 区画の目印を付ける（`board-keyboard.ts`）。 */
function inRegion<T extends HTMLElement>(node: T, region: Region): T {
  node.dataset[REGION_ATTRIBUTE] = region

  return node
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
function iconsElement(card: Pick<FaceFields, 'moveIcon' | 'triggerIcon'>): HTMLElement | undefined {
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
function appendTraitsAndStats(
  bottom: HTMLElement,
  card: Pick<FaceFields, 'attributes' | 'type' | 'bp' | 'sp'> & { readonly modified: ModifiedData | undefined },
): void {
  const added = (card.modified?.addedAttributes ?? []).map((attribute) => `+${attribute}`)
  const traits = [...card.attributes, ...added]
  if (traits.length > 0) bottom.append(element('span', 'card__traits', traits.join(' | ')))

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
}

/**
 * 面を組み立てるのに要る項目（ADR-0028）。盤面のカード（`CardView`）と、デッキ構築の
 * プール・デッキのカード（`poolFaceElement`）の両方がここから作れる。
 */
type FaceCard = FaceFields & {
  readonly modified: ModifiedData | undefined
  readonly damage: number
}

/**
 * カードの見える面の中身を組み立てる。盤面（`faceElement`）とデッキ構築（`poolFaceElement`）で
 * 共有する（ADR-0028）。
 */
function appendFaceContent(node: HTMLElement, card: FaceCard, options: FaceOptions): void {
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

    if (icons !== undefined) bottom.append(icons)
    appendTraitsAndStats(bottom, card)
    node.append(bottom)
  }

  if (card.damage > 0) node.append(element('span', 'card__damage', `ダメージ ${card.damage}`))
}

/**
 * カードの見える面。詳細の札はこの外側に置く（`cardElement`）。
 *
 * フリーズを横倒しにする（総合ルール 第2部 第24章）のはこの要素で、外枠の `card` は回らない。
 * 裏向きなら中身は空にする（裏面の絵柄は CSS が受け持つ）。
 */
function faceElement(card: CardView, options: FaceOptions = {}): HTMLElement {
  const node = element('div', 'card__face')
  if (card.kind === '裏') return node

  appendFaceContent(node, card, options)

  return node
}

/**
 * デッキ構築のプール・デッキの一覧で使う、盤面に関わらないカードの面（ADR-0028）。
 *
 * 盤面のカードと規則を共有する（`appendFaceContent`）。継続効果・ダメージは盤面でしか
 * 起きないので、修整なし・ダメージ 0 として渡す。
 */
function poolFaceElement(face: WireCardFace, options: FaceOptions = {}): HTMLElement {
  const node = element('div', 'card__face')
  appendFaceContent(node, { ...faceFieldsOf(face), modified: undefined, damage: 0 }, options)

  return node
}

function cardElement(card: CardView, picking?: BoardPicking, options: FaceOptions = {}): HTMLElement {
  if (card.kind === '裏') {
    // 裏向きのカードも候補になる（プランのコストのスマッシュ、#127）。押せるかどうかは
    // 置き場所で引く。識別子は届いていない。
    const pickable = isPickable(card, picking)
    // `backCardElement()` を使わないのは、向き・押せるかどうかのクラスを付け、中も `faceElement` で
    // 作る盤面のカードだから（山札やデッキの表紙の、飾りだけの裏面とは作りが違う）。
    const back = element('div', `card card--back card--${card.orientation}${pickable ? ' card--押せる' : ''}`)
    // 押せることを色だけで区別させないのは、表向きのカードと同じである（#94）。
    back.setAttribute('aria-label', `裏向きのカード（${card.orientation}）${pickable ? '（押せます）' : ''}`)
    if (pickable && picking?.onHidden !== undefined) {
      const at = card.at
      const onHidden = picking.onHidden
      back.addEventListener('click', () => onHidden(at))
      // 押せる裏向きのカードは、キーボードでも押せる（ADR-0033）。
      back.setAttribute('role', 'button')
      back.tabIndex = 0
      back.dataset[FOCUS_KEY_ATTRIBUTE] = `h:${keyOfPosition(at)}`
    }
    back.append(faceElement(card))
    return back
  }

  // 継続効果でデータが変わっていることは、文字（`BP1000→2000`）で分かる。色は添えるだけで、
  // それだけに頼らない（#91）。
  const modified = card.modified === undefined ? '' : ' card--修整あり'
  // 押せるかどうかも色だけで区別させない。押せるカードは `aria-label` にもそう出す（#94）。
  const pickable = isPickable(card, picking)
  const picked = picking?.picked === card.id
  const state = `${pickable ? ' card--押せる' : ''}${picked ? ' card--選択中' : ''}`
  const color = `card--色-${primaryColorOf(card.colors)}`
  const node = element('div', `card card--${card.orientation} card--${card.controlledBy}${modified}${state} ${color}`)
  // 乗せた・フォーカスしたカードをカードの詳細に出すための手がかり（`wireCardDetailHover`）。
  node.dataset.cardId = card.id
  // キーボードでも詳細を出せるようにする。マウスを乗せるだけの形にすると触れない人が出る。
  node.tabIndex = 0
  const how = picked ? '（選択中）' : pickable ? '（押せます）' : hasPressable(picking) ? '（押せません）' : ''
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

/**
 * 中のカードから選ぶ（コストなど）ゾーン。選べるカードがあるあいだ、枠ごと目立たせ、盤面のほかを
 * 暗くする。重ねて小さく並べるので、カードの縁の光だけだと、どこを見ればよいか分かりにくい。
 */
const CHOOSING_ZONES: readonly string[] = ['エネルギーゾーン', 'スマッシュゾーン']

/** そのゾーンの中のカードから選ぶか。どのカードが押せるかはここで決めず、カードの側と同じ `isPickable` で引く。 */
function choosesFrom(zone: ZoneView, picking: BoardPicking | undefined): boolean {
  return CHOOSING_ZONES.includes(zone.zone) && zone.cards.some((card) => isPickable(card, picking))
}

/**
 * 強調した枠の上端に付ける札。どこから選ぶかを文字で言い、行動をやめるボタンを枠のすぐ近くに置く
 * （盤面を暗くしても押せる）。やめられない場面ではボタンを出さない。
 */
function choosingTabElement(picking: BoardPicking | undefined): HTMLElement {
  const tab = element('div', 'choosing-tab')
  tab.append(element('span', 'choosing-tab__label', 'ここから選択'))
  if (picking?.onCancelChoice !== undefined) tab.append(button('この行動をやめる', picking.onCancelChoice))

  return tab
}

/**
 * 置き場の見出し。見た目は「ゾーン」を外した呼び名（「リムーブ（0）」）で、読み上げはゾーンの
 * 正式名のまま（「リムーブゾーン（0）」）にする（ADR-0027）。
 */
function zoneTitleElement(zone: ZoneView): HTMLElement {
  const title = element('h3', 'zone__title', zone.zone.replace(/ゾーン$/, ''))
  title.append(element('span', '', `（${zone.count}）`))
  title.setAttribute('aria-label', `${zone.zone}（${zone.count}）`)

  return title
}

/**
 * ゾーンを 1 つ描く。`framed` が偽のとき、ゾーン単独では強調しない（まとめて囲む枠が強調する）。
 */
function zoneElement(zone: ZoneView, picking?: BoardPicking, options: FaceOptions = {}, framed = true): HTMLElement {
  const choosing = framed && choosesFrom(zone, picking)
  const node = element('section', `zone zone--${zone.zone}${choosing ? ' zone--候補あり' : ''}`)
  node.append(zoneTitleElement(zone))

  const cards = element('div', 'zone__cards')
  if (zone.cards.length === 0) cards.append(element('div', 'zone__empty'))
  // 重ねて並べるゾーンは、枚数に応じて重なり幅を詰める（`style.css` の `--fit`）ので、枚数と
  // フリーズしている枚数を渡す。
  if (CHOOSING_ZONES.includes(zone.zone)) {
    cards.style.setProperty('--n', String(zone.cards.length))
    cards.style.setProperty('--nf', String(zone.cards.filter((card) => card.orientation === 'フリーズ').length))
  }
  for (const card of zone.cards) cards.append(cardElement(card, picking, options))
  node.append(cards)
  if (choosing) node.append(choosingTabElement(picking))

  return node
}

/**
 * エネルギーとスマッシュを囲む枠。選べるカードがあるゾーンが両方なら（プランのコスト）、2 つを
 * 1 つの枠で囲んで強調する。片方だけなら（プレイ・移動・起動のコスト）、そのゾーンだけを囲む。
 */
function energyGroupElement(whose: '自分' | '相手', zones: readonly ZoneView[], picking?: BoardPicking): HTMLElement {
  const lit = zones.filter((zone) => choosesFrom(zone, picking))
  const together = lit.length > 1 && lit.length === zones.length
  const node = groupElement(
    whose,
    'エネルギーゾーン',
    zones.map((zone) => zoneElement(zone, picking, {}, !together)),
  )
  if (together) {
    node.classList.add('group--候補あり')
    node.append(choosingTabElement(picking))
  }

  return node
}

/**
 * 自分のトラップゾーン。`トラップとしてプレイする` を行える間は、ここが行き先として光り、押すと
 * その手を行う（#249）。スクエアと同じく、押せることを色だけで区別させず、読み上げにも出す。
 */
function ownTrapZoneElement(zone: ZoneView, picking: BoardPicking | undefined): HTMLElement {
  const node = zoneElement(zone, picking)
  const lit = picking?.trapZone
  const onTrapZone = picking?.onTrapZone
  if (lit === undefined || onTrapZone === undefined) return node

  node.classList.add('zone--置き先')
  node.setAttribute('role', 'button')
  node.tabIndex = 0
  node.dataset[FOCUS_KEY_ATTRIBUTE] = 'trap:自分'
  node.setAttribute('aria-label', `自分のトラップゾーン（押せます: ${lit.label}）`)
  // 光るのは、トラップとしてプレイする手が届いている間だけで、その手はトラップゾーンが空の時にしか
  // 行えない（総合ルール 第2部 第20章 3-1）。ゾーンの中に押せるカードは無いので、カードの click との
  // 重なりは考えない。
  node.addEventListener('click', onTrapZone)
  node.addEventListener('keydown', (event) => {
    // 中のカードにフォーカスがある時の Enter は、そのカードのものである。
    if (event.target !== node || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onTrapZone()
  })

  return node
}

/**
 * 束（捨札・リムーブ）。見せるのは一番上の 1 枚と枚数だけ（ADR-0027）。中身があれば押せ、
 * 押すと中身の一覧が開く（`pickerElement` の「見る」）。
 */
function pileZoneElement(zone: ZoneView, whose: '自分' | '相手', onOpen: (() => void) | undefined): HTMLElement {
  const node = element('section', `zone zone--${zone.zone}`)
  node.append(zoneTitleElement(zone))

  const cardsWrap = element('div', 'zone__cards')
  const pile = element('div', 'pile')
  const top = zone.cards[0]
  if (onOpen !== undefined && zone.count > 0) {
    pile.classList.add('pile--開ける')
    pile.setAttribute('role', 'button')
    pile.tabIndex = 0
    pile.dataset[FOCUS_KEY_ATTRIBUTE] = `pile:${whose}:${zone.zone}`
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
function deckZoneElement(
  deck: ZoneView,
  plan: CardView | undefined,
  picking: BoardPicking | undefined,
  own: boolean,
): HTMLElement {
  const node = element('section', 'zone zone--山札')
  const title = element('h3', 'zone__title', '山札')
  title.append(element('span', '', `（${deck.count}）`))
  node.append(title)

  const cardsWrap = element('div', 'zone__cards')
  const pile = element('div', 'pile')
  // プランゾーンにカードが無い間の山札は、押してプランを始められる（#249）。カードがあれば、
  // そのカードを押す（`cardElement`）。
  const pressable = own && plan === undefined && picking?.deck !== undefined && picking.onDeck !== undefined
  if (pressable) {
    const onDeck = picking.onDeck
    pile.classList.add('pile--押せる')
    pile.dataset[FOCUS_KEY_ATTRIBUTE] = `deck:${own ? '自分' : '相手'}`
    if (picking.deck?.picked === true) pile.classList.add('pile--選択中')
    pile.setAttribute('role', 'button')
    pile.tabIndex = 0
    pile.setAttribute('aria-label', `山札（${picking.deck?.picked === true ? '選択中' : '押せます'}）`)
    if (onDeck !== undefined) {
      pile.addEventListener('click', onDeck)
      pile.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onDeck()
      })
    }
  }
  // プランゾーンのカードは公開情報だが、念のため見えている時だけ表で見せる。見えていなければ
  // 裏面のままにする（表に出せないものを表として描かない）。
  const hasCard = plan !== undefined || deck.count > 0
  if (plan !== undefined && plan.kind === '表') {
    pile.append(cardElement(plan, picking))
    pile.append(element('span', 'pile__plan', 'プラン（1）'))
    // プランのカードのキーワード能力は、カードの下に大きく並べる。枚数は上の見出しに出ている。
    const keywords = keywordsElement(plan.keywords)
    if (keywords !== undefined) {
      keywords.classList.add('pile__keywords')
      pile.append(keywords)
    }
  } else if (hasCard) {
    pile.append(backCardElement())
  } else {
    pile.append(element('div', 'zone__empty'))
  }
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
function squareElement(
  square: SquareView,
  picking: BoardPicking | undefined,
  battle: BattleView | undefined,
  keyboard: boolean,
): HTMLElement {
  const pickable = pickableAt(picking, square.square)
  const inBattle =
    battle !== undefined && battle.square.row === square.square.row && battle.square.column === square.square.column
  const node = element(
    'div',
    `square square--${square.area}${pickable === undefined ? '' : ' square--置き先'}${inBattle ? ' square--バトル中' : ''}`,
  )
  if (inBattle) node.append(element('span', 'square__battle', 'バトル中'))
  // 押せることを色だけで区別させない。読み上げにも出す。
  const onSquare = picking?.onSquare
  if (keyboard) {
    // クリックモードのキーボードでは、ユニットごとではなくスクエアに手を置くので、そこにいる
    // ユニットの名前も添える。押せないスクエアも手を置ける先なので、押せないことも言う（ADR-0033）。
    const units = square.cards.map((card) => (card.kind === '表' ? `${card.controlledBy}の${card.name}` : '裏向きのカード'))
    const unitsPressable = square.cards.some((card) => isPickable(card, picking))
    const where =
      pickable !== undefined
        ? `（押せます: ${pickable.label}）`
        : unitsPressable
          ? '（押せます）'
          : hasPressable(picking)
            ? '（押せません）'
            : ''
    const inside = units.length === 0 ? '' : `：${units.join('、')}`
    node.setAttribute('aria-label', `${square.area} ${square.square.row}-${square.square.column}${inside}${where}`)
    node.tabIndex = 0
    node.setAttribute('role', 'group')
    if (pickable !== undefined && onSquare !== undefined) node.setAttribute('role', 'button')
  } else {
    const where = pickable === undefined ? '' : `（押せます: ${pickable.label}）`
    node.setAttribute('aria-label', `${square.area} ${square.square.row}-${square.square.column}${where}`)
    if (pickable !== undefined && onSquare !== undefined) node.tabIndex = 0
  }
  if (pickable !== undefined && onSquare !== undefined) {
    const picked = pickable.square
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
  keyboard: boolean,
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
      pileZoneElement(zoneOf(view.opponent, 'リムーブゾーン'), '相手', openerOf(view.opponent, 'リムーブゾーン')),
      pileZoneElement(zoneOf(view.opponent, '捨札'), '相手', openerOf(view.opponent, '捨札')),
    ]),
    energyGroupElement('相手', [zoneOf(view.opponent, 'スマッシュゾーン'), zoneOf(view.opponent, 'エネルギーゾーン')], picking),
  )
  inRegion(opponentStrip, 'opp')

  const ownStrip = element('div', 'strip strip--自分')
  ownStrip.append(
    energyGroupElement('自分', [zoneOf(view.own, 'エネルギーゾーン'), zoneOf(view.own, 'スマッシュゾーン')], picking),
    groupElement('自分', '捨札', [
      pileZoneElement(zoneOf(view.own, '捨札'), '自分', openerOf(view.own, '捨札')),
      pileZoneElement(zoneOf(view.own, 'リムーブゾーン'), '自分', openerOf(view.own, 'リムーブゾーン')),
    ]),
  )
  inRegion(ownStrip, 'own')

  const opponentDeck = inRegion(
    place(deckZoneElement(zoneOf(view.opponent, '山札'), planOf(view.opponent), picking, false), '2 / 1'),
    'opp',
  )
  const opponentTrap = inRegion(place(zoneElement(zoneOf(view.opponent, 'トラップゾーン'), picking), '2 / 6'), 'opp')
  const ownTrap = inRegion(place(ownTrapZoneElement(zoneOf(view.own, 'トラップゾーン'), picking), '4 / 1'), 'own')
  const ownDeck = inRegion(place(deckZoneElement(zoneOf(view.own, '山札'), planOf(view.own), picking, true), '4 / 6'), 'own')
  const bank = place(waitingElement('バンク', view.bank), '3 / 1')
  const triggered = place(waitingElement('誘発した能力', view.triggered), '3 / 6')

  const grid: HTMLElement[] = []
  view.squares.forEach((row, r) => {
    const first = row[0]
    if (first === undefined) return
    grid.push(place(areaLabelElement(first.area), `${r + 2} / 2`))
    row.forEach((square, i) => {
      const squareNode = inRegion(squareElement(square, picking, view.battle, keyboard), 'battle')
      // 矢印キーで、画面で見える向きのまま隣へ移るための位置。
      squareNode.dataset.screenRow = String(r)
      squareNode.dataset.screenColumn = String(i)
      grid.push(place(squareNode, `${r + 2} / ${i + 3}`))
    })
  })

  // 置く順は、キーボードでたどる順（自分の置き場 → バトルスペース → 相手の置き場）にする。
  // 画面の位置は `gridArea` で決めているので、見た目は変わらない。ボタンモードでは、これまでの順の
  // ままにする（ADR-0033）。
  if (keyboard) node.append(ownStrip, ownTrap, ownDeck, ...grid, bank, triggered, opponentStrip, opponentDeck, opponentTrap)
  else node.append(opponentStrip, ownStrip, opponentDeck, opponentTrap, ownTrap, ownDeck, bank, triggered, ...grid)

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

/** ロビーのデッキの「…」メニューで押せるもの（ADR-0029）。デッキ一覧の各デッキの操作と同じもの。 */
export type LobbyDeckActions = Pick<DeckListHandlers, 'onOpen' | 'onDuplicate' | 'onShare' | 'onDelete'>

/** ロビーで押せるもの（#175）。 */
export interface LobbyHandlers {
  /** 部屋を作って入る。名前は空でもよい。 */
  readonly onCreate: (name: string, against: OpponentKind) => void
  /** 相手を待っている部屋に入る。 */
  readonly onJoin: (code: RoomCode) => void
  /** 打ち込んだ名前が変わった。**画面は描き直されるので、覚えておくのは呼ぶ側である。** */
  readonly onName: (name: string) => void
  /** 使用するデッキを選び直した（ADR-0021）。名前と同じく、覚えておくのは呼ぶ側である。 */
  readonly onDeck: (deck: DeckId) => void
  /** CPU の席に座らせるデッキを選び直した（#195）。`onDeck` と同じく、覚えておくのは呼ぶ側である。 */
  readonly onCpuDeck: (deck: DeckId) => void
  /** 作る部屋の形式を選び直した（ADR-0021）。覚えておくのは呼ぶ側である。 */
  readonly onFormat: (format: DuelFormat) => void
  /** 作る部屋に当てる禁止／制限リストを選び直した（ADR-0021）。覚えておくのは呼ぶ側である。 */
  readonly onRestriction: (restriction: RestrictionChoice) => void
  /**
   * デッキ一覧を開く（#193、ADR-0029）。組めない立て方では渡さない——カードプールも自分のデッキも
   * 届かず、組んでも残す場所が無い（ADR-0021）。
   */
  readonly onBuild?: () => void
  /** 「…」のメニューの操作（ADR-0029）。`onBuild` と同じ理由で、組めない立て方では渡さない。 */
  readonly deckActions?: LobbyDeckActions
  /** 使用するデッキのページを送った。 */
  readonly onDeckPage: (page: number) => void
  /** 「…」のメニューを開いた・閉じた。`undefined` は閉じる。 */
  readonly onMenu: (deck: DeckId | undefined) => void
  readonly onRoomTab: (tab: RoomTab) => void
  readonly onRoomQuery: (query: string) => void
  readonly onRoomPage: (page: number) => void
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
  caption?: string,
  focusKey?: string,
): HTMLElement {
  const node = element('div', 'lobby__rules')
  if (caption !== undefined) node.append(element('p', 'lobby__rules-caption', caption))

  const formatLabel = element('label', 'lobby__rule')
  formatLabel.append(element('span', 'lobby__rule-label', '形式'))
  const formats = document.createElement('select')
  formats.className = 'lobby__rule-select'
  // 選び直すと描き直す（ロビーは、合わないデッキの表示を追従させる）ので、手を戻す印を付ける。
  if (focusKey !== undefined) formats.dataset[KEEP_FOCUS] = `${focusKey}-形式`
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
  if (focusKey !== undefined) lists.dataset[KEEP_FOCUS] = `${focusKey}-リスト`
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

/** 部屋の名前として受け取る長さの上限（`server` の `room.ts` の `NAME_LIMIT` と同じ）。 */
const NAME_LIMIT = 24

/**
 * 押して選ぶデッキの、選んでいるものに付ける印（`KEEP_FOCUS`）。選ぶたびに描き直すので、選んだ行へ
 * 手を戻したい。矢印で隣へ移った時は、手があった行と選ばれる行が違うが、選んだ行の印は 1 つだけなので、
 * 手のあった行の印を選んだ行のものに替えてから選べば、選んだ行へ戻る。
 */
const PICKED_DECK_KEY = 'デッキ-選択中'
const PICKED_CPU_DECK_KEY = 'CPUのデッキ-選択中'

/**
 * 選べないデッキに出す札と、読み上げに添える言葉（ADR-0029）。使えないカードが入っているデッキと、
 * 選んでいるルールに合わないデッキで、札は同じにして、理由だけを添える。
 */
const UNUSABLE_LABEL = '使用不可'

/** 札と理由を、読み上げと `title` に出す 1 つの文にする。 */
function unusableText(reason: string): string {
  return `${UNUSABLE_LABEL}：${reason}`
}

/**
 * 押せない手の、押せない形（ADR-0029）。`disabled` にしない——Tab で飛ばされ、読み上げが理由に
 * 届かなくなる。理由は `title` と、`aria-describedby` で結ぶ文（ボタンの名前に混ざらないよう、隣に置く）で伝える。
 * 文は、`visible` なら目に見える形で出し（タッチの端末では `title` が出ない）、そうでなければ読み上げだけにする。
 * 押された時に何もしないのは、呼ぶ側が決める。
 */
function refuseButton(node: HTMLElement, reason: string, id: string): HTMLElement {
  node.setAttribute('aria-disabled', 'true')
  node.classList.add('lobby__refused')
  node.title = reason
  node.setAttribute('aria-describedby', id)
  const text = element('span', 'lobby__hidden', reason)
  text.id = id

  return text
}

/** 理由がルールに合わないことのとき、ボタンの面に出す文言（ADR-0029）。詳しい理由は `title` と読み上げに付ける。 */
const OUT_OF_RULES_COVER = '選択したデッキでは対戦できません'

/**
 * 作成・CPU戦の大きいボタン（ADR-0029）。押せないときは、ボタンの面に半透明の黒を重ねて文言を出す。
 * 重ねるので枠の高さは変わらず、ほかの部品にも掛からない。重ねたものは押しを妨げない（押しても何も送らない）。
 * 文言は見せるためだけにあり、読み上げには詳しい理由（`refuseButton`）を渡す。
 */
function handButton(label: string, refusal: HandRefusal | undefined, id: string, onPress: () => void): HTMLElement {
  const go = button(label, () => {
    if (refusal === undefined) onPress()
  })
  go.classList.add('lobby__go')
  const wrap = element('div', 'lobby__go-wrap')
  wrap.append(go)
  if (refusal !== undefined) {
    const cover = element('span', 'lobby__go-cover', refusal.outOfRules ? OUT_OF_RULES_COVER : refusal.reason)
    cover.setAttribute('aria-hidden', 'true')
    wrap.append(cover, refuseButton(go, refusal.reason, id))
  }

  return wrap
}

/** 自分の表示名が届いていない間に、上の帯に出す名前（古いサーバは付けてこない）。 */
const GUEST_NAME = 'ゲスト'

/** ロビーの描き分けに要るもの（ADR-0029）。 */
export interface LobbyView {
  /** 自分の表示名。届いていなければ空。 */
  readonly own: string
  /** 対戦部屋一覧に並ぶ部屋（`lobbyView`）。タブ・探す文字・ページを当てる前。 */
  readonly rooms: readonly RoomView[]
  /** 打ち込みかけの部屋名。画面は丸ごと描き直されるので、呼ぶ側が覚えて渡す。 */
  readonly name: string
  readonly decks: readonly LobbyDeck[]
  readonly chosenDeck: DeckId | undefined
  readonly chosenCpuDeck: DeckId | undefined
  readonly restrictions: readonly WireLobbyRestrictionList[]
  readonly rules: ChosenRules
  readonly deckPage: number
  /** 「…」のメニューを開いているデッキ。 */
  readonly menu: DeckId | undefined
  readonly roomTab: RoomTab
  readonly roomQuery: string
  readonly roomPage: number
  /** コピー・複製・削除の返事を待っているか。重ねて押させない——2 度押すとデッキが 2 つできる。 */
  readonly waiting: boolean
  /** スマートフォンの並べ方の状態と窓口（ADR-0034）。PC の幅では `undefined`。 */
  readonly phone: PhoneControl | undefined
}

/*
 * スマートフォンの並べ方でだけ出す部品（ADR-0034、`phone.ts`）。
 *
 * `PhoneControl` が渡されたとき（幅 768px 以下）にだけ作る。PC の幅では作らないので、PC の DOM には
 * 入り込まない。押した元・閉じる口・フォーカスの扱いは、既存の窓（`confirmElement`）に合わせる——
 * 開いたら中へ、閉じたら開いた元へ手を戻す（置き直しは `phone-focus.ts`）。
 */

const phoneTabId = (name: string, value: string): string => `phone-tab-${name}-${value}`
const phonePanelId = (name: string, value: string, at: number): string => `phone-panel-${name}-${value}-${at}`
/** デッキ構築のタブの並びの名前。タブと中身の両方が同じ名前で結ぶ。 */
const BUILDER_TABS = 'デッキ構築'

/**
 * タブが出す中身に、タブとの結び付きを付ける。中身の名前はタブの文字になり、タブからは `aria-controls` で指される。
 * 1 つのタブが複数の塊を出すときは、`at` で塊ごとに別の印にする（タブの `controls` の数と合わせる）。
 */
function phoneTabpanel(panel: HTMLElement, name: string, value: string, at: number): HTMLElement {
  panel.id = phonePanelId(name, value, at)
  panel.setAttribute('role', 'tabpanel')
  panel.setAttribute('aria-labelledby', phoneTabId(name, value))

  return panel
}

/**
 * タブの並び。押したタブが選ばれ、左右の矢印・Home・End で移る。移る先へ手を置くため、描き直しの前に印を替える。
 * `panels` は、そのタブが出す中身の塊の数。中身には `phoneTabpanel` で同じ順に印を付ける。
 */
function phoneTabsElement<T extends string>(
  name: string,
  className: string,
  tabs: readonly { readonly value: T; readonly label: string; readonly panels: number; readonly className?: string }[],
  current: T,
  onChoose: (tab: T) => void,
): HTMLElement {
  const node = element('div', `phone-only ${className}`)
  node.setAttribute('role', 'tablist')
  node.setAttribute('aria-label', name)
  const values = tabs.map((tab) => tab.value)
  for (const tab of tabs) {
    const each = button(tab.label, () => onChoose(tab.value))
    each.classList.add('phone-tab')
    if (tab.className !== undefined) each.classList.add(tab.className)
    each.id = phoneTabId(name, tab.value)
    each.setAttribute('role', 'tab')
    each.setAttribute('aria-controls', Array.from({ length: tab.panels }, (_, at) => phonePanelId(name, tab.value, at)).join(' '))
    each.setAttribute('aria-selected', String(tab.value === current))
    each.tabIndex = tab.value === current ? 0 : -1
    each.dataset[KEEP_FOCUS] = `${name}-${tab.value}`
    each.addEventListener('keydown', (event) => {
      const to = tabAfterKey(values, tab.value, event.key)
      if (to === undefined) return

      event.preventDefault()
      each.dataset[KEEP_FOCUS] = `${name}-${to}`
      onChoose(to)
    })
    node.append(each)
  }

  return node
}

/** 畳んだ欄を開閉する、幅いっぱいのボタン。 */
function phoneToggleElement(label: string, open: boolean, focusKey: string, className: string, onPress: () => void): HTMLElement {
  const node = button('', onPress)
  node.classList.add('phone-only', 'phone-toggle', className)
  node.setAttribute('aria-expanded', String(open))
  node.dataset[KEEP_FOCUS] = focusKey
  const mark = element('span', 'phone-toggle__mark', open ? '▲' : '▼')
  mark.setAttribute('aria-hidden', 'true')
  node.append(element('span', '', label), mark)

  return node
}

/**
 * 下からせり上がるシートにする。ダイアログとして名前を付け、Esc で閉じる。
 * `canEscape` が偽の間は Esc を見送る（シートの中で開いている別のもの——「…」のメニューが先に閉じる）。
 */
function phoneSheetMarks(sheet: HTMLElement, label: string, onClose: () => void, canEscape: () => boolean = () => true): HTMLElement {
  sheet.setAttribute('role', 'dialog')
  sheet.setAttribute('aria-modal', 'true')
  sheet.setAttribute('aria-label', label)
  sheet.tabIndex = -1
  sheet.dataset[PHONE_SHEET] = ''
  sheet.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && canEscape()) onClose()
  })

  return sheet
}

/** シートの外を暗くした背面。押すと閉じる。 */
function phoneBackdropElement(onClose: () => void): HTMLElement {
  const node = element('div', `phone-only phone-sheet-backdrop ${PHONE_BACKDROP}`)
  node.addEventListener('click', onClose)

  return node
}

/** シートの一番下の閉じる口。片手の親指が届く位置に置く。 */
function phoneCloseElement(label: string, focusKey: string, onClose: () => void): HTMLElement {
  const node = button(label, onClose)
  node.classList.add('phone-sheet__close')
  node.dataset[KEEP_FOCUS] = focusKey

  return node
}

/** 人型のシルエット。アイコンを選べるようにするのは別の Issue（#235）で、それまではこれを出す。 */
function avatarElement(): HTMLElement {
  // 絵だけで意味を持たない。名前は隣の文字が伝えるので、読み上げからは隠す。
  const node = element('span', 'lobby__avatar')
  node.setAttribute('aria-hidden', 'true')
  const svg = svgElement('svg', { viewBox: '0 0 40 40', 'aria-hidden': 'true' })
  svg.append(
    svgElement('circle', { cx: '20', cy: '15', r: '7', fill: '#c9a36a' }),
    svgElement('path', { d: 'M6 40c0-9 6-15 14-15s14 6 14 15z', fill: '#c9a36a' }),
  )
  node.append(svg)

  return node
}

/** 上の帯（ADR-0029）。見出し・説明・自分の表示名。 */
function lobbyTopbarElement(own: string): HTMLElement {
  const bar = element('header', 'panel topbar')
  const name = own === '' ? GUEST_NAME : own
  // 役割の無い要素には名前を付けられないので、見えている名前の文字で伝える。
  const me = element('div', 'lobby__me')
  me.append(avatarElement(), element('span', 'lobby__me-name', name))
  bar.append(
    element('h1', 'topbar__title', '対戦ロビー'),
    element('span', 'topbar__divider'),
    element('span', 'topbar__sub', 'デッキを選んで、ほかのプレイヤーやCPUと対戦しましょう'),
    element('span', 'topbar__spacer'),
    me,
  )

  return bar
}

/** デッキの表紙のカード。カードの面か、面が無ければ裏面（ADR-0029）。読み上げにはデッキの名前があるので、隠す。 */
function deckCoverElement(deck: LobbyDeck, size: 'large' | 'thumb' | 'normal'): HTMLElement {
  const node = element('span', `lobby__art${size === 'normal' ? '' : ` lobby__art--${size}`}`)
  node.setAttribute('aria-hidden', 'true')
  if (deck.cover !== undefined) {
    node.append(poolCardElement(deck.cover))
  } else {
    node.append(backCardElement())
  }

  return node
}

/** 入っている色（ADR-0029）。色ごとのアイコンで並べ、数は出さない。 */
function deckColorsElement(colors: readonly DeckColor[]): HTMLElement {
  const node = element('span', 'lobby__colors')
  node.setAttribute('role', 'img')
  node.setAttribute('aria-label', `色：${colors.join('・')}`)
  for (const color of colors) {
    if (color === COLORLESS) {
      // 無色にはレベルアイコンが無いので、名前で出す。
      node.append(element('span', 'lobby__colorless', color))
      continue
    }
    const icon = document.createElement('img')
    icon.src = LEVEL_ICON_URL[color]
    icon.alt = ''
    node.append(icon)
  }

  return node
}

/** デッキのラベルと色。両方無ければ（中身が届かないデッキ）`undefined`。 */
function deckMetaElement(deck: LobbyDeck): HTMLElement | undefined {
  if (deck.labels.length === 0 && deck.colors.length === 0) return undefined

  const node = element('div', 'lobby__deck-meta')
  if (deck.labels.length > 0) node.append(labelListElement(deck.labels))
  if (deck.colors.length > 0) node.append(deckColorsElement(deck.colors))

  return node
}

/** ページ送り。1 ページに収まるなら出さない。 */
function pagerElement(paged: Paged<unknown>, label: string, onPage: (page: number) => void): HTMLElement | undefined {
  if (paged.pages <= 1) return undefined

  const node = element('nav', 'lobby__pager')
  node.setAttribute('aria-label', label)
  const step = (name: string, text: string, page: number, disabled: boolean): HTMLElement => {
    const each = button(text, () => onPage(page))
    each.dataset[KEEP_FOCUS] = `${label}-${name}`
    each.toggleAttribute('disabled', disabled)
    // 端のページへ移ると、押した「‹」「›」は押せなくなり、手を戻せない。今のページの番号へ移す。
    if (disabled) each.dataset[KEEP_FOCUS_INSTEAD] = `${label}-${paged.page}`
    return each
  }
  const previous = step('前', '‹', paged.page - 1, paged.page === 0)
  previous.setAttribute('aria-label', '前のページ')
  node.append(previous)
  for (let page = 0; page < paged.pages; page += 1) {
    const each = step(String(page), String(page + 1), page, false)
    each.setAttribute('aria-label', `${page + 1} ページ`)
    if (page === paged.page) each.setAttribute('aria-current', 'page')
    node.append(each)
  }
  const next = step('次', '›', paged.page + 1, paged.page >= paged.pages - 1)
  next.setAttribute('aria-label', '次のページ')
  node.append(next)

  return node
}

/** 「…」のボタンに付ける、手を戻す印（`KEEP_FOCUS`）。閉じた時、手は「…」へ戻る。 */
const deckMenuKey = (id: DeckId): string => `デッキのメニュー-${id}`

/** 開いたメニューの、最初の項目に付ける印。「…」を押して開いた時に、手をここへ移す。 */
const deckMenuFirstKey = (id: DeckId): string => `デッキのメニュー-${id}-最初`

/**
 * 「…」のメニュー。デッキ一覧の各デッキにある操作と同じもの（ADR-0029）。
 *
 * `menu`／`menuitem` の役割は名乗らない。名乗るなら矢印キーで移れなければならないが、これは
 * 「…」で開閉するボタンの並びである。中の項目は Tab でたどる。
 * 「ラベル」は #229 が済むまで出さない（デッキの一覧にも、まだラベルを直す操作が無い）。
 */
function deckMenuElement(deck: LobbyDeck, actions: LobbyDeckActions, waiting: boolean, handlers: LobbyHandlers, opensUp: boolean): HTMLElement {
  const node = element('div', `lobby__menu${opensUp ? ' lobby__menu--up' : ''}`)
  node.setAttribute('role', 'group')
  node.setAttribute('aria-label', `「${deck.name}」の操作`)
  const item = (label: string, onPress: () => void, extraClass = ''): HTMLElement => {
    const each = button(label, () => {
      handlers.onMenu(undefined)
      onPress()
    })
    each.className = `lobby__menu-item ${extraClass}`.trim()
    return each
  }
  const duplicate = item('複製', () => actions.onDuplicate(deck.id))
  duplicate.toggleAttribute('disabled', waiting || deck.hasUnusable)
  // 押せない理由を出さないと、何が悪いのか分からない（デッキ一覧と同じ）。
  if (deck.hasUnusable) duplicate.title = '使えなくなったカードが入っているので複製できません。デッキ構築で抜いてください'
  // 使えないカードが入ったデッキでも「デッキ構築」は押せる（カードを抜ける）ので、最初の項目は常に押せる。
  const open = item('デッキ構築', () => actions.onOpen(deck.id))
  open.dataset[KEEP_FOCUS] = deckMenuFirstKey(deck.id)
  node.append(
    open,
    duplicate,
    item('共有', () => actions.onShare(deck.id)),
    element('hr', 'lobby__menu-rule'),
  )
  const remove = item('削除', () => actions.onDelete(deck.id, deck.name), 'lobby__menu-danger')
  remove.toggleAttribute('disabled', waiting)
  node.append(remove)

  return node
}

/**
 * ラジオボタンのまとまりで、矢印キーの向きにある、隣の選べるデッキ（ADR-0029）。選べないデッキは
 * 飛ばす。端で止まり、一周はしない。矢印でなければ `undefined`。使用するデッキの行と、CPU戦の
 * サムネイルで同じ動きにするため、ここに 1 つだけ置く。
 */
function neighborByArrow(event: KeyboardEvent, decks: readonly LobbyDeck[], index: number): LobbyDeck | undefined {
  const move = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0
  if (move === 0) return undefined

  for (let at = index + move; at >= 0 && at < decks.length; at += move) {
    const deck = decks[at]
    if (deck !== undefined && isChoosable(deck)) return deck
  }

  return undefined
}

/**
 * 選べないデッキを示す、膜の上に重ねる 2 つ（ADR-0029）。斜線は、行（サムネイル）の左上の角から
 * 右下の角へ引く。どちらも絵なので、読み上げからは隠す。
 */
function unusableSign(): HTMLElement {
  const sign = element('span', 'lobby__sign')
  sign.setAttribute('aria-hidden', 'true')

  return sign
}

/** 使用するデッキの 1 行。押して選ぶ（ADR-0029）。 */
function deckRowElement(
  deck: LobbyDeck,
  index: number,
  view: LobbyView,
  handlers: LobbyHandlers,
  tabbable: boolean,
  siblings: readonly LobbyDeck[],
): HTMLElement {
  const choosable = isChoosable(deck)
  const picked = choosable && deck.id === view.chosenDeck
  const row = element('div', `lobby__deckrow${picked ? ' lobby__deckrow--picked' : ''}${choosable ? '' : ' lobby__deckrow--unusable'}`)

  const radio = element('div', 'lobby__deck')
  radio.setAttribute('role', 'radio')
  radio.setAttribute('aria-checked', String(picked))
  radio.setAttribute('aria-label', deck.name)
  radio.tabIndex = tabbable && choosable ? 0 : -1
  radio.dataset[KEEP_FOCUS] = picked ? PICKED_DECK_KEY : `デッキ-${deck.id}`
  const choose = (id: DeckId): void => {
    radio.dataset[KEEP_FOCUS] = PICKED_DECK_KEY
    handlers.onDeck(id)
  }
  // スマートフォンでは、押す・Space・Enter で選んだらシートを閉じる（選んだデッキは、上の 1 行に出る）。
  // 閉じるのは選んだ印を描いたあと。矢印で隣へ移るのは見て回る動きなので、閉じない。
  const chooseAndClose = (id: DeckId): void => {
    choose(id)
    view.phone?.send({ kind: 'デッキのシートを閉じる' })
  }
  if (choosable) {
    radio.addEventListener('click', () => chooseAndClose(deck.id))
    radio.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        chooseAndClose(deck.id)
        return
      }
      // ラジオボタンのまとまりと同じく、矢印で隣のデッキへ移って選ぶ。選べないデッキは飛ばす。
      const to = neighborByArrow(event, siblings, index)
      if (to !== undefined) {
        event.preventDefault()
        choose(to.id)
      }
    })
  } else {
    // 押せない行。読み上げでは、帯の「使用不可」と理由を結び付けて伝える。
    radio.setAttribute('aria-disabled', 'true')
    radio.setAttribute('aria-describedby', `lobby-unusable-${deck.id}`)
    radio.title = unusableText(UNUSABLE_REASON)
  }
  const main = element('div', 'lobby__deck-main')
  main.append(element('span', 'lobby__deck-name', deck.name))
  const meta = deckMetaElement(deck)
  if (meta !== undefined) main.append(meta)
  radio.append(deckCoverElement(deck, 'normal'), main)
  row.append(radio)

  if (picked) {
    const badge = element('span', 'lobby__picked', '選択中')
    badge.setAttribute('aria-hidden', 'true')
    row.append(badge)
  }
  if (!choosable) {
    // 膜（CSS）の上に、斜線と、下に重ねる帯を置く。帯は行の高さを増やさない。
    // 帯の字は「使用不可」だけ。理由は読み上げにだけ添える（`title` は行が持つ）。
    const band = element('span', 'lobby__unusable-band', UNUSABLE_LABEL)
    band.id = `lobby-unusable-${deck.id}`
    band.append(element('span', 'lobby__hidden', `：${UNUSABLE_REASON}`))
    row.append(unusableSign(), band)
  }
  if (deck.manageable && handlers.deckActions !== undefined) {
    const open = view.menu === deck.id
    const more = button('…', () => {
      // 開く時は、手を開いたメニューの最初の項目へ移す。描き直したあと、いまの手の印と同じ印の要素へ
      // 戻るので、押した「…」の印を替えておく。
      if (!open) more.dataset[KEEP_FOCUS] = deckMenuFirstKey(deck.id)
      handlers.onMenu(open ? undefined : deck.id)
    })
    more.classList.add('icon-button', 'lobby__deck-menu')
    more.setAttribute('aria-label', `「${deck.name}」の操作`)
    more.setAttribute('aria-expanded', String(open))
    more.dataset[KEEP_FOCUS] = deckMenuKey(deck.id)
    row.append(more)
    // 下の方の行は、開いたメニューが一覧の下からはみ出してスクロールが出ないよう、上へ開く。
    if (open) row.append(deckMenuElement(deck, handlers.deckActions, view.waiting, handlers, index >= 3))
  }

  return row
}

/** 左の列：対戦ルールと使用するデッキ（ADR-0029）。 */
function lobbyDecksPanelElement(view: LobbyView, handlers: LobbyHandlers): HTMLElement {
  const aside = element('span', 'panel__aside', `${view.decks.length} 個`)
  const panel = sectionPanel('lobby__decks-panel', '使用するデッキ', aside)
  // ルールを選ぶところは、デッキと同じ列の上に置く。 選んだルールは、対人戦で作る部屋にも
  // CPU戦にも当たる（ADR-0021）。入る人は一覧に出ている部屋のルールを見て選ぶ。
  panel.append(rulesPicker(view.restrictions, view.rules, handlers, '対戦ルール', 'ロビーのルール'))

  const list = element('div', 'lobby__decks')
  list.setAttribute('role', 'radiogroup')
  list.setAttribute('aria-label', '使用するデッキ')
  list.dataset[KEEP_SCROLL] = 'ロビーのデッキ'
  const paged = pagedOf(view.decks, view.deckPage, DECKS_PER_PAGE)
  if (view.decks.length === 0) {
    const none = handlers.onBuild === undefined ? 'デッキがありません' : 'デッキがありません。\n「デッキ一覧」から作れます'
    list.append(element('p', 'lobby__none', none))
  } else {
    // どれも選ばれていないなら、選ばれていないことを出す（#194）。前に選んでいたデッキを消した
    // 人がここへ来る（`seatedChoice`）。サーバもこの席を断る（`server` の `room.ts` の
    // `refusalOfDeck`）ので、出ているものと座れるものがずれない。
    if (view.chosenDeck === undefined) list.append(element('p', 'lobby__notice', noDeckReason(view.decks)))
    // 矢印で 1 つずつ移れるよう、選んだもの（無ければ先頭の選べるもの）だけを Tab で止まる場所にする。
    const stop = paged.items.some((deck) => deck.id === view.chosenDeck) ? view.chosenDeck : paged.items.find(isChoosable)?.id
    paged.items.forEach((deck, index) => {
      list.append(deckRowElement(deck, index, view, handlers, deck.id === stop, paged.items))
    })
  }
  panel.append(list)

  const foot = element('div', 'lobby__foot')
  foot.append(pagerElement(paged, 'デッキのページ', handlers.onDeckPage) ?? element('span', ''))
  if (handlers.onBuild !== undefined) foot.append(button('デッキ一覧', handlers.onBuild))
  panel.append(foot)

  // スマートフォンでは、この枠そのものが下からのシートになる（ADR-0034）。閉じる口は一番下に置く。
  const phone = view.phone
  if (phone !== undefined) {
    const close = (): void => phone.send({ kind: 'デッキのシートを閉じる' })
    panel.classList.add('lobby__sheet')
    // 「…」のメニューが開いている間の Esc は、メニューを閉じるほうが先（下の keydown）。
    phoneSheetMarks(panel, '使用するデッキ', close, () => view.menu === undefined)
    panel.append(phoneCloseElement('閉じる', 'デッキのシートを閉じる', close))
  }

  // 「…」を開いている間、外を押したら閉じる。
  panel.addEventListener('click', (event) => {
    const inside = event.target instanceof Element && event.target.closest('.lobby__menu, .lobby__deck-menu') !== null
    if (view.menu !== undefined && !inside) handlers.onMenu(undefined)
  })
  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || view.menu === undefined) return

    // メニューの中の項目に手があれば、閉じたあとは「…」へ戻す（描き直しは、手のある要素の印へ戻る）。
    const active = document.activeElement
    if (active instanceof HTMLElement && active.closest('.lobby__menu') !== null) active.dataset[KEEP_FOCUS] = deckMenuKey(view.menu)
    handlers.onMenu(undefined)
  })

  return panel
}

/** スマートフォンの「変更」の印。押したシートを閉じたとき、手はここへ戻る。 */
const DECK_SHEET_OPENER = 'ロビーのデッキの変更'

/**
 * スマートフォンで、使用するデッキ（選んでいる 1 つ）を 1 行で見せる（ADR-0034）。「変更」を押すと、
 * デッキの一覧と対戦ルールをシートで出す。選べているものだけを出す（`chosenDeck` は選べないデッキを含まない）。
 */
function lobbyDeckSummaryElement(view: LobbyView, phone: PhoneControl): HTMLElement {
  const node = element('section', 'panel phone-only lobby__deckpick')
  node.setAttribute('aria-label', '使用するデッキ')
  const chosen = view.decks.find((deck) => deck.id === view.chosenDeck)
  const main = element('div', 'lobby__deckpick-main')
  main.append(element('span', 'lobby__deckpick-label', '使用するデッキ'))
  if (chosen === undefined) {
    main.append(element('span', 'lobby__deckpick-name lobby__deckpick-name--none', noDeckReason(view.decks)))
  } else {
    node.append(deckCoverElement(chosen, 'thumb'))
    main.append(element('span', 'lobby__deckpick-name', chosen.name))
  }
  const change = button('変更', () => phone.send({ kind: 'デッキのシートを開く', opener: DECK_SHEET_OPENER }))
  change.classList.add('lobby__deckpick-change')
  change.setAttribute('aria-label', '使用するデッキを変更する')
  change.setAttribute('aria-haspopup', 'dialog')
  change.dataset[PHONE_OPENER] = DECK_SHEET_OPENER
  change.dataset[KEEP_FOCUS] = DECK_SHEET_OPENER
  node.append(main, change)

  return node
}

/** 対人戦・CPU戦の枠。見出しの帯の色だけが違う。 */
function lobbyModeElement(kind: 'human' | 'cpu', title: string, sub: string): { readonly node: HTMLElement; readonly body: HTMLElement } {
  const node = element('section', `panel lobby__mode lobby__mode--${kind}`)
  const head = element('div', 'lobby__mode-head')
  head.append(element('h2', 'lobby__mode-title', title), element('span', 'lobby__mode-sub', sub))
  const body = element('div', 'lobby__mode-body')
  node.append(head, body)

  return { node, body }
}

/** 対人戦：部屋を作る（ADR-0029）。 */
function lobbyHumanElement(view: LobbyView, handlers: LobbyHandlers): { readonly node: HTMLElement; readonly input: HTMLInputElement } {
  const { node, body } = lobbyModeElement('human', '対人戦', 'ほかのプレイヤーと対戦する')
  const label = element('label', 'lobby__label')
  label.append(document.createTextNode('部屋名'))
  const input = document.createElement('input')
  input.className = 'lobby__name'
  input.type = 'text'
  input.maxLength = NAME_LIMIT
  input.placeholder = '空欄可'
  input.value = view.name
  input.addEventListener('input', () => handlers.onName(input.value))
  label.append(input)
  body.append(label, element('p', 'lobby__note', '作成した部屋は対戦部屋一覧に出て、ほかのプレイヤーが参加できます。'), element('span', 'lobby__spacer'))
  // 押した時の入力欄の中身を読む。**渡された `name` ではない。** あれは描き直した時点の値で、
  // その後に打ち込まれた分が入っていない（打っている間は描き直さない）。
  // 押せない手は出さない（ADR-0029）。使うデッキが選べていないか、選んでいるルールに合わなければ、
  // 押して断られる前に理由を出す。
  const refusal = createRefusal(view.decks, view.chosenDeck)
  body.append(handButton('対戦部屋を作成する', refusal, 'lobby-refusal-create', () => handlers.onCreate(input.value, '人間')))

  return { node, input }
}

/** CPU戦：CPUが使用するデッキをカルーセルで選ぶ（ADR-0029、#195）。 */
function lobbyCpuElement(view: LobbyView, handlers: LobbyHandlers): HTMLElement {
  const { node, body } = lobbyModeElement('cpu', 'CPU戦', 'CPUと対戦して腕を試す')
  const label = 'CPUが使用するデッキ'
  const picker = element('div', 'lobby__picker')
  picker.append(element('p', 'lobby__picker-label', label))

  const decks = view.decks
  if (decks.length === 0) {
    const none = handlers.onBuild === undefined ? 'デッキがありません' : 'デッキがありません。\n「デッキ一覧」から作れます'
    picker.append(element('p', 'lobby__none', none))
  } else {
    const at = decks.findIndex((deck) => deck.id === view.chosenCpuDeck)
    const step = (by: number): void => {
      // 選んでいなければ、どちらへ送っても先頭から始める。選べないデッキは飛ばして、端からは一周する。
      for (let count = 1; count <= decks.length; count += 1) {
        const to = at < 0 ? count - 1 : (((at + by * count) % decks.length) + decks.length) % decks.length
        const deck = decks[to]
        if (deck !== undefined && isCpuChoosable(deck)) {
          handlers.onCpuDeck(deck.id)
          return
        }
      }
    }
    const carousel = element('div', 'lobby__carousel')
    const previous = button('‹', () => step(-1))
    previous.classList.add('lobby__carousel-arrow')
    previous.setAttribute('aria-label', `${label}：前のデッキ`)
    previous.dataset[KEEP_FOCUS] = 'CPUのデッキ-前'
    const next = button('›', () => step(1))
    next.classList.add('lobby__carousel-arrow')
    next.setAttribute('aria-label', `${label}：次のデッキ`)
    next.dataset[KEEP_FOCUS] = 'CPUのデッキ-次'

    const current = element('div', 'lobby__carousel-current')
    current.setAttribute('aria-live', 'polite')
    const chosen = at < 0 ? undefined : decks[at]
    if (chosen === undefined) {
      current.append(element('span', 'lobby__notice', 'デッキを選んでください'))
    } else {
      const main = element('div', 'lobby__carousel-body')
      main.append(element('span', 'lobby__carousel-name', chosen.name))
      const meta = deckMetaElement(chosen)
      if (meta !== undefined) main.append(meta)
      current.append(deckCoverElement(chosen, 'large'), main)
    }
    carousel.append(previous, current, next)
    picker.append(carousel)

    const thumbs = element('div', 'lobby__thumbs')
    thumbs.setAttribute('role', 'radiogroup')
    thumbs.setAttribute('aria-label', label)
    // 描き直しても、列の横スクロールの位置は保つ。選び直した時に選んだものを見せるのは `index.ts`。
    thumbs.dataset[KEEP_SCROLL] = 'ロビーのCPUのデッキ'
    // 使用するデッキの行と同じく、Tab で止まるのは選んでいるもの（無ければ先頭の選べるもの）だけで、
    // 矢印で隣へ移って選ぶ。
    const stop = decks.some((deck) => deck.id === view.chosenCpuDeck) ? view.chosenCpuDeck : decks.find(isCpuChoosable)?.id
    decks.forEach((deck, index) => {
      const choosable = isCpuChoosable(deck)
      const picked = choosable && deck.id === view.chosenCpuDeck
      const thumb = button('', () => {
        if (!choosable) return

        thumb.dataset[KEEP_FOCUS] = PICKED_CPU_DECK_KEY
        handlers.onCpuDeck(deck.id)
      })
      thumb.classList.add('lobby__thumb')
      thumb.classList.toggle('lobby__thumb--unusable', !choosable)
      thumb.setAttribute('role', 'radio')
      thumb.setAttribute('aria-checked', String(picked))
      // 帯を出さない小さな表紙なので、使えないことは読み上げと `title` に添える。
      const named = choosable ? deck.name : `${deck.name}（${unusableText(deck.refusal ?? '')}）`
      thumb.setAttribute('aria-label', named)
      thumb.title = named
      if (!choosable) thumb.setAttribute('aria-disabled', 'true')
      thumb.tabIndex = choosable && deck.id === stop ? 0 : -1
      thumb.dataset[KEEP_FOCUS] = picked ? PICKED_CPU_DECK_KEY : `CPUのデッキ-${deck.id}`
      thumb.addEventListener('keydown', (event) => {
        const to = neighborByArrow(event, decks, index)
        if (to === undefined) return

        event.preventDefault()
        thumb.dataset[KEEP_FOCUS] = PICKED_CPU_DECK_KEY
        handlers.onCpuDeck(to.id)
      })
      thumb.append(deckCoverElement(deck, 'thumb'))
      if (!choosable) thumb.append(unusableSign())
      thumbs.append(thumb)
    })
    picker.append(thumbs)
  }
  body.append(picker, element('span', 'lobby__spacer'))

  // 自分のデッキが選べていて選んでいるルールに合い、CPU のデッキも選べていなければ、押せない（ADR-0029）。
  const refusal = cpuRefusal(decks, view.chosenDeck, view.chosenCpuDeck)
  body.append(handButton('CPUと対戦する', refusal, 'lobby-refusal-cpu', () => handlers.onCreate('', 'CPU')))

  return node
}

/** 部屋のプレイヤー 1 席。空いている席は「? 募集中」。名前が長ければ省略し、アイコンは縮めない。 */
function seatElement(name: string | undefined): HTMLElement {
  const node = element('span', 'lobby__seat')
  if (name === undefined) {
    // 「?」は絵なので隠し、「募集中」とだけ読ませる。
    const mark = element('span', 'lobby__seat-empty', '?')
    mark.setAttribute('aria-hidden', 'true')
    node.append(mark, element('span', 'lobby__seat-name', '募集中'))

    return node
  }
  const label = element('span', 'lobby__seat-name', name)
  label.title = name
  node.append(avatarElement(), label)

  return node
}

/** 対戦部屋一覧の表。 */
function lobbyRoomsTableElement(rows: readonly RoomView[], handlers: LobbyHandlers): HTMLElement {
  // 表の役割を明示する。スマートフォンでは CSS で札の形にする（`display` を変える）ので、ブラウザによっては
  // 表としての読み上げの構造が落ちる。役割を書いておけば、1 部屋ずつの行と見出しのまとまりが保たれる（ADR-0034）。
  const table = document.createElement('table')
  table.setAttribute('role', 'table')
  const head = document.createElement('tr')
  head.setAttribute('role', 'row')
  for (const heading of ['部屋名', 'ステータス', 'ルール', 'プレイヤー']) {
    const cell = document.createElement('th')
    cell.setAttribute('role', 'columnheader')
    cell.textContent = heading
    head.append(cell)
  }
  const action = document.createElement('th')
  action.setAttribute('role', 'columnheader')
  action.append(element('span', 'lobby__hidden', '操作'))
  head.append(action)
  const thead = document.createElement('thead')
  thead.setAttribute('role', 'rowgroup')
  thead.append(head)
  table.append(thead)

  const body = document.createElement('tbody')
  body.setAttribute('role', 'rowgroup')
  for (const view of rows) {
    const row = document.createElement('tr')
    row.setAttribute('role', 'row')
    const cell = (className: string, ...children: (Node | string)[]): HTMLElement => {
      const node = document.createElement('td')
      node.setAttribute('role', 'cell')
      node.className = className
      node.append(...children)
      row.append(node)
      return node
    }
    const name = cell('lobby__room-name', view.name)
    name.title = view.name
    cell('lobby__room-status', element('span', `lobby__badge lobby__badge--${view.status}`, view.status))
    cell('lobby__room-rules', view.rules ?? '')
    const seated = view.seats.filter((seat) => seat !== undefined).length
    const players = element('span', 'lobby__players')
    players.append(seatElement(view.seats[0]), element('span', 'lobby__vs', 'VS'), seatElement(view.seats[1]))
    cell('lobby__room-players', players, element('small', '', `${seated}/2`))
    // 入れない部屋には押す口を出さない。断られる手を画面に出さないのは盤面と同じである。
    // 対戦中の部屋の「観戦」は、観戦ができるようになってから出す（#238）。
    const act = cell('lobby__room-action')
    if (view.joinable) {
      const join = button(view.refusal?.outOfRules === true ? 'ルール外' : '参加', () => {
        if (view.refusal === undefined) handlers.onJoin(view.code)
      })
      join.classList.add('button--small', 'lobby__join')
      join.setAttribute('aria-label', `「${view.name}」に参加する`)
      act.append(join)
      // 選んでいるデッキでは入れない部屋は、押せない形にする（ADR-0029）。ルールに合わないなら、ボタンの文言が
      // 「ルール外」になる。詳しい理由は `title` と読み上げに添える。
      if (view.refusal !== undefined) act.append(refuseButton(join, view.refusal.reason, `lobby-refusal-join-${view.code}`))
    }
    body.append(row)
  }
  table.append(body)

  return table
}

/** 真ん中の下：対戦部屋一覧（ADR-0029）。 */
function lobbyRoomsPanelElement(view: LobbyView, handlers: LobbyHandlers): HTMLElement {
  const panel = sectionPanel('lobby__rooms-panel', '対戦部屋一覧')
  const list = roomListView(view.rooms, view.roomTab, view.roomQuery, view.roomPage)

  const tools = element('div', 'lobby__tools')
  const tabs = element('div', 'lobby__tabs')
  tabs.setAttribute('role', 'group')
  tabs.setAttribute('aria-label', 'ステータスで絞り込む')
  for (const tab of ROOM_TABS) {
    const each = button(tab, () => handlers.onRoomTab(tab))
    each.append(element('span', 'lobby__tab-count', String(list.counts[tab])))
    each.setAttribute('aria-pressed', String(tab === view.roomTab))
    each.dataset[KEEP_FOCUS] = `部屋のタブ-${tab}`
    tabs.append(each)
  }
  const search = element('label', 'lobby__search')
  const query = document.createElement('input')
  query.type = 'search'
  query.placeholder = '部屋名・プレイヤーで探す'
  query.setAttribute('aria-label', '部屋を探す')
  query.value = view.roomQuery
  query.dataset[KEEP_FOCUS] = 'ロビーの部屋検索'
  query.addEventListener('input', (event) => {
    if (!(event instanceof InputEvent && event.isComposing)) handlers.onRoomQuery(query.value)
  })
  query.addEventListener('compositionend', () => handlers.onRoomQuery(query.value))
  search.append(query)
  tools.append(tabs, search)
  panel.append(tools)

  const rooms = element('div', 'lobby__rooms')
  rooms.dataset[KEEP_SCROLL] = 'ロビーの部屋'
  if (view.rooms.length === 0) {
    rooms.append(element('p', 'lobby__none', 'まだ部屋がありません'))
  } else if (list.matched === 0) {
    rooms.append(element('p', 'lobby__none', '当てはまる部屋がありません'))
  } else {
    rooms.append(lobbyRoomsTableElement(list.paged.items, handlers))
  }
  panel.append(rooms)

  const pager = pagerElement(list.paged, '部屋のページ', handlers.onRoomPage)
  if (pager !== undefined) panel.append(pager)

  return panel
}

/** 右の列：お知らせ。中身を用意して届ける仕組みは別の Issue（#239）で作る。それまでは枠だけ置く。 */
function lobbyNewsPanelElement(): HTMLElement {
  const panel = sectionPanel('lobby__news-panel', 'お知らせ')
  const none = element('div', 'lobby__news-none')
  const icon = element('span', 'lobby__news-icon', '📣')
  icon.setAttribute('aria-hidden', 'true')
  none.append(icon, element('span', '', 'お知らせはまだありません'))
  panel.append(none)

  return panel
}

/**
 * ロビー（#175、ADR-0029）。上の帯の下を 3 列に分ける——使用するデッキ（左）、対人戦・CPU戦と
 * 対戦部屋一覧（真ん中）、お知らせ（右）。
 *
 * 打つ前に相手と合言葉を決めておく必要が無いのがここの値である。合言葉を決めるのはサーバ
 * で（ADR-0009、#175）、画面が出すのは名前と様子だけである。
 *
 * `view.name` は打ち込みかけの部屋の名前。画面は届いたものが変わるたびに丸ごと描き直される
 * （`index.ts` の `draw`）ので、打ち込みかけを消さないために、呼ぶ側が覚えて渡す。
 * `focused` なら、描き直した後に部屋名の欄へ手を戻す。
 */
export function lobbyElement(view: LobbyView, handlers: LobbyHandlers, focused = false): HTMLElement {
  const node = element('section', 'lobby')
  node.append(lobbyTopbarElement(view.own))

  const phone = view.phone

  const columns = element('div', 'lobby__columns')
  const left = element('div', 'lobby__column')
  // スマートフォンでは、選んでいる 1 つを 1 行で見せ、一覧と対戦ルールは「変更」のシートに出す。閉じている間は
  // 一覧を作らない。PC の並べ方（3 列）に入り込む部品は、PC では作らない。
  if (phone !== undefined) left.append(lobbyDeckSummaryElement(view, phone))
  if (phone === undefined || phone.state.deckSheet) left.append(lobbyDecksPanelElement(view, handlers))

  const center = element('div', 'lobby__column')
  const human = lobbyHumanElement(view, handlers)
  const modes = element('div', 'lobby__modes')
  const cpu = lobbyCpuElement(view, handlers)
  const rooms = lobbyRoomsPanelElement(view, handlers)
  modes.append(human.node, cpu)
  // スマートフォンでは、上に対人戦・CPU戦のタブを置き、選んだ方の中身だけを見せる（CSS が `data-phone-mode` で出し分ける）。
  // 対人戦のタブが出すのは、部屋を作る欄と部屋の一覧の 2 つ。CPU戦のタブが出すのは CPU戦の枠。
  if (phone !== undefined) {
    const tabs = '対戦の始め方'
    center.dataset.phoneMode = phone.state.lobbyMode
    phoneTabpanel(human.node, tabs, '対人戦', 0)
    phoneTabpanel(rooms, tabs, '対人戦', 1)
    phoneTabpanel(cpu, tabs, 'CPU戦', 0)
    center.append(
      phoneTabsElement<LobbyMode>(
        tabs,
        'lobby__modetabs',
        [
          { value: '対人戦', label: '対人戦', panels: 2, className: 'lobby__modetab--human' },
          { value: 'CPU戦', label: 'CPU戦', panels: 1, className: 'lobby__modetab--cpu' },
        ],
        phone.state.lobbyMode,
        (mode) => phone.send({ kind: 'ロビーのモード', mode }),
      ),
    )
  }
  center.append(modes, rooms)

  const right = element('div', 'lobby__column')
  right.append(lobbyNewsPanelElement())

  columns.append(left, center, right)
  node.append(columns)
  if (phone !== undefined && phone.state.deckSheet) {
    node.append(phoneBackdropElement(() => phone.send({ kind: 'デッキのシートを閉じる' })))
  }

  // 描き直しで打ち込みかけの場所を見失わないように、打っていた人には返す。付け終わってから手を置く。
  // まだ文書に無い要素には置けない。
  if (focused) {
    queueMicrotask(() => {
      human.input.focus()
      human.input.setSelectionRange(human.input.value.length, human.input.value.length)
    })
  }

  return node
}

/** デッキを選ぶところで押せるもの（#193、ADR-0028）。 */
export interface DeckListHandlers {
  readonly onOpen: (deck: DeckId) => void
  readonly onNew: () => void
  /** 既製デッキをコピーして、そのまま組み始める（ADR-0022）。 */
  readonly onCopy: (preset: DeckId) => void
  /** 自分のデッキを、新しいデッキとして保存し直す（ADR-0028）。 */
  readonly onDuplicate: (deck: DeckId) => void
  /** 共有する下書きを開く（ADR-0022・ADR-0028）。 */
  readonly onShare: (deck: DeckId) => void
  /** 自分のデッキを消す。**最後の 1 つは消せない**が、断るのはサーバである。 */
  readonly onDelete: (deck: DeckId, name: string) => void
  readonly onClose: () => void
  /** 自分が出した共有を並べるところを開く（ADR-0022）。 */
  readonly onMyShares: () => void
  /** 「一覧に載せる」共有があるレシピの一覧を開く（ADR-0022）。 */
  readonly onRecipeList: () => void
  readonly onSearch: (search: string) => void
  readonly onColorFilter: (colors: readonly string[]) => void
  readonly onLabelFilter: (labels: readonly string[]) => void
}

/** デッキ一覧に出すもの（#193、ADR-0028）。探した後の絞り込み結果と、選べるものの両方を持つ。 */
export interface DeckListView {
  /** 探した後のデッキ。並べるのはこれだけ。 */
  readonly decks: readonly OwnedDeckRow[]
  /** 探す前のデッキの数。「何件のうち何件」を出す。 */
  readonly total: number
  /** 「入っている色」で選べるもの。実際にどれかのデッキが持つ色だけ。 */
  readonly allColors: readonly string[]
  /** 「ラベル」で選べるもの。実際にどれかのデッキに付いているラベルだけ。 */
  readonly allLabels: readonly AutoDeckLabel[]
  readonly search: string
  readonly colorFilter: readonly string[]
  readonly labelFilter: readonly string[]
  readonly presets: readonly PresetRow[]
  /** コピー・複製・削除の返事を待っているか。重ねて押させない——2 度押すとデッキが 2 つできる。 */
  readonly waiting: boolean
  readonly refusal: string | undefined
  /** スマートフォンの並べ方の状態と窓口（ADR-0034）。PC の幅では `undefined`。 */
  readonly phone: PhoneControl | undefined
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

/** デッキ一覧の上の帯（ADR-0028）。 */
function listTopbarElement(handlers: DeckListHandlers): HTMLElement {
  const bar = element('header', 'panel topbar')
  bar.append(
    button('← ロビーに戻る', handlers.onClose),
    element('h1', 'topbar__title', 'デッキ一覧'),
    element('span', 'topbar__sub', '自分のデッキを組む・共有する'),
    element('span', 'topbar__spacer'),
    button('自分の共有', handlers.onMyShares),
    button('共有されたレシピ', handlers.onRecipeList),
    button('＋ 新しく作る', handlers.onNew, true),
  )

  return bar
}

/** デッキを探すところ（ADR-0028）。名前・入っている色・自動のラベルで絞り込む。 */
function deckSearchPanelElement(view: DeckListView, handlers: DeckListHandlers): HTMLElement {
  const panel = sectionPanel('', 'デッキを探す')
  const body = element('div', 'panel__body')

  const search = document.createElement('input')
  search.type = 'search'
  search.placeholder = 'デッキの名前で探す'
  search.setAttribute('aria-label', 'デッキの名前で探す')
  search.value = view.search
  search.dataset[KEEP_FOCUS] = 'デッキ一覧の検索'
  search.addEventListener('input', (event) => {
    if (!(event instanceof InputEvent && event.isComposing)) handlers.onSearch(search.value)
  })
  search.addEventListener('compositionend', () => handlers.onSearch(search.value))
  body.append(search)

  const colorRow = filterRow(
    '入っている色',
    view.allColors,
    view.colorFilter,
    handlers.onColorFilter,
    (color) => colorChipContent(color as DeckColor),
  )
  if (colorRow !== undefined) body.append(colorRow)

  const labelValues = view.allLabels.map((label) => label.label)
  const labelOf = (value: string): AutoDeckLabel | undefined => view.allLabels.find((label) => label.label === value)
  const labelRow = filterRow(
    'ラベル',
    labelValues,
    view.labelFilter,
    handlers.onLabelFilter,
    (value) => {
      const label = labelOf(value)
      return label === undefined ? [value] : [...labelIconNodes(label), value]
    },
    (value) => {
      const label = labelOf(value)
      return label === undefined ? value : `${label.group}：${label.label}`
    },
  )
  if (labelRow !== undefined) body.append(labelRow)

  panel.append(body)

  return panel
}

/**
 * 既製デッキからコピーして作るところ（ADR-0022）。自分のデッキと同じく、表紙のカードを小さく添える
 * （ADR-0028）。表紙のカードが決まらないデッキはカードの裏面を出す。読み上げにはデッキの名前があるので、隠す。
 */
function presetsPanelElement(presets: readonly PresetRow[], waiting: boolean, handlers: DeckListHandlers): HTMLElement | undefined {
  if (presets.length === 0) return undefined

  const panel = sectionPanel('', '既製デッキからコピーして作る')
  const body = element('div', 'presets')
  for (const preset of presets) {
    const row = element('div', 'preset')
    const art = element('span', 'preset__art')
    art.setAttribute('aria-hidden', 'true')
    if (preset.cover !== undefined) {
      art.append(poolCardElement(preset.cover))
    } else {
      art.append(backCardElement())
    }
    row.append(art, element('span', 'preset__name', preset.name))
    const copy = smallButton('コピーして組む', () => handlers.onCopy(preset.id))
    copy.toggleAttribute('disabled', waiting)
    row.append(copy)
    body.append(row)
  }
  panel.append(body)

  return panel
}

/** 自分のデッキ 1 つのカード（ADR-0028）。 */
function deckCardElement(row: OwnedDeckRow, waiting: boolean, handlers: DeckListHandlers): HTMLElement {
  const card = element('article', 'deckcard')

  const faceWrap = element('div', 'deckcard__face')
  if (row.cover !== undefined) faceWrap.append(poolCardElement(row.cover))
  card.append(faceWrap)

  const main = element('div', 'deckcard__main')
  const head = element('div', 'deckcard__head')
  head.append(element('h3', 'deckcard__name', row.name))
  main.append(head)
  main.append(element('p', 'deckcard__desc', row.description === '' ? '（解説はありません）' : row.description))
  const count = element('span', 'deckcard__count', String(row.count))
  count.append(element('small', '', ' 枚'))
  main.append(count)

  const colors = element('div', 'colors')
  colors.setAttribute('aria-label', '色ごとの枚数')
  for (const { color, count: colorCount } of row.colorCounts) {
    const item = element('span', '')
    if (color === COLORLESS) {
      // 無色にはレベルアイコンが無いので、名前で出す。
      item.append(document.createTextNode(`${color} ${colorCount}`))
    } else {
      const icon = document.createElement('img')
      icon.src = LEVEL_ICON_URL[color]
      icon.alt = color
      item.append(icon, document.createTextNode(String(colorCount)))
    }
    colors.append(item)
  }
  main.append(colors, labelListElement(row.labels))
  card.append(main)

  const actions = element('div', 'deckcard__actions')
  const edit = button('✏️ 編集', () => handlers.onOpen(row.id))
  const duplicate = button('⧉ 複製', () => handlers.onDuplicate(row.id))
  duplicate.toggleAttribute('disabled', waiting || row.hasUnusable)
  const share = button('🔗 共有', () => handlers.onShare(row.id))
  const remove = iconButton('🗑️', `「${row.name}」を削除する`, () => handlers.onDelete(row.id, row.name))
  remove.toggleAttribute('disabled', waiting)
  actions.append(edit, duplicate, share, remove)
  card.append(actions)

  // 複製できない理由。押せないボタンだけを出すと、何が悪いのか分からない。
  if (row.hasUnusable) {
    const note = element('p', 'deckcard__note', '使えなくなったカードが入っているので複製できません。編集で抜いてください')
    note.id = `deckcard-note-${row.id}`
    duplicate.setAttribute('aria-describedby', note.id)
    card.append(note)
  }

  return card
}

/**
 * どのデッキを組むかを選ぶところ（#193、ADR-0028）。上に帯、下に 2 列
 * （探す・既製デッキ／自分のデッキ）を並べる。
 */
export function deckListElement(view: DeckListView, handlers: DeckListHandlers): HTMLElement {
  const node = element('div', 'deckbuild deckbuild--list')
  node.append(listTopbarElement(handlers))

  const columns = element('div', 'columns')

  const left = element('div', 'column column--left')
  // スマートフォンでは、絞り込みを畳んでおき、押すと開く。絞り込み中なら、畳んでいても分かるようにする（ADR-0034）。
  const phone = view.phone
  if (phone !== undefined) {
    const filtering = view.search !== '' || view.colorFilter.length > 0 || view.labelFilter.length > 0
    left.append(
      phoneToggleElement(filtering ? '絞り込み（絞り込み中）' : '絞り込み', phone.state.listFilter, '一覧の絞り込み', 'phone-filter-toggle', () =>
        phone.send({ kind: '一覧の絞り込みを開閉' }),
      ),
    )
  }
  if (phone === undefined || phone.state.listFilter) left.append(deckSearchPanelElement(view, handlers))
  // 既製デッキの欄は、PC では左の列の下。スマートフォンでは自分のデッキの下に置く。見た目の順と Tab・読み上げの順を
  // 一致させるため、CSS の `order` ではなく DOM の順で並べる。
  const presetsPanel = presetsPanelElement(view.presets, view.waiting, handlers)
  if (presetsPanel !== undefined && phone === undefined) left.append(presetsPanel)

  const center = element('div', 'column column--center')
  const aside = element('span', 'panel__aside')
  aside.append(element('strong', '', String(view.decks.length)), ` / ${view.total} 件`)
  const mine = sectionPanel('', '自分のデッキ', aside)
  const scroller = element('div', 'decklist')
  const grid = element('div', 'decklist__grid')
  for (const deck of view.decks) grid.append(deckCardElement(deck, view.waiting, handlers))
  scroller.append(grid)
  if (view.decks.length === 0) scroller.append(element('p', 'pool__none', '条件に合うデッキがありません'))
  mine.append(scroller)
  center.append(mine)

  columns.append(left, center)
  if (presetsPanel !== undefined && phone !== undefined) columns.append(presetsPanel)
  node.append(columns)

  if (view.refusal !== undefined) node.append(element('p', 'refusal', `行えませんでした: ${view.refusal}`))

  return node
}

/** デッキを組むところで押せるもの（#193、ADR-0028）。 */
export interface DeckEditorHandlers extends Pick<LobbyHandlers, 'onFormat' | 'onRestriction'> {
  /** ✏️ を押して、名前をその場で打ち込めるようにする。 */
  readonly onEditNameStart: () => void
  /** 名前を 1 文字打った。描き直しても打ちかけが残るように、呼ぶ側が覚えておく。 */
  readonly onEditName: (name: string) => void
  /** Enter で決める。 */
  readonly onEditNameCommit: (name: string) => void
  /** 入力欄を離れて決める。離れたきっかけのボタンの操作が済むまで、描き直しを待つ（呼ぶ側）。 */
  readonly onEditNameLeave: (name: string) => void
  /** Esc でやめる。打ち込みかけは捨てる。 */
  readonly onEditNameCancel: () => void
  readonly onDescription: (description: string) => void
  /** 組むところの帯から窓を開く・閉じる。 */
  readonly onOpenModal: (modal: DeckEditorModal) => void
  readonly onCloseModal: () => void
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
  /** 折りたためる絞り込みの項目が開いた・閉じた。`open` はブラウザが反映した後の開閉。 */
  readonly onToggleFold: (key: string, open: boolean) => void
  /** カード一覧の表示の形を切り替える。 */
  readonly onPoolView: (view: PoolView) => void
  /** スクロールで一覧の続きを描き足す。 */
  readonly onShowMorePool: () => void
  /** カードの詳細を開く・畳む。描き直さず、押した場でも切り替える（呼ぶ側）。 */
  readonly onToggleDetail: () => void
}

/** デッキを組むところに出すもの（#193、ADR-0028）。どれも `deck-builder.ts` がすでに組み立てている。 */
export interface DeckEditorView {
  readonly name: string
  /** ✏️ で名前をその場で打ち込んでいる途中の値。打ち込んでいなければ `undefined`。 */
  readonly editingName: string | undefined
  /** 一度でも保存したデッキか。保存したことが無ければ「保存しました」とは出さない。 */
  readonly saved: boolean
  readonly description: string
  readonly count: number
  readonly unsaved: boolean
  /** 保存できるか。返事を待っている間と、使えないカードが入っている間は押せない。 */
  readonly savable: boolean
  readonly check: CheckView
  /** 絞り込んだ後のプール。並びはそのまま——描く枚数は `poolShown` で絞る。 */
  readonly pool: readonly PoolRow[]
  /** 絞り込む前のプールの種類の数。「何種のうち何種」を出す。 */
  readonly poolTotal: number
  readonly poolView: PoolView
  /** カード一覧で、面（または行）を描いている枚数。 */
  readonly poolShown: number
  readonly filter: PoolFilter
  readonly filterChoices: FilterChoices
  /** 詳しく絞り込むところを開いているか。 */
  readonly filterOpen: boolean
  /** 折りたためる絞り込みの項目のうち、開いているものの名前。 */
  readonly openFolds: ReadonlySet<string>
  /** カードの詳細を開いているか。 */
  readonly detailOpen: boolean
  readonly deck: readonly DeckRow[]
  readonly detail: (key: string) => CardDetail | undefined
  readonly pinned: string | undefined
  readonly restrictions: readonly WireRestrictionList[]
  readonly rules: ChosenRules
  readonly refusal: string | undefined
  /** デッキの中身から自動で付くラベル（ADR-0028）。 */
  readonly labels: readonly AutoDeckLabel[]
  /** デッキの内訳：レベルの段ごとの、色別の枚数。 */
  readonly levelBars: readonly LevelBar[]
  /** デッキの内訳：種別ごとの枚数。 */
  readonly typeCounts: readonly TypeCount[]
  /** デッキの内訳：スターの合計。 */
  readonly starTotal: number
  /** 組むところの帯から開いている窓。「ラベル」は #229 が済むまで無い。 */
  readonly modal: DeckEditorModal | undefined
  /** スマートフォンの並べ方の状態と窓口（ADR-0034）。PC の幅では `undefined`。 */
  readonly phone: PhoneControl | undefined
}


/** デッキの解説として受け取る長さの上限（`server` の `owned-deck.ts` の `DECK_DESCRIPTION_LIMIT` と同じ）。 */
const DECK_DESCRIPTION_LIMIT = 1000

/**
 * 描き直しても、スクロールした位置を戻す印（`index.ts` の `draw`）。
 *
 * **画面は丸ごと描き直される。** 1 枚入れるたびに、確かめた結果が届くたびに作り直すので、長い
 * 一覧が毎回先頭へ戻ると、続けて入れられない。縦（`scrollTop`）だけでなく横（`scrollLeft`）も
 * 戻す（`index.ts` の `scrollPositions`）——1 行表示を狭い幅で横にスクロールした状態から
 * ＋・−を押しても、左端へ戻らないようにするため（ADR-0028）。
 */
export const KEEP_SCROLL = 'keepScroll'

/**
 * 描き直しても、手を置いていた要素に手を戻す印（`index.ts` の `draw`）。
 *
 * 付けるのは入力欄だけではない。押して選ぶ行・「…」・タブ・ページ送り・カルーセルのように、押した
 * あとに画面が作り直される要素にも付ける——戻さないと、押すたびに手が文書の先頭へ落ちる。入力欄なら、
 * 打っていた位置も戻す。絞り込みの文字は 1 文字打つたびに一覧を作り直すので、戻さないと 1 文字ごとに
 * 打つ場所を見失う。値は画面の中で重ならない名前にする。
 */
export const KEEP_FOCUS = 'keepFocus'

/**
 * 手を戻したい要素が押せなくなっていた時の、代わりの戻し先の `KEEP_FOCUS` の値（`index.ts` の
 * `restoreTyping`）。端のページへ移ると、押した「‹」「›」は押せなくなる。押せない要素には手を
 * 置けないので、今のページの番号のボタンへ移す。
 */
export const KEEP_FOCUS_INSTEAD = 'keepFocusInstead'

/** 絞り込みの値 1 つ。選んでいるものは、色だけでなく太さでも分かる（`chip--選択中`、`aria-pressed` にも出る）。 */
function chip(content: readonly (string | Node)[], pressed: boolean, onPress: () => void): HTMLElement {
  const node = button('', onPress)
  node.classList.add('chip')
  node.classList.toggle('chip--選択中', pressed)
  node.setAttribute('aria-pressed', String(pressed))
  node.append(...content)

  return node
}

/**
 * 「すべて」＋選択肢の並び（ADR-0028）。「すべて」を押すと、その軸で絞らなくなる。
 *
 * `render` は 1 つの選択肢の中身（文字・アイコン）を返す。`ariaLabelOf` を渡せば、読み上げと
 * カーソルを乗せた時の説明にそれを使う（アイコンだけの選択肢のため）。
 */
function chipsElement<T>(
  values: readonly T[],
  chosen: readonly T[],
  onChoose: (next: readonly T[]) => void,
  render: (value: T) => readonly (string | Node)[],
  ariaLabelOf?: (value: T) => string,
): HTMLElement {
  const box = element('div', 'filter__chips')
  const all = chip(['すべて'], chosen.length === 0, () => onChoose([]))
  all.classList.add('chip--すべて')
  box.append(all)
  for (const value of values) {
    const node = chip(render(value), chosen.includes(value), () => onChoose(toggled(chosen, value)))
    if (ariaLabelOf !== undefined) {
      const label = ariaLabelOf(value)
      node.setAttribute('aria-label', label)
      node.title = label
    }
    box.append(node)
  }

  return box
}

/** 折りたためない絞り込みの軸 1 つ（ADR-0028）。項目名と選択肢を同じ行に並べる。選べるものが無ければ出さない。 */
function filterRow<T>(
  label: string,
  values: readonly T[],
  chosen: readonly T[],
  onChoose: (next: readonly T[]) => void,
  render: (value: T) => readonly (string | Node)[] = (value) => [String(value)],
  ariaLabelOf?: (value: T) => string,
): HTMLElement | undefined {
  if (values.length === 0) return undefined

  const row = element('div', 'filter__row')
  row.append(element('span', 'filter__label', label), chipsElement(values, chosen, onChoose, render, ariaLabelOf))

  return row
}

/**
 * 折りたためる絞り込みの軸 1 つ（ADR-0028）。閉じている間は、項目名の横に選んでいる値を
 * 「 | 」でつないで並べる（収まらなければ省略）。選べるものが無ければ出さない。
 */
function foldElement(
  key: string,
  label: string,
  values: readonly string[],
  chosen: readonly string[],
  openFolds: ReadonlySet<string>,
  onToggleFold: (key: string, open: boolean) => void,
  onChoose: (next: readonly string[]) => void,
  shownAs: (value: string) => string = (value) => value,
): HTMLElement | undefined {
  if (values.length === 0) return undefined

  const node = document.createElement('details')
  node.className = 'fold'
  node.open = openFolds.has(key)
  // 描き直しで `open` を入れたときにも `toggle` は出る。反転させず、いまの開閉をそのまま渡す。
  node.addEventListener('toggle', () => onToggleFold(key, node.open))

  const summary = document.createElement('summary')
  summary.append(element('span', 'filter__label', label))
  const picked = element(
    'span',
    `fold__picked${chosen.length === 0 ? ' fold__picked--すべて' : ''}`,
    chosen.length === 0 ? 'すべて' : chosen.map(shownAs).join(' | '),
  )
  picked.title = chosen.join('・')
  summary.append(picked)
  node.append(summary)

  const body = element('div', 'fold__body')
  body.append(chipsElement(values, chosen, onChoose, (value) => [shownAs(value)]))
  node.append(body)

  return node
}

/**
 * 色の絞り込みの中身：色ごとのアイコン（レベルアイコンの形）＋色の名前（ADR-0028）。
 * 無色にはレベルアイコンが無いので、名前だけにする。
 */
function colorChipContent(color: DeckColor): readonly Node[] {
  if (color === COLORLESS) return [document.createTextNode(color)]
  const icon = document.createElement('img')
  icon.className = 'chip__color'
  icon.src = LEVEL_ICON_URL[color]
  icon.alt = ''

  return [icon, document.createTextNode(color)]
}

/** スターの絞り込みの中身。「なし」以外はアイコンだけで出す（読み上げは `starChipAriaLabel`）。 */
function starChipContent(choice: StarChoice): readonly (string | Node)[] {
  switch (choice) {
    case 'なし':
      return ['なし']
    case '★1':
      return [starElement(1, false) ?? '★1']
    case '★2':
      return [starElement(2, false) ?? '★2']
    case 'リバーススター':
      return [starElement(1, true) ?? 'リバーススター']
  }
}

function starChipAriaLabel(choice: StarChoice): string {
  switch (choice) {
    case 'なし':
      return 'スターなし'
    case '★1':
      return 'スター 1'
    case '★2':
      return 'スター 2'
    case 'リバーススター':
      return 'リバーススター'
  }
}

/** 移動方向の絞り込みの中身：ムーブアイコンの形そのもの（ADR-0028）。読み上げは形の名前を渡す。 */
function moveShapeChipContent(label: string): readonly Node[] {
  const shape = MOVE_SHAPES.find((each) => each.label === label)
  const icon = moveIconElement(shape?.directions ?? [])
  icon.removeAttribute('role')
  icon.removeAttribute('aria-label')
  icon.classList.add('chip__move')

  return [icon]
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
  inputs.append(input('min'), element('span', '', '〜'), input('max'))
  row.append(inputs)

  return row
}

/**
 * プールを絞り込むところ（#193、ADR-0028）。並びは ADR どおり：名前・テキスト → エキスパンション
 * → 色 → 種別 → レベル →（詳しく絞り込む）ＢＰ → ＳＰ → スター → 移動方向 → 属性。
 *
 * キーワード能力・ブロック・作品名の軸は、画面だけでは作れないので出さない（#227・#230）。
 */
function filterPanelElement(view: DeckEditorView, handlers: DeckEditorHandlers): HTMLElement {
  const { filter, filterChoices: choices } = view
  const change = (next: Partial<PoolFilter>): void => handlers.onFilter({ ...filter, ...next })

  const reset = isFiltering(filter) ? smallButton('すべて外す', () => handlers.onFilter(emptyFilter())) : undefined
  const panel = sectionPanel('panel--filter', '絞り込み', reset)
  const body = element('div', 'panel__body')
  // 選ぶたびに描き直すので、スクロールした位置を戻す（ADR-0028、`KEEP_SCROLL`）。
  body.dataset[KEEP_SCROLL] = '絞り込み'

  const search = document.createElement('input')
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
  body.append(search)

  const rows: (HTMLElement | undefined)[] = [
    foldElement('エキスパンション', 'エキスパンション', choices.expansions, filter.expansions, view.openFolds, handlers.onToggleFold, (next) =>
      change({ expansions: next }),
    ),
    filterRow('色', choices.colors, filter.colors, (next) => change({ colors: next }), (color) => colorChipContent(color as DeckColor)),
    filterRow('種別', choices.types, filter.types, (next) => change({ types: next }), (type) => [typeShownAs(type)], (type) => type),
    filterRow(
      'レベル',
      choices.levels,
      filter.levels,
      (next) => change({ levels: next }),
      (level) => [String(level)],
      (level) => `レベル${level}`,
    ),
  ]
  for (const row of rows) if (row !== undefined) body.append(row)

  const more = smallButton(view.filterOpen ? '▴ 詳しい絞り込みを閉じる' : '▾ 詳しく絞り込む', () => handlers.onFilterOpen(!view.filterOpen))
  more.classList.add('filter__more')
  more.setAttribute('aria-expanded', String(view.filterOpen))
  body.append(more)

  if (view.filterOpen) {
    const details: (HTMLElement | undefined)[] = [
      rangeRow('ＢＰ', filter.bp, 'ＢＰ', (bp) => change({ bp })),
      rangeRow('ＳＰ', filter.sp, 'ＳＰ', (sp) => change({ sp })),
      filterRow('スター', choices.stars, filter.stars, (next) => change({ stars: next }), starChipContent, starChipAriaLabel),
      filterRow(
        '移動方向',
        choices.moveIcons,
        filter.moveIcons,
        (next) => change({ moveIcons: next }),
        moveShapeChipContent,
        (label) => `移動方向：${label}`,
      ),
      filterRow('発動条件', choices.triggerConditions, filter.triggerConditions, (next) => change({ triggerConditions: next })),
      foldElement('属性', '属性', choices.attributes, filter.attributes, view.openFolds, handlers.onToggleFold, (next) =>
        change({ attributes: next }),
      ),
    ]
    for (const row of details) if (row !== undefined) body.append(row)
  }

  panel.append(body)

  return panel
}

/**
 * カードの詳細（ADR-0028）。見出しを押すと畳める。開閉は描き直さず、class を切り替えるだけに
 * する——画面は操作のたびに丸ごと作り直されるので、描き直しで開閉すると CSS の transition が
 * 効かない。
 */
function poolDetailPanelElement(pinnedDetail: CardDetail | undefined, view: DeckEditorView, handlers: DeckEditorHandlers): HTMLElement {
  const panel = element('section', `panel panel--detail${view.detailOpen ? '' : ' panel--detail-閉'}`)
  panel.setAttribute('aria-label', 'カードの詳細')

  const head = element('div', 'panel__head')
  // 見出しの中に開閉のボタンを置く（button の中には見出しを入れられない）。
  const heading = element('h2', 'panel__title')
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'detail__toggle'
  const chevron = element('span', 'detail__chevron', view.detailOpen ? '▾' : '▴')
  toggle.append(element('span', '', 'カードの詳細'), chevron)
  heading.append(toggle)
  toggle.setAttribute('aria-expanded', String(view.detailOpen))
  toggle.addEventListener('click', () => {
    const opening = panel.classList.contains('panel--detail-閉')
    panel.classList.toggle('panel--detail-閉', !opening)
    toggle.setAttribute('aria-expanded', String(opening))
    chevron.textContent = opening ? '▾' : '▴'
    handlers.onToggleDetail()
  })
  head.append(heading)
  panel.append(head)

  const body = element('div', 'detail')
  fillPoolDetail(body, pinnedDetail)
  panel.append(body)

  return panel
}

/** カードの詳細の中身を入れ替える。左に面、右に文字で全部を書く（ADR-0028）。 */
function fillPoolDetail(node: HTMLElement, detail: CardDetail | undefined): void {
  if (detail === undefined) {
    node.replaceChildren(
      element('p', 'detail__none', 'カードにカーソルを合わせると、ここに出ます。押すと出したままにします'),
    )
    return
  }

  const info = element('div', 'detail__info')
  const title = element('div', 'detail__name')
  const stars = [starElement(detail.face.stars, false), starElement(detail.face.reverseStars, true)].filter(
    (each): each is HTMLElement => each !== undefined,
  )
  title.append(...stars, document.createTextNode(detail.name))
  info.append(title)

  const rows = element('dl', 'detail__rows')
  for (const row of detail.rows) rows.append(element('dt', '', row.label), element('dd', '', row.value))
  info.append(rows)

  if (detail.text.length > 0) {
    const text = element('div', 'detail__text')
    for (const line of detail.text) text.append(element('p', '', line))
    info.append(text)
  }

  node.replaceChildren(poolCardElement(detail.face, { big: true }), info)
}

/** カードの面を、盤面に関わらない場所（プール・デッキ・デッキ一覧）で使う形にする（ADR-0028）。 */
function poolCardElement(face: WireCardFace, options: { readonly big?: boolean; readonly pinned?: boolean } = {}): HTMLElement {
  const classes = ['card', `card--色-${primaryColorOf(face.colors)}`]
  if (options.big) classes.push('card--拡大')
  if (options.pinned) classes.push('card--詳細中')
  const node = element('div', classes.join(' '))
  node.append(poolFaceElement(face, { big: options.big }))

  return node
}

/** レベルの表示（アイコン＋数字）。1 行表示のように面を出さないところで使う。 */
function levelBadgeElement(face: Pick<FaceFields, 'colors' | 'level'>): HTMLElement {
  const node = element('span', 'card__level')
  node.setAttribute('role', 'img')
  node.setAttribute('aria-label', `レベル ${face.level}`)
  const icon = document.createElement('img')
  icon.src = LEVEL_ICON_URL[primaryColorOf(face.colors)]
  icon.alt = ''
  node.append(icon, element('span', '', String(face.level)))

  return node
}

/** 1 種ぶんの、増やす・減らす口。 */
function counterElement(key: string, name: string, count: number, handlers: DeckEditorHandlers): HTMLElement {
  const node = element('div', 'counter')
  // 役割の無い span の aria-label は読まれないことが多いので、枚数は組（group）の名前で伝える。
  node.setAttribute('role', 'group')
  node.setAttribute('aria-label', `「${name}」 デッキに ${count} 枚`)
  const minus = button('−', () => handlers.onRemove(key))
  minus.setAttribute('aria-label', `「${name}」を 1 枚抜く`)
  minus.toggleAttribute('disabled', count === 0)
  const badge = element('span', `counter__count${count > 0 ? ' counter__count--入っている' : ''}`, `×${count}`)
  badge.setAttribute('aria-hidden', 'true')
  const plus = button('＋', () => handlers.onAdd(key))
  plus.setAttribute('aria-label', `「${name}」を 1 枚入れる`)
  node.append(minus, badge, plus)

  return node
}

/** カード表示（面を並べる）の 1 枚。 */
function poolCardItemElement(
  row: PoolRow,
  pinned: boolean,
  handlers: DeckEditorHandlers,
  onHover: (key: string) => void,
  phone: PhoneControl | undefined,
): HTMLElement {
  const item = element('div', `pool__item${row.count > 0 ? ' pool__item--入っている' : ''}`)
  const card = poolCardElement(row.face, { pinned })
  // 面は div の組み合わせなので button には入れられない。押せることは role で伝え、キー操作も足す
  // （1 行表示の名前のボタンと同じく、詳細に出したままにしているかを aria-pressed で出す）。
  card.tabIndex = 0
  card.setAttribute('role', 'button')
  // スマートフォンでは、出したままにするのではなく詳細のシートを開く。開いたままの状態を持たないので aria-pressed は付けない。
  if (phone === undefined) card.setAttribute('aria-pressed', String(pinned))
  else {
    card.setAttribute('aria-haspopup', 'dialog')
    card.dataset[PHONE_OPENER] = cardOpener('プール', row.key)
  }
  card.setAttribute('aria-label', `${row.face.name}（押すと${phone === undefined ? '詳細に出したままにする' : '詳細を開く'}）`)
  const tap = (): void => tapCard(row.key, 'プール', handlers, phone)
  card.addEventListener('mouseenter', () => onHover(row.key))
  card.addEventListener('focus', () => onHover(row.key))
  card.addEventListener('click', tap)
  card.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    tap()
  })
  item.append(card, counterElement(row.key, row.face.name, row.count, handlers))

  return item
}

/**
 * カードを 1 回押したときの動き。PC は詳細に出したままにする（ADR-0028）。スマートフォンはマウスを乗せられないので、
 * 詳細を下からのシートで開く（ADR-0034）。シートを閉じたとき手を戻す先として、押したものに印を付ける。
 * 同じカードがプールとデッキの両方に並ぶので、印には置き場所も入れる。
 */
function tapCard(key: string, place: CardPlace, handlers: DeckEditorHandlers, phone: PhoneControl | undefined): void {
  if (phone === undefined) {
    handlers.onPin(key)
    return
  }

  phone.send({ kind: 'カードのシートを開く', card: key, opener: cardOpener(place, key) })
}

type CardPlace = 'プール' | 'デッキ'

/** シートを閉じたとき手を戻す先の印（`data-phone-opener`）。描き直しても、同じ印の要素へ戻る。 */
const cardOpener = (place: CardPlace, key: string): string => `カード-${place}-${key}`

/**
 * 1 行表示の 1 種（ADR-0028）。プールでもデッキでも使う。
 *
 * ＢＰ／ＳＰはプールの行（`withStats`）にだけ出す。デッキの行はレベル・種別・スター・名前・
 * 枚数だけにする（パートナーの ♥ は #228 が済んでから）。
 */
function poolCardRowElement(
  row: PoolRow,
  pinned: boolean,
  handlers: DeckEditorHandlers,
  onHover: (key: string) => void,
  withStats: boolean,
  phone: PhoneControl | undefined,
): HTMLElement {
  const face = row.face
  const node = element('div', `cardrow card--色-${primaryColorOf(face.colors)}${pinned ? ' cardrow--詳細中' : ''}`)
  node.addEventListener('mouseenter', () => onHover(row.key))
  node.append(levelBadgeElement(face), element('span', 'card__kind', face.type))
  const stars = [starElement(face.stars, false), starElement(face.reverseStars, true)].filter(
    (each): each is HTMLElement => each !== undefined,
  )
  node.append(...stars)

  const name = document.createElement('button')
  name.type = 'button'
  name.className = 'cardrow__name'
  name.textContent = face.name
  const place: CardPlace = withStats ? 'プール' : 'デッキ'
  if (phone === undefined) name.setAttribute('aria-pressed', String(pinned))
  else {
    name.setAttribute('aria-haspopup', 'dialog')
    name.dataset[PHONE_OPENER] = cardOpener(place, row.key)
  }
  name.addEventListener('click', () => tapCard(row.key, place, handlers, phone))
  name.addEventListener('focus', () => onHover(row.key))
  node.append(name)

  // 属性は出さない（狭い幅でも収まるように、ADR-0028）。ＢＰ・ＳＰはユニットだけ持つ。
  if (withStats) {
    node.append(element('span', 'cardrow__meta', face.type === 'ユニット' ? `BP ${face.bp} ／ SP ${face.sp}` : ''))
  }
  node.append(counterElement(row.key, face.name, row.count, handlers))

  return node
}

/**
 * 使えないカード（プールに無いカード）の 1 行。
 *
 * 名前が分からないので、読み上げでは並び順（`ordinal`、使えないカードの中で 1 から数える）と枚数で
 * どの行の「抜く」かを区別する。識別子は意味の無い文字列なので出さない（ADR-0021）。
 */
function unusableCardRowElement(key: string, count: number, ordinal: number, handlers: DeckEditorHandlers): HTMLElement {
  const node = element('div', 'cardrow cardrow--使えない')
  const remove = smallButton('抜く', () => handlers.onRemove(key))
  remove.setAttribute('aria-label', `使えないカード ${ordinal} つめ（${count} 枚）を抜く`)
  node.append(element('span', 'cardrow__name', `使えないカード ×${count}`), remove)

  return node
}

/** カード表示・1 行表示の切り替え（ADR-0028）。 */
function viewSwitchElement(current: PoolView, onChoose: (view: PoolView) => void): HTMLElement {
  const node = element('div', 'viewswitch')
  node.setAttribute('role', 'group')
  node.setAttribute('aria-label', '表示の形')
  const options: readonly { readonly view: PoolView; readonly label: string }[] = [
    { view: 'カード', label: '▦ カード' },
    { view: '一覧', label: '☰ 一覧' },
  ]
  for (const { view, label } of options) {
    const b = button(label, () => onChoose(view))
    b.setAttribute('aria-pressed', String(current === view))
    node.append(b)
  }

  return node
}

/**
 * カード一覧（ADR-0028）。最初の数十枚だけ面を描き、スクロールで描き足す——1000 種になった時、
 * 描き直すたびに全部の面を作ると重いため。描き足した枚数は状態として持ち（`poolShown`）、
 * 絞り込みを変えたら先頭に戻す（呼ぶ側、`index.ts`）。
 */
function poolListElement(view: DeckEditorView, handlers: DeckEditorHandlers, onHover: (key: string) => void): HTMLElement {
  const scroller = element('div', 'pool')
  scroller.dataset[KEEP_SCROLL] = 'プール'
  const shown = view.pool.slice(0, view.poolShown)

  if (view.poolView === 'カード') {
    const grid = element('div', 'pool__grid')
    for (const row of shown) grid.append(poolCardItemElement(row, row.key === view.pinned, handlers, onHover, view.phone))
    scroller.append(grid)
  } else {
    const rows = element('div', 'rows')
    for (const row of shown) rows.append(poolCardRowElement(row, row.key === view.pinned, handlers, onHover, true, view.phone))
    scroller.append(rows)
  }

  if (view.pool.length === 0) scroller.append(element('p', 'pool__none', '条件に合うカードがありません'))
  const hasMore = view.pool.length > view.poolShown
  if (hasMore) {
    const more = element('p', 'pool__more', `続きを表示しています…（${view.poolShown} / ${view.pool.length} 種）`)
    scroller.append(more)
    // 末尾の 1 行が枠の下端に近づいたら描き足す。scroll を待つ形にすると、大きい画面で最初の
    // 数十枚が枠を埋めきらなかったときにスクロールが起きず、続きが描かれないまま止まる。
    // 見張るのは 1 回だけにする——描き足すと画面ごと作り直され、この要素は捨てられる。
    const watcher = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        watcher.disconnect()
        handlers.onShowMorePool()
      },
      // スマートフォンでは一覧は枠の中でスクロールせず、ページがスクロールする（ADR-0034）ので、見張るのは画面にする。
      { root: view.phone === undefined ? scroller : null, rootMargin: '0px 0px 200px 0px' },
    )
    watcher.observe(more)
  }

  return scroller
}

/** 確かめた結果（ADR-0021、ADR-0028）。 */
function checkElement(check: CheckView): HTMLElement {
  const node = element('div', `check check--${check.kind}`)
  switch (check.kind) {
    case '確かめている':
      node.append(element('p', '', '確かめています'))
      break
    case '確かめられない':
      node.append(element('p', '', check.reason))
      break
    case '満たしている':
      node.append(element('p', '', '規定を満たしています'))
      break
    case '満たしていない':
      for (const line of check.lines) node.append(element('p', '', line))
      break
  }

  return node
}

/** デッキの内訳：レベルの段ごとの、色別の積み上げ棒グラフ（ADR-0028）。 */
function levelBreakdownElement(bars: readonly LevelBar[]): HTMLElement {
  const figure = document.createElement('figure')
  figure.className = 'levels'
  figure.setAttribute('role', 'img')
  const max = Math.max(1, ...bars.map((bar) => bar.total))
  const summary = bars
    .map((bar) => {
      const byColor = bar.byColor
        .filter((each) => each.count > 0)
        .map((each) => `${each.color} ${each.count}`)
        .join('・')
      return `レベル${bar.label} ${bar.total} 枚（${byColor === '' ? 'なし' : byColor}）`
    })
    .join('、')
  figure.setAttribute('aria-label', `レベルごとの枚数：${summary}`)
  figure.append(element('span', 'levels__caption', 'レベルごとの枚数'))

  const barsNode = element('div', 'levels__bars')
  for (const bar of bars) {
    const barNode = element('div', 'levels__bar')
    barNode.append(element('span', '', String(bar.total)))
    const stack = element('div', 'levels__stack')
    stack.style.height = `${(bar.total / max) * 74}%`
    for (const { color, count } of bar.byColor) {
      if (count === 0) continue
      // 無色には面の色が無いので、灰色の段にする（`levels__seg--無色`）。
      const seg = element('div', `levels__seg ${color === COLORLESS ? 'levels__seg--無色' : `card--色-${color}`}`)
      seg.style.flexGrow = String(count)
      seg.title = `${color} ${count} 枚`
      stack.append(seg)
    }
    barNode.append(stack)
    barsNode.append(barNode)
  }
  figure.append(barsNode)

  const axis = element('div', 'levels__axis')
  for (const bar of bars) axis.append(element('span', '', bar.label))
  figure.append(axis)

  return figure
}

/** デッキの内訳：種別ごとの枚数と、その下にスターの合計（ADR-0028）。 */
function typeCountsElement(typeCounts: readonly TypeCount[], starTotal: number): HTMLElement {
  const list = element('ul', 'types')
  list.setAttribute('aria-label', '種別ごとの枚数')
  for (const { type, count } of typeCounts) {
    const item = element('li', count === 0 ? 'types__zero' : '')
    item.append(element('span', '', typeShownAs(type)), element('span', '', String(count)))
    if (typeShownAs(type) !== type) item.setAttribute('aria-label', `${type} ${count}`)
    list.append(item)
  }
  const starItem = element('li', 'types__stars')
  starItem.setAttribute('aria-label', `スターの合計 ${starTotal} 個`)
  const label = element('span', '')
  const icon = starElement(1, false)
  if (icon !== undefined) label.append(icon)
  label.append('スター合計')
  starItem.append(label, element('span', '', String(starTotal)))
  list.append(starItem)

  return list
}

/** ラベル 1 つ（ADR-0028）。自動で付いたか選んだかは、見た目にも読み上げにも出さない。 */
function labelChipElement(label: AutoDeckLabel): HTMLElement {
  const node = element('span', 'tag')
  node.append(...labelIconNodes(label), document.createTextNode(label.label))
  node.setAttribute('aria-label', `${label.group}：${label.label}`)

  return node
}

/**
 * ラベルの先頭に付けるもの（ADR-0028）。色の構成（「赤単」「赤黒」）は、その色のレベルアイコンを
 * 名前に出てくる順に並べる。ほかは絵文字（`AUTO_LABEL_EMOJI`）。読み上げには出さない（名前で足りる）。
 */
function labelIconNodes(label: AutoDeckLabel): readonly Node[] {
  const emoji = AUTO_LABEL_EMOJI[label.label]
  if (emoji !== undefined) return [element('span', 'tag__emoji', emoji)]
  if (label.group !== '色の構成') return []

  return COLORS.filter((color) => label.label.includes(color))
    .sort((left, right) => label.label.indexOf(left) - label.label.indexOf(right))
    .map((color) => {
      const icon = document.createElement('img')
      icon.className = 'tag__color'
      icon.src = LEVEL_ICON_URL[color]
      icon.alt = ''
      return icon
    })
}

/** ラベルの中身を表す絵文字（ADR-0028）。色の構成は色のアイコンで表すので、ここには多色だけを持つ。 */
const AUTO_LABEL_EMOJI: Readonly<Record<string, string>> = {
  アグロ: '⚡',
  ミッドレンジ: '⚖️',
  コントロール: '🛡️',
  多色: '🌈',
}

/** ラベルの並び。 */
function labelListElement(labels: readonly AutoDeckLabel[], extraClass = ''): HTMLElement {
  const node = element('div', `taglist ${extraClass}`.trim())
  node.setAttribute('aria-label', 'ラベル')
  for (const label of labels) node.append(labelChipElement(label))

  return node
}

/** 見出しの右に添える、小さいボタン。 */
function smallButton(label: string, onPress: () => void): HTMLElement {
  const node = button(label, onPress)
  node.classList.add('button--small')

  return node
}

/** 見出し（`panel__head`）を持つ、組むところ・デッキ一覧のパネル。 */
function sectionPanel(extraClass: string, title: string, aside?: HTMLElement): HTMLElement {
  const node = element('section', `panel ${extraClass}`.trim())
  const head = element('div', 'panel__head')
  head.append(element('h2', 'panel__title', title))
  if (aside !== undefined) head.append(aside)
  node.append(head)

  return node
}

/** 組むところの上の帯（ADR-0028）。名前の編集・解説・付いているラベル・形式とリストを並べる。 */
function editorTopbarElement(view: DeckEditorView, handlers: DeckEditorHandlers): HTMLElement {
  const bar = element('header', 'panel topbar')
  bar.append(button('← デッキ一覧に戻る', handlers.onBack), element('h1', 'topbar__title', 'デッキ構築'), element('span', 'topbar__divider'))

  const name = element('div', 'deckname')
  if (view.editingName !== undefined) {
    const input = document.createElement('input')
    input.type = 'text'
    input.maxLength = DECK_NAME_LIMIT
    input.value = view.editingName
    input.setAttribute('aria-label', 'デッキの名前')
    input.dataset[KEEP_FOCUS] = 'デッキの名前'
    input.addEventListener('input', () => handlers.onEditName(input.value))
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') handlers.onEditNameCommit(input.value)
      if (event.key === 'Escape') handlers.onEditNameCancel()
    })
    // 描き直しで捨てられるときにも blur が出る（Chrome）。そのときは欄がまだ画面に残っているので、
    // 描き直しが済むのを待ってから、画面に残っている欄を離れたときだけ決める。
    input.addEventListener('blur', () => {
      queueMicrotask(() => {
        if (input.isConnected) handlers.onEditNameLeave(input.value)
      })
    })
    name.append(input)
    // ✏️ を押した直後に手を移す。描き直しの後は `index.ts` が打っていた位置ごと戻しているので動かさない。
    queueMicrotask(() => {
      if (document.activeElement !== input) input.focus()
    })
  } else {
    name.append(
      element('span', 'deckname__text', view.name),
      iconButton('✏️', 'デッキの名前を変える', handlers.onEditNameStart),
    )
  }
  bar.append(name)

  // スマートフォンでは、解説・ラベル・形式・禁止／制限リストを「デッキの設定」に畳む。上の段が大きいと、カードプールが
  // 1 段ほどしか見えなくなるため。畳んでいても、いまの形式とリストは見出しで分かる（ADR-0034）。
  const phone = view.phone
  if (phone !== undefined) {
    const summary = rulesSummaryOf(DUEL_FORMATS, view.rules.format, view.restrictions, view.rules.restriction)
    bar.append(
      phoneToggleElement(`デッキの設定（${summary}）`, phone.state.builderSettings, 'デッキの設定', 'phone-settings-toggle', () =>
        phone.send({ kind: '構築の設定を開閉' }),
      ),
    )
    if (!phone.state.builderSettings) return bar
  }

  const description = smallButton(view.description ? '📝 解説' : '📝 解説を書く', () => handlers.onOpenModal('解説'))
  description.setAttribute('aria-haspopup', 'dialog')
  bar.append(description, labelListElement(view.labels, 'taglist--bar'), element('span', 'topbar__spacer'))

  bar.append(rulesPicker(view.restrictions, view.rules, handlers))

  return bar
}

/** 解説を読む・書く窓（ADR-0028）。押す前に尋ねるところ（`.confirm`）と同じ見た目にする。 */
function descriptionModalElement(view: DeckEditorView, handlers: DeckEditorHandlers): HTMLElement {
  const layer = element('div', 'confirm')
  const box = element('div', 'confirm__box')
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-modal', 'true')
  box.setAttribute('aria-label', 'デッキの解説')
  box.append(element('h2', 'confirm__title', `「${view.name}」の解説`))

  const body = element('div', 'confirm__body')
  const textarea = document.createElement('textarea')
  textarea.rows = 8
  textarea.maxLength = DECK_DESCRIPTION_LIMIT
  textarea.placeholder = '解説（無くてもかまいません）'
  textarea.value = view.description
  textarea.dataset[KEEP_FOCUS] = 'デッキの解説'
  textarea.addEventListener('input', () => handlers.onDescription(textarea.value))
  body.append(textarea, element('p', 'confirm__hint', '保存するまで、デッキには残りません（1000 文字まで）'))
  box.append(body)

  const buttons = element('div', 'confirm__buttons')
  buttons.append(button('閉じる', handlers.onCloseModal, true))
  box.append(buttons)
  layer.append(box)

  layer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') handlers.onCloseModal()
  })
  layer.addEventListener('click', (event) => {
    if (event.target === layer) handlers.onCloseModal()
  })
  queueMicrotask(() => textarea.focus())

  return layer
}

/**
 * スマートフォンで、カードを 1 回押したときの詳細のシート（ADR-0034）。カードの詳細と、1 枚抜く・今の枚数・1 枚入れるの口、
 * 一番下に閉じる口を置く。枚数の増減は一覧の下の＋・−と同じ手（`onAdd`・`onRemove`）で、送るものは変わらない。
 * 詳細が引けないカード（プールから消えた）なら出さない。
 */
function cardSheetElements(view: DeckEditorView, handlers: DeckEditorHandlers, phone: PhoneControl, key: string): HTMLElement[] | undefined {
  const detail = view.detail(key)
  if (detail === undefined) return undefined

  const close = (): void => phone.send({ kind: 'カードのシートを閉じる' })
  const sheet = element('section', 'phone-sheet')
  phoneSheetMarks(sheet, `「${detail.name}」の詳細`, close)
  const body = element('div', 'detail')
  fillPoolDetail(body, detail)

  const count = view.deck.find((row) => row.kind === '使える' && row.key === key)?.count ?? 0
  const counter = element('div', 'phone-sheet__counter')
  counter.setAttribute('role', 'group')
  counter.setAttribute('aria-label', `「${detail.name}」 デッキに ${count} 枚`)
  const minus = button('1 枚抜く', () => handlers.onRemove(key))
  minus.toggleAttribute('disabled', count === 0)
  minus.dataset[KEEP_FOCUS] = 'シート-抜く'
  // 抜ききると押せなくなる。押せない要素には手を置けないので、「1 枚入れる」へ移す。
  minus.dataset[KEEP_FOCUS_INSTEAD] = 'シート-入れる'
  const badge = element('span', `counter__count${count > 0 ? ' counter__count--入っている' : ''}`, `×${count}`)
  badge.setAttribute('aria-hidden', 'true')
  const plus = button('1 枚入れる', () => handlers.onAdd(key), true)
  plus.dataset[KEEP_FOCUS] = 'シート-入れる'
  counter.append(minus, badge, plus)

  sheet.append(body, counter, phoneCloseElement('閉じる', 'カードのシートを閉じる', close))

  return [phoneBackdropElement(close), sheet]
}

/**
 * デッキを組むところ（#193、ADR-0028）。上に帯、下に 3 列（絞り込みとカードの詳細／カード一覧／
 * デッキ）を並べ、画面の高さに収める。
 *
 * **不備があっても保存できる**（ADR-0021）。確かめた結果は読むためのもので、保存を止めない。
 *
 * 打ち込む欄には `KEEP_FOCUS` を付ける。描き直した後に、打っていた人の手を戻すのは `index.ts` である。
 */
export function deckEditorElement(view: DeckEditorView, handlers: DeckEditorHandlers): HTMLElement {
  const phone = view.phone
  // スマートフォンでは、「カードを探す」「デッキ」のタブで 2 つの見え方を切り替える（CSS が class で出し分ける）。
  const node = element('div', phone === undefined ? 'deckbuild' : `deckbuild deckbuild--tab-${phone.state.builderTab}`)
  node.append(editorTopbarElement(view, handlers))
  if (phone !== undefined) {
    node.append(
      phoneTabsElement<BuilderTab>(
        BUILDER_TABS,
        'deckbuild__tabs',
        [
          { value: '探す', label: 'カードを探す', panels: 2 },
          { value: 'デッキ', label: `デッキ（${view.count} 枚）`, panels: 1 },
        ],
        phone.state.builderTab,
        (tab) => {
          phone.send({ kind: 'デッキ構築のタブ', tab })
          // 切り替えた先は、先頭から見せる。タブは画面の上に付いて残るので、ページを先頭へ戻しても見失わない。
          window.scrollTo(0, 0)
        },
      ),
    )
  }

  const columns = element('div', 'columns')

  // 左列：絞り込み（上）とカードの詳細（下）。スマートフォンでは、絞り込みは畳んでおき、カードの詳細は
  // 出さない（カードを押すと、シートで出る）。
  const left = element('div', 'column column--left')
  if (phone !== undefined) {
    left.append(
      phoneToggleElement(
        isFiltering(view.filter) ? '絞り込み（絞り込み中）' : '絞り込み',
        phone.state.builderFilter,
        '構築の絞り込み',
        'phone-filter-toggle',
        () => phone.send({ kind: '構築の絞り込みを開閉' }),
      ),
    )
  }
  if (phone === undefined || phone.state.builderFilter) left.append(filterPanelElement(view, handlers))
  const detailPanel =
    phone === undefined
      ? poolDetailPanelElement(view.pinned === undefined ? undefined : view.detail(view.pinned), view, handlers)
      : undefined
  if (detailPanel !== undefined) left.append(detailPanel)

  // カーソルを合わせている間は仮に出し、離れたらクリックで決めたものに戻す。**描き直さない**——
  // 一覧を丸ごと作り直すほどのことではない。
  const detailBody = detailPanel?.querySelector<HTMLElement>('.detail') ?? null
  const showPinned = (): void => {
    if (detailBody !== null) fillPoolDetail(detailBody, view.pinned === undefined ? undefined : view.detail(view.pinned))
  }
  const hover = (key: string): void => {
    if (detailBody !== null) fillPoolDetail(detailBody, view.detail(key))
  }

  // 中央列：カード一覧。
  const center = element('div', 'column column--center')
  const tools = element('div', 'panel__aside panel__aside--tools')
  const count = element('span', '')
  count.append(element('strong', '', String(view.pool.length)), ` / ${view.poolTotal} 種`)
  tools.append(count, viewSwitchElement(view.poolView, handlers.onPoolView))
  const poolPanel = sectionPanel('', 'カード一覧', tools)
  const poolList = poolListElement(view, handlers, hover)
  poolList.addEventListener('mouseleave', showPinned)
  poolPanel.append(poolList)
  center.append(poolPanel)

  // 右列：デッキ。
  const right = element('div', 'column column--right')
  const deckAside = element('span', 'panel__aside')
  deckAside.append(element('strong', '', String(view.count)), ' 枚')
  const deckPanel = sectionPanel('panel--deck', 'デッキ', deckAside)
  const breakdown = element('div', 'breakdown')
  breakdown.append(levelBreakdownElement(view.levelBars), typeCountsElement(view.typeCounts, view.starTotal))
  deckPanel.append(breakdown)
  deckPanel.append(checkElement(view.check))
  if (view.refusal !== undefined) deckPanel.append(element('p', 'refusal', `行えませんでした: ${view.refusal}`))

  const deckListHead = element('div', 'decklist__head')
  deckListHead.append(element('span', '', 'カード'), element('span', '', '枚数'))
  deckPanel.append(deckListHead)
  const deckList = element('div', 'decklist rows')
  deckList.dataset[KEEP_SCROLL] = 'デッキ'
  if (view.deck.length === 0) deckList.append(element('p', 'pool__none', 'まだカードが入っていません'))
  let unusableOrdinal = 0
  for (const row of view.deck) {
    if (row.kind === '使える') {
      deckList.append(poolCardRowElement(row, row.key === view.pinned, handlers, hover, false, view.phone))
    } else {
      unusableOrdinal += 1
      deckList.append(unusableCardRowElement(row.key, row.count, unusableOrdinal, handlers))
    }
  }
  deckList.addEventListener('mouseleave', showPinned)
  deckPanel.append(deckList)

  const savebar = element('div', phone === undefined ? 'savebar' : 'phonebar')
  // 一度も保存していない新しいデッキは、触っていなくても「保存しました」とは言えない。
  const saveState = view.unsaved ? '保存していない変更があります' : view.saved ? '保存しました' : ''
  const save = button('保存する', handlers.onSave, true)
  save.toggleAttribute('disabled', !view.savable)
  if (phone === undefined) {
    savebar.append(element('span', `savebar__state${view.unsaved ? ' savebar__state--未保存' : ''}`, saveState), save)
    deckPanel.append(savebar)
  } else {
    // スマートフォンでは、枚数と保存を画面の下の帯に出し、どちらのタブでも見えるようにする（ADR-0034）。
    // デッキの枚数は形式で決まった枚数が無いので、いまの枚数だけを出す。
    const total = element('span', 'phonebar__count')
    total.append(element('strong', '', String(view.count)), ' 枚')
    savebar.append(total, element('span', `savebar__state${view.unsaved ? ' savebar__state--未保存' : ''}`, saveState), save)
  }
  right.append(deckPanel)

  // 「カードを探す」のタブが出すのは左と真ん中の列、「デッキ」のタブが出すのは右の列。
  if (phone !== undefined) {
    phoneTabpanel(left, BUILDER_TABS, '探す', 0)
    phoneTabpanel(center, BUILDER_TABS, '探す', 1)
    phoneTabpanel(right, BUILDER_TABS, 'デッキ', 0)
  }

  columns.append(left, center, right)
  node.append(columns)
  if (phone !== undefined) node.append(savebar)

  if (phone !== undefined && phone.state.sheetCard !== undefined) {
    const sheet = cardSheetElements(view, handlers, phone, phone.state.sheetCard)
    if (sheet !== undefined) node.append(...sheet)
  }

  if (view.modal === '解説') node.append(descriptionModalElement(view, handlers))

  return node
}

/** 公開の段階を選ぶところ（ADR-0022）。**選べるのは 2 つだけ**なので、`select` ではなくボタンで選ばせる。 */
function visibilityPicker(chosen: ShareVisibility, onVisibility: (visibility: ShareVisibility) => void): HTMLElement {
  const node = element('div', 'share__visibility')
  node.append(element('span', 'share__visibility-label', '公開の段階'))
  const options: readonly ShareVisibility[] = ['リンクを知っている人だけ', '一覧に載せる']
  for (const option of options) node.append(chip([option], option === chosen, () => onVisibility(option)))

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
  for (const option of orders) orderRow.append(chip([option], option === order, () => handlers.onOrder(option)))
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
): HTMLElement {
  const node = element('section', 'naming')
  node.append(element('h1', 'naming__brand', 'プロレヴォオンライン'))

  const panel = element('div', 'panel')
  const head = element('div', 'panel__head')
  head.append(element('h2', 'panel__title', 'プレイヤー名'))
  const body = element('div', 'panel__body')
  body.append(element('p', 'naming__lead', '他のプレイヤーに公開される名前です。後から変えられます'))

  const input = document.createElement('input')
  input.className = 'naming__input'
  input.type = 'text'
  input.maxLength = DISPLAY_NAME_LIMIT
  input.placeholder = '名前'
  input.value = draft

  // 数え方はサーバに合わせる（`countName`）。入力欄の `maxLength` は UTF-16 の単位なので、絵文字では食い違う。
  const count = element('span', 'naming__count')
  count.id = 'naming-count'
  input.setAttribute('aria-describedby', count.id)
  const syncCount = (): void => {
    const { length, full } = countName(input.value)
    count.textContent = `${length} / ${DISPLAY_NAME_LIMIT}`
    count.classList.toggle('naming__count--full', full)
  }
  syncCount()

  input.addEventListener('input', () => {
    syncCount()
    handlers.onDraft(input.value)
  })
  // 打ち終わってそのまま押せるようにする。**押す口も残す**——鍵盤が出ている画面では、
  // Enter が送るものだと読み取れないことがある。
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') handlers.onDecide(input.value)
  })

  const field = element('div', 'naming__field')
  field.append(input)
  // 押した時の入力欄の中身を読む。渡された `draft` は描き直した時点の値である（`lobbyElement`）。
  field.append(button('これにする', () => handlers.onDecide(input.value), true))
  body.append(field, count)

  if (reason !== undefined) body.append(element('p', 'naming__refusal', reason))
  panel.append(head, body)
  node.append(panel)

  return node
}

/**
 * 部屋に入って相手を待っている間の画面（ADR-0030）。待っている間にやめてロビーへ戻れる（#175）。
 *
 * 部屋の名前やルールは出さない。この画面の状態が持っているのは部屋の符号だけである。
 */
export function awaitingElement(onLeave: () => void): HTMLElement {
  const node = element('section', 'awaiting')
  const panel = element('div', 'panel')
  const body = element('div', 'panel__body')
  body.append(element('h2', 'awaiting__title', '相手を待っています'))
  body.append(button('やめてロビーに戻る', onLeave))
  panel.append(body)
  node.append(panel)

  return node
}

/** ロビーに戻る口（#175）。レシピの画面と、投げ出せる対戦の操作欄に出す。 */
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
 * パネルに出す手のボタンは、カードを選んでいない間の優先権の放棄だけである。カードを選んだ後の手は、
 * 行き先（盤面）とダイアログ（`askElement`）で出す。
 */
export function pickElement(view: PickView, handlers: PickHandlers, aside?: HTMLElement): HTMLElement {
  const node = element('section', 'actions')
  node.append(titleRow('actions__title', '行える手', aside))

  if (view.guide !== undefined) node.append(element('p', 'actions__none', view.guide))

  const list = element('div', 'actions__list')
  for (const view_ of view.untargeted) {
    list.append(button(view_.label, () => handlers.onAction(view_.action), view_.primary))
  }
  node.append(list)

  if (view.picked !== undefined) {
    const back = element('div', 'choice__back')
    // 選択中の「この行動をやめる」（始めた行動を取り消す）と区別する。こちらは押す前の選びかけを
    // 外すだけで、何も送らない。
    back.append(button('カードの選択をやめる', handlers.onCancel))
    node.append(back)
  }

  return node
}

/** 聞くダイアログで押せるもの。 */
export interface AskHandlers {
  readonly onChoose: (option: AskOption) => void
  /** やめる。ダイアログを閉じて、カードを選んでいない状態に戻る。何も送らない。 */
  readonly onCancel: () => void
}

/**
 * 選んだカードの手を聞くダイアログ（#249）。画面の中に重ねる。ブラウザの確認ダイアログは
 * 使わない（`confirmElement` と同じ）。
 *
 * 手が 1 つなら確認（左にキャンセル、右に手）、2 つ以上なら選ぶ（手を縦に並べ、最後にキャンセル）。
 * 見出し（カード名）と何を聞いているかは、読み上げに結び付ける。最初の手に手を置く——デッキ構築の
 * 確認は戻せないことを聞くのでキャンセルに置くが、ここは手を行うために出しているので、Enter で
 * そのまま進める。Esc・暗くしたところを押すのは、キャンセルと同じ。
 *
 * 手を送ったあとは、返事（盤面など）が届いて描き直されるまで、このダイアログは古い画面のまま残る。
 * その間に押されると 2 通目が送られ、サーバに断られて「行えませんでした」が出るので、送った時点で
 * すべてのボタンを押せなくし、通信中であることを出す。送った手は取り消せないので、キャンセルも
 * Esc も効かせない。アニメーションは使わない（描き直しで作り直されるため、ADR-0027）。
 */
export function askElement(view: AskView, handlers: AskHandlers): HTMLElement {
  const layer = element('div', 'dialog')
  const box = element('div', 'dialog__box')
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-modal', 'true')
  const title = element('h2', 'dialog__title', view.heading)
  title.id = 'dialog-title'
  const lead = element('p', 'dialog__lead', view.lead)
  lead.id = 'dialog-lead'
  // 見出しが場所の名前のときだけ、そこにあるカードの名前を見出しと聞く文の間に置く。
  const subject = view.subject === undefined ? undefined : element('p', 'dialog__subject', view.subject)
  if (subject !== undefined) subject.id = 'dialog-subject'
  box.setAttribute('aria-labelledby', title.id)
  box.setAttribute('aria-describedby', subject === undefined ? lead.id : `${subject.id} ${lead.id}`)
  // 送っている間の表示の場所。読み上げに伝わるよう、中身が空のうちから置いておく。
  const sending = element('p', 'dialog__sending')
  sending.setAttribute('role', 'status')
  box.append(title, ...(subject === undefined ? [] : [subject]), lead, sending)

  let sent = false
  // 手を置ける箱にする（Tab の止まる先には加えない）。送ったあと、押せなくしたボタンから手を移す先。
  box.tabIndex = -1
  const onSent = (): void => {
    sent = true
    // ボタンを押せなくすると、そこにあった手が外れる。先に箱へ移して、「通信中…」を読み上げさせる。
    if (box.contains(document.activeElement)) box.focus({ preventScroll: true })
    box.setAttribute('aria-busy', 'true')
    sending.textContent = '通信中…'
    for (const each of box.querySelectorAll('button')) each.disabled = true
  }
  const choose = (option: AskOption): HTMLElement =>
    button(
      option.label,
      () => {
        if (sent) return
        // 行き先を絞るだけの選択肢は何も送らず、すぐ描き直されるので、待つことが無い。
        if ('send' in option) onSent()
        handlers.onChoose(option)
      },
      view.options.length === 1,
    )
  const onCancel = (): void => {
    if (!sent) handlers.onCancel()
  }
  const cancel = button('キャンセル', onCancel)
  const first = view.options[0]
  if (view.options.length === 1 && first !== undefined) {
    const row = element('div', 'dialog__row')
    row.append(cancel, choose(first))
    box.append(row)
  } else {
    const actions = element('div', 'dialog__actions')
    for (const option of view.options) actions.append(choose(option))
    const foot = element('div', 'dialog__cancel')
    foot.append(cancel)
    box.append(actions, foot)
  }
  layer.append(box)

  // Esc は、手がどこにあっても一番上の層が受ける（`index.ts` の窓全体の Esc が、ここへ回す）。
  onLayerEscape(layer, onCancel)
  ignoreKeyRepeat(layer)
  // 重ねた層の外側（暗くしたところ）を押しても、やめる。
  layer.addEventListener('click', (event) => {
    if (event.target === layer) onCancel()
  })
  // 手を置くのは、開いたときの 1 回だけ（`dialog-focus.ts`）。ここで毎回置くと、描き直すたびに先頭へ戻る。

  return layer
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
 *
 * `onLeave` を渡すと、決着の帯の下、画面の中央下部に「ロビーに戻る」を出す（ADR-0027）。
 * 決着した後に押すのはこれだけなので、左の列の操作パネルではなく目に入る所に置く。層は
 * 押せない作りなので、このボタンだけ押せるようにしてある（`style.css` の `.result__leave`）。
 */
export function overlayElement(overlay: Overlay, result?: ResultView, onLeave?: () => void): HTMLElement {
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
  if (result !== undefined && onLeave !== undefined) {
    const leave = element('div', 'result__leave')
    leave.append(button('ロビーに戻る', onLeave, true))
    node.append(leave)
  }

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

/** 立ち絵の場所に置く、胸から上のシルエット（画像は使わない、ADR-0027）。塗りは `style.css` が決める。 */
function silhouetteElement(): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 100 100')
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute(
    'd',
    'M50 18c-11 0-19 8-19 19 0 7 3 13 8 16-2 3-5 5-10 6-11 3-17 12-19 24l-1 17h82l-1-17c-2-12-8-21-19-24-5-1-8-3-10-6 5-3 8-9 8-16 0-11-8-19-19-19z',
  )
  svg.append(path)

  return svg
}

/**
 * プレイヤーの枠（ADR-0027）。立ち絵の場所（胸から上のシルエット）・名前・ダメージを置く。
 *
 * パートナーゾーンが空ならパートナーの場所ごと詰める——パートナーバトルでない対局では
 * このゾーンが常に空になるので、呼ぶ側で対局の形式を気にしなくてよい。
 */
function playerPanelElement(side: SideView, name: string, picking: BoardPicking | undefined): HTMLElement {
  const node = element('section', `panel player player--${side.whose}`)
  const tag = `${side.whose}・${side.player}`
  node.setAttribute('aria-label', tag)

  const portrait = element('div', 'player__portrait')
  portrait.setAttribute('aria-hidden', 'true')
  portrait.append(silhouetteElement())
  node.append(portrait)

  const body = element('div', 'player__body')
  body.append(element('span', 'player__whose', tag))
  body.append(element('p', 'player__name', name))
  const damageLine = element('p', 'player__damage', 'ダメージ ')
  damageLine.append(element('strong', '', String(side.damage)))
  body.append(damageLine)
  node.append(body)

  const partner = partnerOf(side)
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
  if (whose === '自分') inRegion(node, 'hand')
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

/** 一覧の問いの文の `id`。一覧が重なっても、同じ `id` を持たないようにする。 */
let pickerSequence = 0

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
  sending?: HTMLElement,
  /** Esc を押したときの動き。手がどこにあっても、一番上の層が受ける（ADR-0033）。 */
  onEscape?: () => void,
): HTMLElement {
  const node = element('div', `picker picker--${kind}`)
  node.setAttribute('role', 'dialog')
  node.setAttribute('aria-modal', 'true')
  node.setAttribute('aria-label', title)
  // 手を置ける箱にする（Tab の止まる先には加えない）。
  node.tabIndex = -1
  if (onEscape !== undefined) onLayerEscape(node, onEscape)
  ignoreKeyRepeat(node)

  const box = element('div', 'picker__box')
  const head = element('div', 'picker__head')
  head.append(element('h2', 'picker__title', title))
  if (lead !== undefined) {
    const leadNode = element('p', 'picker__lead', lead)
    // 続けて届いた選択で問いの文が変わっても、読み上げで伝わるように、箱の説明に結ぶ。
    leadNode.id = `picker-lead-${++pickerSequence}`
    node.setAttribute('aria-describedby', leadNode.id)
    head.append(leadNode)
  }
  if (sending !== undefined) head.append(sending)
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

  return pickerElement('見る', `${zone.zone}（${zone.count}）`, '上にあるカードほど後から置かれたカード', cards, foot, undefined, onClose)
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
 *
 * 候補が全部能力のとき（`isAbilityChoice`、ADR-0031）は、カードの面のかわりに文字の札を並べる。
 * 呼び名は `abilityLabels` が候補と同じ並びで渡す。
 *
 * 答えを送ったあとは、返事が届いて描き直されるまで、すべての押す先を押せなくして「通信中…」を
 * 出す（ADR-0031）。残ったままの一覧で押されると、2 通目がサーバに断られる。
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
  rawHandlers: ChoosePickerHandlers,
  abilityLabels: readonly string[] = [],
): HTMLElement {
  const sending = element('p', 'picker__sending')
  sending.setAttribute('role', 'status')
  let sent = false
  let root: HTMLElement | undefined
  const lock = (): void => {
    sent = true
    // 押せなくしたボタンから手が外れる。先に一覧の箱へ移して、「通信中…」を読み上げさせる。
    if (root?.contains(document.activeElement) === true) root.focus({ preventScroll: true })
    sending.textContent = '通信中…'
    // `role="dialog"` を持つ外側の要素に付ける（確認ダイアログと同じ、`askElement`）。
    root?.setAttribute('aria-busy', 'true')
    for (const each of root?.querySelectorAll<HTMLElement>('button, [role="button"]') ?? []) {
      if (each instanceof HTMLButtonElement) {
        each.disabled = true
        continue
      }
      each.setAttribute('aria-disabled', 'true')
      // 押せなくしたあとも「押せます」と読み上げない。選びかけの「（選択中）」は残す。
      const label = each.getAttribute('aria-label')
      if (label !== null) each.setAttribute('aria-label', label.replace('（押せます）', ''))
    }
  }
  const once =
    <Args extends unknown[]>(run: (...args: Args) => void) =>
    (...args: Args): void => {
      if (sent) return
      lock()
      run(...args)
    }
  const handlers: ChoosePickerHandlers = {
    // 選びかけは何も送らない。もう送ったあとは動かさない。
    onPick: (index) => {
      if (!sent) rawHandlers.onPick(index)
    },
    onConfirm: once(rawHandlers.onConfirm),
    onDecline: once(rawHandlers.onDecline),
    onRewind: once(rawHandlers.onRewind),
    onCancel: once(rawHandlers.onCancel),
  }

  const abilityOnly = candidates.length > 0 && candidates.every(({ candidate }) => candidate.kind === '能力')
  const cards = candidates.map(({ index, candidate }) => {
    const isPicked = picked === index
    const how = isPicked ? '（選択中）' : '（押せます）'
    const node =
      candidate.kind === '能力'
        ? (() => {
            const built = element('div', 'picker__ability', abilityLabels[index] ?? '発生源のない能力')
            built.setAttribute('aria-label', `${abilityLabels[index] ?? '発生源のない能力'}${how}`)
            // 乗せた・フォーカスした札の発生源のカードを、右の列の詳細に出す（`wireCardDetailHover`）。
            // 何をする能力かは通信に載らないので、出せるのはカードのテキストまでである。
            if (candidate.source !== undefined) built.dataset.cardId = candidate.source
            return built
          })()
        : candidate.kind === '見えている'
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

    // 能力の札は文字だけなので、カードの面の光り方（`card--`）ではなく専用の見た目にする。
    const isAbility = candidate.kind === '能力'
    node.classList.add(isAbility ? 'picker__ability--押せる' : 'card--押せる')
    node.classList.toggle(isAbility ? 'picker__ability--選択中' : 'card--選択中', isPicked)
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
  // 何枚目を選んでいるかは、カードを何枚か選ばせる場面の情報である。能力を選ぶ場面では意味が
  // 無いので出さない（ADR-0031）。
  if (!abilityOnly) foot.append(element('span', 'picker__count', `${answered + 1} 枚目を選んでいます`))
  if (mayDecline) foot.append(button('選ばない', handlers.onDecline))
  if (mayRewind) foot.append(button('ひとつ戻る', handlers.onRewind))
  if (mayCancel) foot.append(button('この行動をやめる', handlers.onCancel))
  const decide = button('これに決める', () => {
    if (picked !== undefined) handlers.onConfirm(picked)
  })
  decide.classList.add('button--primary')
  decide.toggleAttribute('disabled', picked === undefined)
  foot.append(decide)

  // Esc は、選びかけを外すだけにする。行動そのものを取り消すのは「この行動をやめる」を押したときだけで、
  // Esc 1 回で行動全体を取り消さない（ADR-0033）。
  root = pickerElement('選ぶ', '候補から選ぶ', asking, cards, foot, sending, () => {
    if (picked !== undefined) handlers.onPick(undefined)
  })
  // 能力の札は文字だけなので、枠の幅は中身に合わせて狭める（ADR-0031）。
  if (abilityOnly) root.classList.add('picker--ability')

  return root
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
  /**
   * 操作のしかたがクリックか（演出・繋がっていない間も含む）。キーボードの配線（盤面の区画・矢印キー・
   * DOM の順）はクリックモードにだけ掛ける。ボタンモードは変えない（ADR-0033）。
   */
  readonly clickMode: boolean
  readonly onOpenPile: (player: Player, zone: '捨札' | 'リムーブゾーン') => void
  /** 開いている「見る」一覧。無ければ `undefined`。 */
  readonly viewingPile?: HTMLElement
  /** 開いている「選ぶ」一覧。無ければ `undefined`。 */
  readonly choosePicker?: HTMLElement
  /** 選んだカードの手を聞くダイアログ（#249）。無ければ `undefined`。 */
  readonly dialog?: HTMLElement
  /** 演出・決着の層。出すものが無ければ `undefined`。 */
  readonly overlay?: HTMLElement
  /** 表側が見えているカードすべて（`view-model.ts` の `visibleCardViewsIn`）。詳細の配線に使う。 */
  readonly cardsById: ReadonlyMap<CardId, CardView>
  /**
   * カードの詳細の既定に出すカード。盤面で選んでいるカード（`picking.picked`）のかわりに使う。
   * 能力を選ぶ一覧で選びかけの札があるとき、その発生源のカードを出す（ADR-0031）。
   */
  readonly detailDefault?: CardId
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
  left.append(playerPanelElement(view.opponent, props.opponentName, props.picking))

  const controls = element('section', 'panel controls')
  controls.append(element('p', 'controls__turn', view.turnNumber))
  controls.append(element('p', 'controls__priority', view.priority))
  controls.append(phasesElement(view.phases))
  const actions = element('div', 'controls__actions')
  for (const child of props.controlsChildren) actions.append(child)
  controls.append(actions)
  left.append(controls)

  left.append(playerPanelElement(view.own, props.ownName, props.picking))

  const center = element('section', 'duel__center')
  center.setAttribute('aria-label', '盤面')
  // 区画の中に手を置ける先が無いときの、手の戻し先（`board-keyboard.ts`）。Tab の止まる先には加えない。
  if (props.clickMode) center.tabIndex = -1
  const opponentHand = handElement('相手', zoneOf(view.opponent, '手札'), props.picking)
  const procedure = procedureElement(view.battle, view.smashJudgments)
  const board = boardGridElement(view, props.picking, props.onOpenPile, props.clickMode)
  const ownHand = handElement('自分', zoneOf(view.own, '手札'), props.picking)
  // クリックモードでは、自分の手札を盤面より先に置く。キーボードでたどる順を、手札 → 盤面にするため
  // （行は `style.css` で決めているので、画面の位置は動かない、ADR-0033）。
  if (props.clickMode) center.append(ownHand, procedure, board, opponentHand)
  else center.append(opponentHand, procedure, board, ownHand)
  // クリックモードでは、DOM の順を盤面 → 左の列 → 右の列にする。キーボードでたどる順を、盤面の
  // あとに操作パネルにするため（`style.css` の `order` で画面の位置は動かさない、ADR-0033）。
  // ボタンモードは、これまでの順（左の列が先）のまま。
  if (props.clickMode) root.append(center, left)
  else root.append(left, center)

  const right = element('aside', 'duel__right')
  right.append(logElement(view.log))
  const detail = detailPanelElement()
  right.append(detail)
  root.append(right)

  if (props.overlay !== undefined) root.append(props.overlay)
  if (props.viewingPile !== undefined) root.append(props.viewingPile)
  if (props.choosePicker !== undefined) root.append(props.choosePicker)
  if (props.dialog !== undefined) root.append(props.dialog)

  if (props.clickMode) wireBoardKeyboard(root)
  wireCardDetailHover(root, detail, props.cardsById, props.detailDefault ?? props.picking?.picked)

  // 押せるもの以外のところを押したら、選びかけを外す（#249）。押せるカードを押した時は、その
  // カードが次の選択になるので外さない。
  const onBlank = props.picking?.onBlank
  if (onBlank !== undefined) {
    root.addEventListener('click', (event) => {
      if (!keepsPicking(event.target)) onBlank()
    })
  }

  return root
}
