import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyCardArtwork, artworkUrl, configureArtworkOrigin } from './card-art.js'
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
  readonly style = { setProperty: (name: string, value: string) => void this.properties.set(name, value) }
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
  get src(): string { return this.source }
  set src(url: string) { this.source = url; queueMicrotask(() => this.onload?.()) }
}

/** 画面に置かれているカードの面と、次のフレームを進める手立て。 */
function fakeScreen(): { faces: FakeFace[]; nextFrame: () => Promise<void> } {
  const faces: FakeFace[] = []
  let frames: (() => void)[] = []
  vi.stubGlobal('document', {
    documentElement: {},
    querySelectorAll: () => faces.filter((face) => face.isConnected),
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: () => {} }),
      toDataURL: () => 'data:image/png;base64,smoothed',
    }),
  })
  vi.stubGlobal('window', { addEventListener: () => {} })
  vi.stubGlobal('devicePixelRatio', 1)
  vi.stubGlobal('Image', FakeImage)
  vi.stubGlobal('MutationObserver', class { observe(): void {} })
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => frames.push(callback))
  return {
    faces,
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

afterEach(() => vi.unstubAllGlobals())

// デッキ構築で枚数を変更するたびに、画面はカードの面を作成し直す。作成し直した面に絵が付くのを次の
// フレームまで待つと、その間は絵の無い背景が見えてちらつく。
describe('描き直したカードの面の絵', () => {
  it('前に付けた元画像は、作成し直した面にも作成した時点で付く', async () => {
    configureArtworkOrigin('wss://example.test/duel')
    const screen = fakeScreen()
    const first = new FakeFace()
    screen.faces.push(first)
    applyCardArtwork(first as unknown as HTMLElement, artworkFace('/card-art/redrawn'), false)
    await screen.nextFrame()
    expect(first.properties.get('--card-art-image')).toBe('url("https://example.test/card-art/redrawn")')
    expect(first.properties.get('--card-art-smoothed')).toBe('url("data:image/png;base64,smoothed")')

    first.isConnected = false
    const redrawn = new FakeFace()
    screen.faces.push(redrawn)
    applyCardArtwork(redrawn as unknown as HTMLElement, artworkFace('/card-art/redrawn'), false)

    expect(redrawn.properties.get('--card-art-image')).toBe('url("https://example.test/card-art/redrawn")')
    // 縮小した画像は、描く直前のフレームで付く。
    await screen.nextFrame()
    expect(redrawn.properties).toEqual(first.properties)
  })

  it('まだ付けたことの無い絵は、読み込んでから付く', async () => {
    configureArtworkOrigin('wss://example.test/duel')
    const screen = fakeScreen()
    const face = new FakeFace()
    screen.faces.push(face)
    applyCardArtwork(face as unknown as HTMLElement, artworkFace('/card-art/first-time'), false)

    expect(face.properties.size).toBe(0)
    await screen.nextFrame()
    expect(face.properties.get('--card-art-image')).toBe('url("https://example.test/card-art/first-time")')
  })
})
