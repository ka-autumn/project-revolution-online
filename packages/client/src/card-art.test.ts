import { afterEach, describe, expect, it, vi } from 'vitest'
import { artworkUrl, configureArtworkOrigin } from './card-art.js'
import { faceFieldsOf } from './view-model.js'
import { defineUnit, faceOf } from '@revolution/engine'

describe('カード画像の表示情報', () => {
  it('選択した対戦サーバで画像を解決し、外部URLを使用しない', () => {
    configureArtworkOrigin('wss://example.test/duel')
    expect(artworkUrl('/card-art/sample')).toBe('https://example.test/card-art/sample')
    expect(artworkUrl('https://other.test/card-art/sample')).toBeUndefined()
    expect(artworkUrl('javascript:alert(1)')).toBeUndefined()
  })
  it('表示情報のない古い表記を使用でき、登録済みならキーとフレーバーを維持する', () => {
    const face = faceOf(defineUnit({ name: '架空のカード', level: 1, bp: 100, sp: 100 }))
    expect(faceFieldsOf(face).artwork).toBeUndefined()
    expect(faceFieldsOf({ ...face, key: 'sample', artwork: { flavor: '架空の風景' } })).toMatchObject({ key: 'sample', artwork: { flavor: '架空の風景' } })
  })
})

/** カードの面の代わり。絵は CSS 変数（`--card-art-image`・`--card-art-smoothed`）で付く。 */
class FakeFace {
  readonly properties = new Map<string, string>()
  readonly style = {
    setProperty: (name: string, value: string) => void this.properties.set(name, value),
    removeProperty: (name: string) => void this.properties.delete(name),
  }
  readonly classList = { add: () => {}, toggle: () => {} }
  isConnected = true
  querySelector(): null { return null }
  closest(): null { return null }
  getBoundingClientRect(): { width: number; height: number } { return { width: 100, height: 140 } }
}

/** 読み込みを、次のマイクロタスクで済ませる画像。 */
class FakeImage {
  readonly naturalWidth = 200
  readonly naturalHeight = 280
  crossOrigin = ''
  onload: (() => void) | undefined
  onerror: (() => void) | undefined
  private source = ''
  constructor(private readonly canLoadImage: (url: string) => boolean) {}
  get src(): string { return this.source }
  set src(url: string) {
    this.source = url
    queueMicrotask(() => (this.canLoadImage(url) ? this.onload : this.onerror)?.())
  }
}

/** 画面に置かれているカードの面と、次のフレームを進める手立て。 */
async function fakeScreen(canLoadImage = (_url: string) => true) {
  const faces: FakeFace[] = []
  let frames: (() => void)[] = []
  let onResize: (() => void) | undefined
  const encodePng = vi.fn((callback: (png: Blob) => void, type: string) => {
    queueMicrotask(() => callback(new Blob(['見本の画像'], { type })))
  })
  let nextUrl = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:https://example.test/${++nextUrl}`)
  const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.resetModules()
  const artwork = await import('./card-art.js')
  artwork.configureArtworkOrigin('wss://example.test/duel')
  vi.stubGlobal('document', {
    documentElement: {},
    querySelectorAll: () => faces.filter((face) => face.isConnected),
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: () => {} }),
      toBlob: encodePng,
    }),
  })
  vi.stubGlobal('window', {
    addEventListener: (event: string, callback: () => void) => {
      if (event === 'resize') onResize = callback
    },
  })
  vi.stubGlobal('devicePixelRatio', 1)
  vi.stubGlobal('Image', class extends FakeImage { constructor() { super(canLoadImage) } })
  vi.stubGlobal('MutationObserver', class { observe(): void {} })
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => frames.push(callback))
  return {
    drawFace: (url: string): FakeFace => {
      const face = new FakeFace()
      faces.push(face)
      artwork.applyCardArtwork(face as unknown as HTMLElement, artworkFace(url), false)
      return face
    },
    encodePng,
    revokeUrl,
    resize: () => onResize?.(),
    nextFrame: async () => {
      const running = frames
      frames = []
      for (const callback of running) callback()
      // 読み込みと縮小が済むまで待つ。
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
  }
}

