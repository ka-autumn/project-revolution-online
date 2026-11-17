import type { Color, MakerCatalog, WireCardFace } from '@revolution/engine'

export function makerLogoUrl(path: string, color: Color, origin: string): string | undefined {
  try {
    const url = new URL(path, origin)
    if (url.origin !== origin || !url.pathname.startsWith('/maker-logos/')) return undefined
    url.searchParams.set('color', color)
    return url.href
  } catch { return undefined }
}

export function printedSymbolsOf(face: Pick<WireCardFace, 'makerSymbols' | 'printedMakerSymbols'>): readonly string[] {
  return face.printedMakerSymbols ?? face.makerSymbols ?? []
}

export function makerNameOf(symbol: string, makers: MakerCatalog): string {
  return Object.hasOwn(makers, symbol) ? makers[symbol]!.name : symbol
}

export function metadataRowsOf(face: Pick<WireCardFace, 'works' | 'makerSymbols' | 'printedMakerSymbols'>, makers: MakerCatalog): readonly { readonly label: string; readonly value: string }[] {
  const rows = []
  if (face.works?.length) rows.push({ label: '作品名', value: face.works.join(' | ') })
  const symbols = printedSymbolsOf(face)
  if (symbols.length) rows.push({ label: 'ブロック', value: symbols.map((symbol) => makerNameOf(symbol, makers)).join(' | ') })
  return rows
}
