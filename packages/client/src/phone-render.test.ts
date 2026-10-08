// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { WirePoolCard } from '@revolution/engine'
import {
  checkView,
  deckRows,
  filterOwnedDeckRows,
  levelBreakdownOf,
  newDraft,
  poolRows,
  starTotalOf,
  typeCountsOf,
} from './deck-builder.js'
import type { LobbyDeck, OwnedDeckRow } from './deck-builder.js'
import { deckEditorElement, deckListElement, lobbyElement } from './render.js'
import type { DeckEditorHandlers, DeckEditorView, DeckListHandlers, DeckListView, LobbyHandlers, LobbyView } from './render.js'
import { initialPhone, reducePhone } from './phone.js'
import type { PhoneAction, PhoneControl, PhoneState } from './phone.js'
import { emptyFilter, filterChoicesOf } from './pool-filter.js'
import { strategyFace, unitFace } from './test-support.js'

/**
 * 描く側の DOM（ADR-0034）。スマートフォンの状態が渡されなければ（PC の幅）スマートフォン用の部品は作らず、
 * 渡されたら、シートの中の手の動きとタブ・表の読み上げの結び付きが付く。
 */

const POOL: readonly WirePoolCard[] = [
  { key: 'a', face: unitFace('テスト・赤のユニット', { colors: ['赤'], level: 1 }), expansions: [] },
  { key: 'b', face: strategyFace('テスト・ストラテジー'), expansions: [] },
]

/** 押された動きを覚えておくだけの窓口。状態は動かさない（描き直しは呼ぶ側の仕事）。 */
function phoneOf(state: PhoneState): { readonly phone: PhoneControl; readonly sent: PhoneAction[] } {
  const sent: PhoneAction[] = []

  return { phone: { state, send: (action) => void sent.push(action) }, sent }
}

function deck(id: string, name: string): LobbyDeck {
  return { id, name, cover: undefined, colors: [], labels: [], manageable: false, hasUnusable: false, faces: undefined, refusal: undefined }
}

function lobbyHandlers(): LobbyHandlers & { readonly onDeck: Mock<(deck: string) => void> } {
  return {
    onCreate: vi.fn(),
    onJoin: vi.fn(),
    onName: vi.fn(),
    onDeck: vi.fn<(deck: string) => void>(),
    onCpuDeck: vi.fn(),
    onFormat: vi.fn(),
    onRestriction: vi.fn(),
    onDeckPage: vi.fn(),
    onMenu: vi.fn(),
    onRoomTab: vi.fn(),
    onRoomQuery: vi.fn(),
    onRoomPage: vi.fn(),
  }
}

function lobbyView(phone: PhoneControl | undefined): LobbyView {
  return {
    own: 'テスト',
    rooms: [
      {
        code: 'room-1',
        name: 'テスト部屋',
        status: '待機中',
        joinable: true,
        seats: ['テスト太郎', undefined],
        rules: undefined,
        refusal: undefined,
      },
    ],
    name: '',
    decks: [deck('d1', '一つ目のデッキ'), deck('d2', '二つ目のデッキ'), deck('d3', '三つ目のデッキ')],
    chosenDeck: 'd1',
    chosenCpuDeck: 'd1',
    restrictions: [],
    rules: { format: undefined, restriction: undefined },
    deckPage: 0,
    menu: undefined,
    roomTab: 'すべて',
    roomQuery: '',
    roomPage: 0,
    waiting: false,
    phone,
  } as LobbyView
}

const noop = (): void => undefined
/** 呼ばれたものを数えず、何も起こさない取っ手。`deckActions` のような「あれば出る」ものは持たない型に限って使う。 */
function stub<T extends object>(): T {
  return new Proxy({}, { get: () => noop }) as T
}

function listView(phone: PhoneControl | undefined): DeckListView {
  const decks: OwnedDeckRow[] = [
    { id: 'o1', name: '自分のデッキ', description: '', count: 0, cover: undefined, colorCounts: [], labels: [], hasUnusable: false },
  ]

  return {
    decks: filterOwnedDeckRows(decks, '', [], []),
    total: decks.length,
    allColors: [],
    allLabels: [],
    search: '',
    colorFilter: [],
    labelFilter: [],
    presets: [{ id: 'p1', name: '既製のデッキ', cover: undefined }],
    waiting: false,
    refusal: undefined,
    phone,
  }
}

