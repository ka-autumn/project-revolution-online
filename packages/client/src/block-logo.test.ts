import { afterEach, expect, it, vi } from 'vitest'
import { defineUnit, faceOf } from '@revolution/engine'
import { configureCardMetadata, sheetDetailElement } from './render.js'
import { faceFieldsOf, type CardView } from './view-model.js'

vi.mock('./card-art.js', () => ({
  artworkOrigin: () => 'https://example.test',
  applyCardArtwork: () => {},
}))

class TestElement extends EventTarget {
  className = ''
  textContent = ''
  readonly children: TestElement[] = []
  readonly style = { backgroundImage: '' }
  readonly classList = {
    add: (name: string) => { this.className += ' ' + name },
    toggle: () => {},
  }
  setAttribute(): void {}
  append(...children: TestElement[]): void { this.children.push(...children) }
}

class TestImage extends TestElement {
  src = ''
  naturalWidth = 40
  naturalHeight = 20
}

afterEach(() => vi.unstubAllGlobals())

it('カード詳細を描き直すと、表示済みのロゴは読み込み完了を再び待たず最初から表示される', () => {
  const elements: TestElement[] = []
  const images: TestImage[] = []
  vi.stubGlobal('document', {
    createTextNode: () => new TestElement(),
    createElement: (tag: string) => {
      const node = tag === 'img' ? new TestImage() : new TestElement()
      if (node instanceof TestImage) images.push(node)
      elements.push(node)
      return node
    },
  })
  const face = faceOf(defineUnit({ name: '見本', level: 1, bp: 100, sp: 100 }))
  const card: CardView = {
    ...faceFieldsOf(face), kind: '表', id: 'sample', controlledBy: '自分', ownedBy: undefined,
    orientation: 'リリース', damage: 0, modified: undefined, grantedKeywords: [], pending: [], makerSymbols: ['AA'],
  }
  configureCardMetadata({ AA: { name: '見本書房', reading: 'みほんしょぼう', logo: '/maker-logos/AA' } }, {})

  function redrawLogo(): TestElement {
    elements.length = 0
    sheetDetailElement(card)
    return elements.find(node => node.className.split(' ').includes('block-logo'))!
  }

  const first = redrawLogo()
  expect(first.textContent).toBe('AA')
  images.find(image => image.src.includes('/maker-logos/AA'))!.dispatchEvent(new Event('load'))
  expect(first.textContent).toBe('')
  const redrawn = redrawLogo()
  expect(redrawn.textContent).toBe('')
  expect(redrawn.className).toContain('block-logo--image')
  expect(redrawn.style).toMatchObject({
    backgroundImage: first.style.backgroundImage,
    width: '4.4em',
  })
  expect(first.style.backgroundImage).toContain('/maker-logos/AA')
})
