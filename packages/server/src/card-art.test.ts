import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { defineUnit, faceOf, toWire, perspectiveOf, emptyDuelState, instantiate, putOnSquare } from '@revolution/engine'
import { handleArtwork, presentationOfPool, readArtwork } from './card-art.js'
import { poolFacesOf, readSupply } from './deck.js'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

describe('カードキーに対応する表示情報', () => {
  it('同名の別カードを区別し、盤面とカードプールで同じ画像を使用する', () => {
    const first = defineUnit({ name: '架空の同名カード', level: 1, bp: 1000, sp: 500 })
    const second = defineUnit({ name: '架空の同名カード', level: 2, bp: 2000, sp: 1000 })
    const pool = { first, second }
    const artwork = { directory: '/unused', cards: { first: { image: 'first.png', flavor: '最初の風景' }, second: { image: 'second.png' } } }
    const describeCard = presentationOfPool(pool, artwork)
    expect(describeCard(first)).toEqual({ key: 'first', artwork: { url: '/card-art/first', flavor: '最初の風景' } })
    expect(describeCard(second)).toEqual({ key: 'second', artwork: { url: '/card-art/second' } })
    const state = putOnSquare(emptyDuelState(), { row: 0, column: 0 }, instantiate({ id: 'one-copy', card: first, owner: '先攻' }))
    const wire = toWire(perspectiveOf(state, '先攻'), describeCard)
    expect(wire.squares.flat()[0]?.card).toEqual(poolFacesOf({ pool, artwork })[0]?.face)
    expect(presentationOfPool(pool)(first)).toEqual({ key: 'first' })
    expect(faceOf(first)).not.toHaveProperty('artwork')
  })

  it('素材未登録の供給元を使用でき、不正な画像パスを起動前に拒否する', () => {
    expect(readArtwork(undefined)).toBeUndefined()
    for (const image of ['../secret.png', 'folder/image.png', 'C:\\secret.png', '../secret.webp', 'image.svg']) expect(typeof readArtwork({ directory: '.', cards: { sample: { image } } })).toBe('string')
    expect(typeof readArtwork({ directory: '.', cards: { sample: { flavor: 1 } } })).toBe('string')
    expect(readSupply({ pool: { sample: defineUnit({ name: '架空', level: 0, bp: 100, sp: 100 }) }, presets: [{ id: 'one', name: '架空', cards: ['sample'] }], artwork: { directory: '.', cards: { sample: { image: '../secret.png' } } } }).kind).toBe('断る')
  })

  it('登録画像だけを配信し、欠落・不正エンコード・未登録の要求を404にする', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'card-art-test-'))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))
    await writeFile(join(directory, 'sample.png'), Buffer.from([137,80,78,71]))
    await writeFile(join(directory, 'unlisted.png'), 'not supplied')
    const webpBytes = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==', 'base64')
    const hash = createHash('sha256').update(webpBytes).digest('hex')
    const filename = 'compressed.' + hash + '.webp'
    await writeFile(join(directory, filename), webpBytes)
    const artwork = { directory, cards: { sample: { image: 'sample.png' }, compressed: { image: filename }, missing: { image: 'missing.' + hash + '.webp' } } }
    const card = defineUnit({ name: '架空のカード', level: 1, bp: 100, sp: 100 })
    const compressedPath = presentationOfPool({ compressed: card }, artwork)(card).artwork?.url
    expect(compressedPath).toBe('/card-art/compressed/' + hash)
    const server = createServer((request, response) => { if (!handleArtwork(request, response, artwork)) { response.writeHead(404); response.end() } })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
    const address = server.address(); if (address === null || typeof address === 'string') throw new Error('port missing')
    const base = 'http://127.0.0.1:' + address.port
    const response = await fetch(base + '/card-art/sample')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([137,80,78,71]))
    expect(response.headers.get('cache-control')).toBe('no-cache')
    const compressed = await fetch(base + compressedPath)
    expect(compressed.status).toBe(200)
    expect(compressed.headers.get('content-type')).toBe('image/webp')
    expect(compressed.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
    expect(Buffer.from(await compressed.arrayBuffer())).toEqual(webpBytes)

    const head = await fetch(base + compressedPath, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-type')).toBe('image/webp')
    expect(head.headers.get('content-length')).toBe(String(webpBytes.length))
    expect(head.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
    expect(await head.text()).toBe('')
    for (const key of ['missing','unknown','unlisted.png','%ZZ','..%2Fsample.png']) expect((await fetch(base + '/card-art/' + key)).status).toBe(404)
    const unversioned = await fetch(base + '/card-art/compressed')
    expect(unversioned.status).toBe(200)
    expect(unversioned.headers.get('cache-control')).toBe('no-cache')
    for (const path of ['/card-art/compressed/' + '0'.repeat(64), compressedPath + '/' + hash, '/card-art/missing/' + hash, '/card-art/sample/' + hash]) {
      const rejected = await fetch(base + path)
      expect(rejected.status).toBe(404)
      expect(rejected.headers.get('cache-control')).toBe('no-store')
    }
    await writeFile(join(directory, filename), 'changed under the same filename')
    const changed = await fetch(base + compressedPath)
    expect(changed.status).toBe(404)
    expect(changed.headers.get('cache-control')).toBe('no-store')
    expect((await fetch(base + '/card-art/sample')).status).toBe(200)
  })
})
