import type { FaceFields } from './view-model.js'

let configuredArtworkOrigin = typeof location === 'undefined' ? 'http://localhost:8787' : location.origin
export function configureArtworkOrigin(server: string): void {
  const url = new URL(server)
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
  configuredArtworkOrigin = url.origin
}

export function artworkUrl(path: string): string | undefined {
  try {
    const url = new URL(path, configuredArtworkOrigin)
    return url.origin === configuredArtworkOrigin && url.pathname.startsWith('/card-art/') ? url.href : undefined
  } catch { return undefined }
}

const images = new Map<string, Promise<HTMLImageElement | undefined>>()
const failed = new Set<string>()

/**
 * 元画像の要素を保持しない場合、ブラウザが読み込んだ絵を手放し、描き直しで絵がちらつく（#402）。
 * 表示中の絵は保持件数にかかわらず描き直しまで参照し、それ以外は URL ごとの履歴から取得する。
 */
const mountedImages = new Map<string, { readonly image: HTMLImageElement; faces: number }>()
const shown = new Map<string, HTMLImageElement>()
const SHOWN_LIMIT = 128
function rememberShown(url: string, image: HTMLImageElement): void {
  shown.delete(url); shown.set(url, image)
  if (shown.size > SHOWN_LIMIT) shown.delete(shown.keys().next().value!)
}
const cssUrl = (url: string): string => 'url(' + JSON.stringify(url) + ')'

function retainMountedImage(url: string, image: HTMLImageElement): void {
  const mounted = mountedImages.get(url)
  if (mounted === undefined) mountedImages.set(url, { image, faces: 1 })
  else mounted.faces++
}

function releaseMountedImage(url: string): void {
  const mounted = mountedImages.get(url)
  if (mounted === undefined) return
  if (--mounted.faces === 0) mountedImages.delete(url)
}