function artworkFace(url: string): ReturnType<typeof faceFieldsOf> {
  const face = faceOf(defineUnit({ name: '架空のカード', level: 1, bp: 100, sp: 100 }))
  return faceFieldsOf({ ...face, key: url, artwork: { url } })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// デッキ構築で枚数を変更するたびに、画面はカードの面を作成し直す。作成し直した面に絵が付くのを次の
// フレームまで待つと、その間は絵の無い背景が見えてちらつく。
describe('描き直したカードの面の絵', () => {
  it('前に付けた元画像は、作成し直した面にも作成した時点で付く', async () => {
    const screen = await fakeScreen()
    const first = screen.drawFace('/card-art/redrawn')
    await screen.nextFrame()
    expect(first.properties.get('--card-art-image')).toBe('url("https://example.test/card-art/redrawn")')
    expect(first.properties.get('--card-art-smoothed')).toBe('url("blob:https://example.test/1")')
    const shown = new Map(first.properties)

    first.isConnected = false
    const redrawn = screen.drawFace('/card-art/redrawn')

    expect(redrawn.properties.get('--card-art-image')).toBe('url("https://example.test/card-art/redrawn")')
    // 縮小した画像は、描く直前のフレームで付く。
    await screen.nextFrame()
    expect(redrawn.properties).toEqual(shown)
  })

  it('まだ付けたことの無い絵は、読み込んでから付く', async () => {
    const screen = await fakeScreen()
    const face = screen.drawFace('/card-art/first-time')

    expect(face.properties.size).toBe(0)
    await screen.nextFrame()
    expect(face.properties.get('--card-art-image')).toBe('url("https://example.test/card-art/first-time")')
  })

  it('144 種のカードの面を描き直しても、同じ寸法の縮小画像を再作成しない', async () => {
    const screen = await fakeScreen()
    const urls = Array.from({ length: 144 }, (_, index) => `/card-art/sample-${index}`)

    const initial = urls.map(screen.drawFace)
    for (let frame = 0; frame < urls.length && screen.encodePng.mock.calls.length < urls.length; frame++) {
      await screen.nextFrame()
    }
    expect(initial.every((face) => face.properties.has('--card-art-smoothed'))).toBe(true)
    const shown = initial.map((face) => new Map(face.properties))
    screen.encodePng.mockClear()
    for (const face of initial) face.isConnected = false

    const redrawn = urls.map(screen.drawFace)
    await screen.nextFrame()

    expect(screen.encodePng).not.toHaveBeenCalled()
    expect(screen.revokeUrl).not.toHaveBeenCalled()
    expect(redrawn.map((face) => face.properties)).toEqual(shown)

    for (const face of redrawn) face.isConnected = false
    screen.drawFace('/card-art/next-screen')
    await screen.nextFrame()

    expect(screen.revokeUrl).toHaveBeenCalledTimes(80)
    expect(screen.revokeUrl).toHaveBeenCalledWith('blob:https://example.test/1')
    expect(screen.revokeUrl).not.toHaveBeenCalledWith('blob:https://example.test/144')
  })

  it('画面を切り替えた次のフレームでは、新しい面が待っている縮小画像だけを作成する', async () => {
    const screen = await fakeScreen()
    const oldFaces = Array.from({ length: 8 }, (_, index) => screen.drawFace(`/card-art/old-${index}`))
    await screen.nextFrame()
    expect(screen.encodePng).toHaveBeenCalledTimes(4)
    screen.encodePng.mockClear()

    for (const face of oldFaces) face.isConnected = false
    const current = screen.drawFace('/card-art/current')
    await screen.nextFrame()

    expect(screen.encodePng).toHaveBeenCalledTimes(1)
    expect(current.properties.has('--card-art-smoothed')).toBe(true)
  })

  it('元画像が復旧し失敗履歴から外れた面は、同じ寸法でも描画通知で再取得する', async () => {
    let imagesAvailable = false
    const screen = await fakeScreen(() => imagesAvailable)
    const faces = Array.from({ length: 130 }, (_, index) => screen.drawFace(`/card-art/failed-${index}`))
    await screen.nextFrame()
    expect(faces.every((face) => !face.properties.has('--card-art-image'))).toBe(true)

    imagesAvailable = true
    screen.resize()
    await screen.nextFrame()

    expect(faces.slice(0, 2).every((face) => face.properties.has('--card-art-image'))).toBe(true)
    expect(faces.slice(2).every((face) => !face.properties.has('--card-art-image'))).toBe(true)
  })
})
