/**
 * スマートフォンで、コストを払う一覧（エネルギー・スマッシュ、ADR-0034）をいつまで開いておくか。
 *
 * 払う答えは 1 枚ずつ送る（ADR-0008）。サーバは答えを受け取るたびに「盤面」→「選んでほしい」の順に送り、
 * 受け取った側は「盤面」で選択を畳む（`session.ts`）。その間に一覧を閉じてしまうと、1 枚払うたびに
 * 開き直すことになる。かといって「盤面」だけでは、次の選択が続くのか行動が終わったのかを見分けられない
 * （どちらの盤面も同じ形で届く）ので、次に届くもので決める。
 *
 * 通信にも保存にも混ぜない、画面の中の状態である。
 */
import type { Player, WireChoice, WirePerspective } from '@revolution/engine'
import { choosesFromZone } from './input-model.js'

/** コストを払える置き場。並べる順でもある。 */
export const PAY_ZONES = ['エネルギーゾーン', 'スマッシュゾーン'] as const
export type PayZone = (typeof PAY_ZONES)[number]

export function isPayZone(zone: string): zone is PayZone {
  return (PAY_ZONES as readonly string[]).includes(zone)
}

/** 開いている、払う一覧。 */
export interface PayList {
  readonly player: Player
  /** 開いたときに払うカードがあった置き場。どちらのボタンから開いても同じになる。 */
  readonly zones: readonly PayZone[]
  /** 答えを送って、次の選択か行動の終わりが届くのを待っている。 */
  readonly awaiting: boolean
}

/**
 * 置き場のボタンを押したとき、払う一覧を開くか。押した置き場に払うカードがあるときだけ開く。
 * 払える置き場が両方にあれば（プランのコスト）、どちらを押しても 2 つを 1 つにまとめる。
 * 押した置き場に払うカードが無ければ、見るだけの一覧になるので `undefined`。
 */
export function openPayList(
  board: WirePerspective,
  choice: WireChoice | undefined,
  player: Player,
  pressed: string,
): PayList | undefined {
  if (choice === undefined || !isPayZone(pressed) || !choosesFromZone(board, choice, player, pressed)) return undefined

  return { player, zones: PAY_ZONES.filter((zone) => choosesFromZone(board, choice, player, zone)), awaiting: false }
}

/** 払う一覧の動きに関わる出来事。 */
export type PayListEvent =
  /** 1 枚払う答えを送った。 */
  | { readonly kind: '答えた' }
  /** 行動をやめる答えを送った。 */
  | { readonly kind: 'やめた' }
  /** 盤面が届いた。`actions` は、一緒に届いた行える手の数。 */
  | { readonly kind: '盤面'; readonly actions: number }
  /** 選んでほしいことが届いた。`board` は、そのとき見えている盤面。 */
  | { readonly kind: '選んでほしい'; readonly board: WirePerspective; readonly choice: WireChoice }
  /** 答えたあと、盤面だけで選んでほしいことが続かなかった。 */
  | { readonly kind: '続かなかった' }
  /** 送った答えが断られた。選択はそのまま続いている。 */
  | { readonly kind: '断られた' }

/**
 * 出来事を受けて、払う一覧がどうなるか。閉じるなら `undefined`。
 *
 * - 次の選択が、この一覧の置き場のどれかに払うカードを含んでいれば、開いたまま次の 1 枚を選ばせる。
 *   含まなくなれば閉じる。
 * - 答えたあとの盤面は、まだ閉じない（次の選択が続くかもしれない）。ただし、選んでいる間は行える手が
 *   空で届く（サーバ）ので、行える手が付いてきた盤面は行動が終わったあとのものである。
 * - 答えていないのに盤面が届いたら、見ていた盤面とは別のものになったので閉じる。
 * - 行動をやめたら閉じる。
 */
export function settlePayList(list: PayList | undefined, event: PayListEvent): PayList | undefined {
  if (list === undefined) return undefined

  switch (event.kind) {
    case '答えた':
      return { ...list, awaiting: true }
    case 'やめた':
      return undefined
    case '盤面':
      return list.awaiting && event.actions === 0 ? list : undefined
    case '選んでほしい':
      return list.zones.some((zone) => choosesFromZone(event.board, event.choice, list.player, zone))
        ? { ...list, awaiting: false }
        : undefined
    case '続かなかった':
      return list.awaiting ? undefined : list
    case '断られた':
      return list.awaiting ? { ...list, awaiting: false } : list
  }
}
