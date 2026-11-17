import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Card, MakerCatalog } from '@revolution/engine'
import { COLORS } from '@revolution/engine'
import type { Color } from '@revolution/engine'

const LOGO_PATH = '/maker-logos/'
const CONTENT_TYPES: Readonly<Record<string, string>> = { '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' }
const EMBEDDED_SVG_PREFIX = 'data:image/svg+xml,'

function embeddedSvgOf(value: string): string | undefined {
  if (!value.startsWith(EMBEDDED_SVG_PREFIX) || value.length > 128 * 1024) return undefined
  try {
    const svg = decodeURIComponent(value.slice(EMBEDDED_SVG_PREFIX.length))
    return /^\s*<svg[\s>]/.test(svg) ? svg : undefined
  } catch { return undefined }
}

function isLogoSource(value: unknown): value is string {
  return typeof value === 'string' && (embeddedSvgOf(value) !== undefined || (!value.startsWith('data:') && /\.(?:png|webp|svg)$/i.test(value)))
}

function applyCardColor(svg: string, color: Color): string {
  return svg.replace(/<svg\b[^>]*>/i, (root) => root
    .replace(/\sdata-card-color\s*=\s*(["']).*?\1/i, '')
    .replace(/(\/?>)$/, ` data-card-color="${color}"$1`))
}

function isNonemptyStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.trim() !== '')
}

function isSymbols(value: unknown): value is readonly string[] {
  return isNonemptyStrings(value) && value.every((symbol) => /^[A-Za-z]+$/.test(symbol))
}

export function readMakerCatalog(value: unknown, pool: Readonly<Record<string, Card>>): MakerCatalog | string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'メーカーの対応表が不正です'
  for (const [symbol, entry] of Object.entries(value)) {
    if (!/^[A-Za-z]+$/.test(symbol) || typeof entry !== 'object' || entry === null || Array.isArray(entry)) return 'メーカーの対応表が不正です'
    const record = entry as Record<string, unknown>
    if (typeof record['name'] !== 'string' || record['name'].trim() === '' || typeof record['reading'] !== 'string' || record['reading'].trim() === '') return 'メーカーの名前・読み仮名が必要です'
    if (record['logo'] !== undefined && !isLogoSource(record['logo'])) return 'メーカーのロゴは画像のパスまたは埋め込みSVGが必要です'
  }
  for (const card of Object.values(pool)) {
    if (!isNonemptyStrings(card.works) || !isSymbols(card.makerSymbols) || (card.printedMakerSymbols !== undefined && !isSymbols(card.printedMakerSymbols))) return 'カードの作品名・メーカーシンボルが必要です'
    for (const symbol of [...card.makerSymbols, ...(card.printedMakerSymbols ?? [])]) {
      if (!Object.hasOwn(value, symbol)) return 'メーカーシンボルの対応がありません'
    }
  }
  return value as MakerCatalog
}

export function makerCatalogForWire(makers: MakerCatalog = {}): MakerCatalog {
  return Object.fromEntries(Object.entries(makers).map(([symbol, entry]) => [symbol, {
    name: entry.name,
    reading: entry.reading,
    ...(entry.logo === undefined ? {} : { logo: LOGO_PATH + encodeURIComponent(symbol) }),
  }]))
}

export function handleMakerLogo(request: IncomingMessage, response: ServerResponse, makers: MakerCatalog = {}): boolean {
  const [path = '', query = ''] = (request.url ?? '').split('?', 2)
  if (!path.startsWith(LOGO_PATH)) return false
  const fail = (): void => { response.writeHead(404, { 'cache-control': 'no-store' }); response.end() }
  if (request.method !== 'GET' && request.method !== 'HEAD') { fail(); return true }
  const color = new URLSearchParams(query).get('color')
  if (color !== null && !COLORS.some((candidate) => candidate === color)) { fail(); return true }
  let symbol: string
  try { symbol = decodeURIComponent(path.slice(LOGO_PATH.length)) } catch { fail(); return true }
  const file = Object.hasOwn(makers, symbol) ? makers[symbol]?.logo : undefined
  const embedded = file === undefined ? undefined : embeddedSvgOf(file)
  const contentType = embedded !== undefined ? 'image/svg+xml' : file === undefined ? undefined : CONTENT_TYPES[extname(file).toLowerCase()]
  if (file === undefined || contentType === undefined) { fail(); return true }
  const bytes = embedded === undefined ? readFile(file) : Promise.resolve(Buffer.from(embedded))
  void bytes.then((loaded) => {
    const body = contentType === 'image/svg+xml' && color !== null ? applyCardColor(loaded.toString('utf8'), color as Color) : loaded
    response.writeHead(200, { 'content-type': contentType, 'cache-control': 'private, no-cache', 'x-content-type-options': 'nosniff' })
    response.end(request.method === 'HEAD' ? undefined : body)
  }).catch(fail)
  return true
}
