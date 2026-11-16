import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Card, MakerCatalog } from '@revolution/engine'

const LOGO_PATH = '/maker-logos/'
const CONTENT_TYPES: Readonly<Record<string, string>> = { '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' }

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
    if (record['logo'] !== undefined && (typeof record['logo'] !== 'string' || !/\.(?:png|webp|svg)$/i.test(record['logo']))) return 'メーカーのロゴはPNG・WebP・SVGのパスが必要です'
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
  const path = (request.url ?? '').split('?', 1)[0]!
  if (!path.startsWith(LOGO_PATH)) return false
  const fail = (): void => { response.writeHead(404, { 'cache-control': 'no-store' }); response.end() }
  if (request.method !== 'GET' && request.method !== 'HEAD') { fail(); return true }
  let symbol: string
  try { symbol = decodeURIComponent(path.slice(LOGO_PATH.length)) } catch { fail(); return true }
  const file = Object.hasOwn(makers, symbol) ? makers[symbol]?.logo : undefined
  const contentType = file === undefined ? undefined : CONTENT_TYPES[extname(file).toLowerCase()]
  if (file === undefined || contentType === undefined) { fail(); return true }
  void readFile(file).then((bytes) => {
    response.writeHead(200, { 'content-type': contentType, 'cache-control': 'private, no-cache', 'x-content-type-options': 'nosniff' })
    response.end(request.method === 'HEAD' ? undefined : bytes)
  }).catch(fail)
  return true
}
