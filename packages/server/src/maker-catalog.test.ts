import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { handleMakerLogo, makerCatalogForWire } from './maker-catalog.js'

it('ロゴのローカルパスを通信に含めず、指定された画像だけを配信する', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'revolution-maker-test-'))
  const file = join(directory, 'sample.svg')
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>'
  await writeFile(file, svg)
  const makers = { AA: { name: '見本出版', reading: 'みほんしゅっぱん', logo: file } }
  const wire = makerCatalogForWire(makers)
  expect(wire.AA?.logo).toBe('/maker-logos/AA')
  expect(JSON.stringify(wire)).not.toContain(directory.replaceAll('\\', '\\\\'))
  const server = createServer((request, response) => {
    if (!handleMakerLogo(request, response, makers)) { response.writeHead(404); response.end() }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('確認用サーバのポートを取得できません')
  const origin = `http://127.0.0.1:${address.port}`
  try {
    const response = await fetch(origin + wire.AA!.logo)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/svg+xml')
    expect(await response.text()).toBe(svg)
    expect((await fetch(origin + '/maker-logos/AA', { method: 'HEAD' })).status).toBe(200)
    expect((await fetch(origin + '/maker-logos/unknown')).status).toBe(404)
    expect((await fetch(origin + '/maker-logos/%2e%2e%2f' + encodeURIComponent(file))).status).toBe(404)
    expect((await fetch(origin + '/maker-logos/AA', { method: 'POST' })).status).toBe(404)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await rm(directory, { recursive: true })
  }
})
