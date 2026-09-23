import { SHARE_PATH_PREFIX } from '@revolution/engine'
import type { PublicShare, ShareKey } from '@revolution/engine'
import { connect } from './connection.js'
import { copyOutcomeOf, publicCardSections, rememberPendingShare } from './recipe.js'
import type { CopyState } from './recipe.js'
import { publicShareElement, publicShareLoadingElement, publicShareNotFoundElement } from './render.js'

export interface PublicShareMountOptions {
  /** 対戦サーバの HTTP の置き場（`main.ts` の `httpOrigin`）。 */
  readonly serverOrigin: string
  /** 対戦サーバの WebSocket の URL（`main.ts` の `serverUrl`）。「コピーする」を押した時だけ使う。 */
  readonly wsUrl: string
  /** この画面の名乗り（`main.ts` の `participantId`）。「コピーする」を押した時だけ使う。 */
  readonly participant: string
  readonly key: ShareKey
  /** 未ログインの人に見せる、ログインへの誘い（`main.ts` の `signInUrl`）。 */
  readonly signInUrl: string
}

/** `/share/<鍵>` を読んだ結果（ADR-0022、#197）。DOM に触れない——`mountPublicShare` が描き分ける。 */
export type PublicShareLoad = { readonly kind: '読めた'; readonly share: PublicShare } | { readonly kind: '開けなかった' }

/**
 * `/share/<鍵>` を対戦サーバの公開 HTTP の口へ尋ねる（ADR-0022、#197）。
 *
 * DOM に触れない。届かなかった・200 でない・JSON として読めない、のどれも「開けなかった」
 * として同じ形で返す——`serve.ts` の側も、取り消された共有と知らない鍵を見分けて返さない
 * （`handlePublicShare`）ので、こちらも区別する理由が無い。
 *
 * Cookie を付けて送る（`credentials: 'include'`）。ログインしているかをサーバが Cookie で
 * 見分け、能力テキストまで出すかを決める（`PublicShare.authenticated`）。画面と対戦サーバは
 * 別の場所に置かれる（ADR-0013）ので、これはクロスオリジンの要求になる——対戦サーバの側で
 * CORS を許している（`server` の `sign-in.ts` の `allowedOrigin`）。
 */
export async function loadPublicShare(serverOrigin: string, key: ShareKey): Promise<PublicShareLoad> {
  try {
    const response = await fetch(`${serverOrigin}${SHARE_PATH_PREFIX}${encodeURIComponent(key)}`, {
      credentials: 'include',
    })
    if (!response.ok) return { kind: '開けなかった' }

    return { kind: '読めた', share: (await response.json()) as PublicShare }
  } catch {
    return { kind: '開けなかった' }
  }
}

/**
 * `/share/<鍵>` の公開ページを描く（ADR-0022、#197）。
 *
 * 読み込みは `fetch` 1 回（`loadPublicShare`）で、WebSocket を張らない。ふだんの画面
 * （`index.ts` の `mount`）と違って接続も名乗りも要らない。
 *
 * 「コピーする」を押すまでは、それも張らない。繋いだ接続に対して対戦サーバは必ず 3 つの
 * ことをする——全カードの表記を送る（`sendPool`）・持っていなければ既製デッキを 1 つ配る
 * （`sendOwnDecks`）・表示名が無ければ尋ねてほかを全部はねる（ADR-0020）。見るだけで満足する
 * 人全員にこれを引き受けさせないため、繋ぐのはコピーする意思がある人だけにする。
 */
export async function mountPublicShare(root: HTMLElement, options: PublicShareMountOptions): Promise<void> {
  root.replaceChildren(publicShareLoadingElement())

  const loaded = await loadPublicShare(options.serverOrigin, options.key)
  if (loaded.kind === '開けなかった') {
    root.replaceChildren(publicShareNotFoundElement())
    return
  }

  const share = loaded.share
  let copyState: CopyState = { kind: '未着手' }

  function render(): void {
    const onLogin = (): void => rememberPendingShare(sessionStorage, options.key)
    root.replaceChildren(publicShareElement(share, publicCardSections(share.cards), options.signInUrl, onLogin, copyState, startCopy))
  }

  /**
   * 押された時に初めて繋ぐ（ADR-0022、#197）。`shareId` は `share.share`——未ログインでは
   * `undefined` で、その場合はボタン自体を出さない（`render.ts` の `publicShareElement`）ので
   * ここが呼ばれることはない。
   */
  function startCopy(): void {
    const shareId = share.share
    if (shareId === undefined || copyState.kind !== '未着手') return

    copyState = { kind: '繋いでいます' }
    render()

    // 1 度だけ送る。繋ぎ直しで `繋がっている` が 2 度届くことがある（`connection.ts`）ので、
    // 送ったことを覚えておく。
    let sent = false
    const connection = connect({
      url: options.wsUrl,
      participant: options.participant,
      // どこの部屋にもいない。入り直す先を持たない一回きりの接続である。
      rejoining: () => undefined,
      onLinkChanged: (link) => {
        if (link.kind !== '繋がっている' || sent) return

        sent = true
        connection.send({ kind: 'デッキをコピーする', origin: { kind: '共有レシピ', share: shareId } })
      },
      onMessage: (message) => {
        const outcome = copyOutcomeOf(message)
        if (outcome === undefined) return

        copyState = outcome
        connection.close()
        render()
      },
    })
  }

  render()
}
