import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { join, openDeckEditor, releasePlayers } from './players.js'
import { MEASURE_SERVER, PRIVATE_DECKS, hasPrivateDecks } from './servers.js'

/*
 * デッキ構築で＋・−を押してから、枚数の表示が更新されるまでの時間（#242、#411）。描き直し方を
 * 移す前後で比べるための記録で、計測の値に合格の線は引かない。ただし、測れなかった時は失敗にする。
 * カード名は扱わず、件数と並び順だけを使う。
 */

/** 一覧に読み込むカードの種類の数（#411 が使った数）。 */
const LOADED_KINDS = 144
const PRESSES = 20
/** 一覧の続きが読み込まれない時に、下端まで送り直す回数と、1 回ごとに待つ時間。 */
const LOAD_ATTEMPTS = 6
const LOAD_WAIT_MS = 10_000

test.afterEach(releasePlayers)

interface Sample {
  /** 押してから、枚数の表示の中身が更新されるまで。 */
  readonly changed: number
  /** 押してから、更新されたあと最初の描画が済むまで。 */
  readonly painted: number
}

declare global {
  interface Window {
    sample: Promise<Sample>
  }
}

/**
 * 一覧をいったん上端へ戻してから、下端まで送る。下端にいるまま送り直しても、末尾の行が見えたことは
 * もう一度は通知されない。末尾の行が見えると画面ごと作成し直されるので、毎回要素を取得し直す。
 */
async function scrollPoolToEnd(page: Page): Promise<void> {
  for (const toEnd of [false, true]) {
    await page.evaluate(
      (end) =>
        new Promise<void>((resolve) => {
          const pool = document.querySelector('.pool')
          if (pool !== null) pool.scrollTop = end ? pool.scrollHeight : 0
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        }),
      toEnd,
    )
  }
}

/** 下端まで送って、一覧が `before` 種より増えるのを待つ。増えなければ、何回かやり直す。 */
async function loadMore(page: Page, before: number): Promise<boolean> {
  for (let attempt = 0; attempt < LOAD_ATTEMPTS; attempt += 1) {
    await scrollPoolToEnd(page)
    const grown = await expect
      .poll(() => page.locator('.pool__item').count(), { timeout: LOAD_WAIT_MS })
      .toBeGreaterThan(before)
      .then(
        () => true,
        () => false,
      )
    if (grown) return true
  }

  return false
}

/** 一覧の末尾を表示して、`kinds` 種になるまで続きを読み込む。 */
async function loadPool(page: Page, kinds: number): Promise<void> {
  const items = page.locator('.pool__item')
  for (let before = await items.count(); before < kinds; before = await items.count()) {
    if (!(await loadMore(page, before))) {
      throw new Error(`計測の前の読み込みで止まった: 一覧が ${before} 種から増えない（必要なのは ${kinds} 種）`)
    }
  }
}

/**
 * 計測で押すデッキの行を選ぶ。「−」を押しても行が消えないように、2 枚以上の行にする。「−」と「＋」を
 * 交互に押すので、枚数は元の値を超えず、「＋」が上限に当たることはない。
 */
async function pickRow(page: Page): Promise<number> {
  const counts = await page.locator('.decklist .cardrow .counter__count').allTextContents()
  const row = counts.findIndex((text) => Number(text.replace('×', '')) >= 2)
  if (row < 0) {
    throw new Error(`計測の前に止めた: デッキに 2 枚以上の行が無い（枚数の表示: ${counts.join(' ') || 'なし'}）`)
  }

  return row
}

/** 一覧の絵の読み込みと縮小が済むまで待つ。残っていると、押したあとの時間に混ざる。 */
async function settleArtwork(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const faces = [...document.querySelectorAll<HTMLElement>('.pool .card-art-face')]
      return faces.length > 0 && faces.every((face) => face.style.getPropertyValue('--card-art-smoothed') !== '')
    },
    undefined,
    { timeout: 60_000 },
  )
}

const checkedReplies = (page: Page): Promise<number> =>
  page.evaluate(() => window.handled.filter((data) => data.includes('"kind":"デッキを確かめた"')).length)

/** デッキの `row` 番目（0 始まり）の行の「−」「＋」を 1 回押して、時間を取得する。 */
async function press(page: Page, row: number, button: '−' | '＋'): Promise<Sample> {
  const checked = await checkedReplies(page)
  await page.evaluate((at) => {
    const text = () => document.querySelectorAll('.decklist .cardrow .counter__count')[at]?.textContent
    const before = text()
    window.sample = new Promise((resolve) => {
      window.addEventListener(
        'click',
        (event) => {
          const observer = new MutationObserver(() => {
            if (text() === before) return
            observer.disconnect()
            const changed = performance.now() - event.timeStamp
            requestAnimationFrame(() =>
              setTimeout(() => resolve({ changed, painted: performance.now() - event.timeStamp }), 0),
            )
          })
          observer.observe(document.body, { childList: true, subtree: true, characterData: true })
        },
        { capture: true, once: true },
      )
    })
  }, row)
  await page.locator('.decklist .cardrow').nth(row).locator('.counter button', { hasText: button }).click()
  const sample = await page.evaluate(() => window.sample)
  // 押すと少し後に確認を送り、返事でもう一度描き直す。それと絵の処理が済んでから次を押す。
  await expect.poll(() => checkedReplies(page)).toBeGreaterThan(checked)
  await settleArtwork(page)

  return sample
}

function summary(values: readonly number[]): string {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = (sorted.length - 1) / 2
  const median = (sorted[Math.floor(middle)]! + sorted[Math.ceil(middle)]!) / 2

  return `中央値 ${median.toFixed(0)} ms（最小 ${sorted[0]!.toFixed(0)}・最大 ${sorted.at(-1)!.toFixed(0)}）`
}

test('デッキ構築で＋・−を押してから、枚数の表示が更新されるまでの時間を記録する', async ({ browser }) => {
  if (!hasPrivateDecks) console.log(`デッキ構築の計測は飛ばしました: ${PRIVATE_DECKS} がありません`)
  test.skip(!hasPrivateDecks, `${PRIVATE_DECKS} が無いので、計測できない`)
  test.setTimeout(480_000)

  const page = await join(browser, MEASURE_SERVER)
  await openDeckEditor(page)
  await loadPool(page, LOADED_KINDS)
  await settleArtwork(page)
  const kinds = await page.locator('.pool__item').count()
  const deck = await page.locator('.panel--deck .panel__aside strong').textContent()
  const faces = await page.locator('.card-art-face').count()

  const row = await pickRow(page)
  const samples: Sample[] = []
  for (let at = 0; at < PRESSES; at += 1) samples.push(await press(page, row, at % 2 === 0 ? '−' : '＋'))

  console.log(
    [
      `デッキ構築の計測: 一覧に ${kinds} 種、デッキ ${deck} 枚、カードの面 ${faces} 枚、${PRESSES} 回`,
      `  枚数の表示が更新されるまで: ${summary(samples.map((each) => each.changed))}`,
      `  次の描画が済むまで:         ${summary(samples.map((each) => each.painted))}`,
    ].join('\n'),
  )
})
