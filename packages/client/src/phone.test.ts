import { describe, expect, it } from 'vitest'
import { initialPhone, isPhoneWidth, reducePhone, returnedToPhone, rulesSummaryOf, settlePhone, tabAfterKey, takePending } from './phone.js'

describe('スマートフォンの画面の中の状態（ADR-0034）', () => {
  it('テストの環境のように画面が無ければ、スマートフォンの幅ではない', () => {
    expect(isPhoneWidth()).toBe(false)
  })

  it('デッキのシートを開けば手は中へ、閉じれば開いた元へ戻す', () => {
    const opened = reducePhone(initialPhone(), { kind: 'デッキのシートを開く', opener: '変更' })
    expect(opened.deckSheet).toBe(true)
    expect(takePending(opened).pending).toEqual({ kind: 'シートの中へ' })

    const closed = reducePhone(takePending(opened).state, { kind: 'デッキのシートを閉じる' })
    expect(closed.deckSheet).toBe(false)
    expect(closed.pending).toEqual({ kind: '元へ', opener: '変更' })
    expect(closed.opener).toBeUndefined()
  })

  it('開いていないシートを閉じても、手を動かさない', () => {
    const state = initialPhone()
    expect(reducePhone(state, { kind: 'デッキのシートを閉じる' })).toBe(state)
    expect(reducePhone(state, { kind: 'カードのシートを閉じる' })).toBe(state)
  })

  it('手の置き直しは 1 度だけ渡す', () => {
    const opened = reducePhone(initialPhone(), { kind: 'カードのシートを開く', card: 'a', opener: 'カード-a' })
    const first = takePending(opened)
    expect(first.pending).toEqual({ kind: 'シートの中へ' })
    expect(takePending(first.state).pending).toBeUndefined()
  })

  it('カードのシートを開いたまま別のカードを開いても、戻る先は最初に開いた押せるもの', () => {
    const a = reducePhone(initialPhone(), { kind: 'カードのシートを開く', card: 'a', opener: 'カード-a' })
    const b = reducePhone(a, { kind: 'カードのシートを開く', card: 'b', opener: 'カード-b' })
    expect(b.sheetCard).toBe('b')
    expect(reducePhone(b, { kind: 'カードのシートを閉じる' }).pending).toEqual({ kind: '元へ', opener: 'カード-a' })
  })

  it('タブ・畳んだ欄は互いに別の状態で、開閉は往復する', () => {
    let state = initialPhone()
    state = reducePhone(state, { kind: 'デッキ構築のタブ', tab: 'デッキ' })
    state = reducePhone(state, { kind: '構築の絞り込みを開閉' })
    state = reducePhone(state, { kind: 'ロビーのモード', mode: 'CPU戦' })
    expect(state).toMatchObject({ builderTab: 'デッキ', builderFilter: true, lobbyMode: 'CPU戦', listFilter: false, builderSettings: false })

    state = reducePhone(reducePhone(state, { kind: '構築の設定を開閉' }), { kind: '構築の設定を開閉' })
    state = reducePhone(state, { kind: '構築の絞り込みを開閉' })
    expect(state.builderFilter).toBe(false)
    expect(state.builderSettings).toBe(false)
  })
})

