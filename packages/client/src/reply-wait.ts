import type { FromClient, ToClient } from '@revolution/engine'
import type { Link } from './connection.js'

/**
 * 対戦の中で送る手（#253）。どれも、サーバが盤面か選んでほしいか行えなかったで必ず返事を返す
 * （`server` の `room.ts` の `act`・`answer`・`rewind`）。
 */
export type DuelMove = Extract<FromClient, { readonly kind: '行動する' | '選ぶ' | 'ひとつ戻る' | '取り消す' }>

/**
 * 手を送ってから、その返事が届くまでの間か（#253、ADR-0054）。
 *
 * 画面は、手を送っても返事が届いて描き直されるまでは送る前のままで、その間もボタンは押せる。
 * 押せば同じ手が 2 通送られ、2 通目も合法なら通ってしまう（優先権の放棄なら、フェイズを 1 つ
 * 飛ばす）。サーバの関門は「今の盤面で行える手か」しか見ないので、止めるのは画面の側である。
 * 通信の形もサーバも変えない。
 *
 * 繋がりが切れたら解き、繋ぎ直して入り直す部屋があれば、入り直しの返事が届くまで待つ
 * （`afterLinkChange`）。時間では解かない。返事が来ないのは繋がりが切れた時に限られ、解いた
 * 直後に押せば、防ぎたい二重送信そのものになる。
 *
 * 描き直しをまたいで持つ。ダイアログや一覧の中だけに持つと、返事より先に別の理由
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
 * 手の返事は `盤面`・`選んでほしい`・`行えなかった` の 3 つで、サーバは手 1 通にこのどれかを必ず
 * 返す。1 つの手に `盤面` と `選んでほしい` が続けて届くこともある（`room.ts` の `advance`）が、
 * どちらで解いても、2 通目は待っていない時に届くだけである。
 *
 * 入り直し（`部屋に入る`）の返事も解く。`席についた`（入り直せた）・`行えなかった`（断られた）・
 * `相手を待っている`（部屋がもう無く、新しく開いた）のどれかで、繋いだ時点でサーバが先に送る
 * `ロビー`（部屋にいない）・`名前を決めてほしい` も、入り直す先の盤面がもう無いことを言っている。
 *
 * `相手の繋がり` とデッキにまつわるものでは解かない。行える手を変えないもので、届いても送った手の
 * 返事ではない。
 *
 * 通信の形では、どの送信への返事かを見分けられない。手の前に送った対戦の手ではないもの（「やめて
 * ロビーに戻る」など）が断られた `行えなかった` でも解ける。窓はとても狭いので受け入れている
 * （ADR-0054 の「前提」）。
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
    case '相手を待っている':
    case 'ロビー':
    case '名前を決めてほしい':
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
 * 繋がりの様子が変わった後の待ち。
 *
 * 切れたら（`繋がっている` 以外）解く。切れる前に送った手の返事はもう来ず、切れている間は手を
 * 出さない（`index.ts` の `draw`）。
 *
 * 繋がった時に入り直す部屋があれば（`rejoining`）、解かずに待つ。`connection.ts` は繋がると
 * `部屋に入る` を送り、サーバはいまの盤面を送り直す（ADR-0009）。その返事が届くまで、画面には
 * 切れる前の盤面と行える手が残っており、そこで押した手は入り直しのすぐ後にサーバに届いて、いまの
 * 盤面で合法なら通ってしまう。切れる前の手を繋ぎ直した先で押させない（ADR-0016）ためにも、
 * 入り直しの返事（`isReply`）が届くまで止める。入り直す部屋が無ければ、待つ返事も無いので解く。
 */
export function afterLinkChange(link: Link, rejoining: boolean): ReplyWait {
  return link.kind === '繋がっている' && rejoining ? WAITING : NOT_WAITING
}

/**
 * 手を送ってよいか。送るなら、送った後の待ちも返す。
 *
 * 待っている間に押されたら送らない（空振り）。押せなくしてあるので、ふつうはここまで来ないが、
 * 描き直しの前に届いた押下（素早い 2 回目のクリック、キーリピート）はここで止まる。
 */
export function trySend(waiting: ReplyWait): { readonly send: boolean; readonly waiting: ReplyWait } {
  return waiting ? { send: false, waiting } : { send: true, waiting: WAITING }
}
