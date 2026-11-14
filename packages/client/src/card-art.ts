import type { FaceFields } from './view-model.js'

let artworkOrigin = typeof location === 'undefined' ? 'http://localhost:8787' : location.origin
export function configureArtworkOrigin(server: string): void {
  const url = new URL(server)
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
  artworkOrigin = url.origin
}

export function artworkUrl(path: string): string | undefined {
  try {
    const url = new URL(path, artworkOrigin)
    return url.origin === artworkOrigin && url.pathname.startsWith('/card-art/') ? url.href : undefined
  } catch { return undefined }
}

const images = new Map<string, Promise<HTMLImageElement | undefined>>()
const failed = new Set<string>()
const resized = new Map<string, string>()
const resizing = new Map<string, Promise<string>>()
let resizedBytes = 0

/**
 * 一度カードの面に付けた絵（元画像と縮小した画像）を、画像の URL ごとに覚えておく。
 *
 * 画面は描き直すたびにカードの面を作成し直す（#242）。作成し直した面に絵を付けるのを読み込みと縮小の
 * 後まで待つと、その間は絵の無い背景が見え、デッキ構築で枚数を変更するたびに絵がちらつく。覚えた絵は
 * 面を作成した時点で付ける。画像の要素を握っておくのは、ブラウザに読み込んだ画像を手放させないため。
 */
interface ShownArtwork {
  readonly image: HTMLImageElement
  smoothed: HTMLImageElement | undefined
}
const shown = new Map<string, ShownArtwork>()
const SHOWN_LIMIT = 128
function rememberShown(url: string, image: HTMLImageElement): ShownArtwork {
  const remembered = shown.get(url) ?? { image, smoothed: undefined }
  shown.delete(url); shown.set(url, remembered)
  if (shown.size > SHOWN_LIMIT) shown.delete(shown.keys().next().value!)
  return remembered
}
function rememberSmoothed(url: string, image: HTMLImageElement, encoded: string): void {
  const remembered = rememberShown(url, image)
  if (remembered.smoothed?.src === encoded) return
  const holder = new Image(); holder.src = encoded
  remembered.smoothed = holder
}
const cssUrl = (url: string): string => 'url(' + JSON.stringify(url) + ')'

function loadImage(url: string): Promise<HTMLImageElement | undefined> {
  if (failed.has(url)) return Promise.resolve(undefined)
  const remembered = shown.get(url)
  if (remembered !== undefined) return Promise.resolve(remembered.image)
  const cached = images.get(url)
  if (cached !== undefined) { images.delete(url); images.set(url, cached); return cached }
  const pending = new Promise<HTMLImageElement | undefined>((resolve) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => {
      failed.add(url)
      if (failed.size > 128) failed.delete(failed.values().next().value!)
      resolve(undefined)
    }
    image.src = url
  })
  images.set(url, pending)
  if (images.size > 12) images.delete(images.keys().next().value!)
  return pending
}

async function smoothImage(image: HTMLImageElement, width: number, height: number): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('Canvas unavailable')
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(image, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' })
    try { context.drawImage(bitmap, 0, 0) } finally { bitmap.close() }
  } else context.drawImage(image, 0, 0, width, height)
  return canvas.toDataURL('image/png')
}

function fitCardText(node: HTMLElement): void {
  if (!node.isConnected || !node.closest('.card--拡大')) return
  const body = node.querySelector<HTMLElement>('.card__lines'), bottom = node.querySelector<HTMLElement>('.card__bottom')
  if (body === null || bottom === null) return
  bottom.style.height = '30%'
  const overflow = Math.max(0, body.scrollHeight - body.clientHeight)
  if (overflow > 1) bottom.style.height = Math.min(node.clientHeight * .45, bottom.offsetHeight + overflow + 2) + 'px'
}