describe('画面を離れたときの状態の整理', () => {
  const none = { lobby: false, deckList: false, editor: false }

  it('出している画面の状態は触らない（同じ値を返す）', () => {
    const state = reducePhone(initialPhone(), { kind: 'デッキのシートを開く', opener: '変更' })
    expect(settlePhone(state, { ...none, lobby: true })).toBe(state)
  })

  it('ロビーを離れたら、開いていたシートと選んでいたモードを最初に戻す', () => {
    let state = reducePhone(initialPhone(), { kind: 'デッキのシートを開く', opener: '変更' })
    state = reducePhone(state, { kind: 'ロビーのモード', mode: 'CPU戦' })
    const settled = settlePhone(state, none)
    expect(settled).toEqual(initialPhone())
  })

  it('デッキ構築を離れたら、タブ・畳んだ欄・シートを最初に戻し、手の置き直しも持ち越さない', () => {
    let state = reducePhone(initialPhone(), { kind: 'デッキ構築のタブ', tab: 'デッキ' })
    state = reducePhone(state, { kind: 'カードのシートを開く', card: 'a', opener: 'カード-a' })
    state = reducePhone(state, { kind: '構築の設定を開閉' })
    expect(settlePhone(state, { ...none, lobby: true, deckList: true })).toEqual(initialPhone())
  })

  it('デッキ一覧を離れたら、絞り込みを畳む', () => {
    const state = reducePhone(initialPhone(), { kind: '一覧の絞り込みを開閉' })
    expect(settlePhone(state, none).listFilter).toBe(false)
  })

  it('離れていなければ、持ち越した手の置き直しも消さない', () => {
    const state = reducePhone(initialPhone(), { kind: 'デッキのシートを開く', opener: '変更' })
    // ロビーは出していて、デッキ構築だけ出していない。ロビーのシートの手の置き直しは残る。
    expect(settlePhone(state, { ...none, lobby: true }).pending).toEqual({ kind: 'シートの中へ' })
  })
})

describe('タブの矢印キー', () => {
  const tabs = ['探す', 'デッキ'] as const

  it('右へは次、左へは前に移り、端からは一周する', () => {
    expect(tabAfterKey(tabs, '探す', 'ArrowRight')).toBe('デッキ')
    expect(tabAfterKey(tabs, 'デッキ', 'ArrowRight')).toBe('探す')
    expect(tabAfterKey(tabs, '探す', 'ArrowLeft')).toBe('デッキ')
  })

  it('Home・End は両端へ移る', () => {
    expect(tabAfterKey(tabs, 'デッキ', 'Home')).toBe('探す')
    expect(tabAfterKey(tabs, '探す', 'End')).toBe('デッキ')
  })

  it('ほかのキーでは移らない', () => {
    expect(tabAfterKey(tabs, '探す', 'Enter')).toBeUndefined()
    expect(tabAfterKey(tabs, '探す', 'ArrowDown')).toBeUndefined()
  })
})

describe('デッキの設定の見出しに出す、いまの形式とリスト', () => {
  const lists = [
    { id: 'a', name: '第1期' },
    { id: 'b', name: '第2期' },
  ]

  it('選んでいなければ、選ぶところが出すのと同じ先頭を言う', () => {
    expect(rulesSummaryOf(['構築戦'], undefined, lists, undefined)).toBe('構築戦・第1期')
  })

  it('リストを選んでいればその名前、制限なしを選んでいれば制限なし', () => {
    expect(rulesSummaryOf(['構築戦'], '構築戦', lists, { kind: '禁止／制限リスト', id: 'b' })).toBe('構築戦・第2期')
    expect(rulesSummaryOf(['構築戦'], '構築戦', lists, { kind: '制限なし' })).toBe('構築戦・制限なし')
  })

  it('リストが 1 つも届いていなければ、制限なし', () => {
    expect(rulesSummaryOf(['構築戦'], undefined, [], undefined)).toBe('構築戦・制限なし')
  })

  it('選んだリストがもう無ければ、選ぶところと同じく先頭にする', () => {
    expect(rulesSummaryOf(['構築戦'], undefined, lists, { kind: '禁止／制限リスト', id: 'x' })).toBe('構築戦・第1期')
  })
})

describe('PC の幅を経てスマートフォンの幅へ戻ったとき', () => {
  it('シートを開いたままなら、手をシートの中へ置き直す', () => {
    const opened = takePending(reducePhone(initialPhone(), { kind: 'デッキのシートを開く', opener: '変更' })).state
    expect(opened.pending).toBeUndefined()
    expect(returnedToPhone(opened).pending).toEqual({ kind: 'シートの中へ' })

    const card = takePending(reducePhone(initialPhone(), { kind: 'カードのシートを開く', card: 'a', opener: 'カード-a' })).state
    expect(returnedToPhone(card).pending).toEqual({ kind: 'シートの中へ' })
  })

  it('シートを開いていなければ、何も動かさない（同じ値を返す）', () => {
    const state = initialPhone()
    expect(returnedToPhone(state)).toBe(state)
  })
})
