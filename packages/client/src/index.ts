import { ZONES } from '@revolution/engine'

/**
 * クライアントの起動点。
 *
 * クライアントも同じルールエンジンを動かすが、用途は先読み表示と入力の妥当性チェックで
 * あって権威ではない（ADR-0004）。中身は後続の Issue で入る。
 * 現時点では、ルールエンジンがブラウザ向けに解決できることだけを確かめている。
 */
export const mount = (root: HTMLElement): void => {
  root.textContent = `@revolution/client: ${ZONES.length} 種類のゾーンを認識しています`
}
