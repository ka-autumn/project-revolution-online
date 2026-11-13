import type { PlanKeyword } from '@revolution/engine'
import { grantedKeywordText } from './view-model.js'

/**
 * 与えられたキーワード能力の表示（ADR-0073）。アイコンと、カードの詳細に追加する行を組み立てる。
 * 盤面の描画（`render.ts`）から切り出してあるのは、読み上げの文を、DOM を組み立てて確認するため。
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

/** 太い十字（10 × 10 の中の、腕の太さ 2.8 の十字）。 */
const CROSS_PATH = 'M3.6 0.6h2.8v3h3v2.8h-3v3H3.6v-3h-3V3.6h3z'

function spanOf(className: string, text?: string): HTMLElement {
  const node = document.createElement('span')
  node.className = className
  if (text !== undefined) node.textContent = text

  return node
}

/**
 * キーワード能力のアイコン 1 つ。与えられた能力は、書かれたものと見分けるため、右下に「＋」の宝石を付ける
 * （スタイルは `style.css`）。読み上げでは「（与えられた能力）」を添える。
 */
export function keywordElement(keyword: PlanKeyword, granted = false): HTMLElement {
  const node = spanOf(`keyword keyword--${keyword}${granted ? ' keyword--与えられた' : ''}`)
  node.setAttribute('role', 'img')
  node.setAttribute('aria-label', granted ? `${keyword}（与えられた能力）` : keyword)
  node.append(spanOf('', keyword))

  return node
}

/** キーワード能力のアイコンの並び。`granted` は、そのうち与えられたもの。持たなければ `undefined`。 */
export function keywordsElement(
  keywords: readonly PlanKeyword[],
  granted: readonly PlanKeyword[] = [],
): HTMLElement | undefined {
  if (keywords.length === 0) return undefined

  const node = spanOf('keywords')
  for (const keyword of keywords) node.append(keywordElement(keyword, granted.includes(keyword)))

  return node
}

/**
 * 与えられたキーワード能力の、カードの詳細に追加する行（1 つにつき 1 行）。行頭は「●」ではなく太い十字の「＋」で、
 * 書かれたテキストと見分ける。「与えられた能力」の注記は目には表示せず、読み上げにだけ伝える。
 */
export function grantedParagraphs(granted: readonly PlanKeyword[]): HTMLParagraphElement[] {
  return granted.map((keyword) => {
    const paragraph = document.createElement('p')
    paragraph.className = 'card__granted'
    // 太い十字。白い縁取りは、暗い地（黒いカードなど）でも読めるようにするためで、CSS で付ける。
    const mark = document.createElementNS(SVG_NS, 'svg')
    mark.setAttribute('class', 'card__granted-mark')
    mark.setAttribute('viewBox', '-0.7 -0.7 11.4 11.4')
    mark.setAttribute('aria-hidden', 'true')
    const cross = document.createElementNS(SVG_NS, 'path')
    cross.setAttribute('d', CROSS_PATH)
    mark.append(cross)
    paragraph.append(mark, spanOf('card__granted-reading', '与えられた能力: '), document.createTextNode(grantedKeywordText(keyword)))

    return paragraph
  })
}
