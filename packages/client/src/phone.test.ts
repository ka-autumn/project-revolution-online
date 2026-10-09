import { describe, expect, it } from 'vitest'
import { initialPhone, isPhoneWidth, reducePhone, returnedToPhone, rulesSummaryOf, settlePhone, tabAfterKey, takePending, takeScroll } from './phone.js'

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
    state = reducePhone(state, { kind: 'デッキ構築のタブ', tab: 'デッキ', sight: { top: 0, stuck: false } })
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
  const none = { lobby: false, deckList: false, editor: false, duel: false }

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
    let state = reducePhone(initialPhone(), { kind: 'デッキ構築のタブ', tab: 'デッキ', sight: { top: 0, stuck: false } })
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

describe('デッキ構築のタブごとのスクロールの位置（ADR-0034）', () => {
  const stuckAt = (top: number) => ({ top, stuck: true })
  const free = { top: 40, stuck: false }

  it('帯が上に付いている間に、初めて開くタブは、タブの帯のすぐ下から見せる', () => {
    const state = reducePhone(initialPhone(), { kind: 'デッキ構築のタブ', tab: 'デッキ', sight: stuckAt(900) })
    expect(state.builderTab).toBe('デッキ')
    expect(takeScroll(state).scroll).toEqual({ kind: 'タブの帯の下へ' })
  })

  it('離れたタブの位置を覚え、戻ったときにその位置へ戻す', () => {
    let state = reducePhone(initialPhone(), { kind: 'デッキ構築のタブ', tab: 'デッキ', sight: stuckAt(900) })
    state = takeScroll(state).state
    state = reducePhone(state, { kind: 'デッキ構築のタブ', tab: '探す', sight: stuckAt(300) })
    expect(state.scroll).toEqual({ kind: '位置へ', top: 900 })
    // 「デッキ」を離れたときの位置（300）が覚えられている。
    state = reducePhone(takeScroll(state).state, { kind: 'デッキ構築のタブ', tab: 'デッキ', sight: stuckAt(900) })
    expect(state.scroll).toEqual({ kind: '位置へ', top: 300 })
  })

  it('帯がまだ上に付いていない（ページの上の方にいる）なら、位置を動かさず、その位置も覚えない', () => {
    const state = reducePhone(initialPhone(), { kind: 'デッキ構築のタブ', tab: 'デッキ', sight: free })
    expect(state.scroll).toBeUndefined()
    expect(state.builderScroll).toEqual({})
    // 覚えていた位置があっても、上に付く前の切り替えでは動かさない。
    const back = reducePhone(
      reducePhone(reducePhone(initialPhone(), { kind: 'デッキ構築のタブ', tab: 'デッキ', sight: stuckAt(500) }), {
        kind: 'デッキ構築のタブ',
        tab: '探す',
        sight: stuckAt(700),
      }),
      { kind: 'デッキ構築のタブ', tab: 'デッキ', sight: free },
    )
    expect(back.scroll).toBeUndefined()
  })

  it('選んでいるタブをもう一度押しても、何も動かさない', () => {
    const state = initialPhone()
    expect(reducePhone(state, { kind: 'デッキ構築のタブ', tab: '探す', sight: stuckAt(500) })).toBe(state)
  })

  it('確かめた結果を見に行くときは、覚えていた位置より確かめた結果の文を優先する', () => {
    let state = reducePhone(initialPhone(), { kind: 'デッキ構築のタブ', tab: 'デッキ', sight: stuckAt(500) })
    state = reducePhone(state, { kind: 'デッキ構築のタブ', tab: '探す', sight: stuckAt(800) })
    state = reducePhone(takeScroll(state).state, { kind: '確かめた結果を見る', sight: stuckAt(800) })
    expect(state.builderTab).toBe('デッキ')
    expect(state.scroll).toEqual({ kind: '確かめた結果へ' })
    // 上に付く前でも見に行く。
    const top = reducePhone(initialPhone(), { kind: '確かめた結果を見る', sight: free })
    expect(top.scroll).toEqual({ kind: '確かめた結果へ' })
  })

  it('すでに「デッキ」のタブにいても、確かめた結果の位置へ持っていく', () => {
    const inDeck = reducePhone(initialPhone(), { kind: 'デッキ構築のタブ', tab: 'デッキ', sight: stuckAt(100) })
    const state = reducePhone(takeScroll(inDeck).state, { kind: '確かめた結果を見る', sight: stuckAt(600) })
    expect(state.scroll).toEqual({ kind: '確かめた結果へ' })
    expect(state.builderScroll).toEqual(inDeck.builderScroll)
  })

  it('スクロールの置き直しは 1 度だけ渡す', () => {
    const state = reducePhone(initialPhone(), { kind: 'デッキ構築のタブ', tab: 'デッキ', sight: stuckAt(900) })
    const first = takeScroll(state)
    expect(first.scroll).toBeDefined()
    expect(takeScroll(first.state).scroll).toBeUndefined()
  })

  it('デッキ構築を離れたら、覚えた位置も置き直しも捨てる', () => {
    const state = reducePhone(initialPhone(), { kind: 'デッキ構築のタブ', tab: 'デッキ', sight: stuckAt(900) })
    const left = reducePhone(takeScroll(state).state, { kind: 'デッキ構築のタブ', tab: '探す', sight: stuckAt(300) })
    expect(Object.keys(left.builderScroll).sort()).toEqual(['デッキ', '探す'])
    expect(settlePhone(left, { lobby: true, deckList: true, editor: false, duel: false })).toEqual(initialPhone())
    expect(settlePhone(left, { lobby: true, deckList: false, editor: true, duel: false })).toBe(left)
  })
})