function editorView(phone: PhoneControl | undefined): DeckEditorView {
  const draft = { ...newDraft(), cards: ['a'] }

  return {
    name: draft.name,
    editingName: undefined,
    saved: false,
    description: '',
    count: draft.cards.length,
    unsaved: true,
    savable: true,
    check: checkView(draft, false, [], POOL),
    pool: poolRows(POOL, draft),
    poolTotal: POOL.length,
    poolView: 'カード',
    poolShown: POOL.length,
    filter: emptyFilter(),
    filterChoices: filterChoicesOf(POOL),
    filterOpen: false,
    openFolds: new Set(),
    detailOpen: true,
    deck: deckRows(POOL, draft),
    detail: () => undefined,
    pinned: undefined,
    restrictions: [],
    rules: { format: undefined, restriction: undefined },
    refusal: undefined,
    labels: [],
    levelBars: levelBreakdownOf(POOL, draft),
    typeCounts: typeCountsOf(POOL, draft),
    starTotal: starTotalOf(POOL, draft),
    modal: undefined,
    phone,
  } as DeckEditorView
}

/** スマートフォンの部品が持つ印。どれか 1 つでも PC の DOM にあってはならない。 */
const PHONE_PARTS = [
  '.phone-only',
  '.phone-tab',
  '.phone-toggle',
  '.phone-sheet',
  '.phone-sheet-backdrop',
  '.lobby__sheet',
  '.phonebar',
  '[data-phone-sheet]',
  '[data-phone-opener]',
  '[data-phone-mode]',
  '[role="tablist"]',
  '[role="tab"]',
  '[role="tabpanel"]',
  '[class*="deckbuild--tab-"]',
].join(',')

function keydown(target: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  target.dispatchEvent(event)

  return event
}

describe('PC の幅（スマートフォンの状態が渡されない）では、スマートフォン用の部品を作らない', () => {
  it('ロビー', () => {
    const node = lobbyElement(lobbyView(undefined), lobbyHandlers())
    expect(node.querySelectorAll(PHONE_PARTS)).toHaveLength(0)
    // PC の 3 列に並べるものは、全部ある。
    expect(node.querySelector('.lobby__decks-panel')).not.toBeNull()
    expect(node.querySelector('.lobby__mode--human')).not.toBeNull()
    expect(node.querySelector('.lobby__mode--cpu')).not.toBeNull()
    expect(node.querySelector('.lobby__rooms-panel')).not.toBeNull()
  })

  it('デッキ一覧。既製デッキの欄は左の列の下にある', () => {
    const node = deckListElement(listView(undefined), stub<DeckListHandlers>())
    expect(node.querySelectorAll(PHONE_PARTS)).toHaveLength(0)
    const left = node.querySelector('.column--left')
    expect(left?.textContent).toContain('既製デッキからコピーして作る')
    expect(node.querySelector('.column--center')?.textContent).not.toContain('既製デッキからコピーして作る')
  })

  it('デッキ構築', () => {
    const node = deckEditorElement(editorView(undefined), stub<DeckEditorHandlers>())
    expect(node.querySelectorAll(PHONE_PARTS)).toHaveLength(0)
    expect(node.querySelector('.savebar')).not.toBeNull()
  })
})

describe('ロビーのデッキのシート（ADR-0034）', () => {
  function openedSheet(): {
    readonly node: HTMLElement
    readonly handlers: ReturnType<typeof lobbyHandlers>
    readonly sent: PhoneAction[]
    readonly rows: readonly Element[]
  } {
    const { phone, sent } = phoneOf(reducePhone(initialPhone(), { kind: 'デッキのシートを開く', opener: 'ロビーのデッキの変更' }))
    const handlers = lobbyHandlers()
    const node = lobbyElement(lobbyView(phone), handlers)

    return { node, handlers, sent, rows: [...node.querySelectorAll('.lobby__sheet [role="radio"]')] }
  }

  it('シートを開いている間は、シートがダイアログとして出る', () => {
    const { node, rows } = openedSheet()
    expect(node.querySelector('.lobby__sheet')?.getAttribute('role')).toBe('dialog')
    expect(rows).toHaveLength(3)
  })

  it('矢印キーでは選択だけが隣へ移り、シートは閉じない', () => {
    const { handlers, sent, rows } = openedSheet()
    const first = rows[0]
    if (first === undefined) throw new Error('デッキの行が無い')

    expect(keydown(first, 'ArrowDown').defaultPrevented).toBe(true)
    expect(handlers.onDeck).toHaveBeenCalledWith('d2')
    expect(sent).toEqual([])
  })

  it.each([
    ['Enter', (row: Element) => keydown(row, 'Enter')],
    ['Space', (row: Element) => keydown(row, ' ')],
    ['クリック', (row: Element) => row.dispatchEvent(new MouseEvent('click', { bubbles: true }))],
  ])('%s で選ぶと選んだうえでシートを閉じる', (_name, act) => {
    const { handlers, sent, rows } = openedSheet()
    const second = rows[1]
    if (second === undefined) throw new Error('デッキの行が無い')

    act(second)
    expect(handlers.onDeck).toHaveBeenCalledWith('d2')
    expect(sent).toEqual([{ kind: 'デッキのシートを閉じる' }])
  })
})

