// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initialNotices } from './notices-view.js'
import { lobbyElement, nameElement } from './render.js'
import type { LobbyHandlers, LobbyView } from './render.js'

/*
 * 画面の部品を DOM に置いて確認する例（#242）。DOM が要るファイルだけが、先頭の
 * `@vitest-environment` で happy-dom を指定する。ほかのファイルの環境は変更されない。
 * スクロール位置・押下・日本語入力の変換のように本物のブラウザでしか起きないことは、
 * `browser-tests/` で確認する。
 */

afterEach(() => {
  document.body.replaceChildren()
})

describe('名前を決めるところ', () => {
  it('打ち込むと文字数の表示が更新され、「これにする」で打ち込んだ中身を渡す（ADR-0020）', () => {
    const onDraft = vi.fn()
    const onDecide = vi.fn()
    document.body.append(nameElement('', undefined, { onDraft, onDecide }))
    const input = document.querySelector<HTMLInputElement>('.naming__input')!

    input.value = 'なまえ'
    input.dispatchEvent(new Event('input'))
    document.querySelector<HTMLButtonElement>('.naming button')!.click()

    expect(document.querySelector('.naming__count')!.textContent).toMatch(/^3 \//)
    expect(onDraft).toHaveBeenLastCalledWith('なまえ')
    expect(onDecide).toHaveBeenCalledWith('なまえ')
  })
})

describe('ロビーの対戦部屋一覧', () => {
  it('相手を待っている部屋の「参加」を押すと、その部屋の合言葉を渡す', () => {
    const view: LobbyView = {
      own: 'じぶん',
      rooms: [
        {
          code: '架空の合言葉',
          name: '架空の部屋',
          status: '待機中',
          joinable: true,
          seats: ['あいて', undefined],
          rules: '',
          refusal: undefined,
        },
      ],
      name: '',
      decks: [],
      chosenDeck: undefined,
      chosenCpuDeck: undefined,
      restrictions: [],
      rules: { format: undefined, restriction: undefined },
      deckPage: 0,
      menu: undefined,
      roomTab: 'すべて',
      roomQuery: '',
      roomPage: 0,
      waiting: false,
      phone: undefined,
      notices: { state: initialNotices(), pending: undefined, send: vi.fn() },
    }
    const onJoin = vi.fn()
    const handlers: LobbyHandlers = {
      onCreate: vi.fn(),
      onJoin,
      onName: vi.fn(),
      onDeck: vi.fn(),
      onCpuDeck: vi.fn(),
      onFormat: vi.fn(),
      onRestriction: vi.fn(),
      onDeckPage: vi.fn(),
      onMenu: vi.fn(),
      onRoomTab: vi.fn(),
      onRoomQuery: vi.fn(),
      onRoomPage: vi.fn(),
    }
    document.body.append(lobbyElement(view, handlers))

    document.querySelector<HTMLButtonElement>('[aria-label="「架空の部屋」に参加する"]')!.click()

    expect(onJoin).toHaveBeenCalledWith('架空の合言葉')
  })
})