interface ArtworkTarget { readonly url: string | undefined; request: string | undefined }
const pendingTargets = new WeakMap<HTMLElement, ArtworkTarget>()
const active = new Map<HTMLElement, ArtworkTarget>()
let observing = false
let frame: number | undefined
let observer: ResizeObserver | undefined
let inFlight = 0
const refresh = (): void => {
  frame = undefined
  for (const [node] of active) if (!node.isConnected) { observer?.unobserve(node); active.delete(node) }
  for (const node of document.querySelectorAll<HTMLElement>('.card-art-face')) {
    const target = pendingTargets.get(node)
    if (target !== undefined && !active.has(node)) { active.set(node, target); observer?.observe(node); void paint(node, target) }
  }
}
function schedule(): void { if (frame === undefined) frame = requestAnimationFrame(refresh) }
async function paint(node: HTMLElement, target: ArtworkTarget): Promise<void> {
  if (!node.isConnected) return
  fitCardText(node)
  if (target.url === undefined) return
  const rect = node.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return
  const image = await loadImage(target.url)
  if (image === undefined || !node.isConnected || pendingTargets.get(node) !== target) return
  node.style.setProperty('--card-art-image', cssUrl(target.url))
  rememberShown(target.url, image)
  const scale = Math.min(1, Math.max(rect.width * devicePixelRatio / image.naturalWidth, rect.height * devicePixelRatio / image.naturalHeight))
  const width = Math.max(1, Math.ceil(image.naturalWidth * scale)), height = Math.max(1, Math.ceil(image.naturalHeight * scale))
  const key = target.url + ':' + width + 'x' + height
  if (target.request === key) return
  target.request = key
  const cached = resized.get(key)
  if (cached !== undefined) {
    resized.delete(key); resized.set(key, cached)
    node.style.setProperty('--card-art-smoothed', cssUrl(cached)); rememberSmoothed(target.url, image, cached); return
  }
  let pending = resizing.get(key)
  if (pending === undefined) {
    // 大量表示時は元画像を維持し、同時に作成する縮小画像を制限する。
    if (inFlight >= 4) { target.request = undefined; return }
    inFlight++
    pending = smoothImage(image, width, height)
    resizing.set(key, pending)
  }
  try {
    const encoded = await pending
    if (!resized.has(key) && encoded.length <= 16 * 1024 * 1024) {
      resized.set(key, encoded); resizedBytes += encoded.length * 2
      while (resized.size > 64 || resizedBytes > 32 * 1024 * 1024) {
        const oldest = resized.keys().next().value!
        resizedBytes -= (resized.get(oldest)?.length ?? 0) * 2; resized.delete(oldest)
      }
    }
    if (node.isConnected && pendingTargets.get(node) === target && target.request === key) {
      node.style.setProperty('--card-art-smoothed', cssUrl(encoded)); rememberSmoothed(target.url, image, encoded)
    }
  } catch { /* 元画像を維持し、同じ寸法での失敗を繰り返さない。 */ }
  finally {
    if (resizing.get(key) === pending) { resizing.delete(key); inFlight-- }
    for (const [other, waiting] of active) if (waiting.url !== undefined && waiting.request === undefined) void paint(other, waiting)
  }
}

export function applyCardArtwork(node: HTMLElement, card: FaceFields, big: boolean): void {
  node.classList.add('card-art-face')
  node.classList.toggle('card-art-nonunit', card.type !== 'ユニット')
  node.classList.toggle('card-art-trap', card.type === 'トラップ')
  const bottom = node.querySelector('.card__bottom'), title = node.querySelector('.card__title')
  if (!big && bottom !== null && title !== null) bottom.prepend(title)
  const body = node.querySelector('.card__lines')
  if (big && body !== null && card.artwork?.flavor) {
    const flavor = document.createElement('p'); flavor.className = 'card-art-flavor'; flavor.textContent = '【' + card.artwork.flavor + '】'; body.prepend(flavor)
  }
  if (bottom !== null) {
    const footer = document.createElement('div'); footer.className = 'card-art-footer'
    for (const part of [bottom.querySelector('.card__stats'), bottom.querySelector('.card__traits')]) if (part !== null) footer.append(part)
    if (footer.childElementCount > 0) bottom.append(footer)
  }
  requestAnimationFrame(() => fitCardText(node))
  const url = card.artwork?.url === undefined ? undefined : artworkUrl(card.artwork.url)
  pendingTargets.set(node, { url, request: undefined })
  // 前に付けた絵があれば今すぐ付ける。寸法が違っても、縮小し直した絵は描いた後に差し替わる。
  const remembered = url === undefined ? undefined : shown.get(url)
  if (url !== undefined && remembered !== undefined) {
    node.style.setProperty('--card-art-image', cssUrl(url))
    if (remembered.smoothed !== undefined) node.style.setProperty('--card-art-smoothed', cssUrl(remembered.smoothed.src))
  }
  if (!observing) {
    observing = true
    if (typeof ResizeObserver === 'function') observer = new ResizeObserver((entries) => {
      for (const entry of entries) { const node = entry.target as HTMLElement, target = active.get(node); if (target !== undefined) void paint(node, target) }
    })
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true })
    window.addEventListener('resize', () => { for (const [node, target] of active) void paint(node, target) })
  }
  schedule()
}
