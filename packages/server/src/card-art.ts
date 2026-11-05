import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Card, CardPresentationOf } from '@revolution/engine'

export interface CardArtwork {
  readonly directory: string
  readonly cards: Readonly<Record<string, { readonly image?: string; readonly flavor?: string }>>
}

const ART_PATH = '/card-art/'

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
    if (record['image'] !== undefined && (typeof record['image'] !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.png$/.test(record['image']))) return '画像はディレクトリを含まないPNGファイル名が必要です'
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
        ...(entry.image === undefined ? {} : { url: ART_PATH + encodeURIComponent(key) }),
        ...(entry.flavor === undefined ? {} : { flavor: entry.flavor }),
      } }),
    }
  }
}

export function handleArtwork(request: IncomingMessage, response: ServerResponse, artwork?: CardArtwork): boolean {
  const pathname = (request.url ?? '').split('?')[0] ?? ''
  if (!pathname.startsWith(ART_PATH)) return false
  const fail = (): void => { response.writeHead(404); response.end() }
  if (artwork === undefined || (request.method !== 'GET' && request.method !== 'HEAD')) { fail(); return true }
  let key: string
  try { key = decodeURIComponent(pathname.slice(ART_PATH.length)) } catch { fail(); return true }
  const image = Object.hasOwn(artwork.cards, key) ? artwork.cards[key]?.image : undefined
  if (image === undefined || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.png$/.test(image)) { fail(); return true }
  void readFile(join(artwork.directory, image)).then((bytes) => {
    response.writeHead(200, { 'content-type': 'image/png', 'content-length': bytes.length, 'access-control-allow-origin': '*', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' })
    response.end(request.method === 'HEAD' ? undefined : bytes)
  }).catch(fail)
  return true
}
