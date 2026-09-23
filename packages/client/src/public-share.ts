import { SHARE_PATH_PREFIX } from '@revolution/engine'
import type { PublicShare, ShareKey } from '@revolution/engine'
import { publicCardSections } from './recipe.js'
import { publicShareElement, publicShareLoadingElement, publicShareNotFoundElement } from './render.js'

export interface PublicShareMountOptions {
  /** 対戦サーバの HTTP の置き場（`main.ts` の `httpOrigin`）。 */
  readonly serverOrigin: string
  readonly key: ShareKey
  /** 未ログインの人に見せる、ログインへの誘い（`main.ts` の `signInUrl`）。 */
  readonly signInUrl: string
}

/**
 * `/share/<鍵>` の公開ページを描く（ADR-0022、#197）。
 *
 * **WebSocket は張らない。** ふだんの画面（`index.ts` の `mount`）と違って接続も名乗りも要らず、
 * 対戦サーバの公開 HTTP の口（`server` の `serve.ts`）へ 1 回 `fetch` するだけで完結する。
 *
 * **Cookie を付けて送る**（`credentials: 'include'`）。ログインしているかをサーバが Cookie で
 * 見分け、能力テキストまで出すかを決める（`PublicShare.authenticated`）。画面と対戦サーバは
 * 別の場所に置かれる（ADR-0013）ので、これはクロスオリジンの要求になる——対戦サーバの側で
 * CORS を許している（`server` の `sign-in.ts` の `allowedOrigin`）。
 */
export async function mountPublicShare(root: HTMLElement, options: PublicShareMountOptions): Promise<void> {
  root.replaceChildren(publicShareLoadingElement())

  let share: PublicShare
  try {
    const response = await fetch(`${options.serverOrigin}${SHARE_PATH_PREFIX}${encodeURIComponent(options.key)}`, {
      credentials: 'include',
    })
    if (!response.ok) {
      root.replaceChildren(publicShareNotFoundElement())
      return
    }

    share = (await response.json()) as PublicShare
  } catch {
    // 繋がらない・JSON として読めない、のどちらも「開けなかった」として同じ形で出す。
    root.replaceChildren(publicShareNotFoundElement())
    return
  }

  root.replaceChildren(publicShareElement(share, publicCardSections(share.cards), options.signInUrl))
}
