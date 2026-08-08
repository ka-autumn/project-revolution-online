import { ZONES } from '@revolution/engine'

/**
 * サーバの起動点。
 *
 * サーバが完全な盤面を持つ唯一の権威となる（ADR-0004）。中身は後続の Issue で入る。
 * 現時点では、ルールエンジンがサーバ向けに解決できることだけを確かめている。
 */
export const start = (): void => {
  console.log(`@revolution/server: ${ZONES.length} 種類のゾーンを認識しています`)
}