describe('タブと中身の読み上げでの結び付き（ADR-0034）', () => {
  /** タブが指す中身が全部あり、中身はタブを名前の元にしている。 */
  function expectTabsTied(node: HTMLElement): void {
    const tabs = [...node.querySelectorAll('[role="tab"]')]
    expect(tabs.length).toBeGreaterThan(0)
    for (const tab of tabs) {
      const controls = (tab.getAttribute('aria-controls') ?? '').split(' ').filter((id) => id !== '')
      expect(controls.length).toBeGreaterThan(0)
      for (const id of controls) {
        const panel = node.querySelector(`[id="${id}"]`)
        expect(panel?.getAttribute('role')).toBe('tabpanel')
        expect(panel?.getAttribute('aria-labelledby')).toBe(tab.id)
      }
    }
    // 中身のほうも、どれかのタブに指されている。
    const controlled = new Set(tabs.flatMap((tab) => (tab.getAttribute('aria-controls') ?? '').split(' ')))
    for (const panel of node.querySelectorAll('[role="tabpanel"]')) expect(controlled.has(panel.id)).toBe(true)
  }

  it('ロビーの対人戦・CPU戦', () => {
    expectTabsTied(lobbyElement(lobbyView(phoneOf(initialPhone()).phone), lobbyHandlers()))
  })

  it('デッキ構築のカードを探す・デッキ', () => {
    expectTabsTied(deckEditorElement(editorView(phoneOf(initialPhone()).phone), stub<DeckEditorHandlers>()))
  })
})

describe('部屋の一覧の読み上げ（ADR-0034）', () => {
  it('表の役割が明示され、参加のボタンの名前に部屋名が結び付いている', () => {
    const node = lobbyElement(lobbyView(phoneOf(initialPhone()).phone), lobbyHandlers())
    const table = node.querySelector('table')
    expect(table?.getAttribute('role')).toBe('table')
    expect(table?.querySelectorAll('thead,tbody')).toHaveLength(2)
    for (const group of table?.querySelectorAll('thead,tbody') ?? []) expect(group.getAttribute('role')).toBe('rowgroup')
    for (const row of table?.querySelectorAll('tr') ?? []) expect(row.getAttribute('role')).toBe('row')
    for (const head of table?.querySelectorAll('th') ?? []) expect(head.getAttribute('role')).toBe('columnheader')
    for (const cell of table?.querySelectorAll('td') ?? []) expect(cell.getAttribute('role')).toBe('cell')
    expect(node.querySelector('.lobby__join')?.getAttribute('aria-label')).toBe('「テスト部屋」に参加する')
  })
})

describe('スマートフォンのデッキ一覧の DOM の順', () => {
  it('絞り込み → 自分のデッキ → 既製デッキの順で、見た目の順と同じ', () => {
    const node = deckListElement(listView(phoneOf(initialPhone()).phone), stub<DeckListHandlers>())
    const filter = node.querySelector('.phone-filter-toggle')
    const mine = node.querySelector('.column--center')
    const presets = [...node.querySelectorAll('.panel')].find((panel) => panel.textContent?.includes('既製デッキからコピーして作る'))
    if (filter === null || mine === null || presets === undefined) throw new Error('欄が足りない')

    const follows = (earlier: Element, later: Element): boolean => (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    expect(follows(filter, mine)).toBe(true)
    expect(follows(mine, presets)).toBe(true)
  })
})
