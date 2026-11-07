import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Card, CardPresentationOf } from '@revolution/engine'

export interface CardArtwork {
  readonly directory: string
  readonly cards: Readonly<Record<string, { readonly image?: string; readonly flavor?: string }>>
}

const ART_PATH = '/card-art/'
const IMMUTABLE_ART_CACHE = 'private, max-age=31536000, immutable'

function artworkHashOf(filename: string): string | undefined {
  return /\.([a-f0-9]{64})\.(?:png|webp)$/.exec(filename)?.[1]
}

function artworkPathOf(key: string, filename: string): string {
  const path = ART_PATH + encodeURIComponent(key)
  const hash = artworkHashOf(filename)
  return hash === undefined ? path : path + '/' + hash
}

function artworkContentType(filename: unknown): 'image/png' | 'image/webp' | undefined {
  if (typeof filename !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(png|webp)$/.test(filename)) return undefined
  return filename.endsWith('.webp') ? 'image/webp' : 'image/png'
}

export function readArtwork(value: unknown): CardArtwork | string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null) return '画像の供給設定を読めません'
  const source = value as Record<string, unknown>
  if (typeof source['directory'] !== 'string' || source['directory'].trim() === '') return '画像のディレクトリが必要です'
  const cards = source['cards']
  if (typeof cards !== 'object' || cards === null || Array.isArray(cards)) return '画像の対応データを読めません'
  for (const entry of Object.values(cards)) {
    if (typeof entry !== 'object' || entry === null) return '画像の対応データに不正な値があります'
    const record = entry as Record<string, unknown>
    if (record['image'] !== undefined && artworkContentType(record['image']) === undefined) return '画像はディレクトリを含まないPNGまたはWebPのファイル名が必要です'
    if (record['flavor'] !== undefined && typeof record['flavor'] !== 'string') return 'フレーバーは文字列が必要です'
  }
  return { ...(value as CardArtwork), directory: resolve(source['directory']) }
}

export function presentationOfPool(pool: Readonly<Record<string, Card>>, artwork?: CardArtwork): CardPresentationOf {
  const keys = new Map<Card, string>()
  for (const [key, card] of Object.entries(pool)) if (!keys.has(card)) keys.set(card, key)
  return (card) => {
    const key = keys.get(card)
    if (key === undefined) return {}
    const entry = artwork !== undefined && Object.hasOwn(artwork.cards, key) ? artwork.cards[key] : undefined
    return {
      key,
      ...(entry === undefined ? {} : { artwork: {
        ...(entry.image === undefined ? {} : { url: artworkPathOf(key, entry.image) }),
        ...(entry.flavor === undefined ? {} : { flavor: entry.flavor }),
      } }),
    }
  }
}

export function handleArtwork(request: IncomingMessage, response: ServerResponse, artwork?: CardArtwork): boolean {
  const [pathname = ''] = (request.url ?? '').split('?', 1)
  if (!pathname.startsWith(ART_PATH)) return false
  const fail = (): void => { response.writeHead(404, { 'cache-control': 'no-store' }); response.end() }
  if (artwork === undefined || (request.method !== 'GET' && request.method !== 'HEAD')) { fail(); return true }
  const [encodedKey = '', requestedHash, extraSegment] = pathname.slice(ART_PATH.length).split('/')
  if (extraSegment !== undefined) { fail(); return true }
  let key: string
  try { key = decodeURIComponent(encodedKey) } catch { fail(); return true }
  const image = Object.hasOwn(artwork.cards, key) ? artwork.cards[key]?.image : undefined
  const contentType = artworkContentType(image)
  if (image === undefined || contentType === undefined) { fail(); return true }
  if (requestedHash !== undefined && requestedHash !== artworkHashOf(image)) { fail(); return true }
  void readFile(join(artwork.directory, image)).then((bytes) => {
    if (requestedHash !== undefined && createHash('sha256').update(bytes).digest('hex') !== requestedHash) { fail(); return }
    response.writeHead(200, {
      'content-type': contentType,
      'content-length': bytes.length,
      'access-control-allow-origin': '*',
      'cache-control': requestedHash === undefined ? 'no-cache' : IMMUTABLE_ART_CACHE,
      'x-content-type-options': 'nosniff',
    })
    response.end(request.method === 'HEAD' ? undefined : bytes)
  }).catch(fail)
  return true
}