function loadImage(url: string): Promise<HTMLImageElement | undefined> {
  if (failed.has(url)) return Promise.resolve(undefined)
  const remembered = mountedImages.get(url)?.image ?? shown.get(url)
  if (remembered !== undefined) return Promise.resolve(remembered)
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

async function smoothImage(image: HTMLImageElement, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('Canvas unavailable')
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(image, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' })
    try { context.drawImage(bitmap, 0, 0) } finally { bitmap.close() }
  } else context.drawImage(image, 0, 0, width, height)
  return new Promise((resolve, reject) => {
    canvas.toBlob((png) => {
      if (png === null) reject(new Error('Unable to encode PNG'))
      else resolve(png)
    }, 'image/png')
  })
}

function fitCardText(node: HTMLElement): void {
  if (!node.isConnected || !node.closest('.card--拡大')) return
  const body = node.querySelector<HTMLElement>('.card__lines'), bottom = node.querySelector<HTMLElement>('.card__bottom')
  if (body === null || bottom === null) return
  bottom.style.height = '30%'
  const overflow = Math.max(0, body.scrollHeight - body.clientHeight)
  if (overflow > 1) bottom.style.height = Math.min(node.clientHeight * .45, bottom.offsetHeight + overflow + 2) + 'px'
}

interface ArtworkMeasurement {
  readonly width: number
  readonly height: number
  readonly pixelRatio: number
}

interface ArtworkTarget {
  readonly url: string | undefined
  original: HTMLImageElement | undefined
  measurement?: ArtworkMeasurement
  request?: string
  appliedResize?: ResizedImage
}

interface ResizedImage {
  readonly key: string
  readonly url: string
  readonly bytes: number
  faces: number
}

interface ResizeJob {
  readonly key: string
  readonly image: HTMLImageElement
  readonly width: number
  readonly height: number
  readonly faces: Map<HTMLElement, ArtworkTarget>
}

const pendingTargets = new WeakMap<HTMLElement, ArtworkTarget>()
const active = new Map<HTMLElement, ArtworkTarget>()
const resized = new Map<string, ResizedImage>()
const cachedResizes = new Map<string, ResizedImage>()
const MAX_CACHED_RESIZES = 64
const MAX_CACHED_RESIZE_BYTES = 32 * 1024 * 1024
let cachedResizeBytes = 0
const resizeJobs = new Map<string, ResizeJob>()
const waitingResizes = new Set<ResizeJob>()
const MAX_CONCURRENT_RESIZES = 4
let observing = false
let frame: number | undefined
let observer: ResizeObserver | undefined
let inFlight = 0
let resizeDrainScheduled = false

function removeCachedResize(image: ResizedImage): void {
  if (cachedResizes.delete(image.key)) cachedResizeBytes -= image.bytes
}

function discardResize(image: ResizedImage): void {
  removeCachedResize(image)
  resized.delete(image.key)
  URL.revokeObjectURL(image.url)
}

function cacheUnusedResize(image: ResizedImage): void {
  if (image.bytes > MAX_CACHED_RESIZE_BYTES) {
    discardResize(image)
    return
  }
  cachedResizes.set(image.key, image)
  cachedResizeBytes += image.bytes
  while (cachedResizes.size > MAX_CACHED_RESIZES || cachedResizeBytes > MAX_CACHED_RESIZE_BYTES) {
    discardResize(cachedResizes.values().next().value!)
  }
}

function releaseResizedImage(image: ResizedImage): void {
  if (--image.faces === 0) cacheUnusedResize(image)
}

function removeResizeTarget(node: HTMLElement, target: ArtworkTarget): void {
  if (target.request === undefined) return
  const job = resizeJobs.get(target.request)
  if (job === undefined) return
  job.faces.delete(node)
  if (job.faces.size === 0 && waitingResizes.delete(job)) resizeJobs.delete(job.key)
}

const refresh = (): void => {
  frame = undefined
  const detachedResizes: ResizedImage[] = []
  for (const [node, target] of active) {
    if (node.isConnected) continue
    if (target.appliedResize !== undefined) {
      detachedResizes.push(target.appliedResize)
      node.style.removeProperty('--card-art-smoothed')
      delete target.appliedResize
    }
    if (target.url !== undefined && target.original !== undefined) releaseMountedImage(target.url)
    removeResizeTarget(node, target)
    delete target.measurement
    delete target.request
    observer?.unobserve(node)
    active.delete(node)
  }
  for (const node of document.querySelectorAll<HTMLElement>('.card-art-face')) {
    const target = pendingTargets.get(node)
    if (target === undefined || active.has(node)) continue
    active.set(node, target)
    if (target.url !== undefined && target.original !== undefined) retainMountedImage(target.url, target.original)
    observer?.observe(node)
    void paint(node, target)
  }
  if (detachedResizes.length > 0) {
    // 先に解放すると、保持上限を超える一覧で、読み込み済みの絵まで描き直しのたびに縮小し直す（#411）。
    // 元画像を保持済みの新しい面は、ここより先に登録したマイクロタスクで縮小画像を参照する。
    queueMicrotask(() => {
      for (const image of detachedResizes) releaseResizedImage(image)
    })
  }
}
function schedule(): void { if (frame === undefined) frame = requestAnimationFrame(refresh) }
async function paint(node: HTMLElement, target: ArtworkTarget): Promise<void> {
  if (!node.isConnected) return
  fitCardText(node)
  if (target.url === undefined) return
  const { width: faceWidth, height: faceHeight } = node.getBoundingClientRect()
  if (faceWidth === 0 || faceHeight === 0) return
  const measurement = { width: faceWidth, height: faceHeight, pixelRatio: devicePixelRatio }
  const previous = target.measurement
  if (previous?.width === faceWidth && previous.height === faceHeight && previous.pixelRatio === measurement.pixelRatio) return
  target.measurement = measurement
  const image = await (target.original ?? loadImage(target.url))
  if (!node.isConnected || pendingTargets.get(node) !== target || target.measurement !== measurement) return
  if (image === undefined) {
    delete target.measurement
    return
  }
  if (target.original === undefined) {
    target.original = image
    retainMountedImage(target.url, image)
    node.style.setProperty('--card-art-image', cssUrl(target.url))
  }
  rememberShown(target.url, image)
  const scale = Math.min(1, Math.max(faceWidth * measurement.pixelRatio / image.naturalWidth, faceHeight * measurement.pixelRatio / image.naturalHeight))
  const width = Math.max(1, Math.ceil(image.naturalWidth * scale)), height = Math.max(1, Math.ceil(image.naturalHeight * scale))
  const key = target.url + ':' + width + 'x' + height
  if (target.request === key) return
  removeResizeTarget(node, target)
  target.request = key
  const existingResize = resized.get(key)
  if (existingResize !== undefined) {
    applyResizedImage(node, target, existingResize)
    return
  }
  let job = resizeJobs.get(key)
  if (job === undefined) {
    job = { key, image, width, height, faces: new Map() }
    resizeJobs.set(key, job)
    waitingResizes.add(job)
  }
  job.faces.set(node, target)
  if (!resizeDrainScheduled) startQueuedResizes()
}

function applyResizedImage(node: HTMLElement, target: ArtworkTarget, image: ResizedImage): void {
  const previous = target.appliedResize
  if (previous === image) return
  removeCachedResize(image)
  image.faces++
  target.appliedResize = image
  node.style.setProperty('--card-art-smoothed', cssUrl(image.url))
  if (previous !== undefined) releaseResizedImage(previous)
}

function isCurrentResizeTarget(node: HTMLElement, target: ArtworkTarget, key: string): boolean {
  return node.isConnected && pendingTargets.get(node) === target && target.request === key
}

function startQueuedResizes(): void {
  for (const job of waitingResizes) {
    if (inFlight >= MAX_CONCURRENT_RESIZES) return
    waitingResizes.delete(job)
    if (![...job.faces].some(([node, target]) => isCurrentResizeTarget(node, target, job.key))) {
      resizeJobs.delete(job.key)
      continue
    }
    inFlight++
    void finishResize(job)
  }
}

async function finishResize(job: ResizeJob): Promise<void> {
  try {
    const png = await smoothImage(job.image, job.width, job.height)
    // 長い data URL を面ごとに CSS に設定すると、大量表示時に描き直しが遅れる（#411）。
    const image = { key: job.key, url: URL.createObjectURL(png), bytes: png.size, faces: 0 }
    resized.set(job.key, image)
    for (const [node, target] of job.faces) {
      if (isCurrentResizeTarget(node, target, job.key)) applyResizedImage(node, target, image)
    }
    if (image.faces === 0) cacheUnusedResize(image)
  } catch { /* 元画像を維持し、同じ寸法での失敗を繰り返さない。 */ }
  finally {
    resizeJobs.delete(job.key)
    inFlight--
    // 作成待ちを描画の間に進める。完了ごとに全カードの寸法を測り直すと、枚数の表示が遅れる（#411）。
    if (waitingResizes.size > 0 && !resizeDrainScheduled) {
      resizeDrainScheduled = true
      requestAnimationFrame(() => {
        resizeDrainScheduled = false
        startQueuedResizes()
      })
    }
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
    for (const part of [bottom.querySelector('.card__traits'), bottom.querySelector('.card__stats')]) if (part !== null) footer.append(part)
    if (footer.childElementCount > 0) bottom.append(footer)
  }
  requestAnimationFrame(() => fitCardText(node))
  const url = card.artwork?.url === undefined ? undefined : artworkUrl(card.artwork.url)
  const original = url === undefined ? undefined : mountedImages.get(url)?.image ?? shown.get(url)
  pendingTargets.set(node, { url, original })
  // 縮小画像の選択には、面が画面に置かれたあとの寸法が要る。
  if (url !== undefined && original !== undefined) node.style.setProperty('--card-art-image', cssUrl(url))
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

export function artworkOrigin(): string { return configuredArtworkOrigin }
