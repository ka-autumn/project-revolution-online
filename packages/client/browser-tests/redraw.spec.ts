import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createRoom, join, seatWaitingPlayer, uniqueName, waitForMessage } from './players.js'

/*
 * ほかの人の操作で画面が描き直されても、手元の操作が壊れないこと（#242、ADR-0078）。
 */

/** 部屋の一覧の「すべて」の件数。描き直しが済んだかを、画面の上で確認する。 */
const roomCount = (page: Page) => page.getByRole('button', { name: /^すべて/ }).locator('.lobby__tab-count')

test('一覧を途中までスクロールしている時に、ほかの人が部屋を作っても、位置が戻らない', async ({ browser }) => {
  // 一覧は 1 ページ 6 部屋なので、画面を低くして、はみ出させる。
  const a = await join(browser, uniqueName('A'), { viewport: { width: 1280, height: 600 } })
  const leave = await Promise.all(Array.from({ length: 6 }, (_, at) => seatWaitingPlayer(`並ぶ部屋${at}`)))
  const b = await join(browser, uniqueName('B'))
  const list = a.locator('.lobby__rooms')
  await expect(list.locator('tbody tr')).toHaveCount(6)
  expect(await list.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeGreaterThan(40)
  await list.evaluate((node) => {
    node.scrollTop = 40
  })
  const before = Number(await roomCount(a).textContent())

  await createRoom(b, uniqueName('あとの部屋'))

  await expect(roomCount(a)).toHaveText(String(before + 1))
  expect(await list.evaluate((node) => node.scrollTop)).toBe(40)

  for (const close of leave) close()
  await a.context().close()
  await b.context().close()
})

test('日本語入力の変換中に、ほかの人の操作で描き直されても、変換が切れない', async ({ browser }) => {
  const a = await join(browser, uniqueName('A'))
  const b = await join(browser, uniqueName('B'))
  const input = a.locator('.lobby__name')
  await input.click()
  await input.evaluate((node: HTMLInputElement) => {
    const events: string[] = []
    Object.assign(window, { composingInput: node, compositionEvents: events })
    for (const type of ['compositionstart', 'compositionend']) node.addEventListener(type, () => events.push(type))
  })
  const ime = await a.context().newCDPSession(a)
  const compose = (text: string) =>
    ime.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length })
  const state = () =>
    a.evaluate(() => {
      const held = window as unknown as { composingInput: HTMLInputElement; compositionEvents: string[] }
      return {
        sameInput: held.composingInput === document.querySelector('.lobby__name'),
        focused: document.activeElement === held.composingInput,
        value: held.composingInput.value,
        events: [...held.compositionEvents],
      }
    })
  await compose('たいせん')
  const before = Number(await roomCount(a).textContent())

  const roomName = uniqueName('変換中の部屋')
  await createRoom(b, roomName)
  await waitForMessage(a, roomName)
  await compose('たいせんべや')

  expect(await state()).toEqual({ sameInput: true, focused: true, value: 'たいせんべや', events: ['compositionstart'] })

  await ime.send('Input.insertText', { text: '対戦部屋' })

  // 確定すると、待っていた描き直しがかかり、打った文字は作成し直した入力欄に残る。
  await expect(roomCount(a)).toHaveText(String(before + 1))
  await expect(input).toHaveValue('対戦部屋')

  await a.context().close()
  await b.context().close()
})
