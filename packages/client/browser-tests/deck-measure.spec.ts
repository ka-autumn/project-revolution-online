import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { join, openDeckEditor, uniqueName } from './players.js'
import { MEASURE_SERVER, PRIVATE_DECKS, hasPrivateDecks } from './servers.js'

/*
 * デッキ構築で＋・−を押してから、枚数の表示が更新されるまでの時間（#242、#411）。描き直し方を
 * 移す前後で比べるための記録で、速さの合否は判定しない。カード名は扱わず、件数と並び順だけを使う。
 */

/** 一覧に読み込むカードの種類の数（#411 が使った数）。 */
const LOADED_KINDS = 144
const PRESSES = 20

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

/** 一覧の末尾を表示して、続きを読み込む。 */
async function loadPool(page: Page, kinds: number): Promise<void> {
  const items = page.locator('.pool__item')
  for (let before = await items.count(); before < kinds; before = await items.count()) {
    // 末尾の行が見えると画面ごと作成し直されるので、要素を指定せず、一覧を下端まで送る。
    await page.locator('.pool').evaluate((node) => {
      node.scrollTop = node.scrollHeight
    })
    await expect.poll(() => items.count()).toBeGreaterThan(before)
  }
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

/** デッキの先頭の行の「−」「＋」を 1 回押して、時間を取得する。 */
async function press(page: Page, button: '−' | '＋'): Promise<Sample> {
  const checked = await checkedReplies(page)
  await page.evaluate(() => {
    const text = () => document.querySelector('.decklist .cardrow .counter__count')?.textContent
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
  })
  await page.locator('.decklist .cardrow').first().locator('.counter button', { hasText: button }).click()
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
  test.setTimeout(240_000)

  const page = await join(browser, MEASURE_SERVER, uniqueName('計測'))
  await openDeckEditor(page)
  await loadPool(page, LOADED_KINDS)
  await settleArtwork(page)
  const kinds = await page.locator('.pool__item').count()
  const deck = await page.locator('.panel--deck .panel__aside strong').textContent()
  const faces = await page.locator('.card-art-face').count()

  const samples: Sample[] = []
  for (let at = 0; at < PRESSES; at += 1) samples.push(await press(page, at % 2 === 0 ? '−' : '＋'))

  console.log(
    [
      `デッキ構築の計測: 一覧に ${kinds} 種、デッキ ${deck} 枚、カードの面 ${faces} 枚、${PRESSES} 回`,
      `  枚数の表示が更新されるまで: ${summary(samples.map((each) => each.changed))}`,
      `  次の描画が済むまで:         ${summary(samples.map((each) => each.painted))}`,
    ].join('\n'),
  )

  await page.context().close()
})
