import { ZONES } from '@revolution/engine'

/**
 * クライアントの起動点。
 *
 * クライアントは受け取った盤面を描き、選んだものを送るだけで、**ルールの判断は持たない**
 * （ADR-0010）。行える手はサーバが盤面と一緒に送る。中身は #14 で入る。
 * 現時点では、ルールエンジンがブラウザ向けに解決できることだけを確かめている。エンジンを
 * 使うのは、ゾーンやスクエアの呼び名といった値と型のためである。
 */
export const mount = (root: HTMLElement): void => {
  root.textContent = `@revolution/client: ${ZONES.length} 種類のゾーンを認識しています`
}
