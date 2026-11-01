import type { FromClient, ToClient } from '@revolution/engine'

/**
 * 対戦の中で送る手（#253）。どれも、サーバが盤面か選んでほしいか行えなかったで必ず返事を返す
 * （`server` の `room.ts` の `act`・`answer`・`rewind`）。
 */
export type DuelMove = Extract<FromClient, { readonly kind: '行動する' | '選ぶ' | 'ひとつ戻る' | '取り消す' }>

/**
 * 手を送ってから、その返事が届くまでの間か（#253）。
 *
 * 画面は、手を送っても返事が届いて描き直されるまでは送る前のままで、その間もボタンは押せる。
 * 押せば同じ手が 2 通送られ、2 通目も合法なら通ってしまう（優先権の放棄なら、フェイズを 1 つ
 * 飛ばす）。サーバの関門は「今の盤面で行える手か」しか見ないので、**止めるのは画面の側である。**
 * 通信の形もサーバも変えない。
 *
 * **繋がりの様子が変わったら、どちらへでも解く**（`index.ts` の `onLinkChanged`）。切れている間に送った
 * ものは届かず（`connection.ts`）、切れる前に送ったものの返事ももう来ない。繋ぎ直せばサーバがいまの盤面を
 * 送り直す（ADR-0009）ので、そこからまた押せる。**時間では解かない。** 返事が来ないのは繋がりが切れた時に
 * 限られ、解いた直後に押せば、防ぎたい二重送信そのものになる。
 *
 * **描き直しをまたいで持つ。** ダイアログや一覧の中だけに持つと、返事より先に別の理由
 * （`相手の繋がり`、演出の待ち行列）で描き直された時に、送る前の状態で作り直されて、また
 * 押せるようになる。
 */
export type ReplyWait = boolean

/** 何も送っていない状態。 */
export const NOT_WAITING: ReplyWait = false

/** 手を送って、返事を待っている状態。 */
export const WAITING: ReplyWait = true

/**
 * 届いたものが、待っている返事か。
 *
 * 返事は `盤面`・`選んでほしい`・`行えなかった` の 3 つで、サーバは手 1 通にこのどれかを必ず返す。
 * `席についた` も解く。対戦が始まり直したところで（入り直しを含む）、前の盤面に送った手の返事は
 * 待つものではなくなっている。
 *
 * **`相手の繋がり` では解かない。** 行える手を変えないもので、届いても送った手の返事ではない。
 *
 * 自分が優先権を持つ間（＝手を送れる間）は、相手は何も行えない（`room.ts` の `act` が断る）ので、
 * 送ってから返事までの間に、相手の手による盤面が割り込んで先に解いてしまうことは無い。CPU の手は
 * 自分の手と同じ受け取りの中で打たれ、自分の手の盤面の後に続けて届く（`room.ts` の `withCpu`）。
 */
export function isReply(message: ToClient): boolean {
  switch (message.kind) {
    case '盤面':
    case '選んでほしい':
    case '行えなかった':
    case '席についた':
      return true
    default:
      return false
  }
}

/** メッセージが 1 つ届いた後の待ち。 */
export function afterMessage(waiting: ReplyWait, message: ToClient): ReplyWait {
  return isReply(message) ? NOT_WAITING : waiting
}

/**
 * 手を送ってよいか。送るなら、送った後の待ちも返す。
 *
 * 待っている間に押されたら**送らない**（空振り）。押せなくしてあるので、ふつうはここまで
 * 来ないが、描き直しの前に届いた押下（素早い 2 回目のクリック、キーリピート）はここで止まる。
 */
export function trySend(waiting: ReplyWait): { readonly send: boolean; readonly waiting: ReplyWait } {
  return waiting ? { send: false, waiting } : { send: true, waiting: WAITING }
}