describe('対戦画面のシート（ADR-0034）', () => {
  const none = { lobby: false, deckList: false, editor: false, duel: false }

  it('ログ・行える手のシートを開けば手は中へ、閉じれば開いた元へ戻す', () => {
    const opened = reducePhone(initialPhone(), { kind: '対戦のシートを開く', sheet: 'ログ', opener: 'ログ' })
    expect(opened.duelSheet).toBe('ログ')
    expect(takePending(opened).pending).toEqual({ kind: 'シートの中へ' })

    const closed = reducePhone(takePending(opened).state, { kind: '対戦のシートを閉じる' })
    expect(closed.duelSheet).toBeUndefined()
    expect(closed.pending).toEqual({ kind: '元へ', opener: 'ログ' })
  })

  it('開いていないシートを閉じても、手を動かさない', () => {
    const state = initialPhone()
    expect(reducePhone(state, { kind: '対戦のシートを閉じる' })).toBe(state)
    expect(reducePhone(state, { kind: '対戦のカードを閉じる' })).toBe(state)
  })

  it('カードの詳細だけのシートは、開くたびに別の入れ物になる', () => {
    const first = reducePhone(initialPhone(), { kind: '対戦のカードを見る', card: 'a' })
    const again = reducePhone(reducePhone(first, { kind: '対戦のカードを閉じる' }), { kind: '対戦のカードを見る', card: 'a' })
    expect(first.viewedCard).toEqual(again.viewedCard)
    expect(first.viewedCard).not.toBe(again.viewedCard)
  })

  it('対戦を離れたら、開いていたシートも詳細も捨てる', () => {
    let state = reducePhone(initialPhone(), { kind: '対戦のシートを開く', sheet: '行える手', opener: '行える手' })
    state = reducePhone(state, { kind: '対戦のカードを見る', card: 'a' })
    expect(settlePhone(state, { ...none, duel: true })).toBe(state)
    expect(settlePhone(state, none)).toEqual(initialPhone())
  })

  it('PC の幅を経て戻ったとき、シートを開いたままなら手を中へ置き直す', () => {
    const opened = takePending(reducePhone(initialPhone(), { kind: '対戦のシートを開く', sheet: 'ログ', opener: 'ログ' })).state
    expect(returnedToPhone(opened).pending).toEqual({ kind: 'シートの中へ' })
  })
})
