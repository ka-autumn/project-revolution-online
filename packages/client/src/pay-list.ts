/**
 * スマートフォンで、コストを払う一覧（エネルギー・スマッシュ、ADR-0034）の開閉。
 *
 * 払う答えは 1 枚ずつ送る（ADR-0008）。サーバは答えを受け取るたびに盤面を送り、選択が続くときだけ、そのあとに
 * 「選んでほしい」を送る。受け取った側は盤面で選択を畳む（`session.ts`）。盤面だけでは選択が続くか行動が終わった
 * のか見分けられない（どちらの盤面も同じ形）ので、答えたあとの盤面が届いたら一覧をいったん閉じ、開き直す
 * 予定だけを覚える。続く「選んでほしい」が一覧のゾーンの候補を含んでいれば、同じ一覧を同じ位置で開き直す。
 * 待ち時間で見切ることはしない（回線が遅れても壊れず、行動が終わればすぐ閉じる）。
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

/** 払う一覧。どれを開くかを決めるもの。 */
export interface PayList {
  readonly player: Player
  /** 開いたときに払うカードがあった置き場。どちらのボタンから開いても同じになる。 */
  readonly zones: readonly PayZone[]
  /** 押した置き場。開き直すときも、同じ見出しを基準にする。 */
  readonly pressed: PayZone
}

export type PayState =
  /** 一覧を開いている。`answered` は、払う答えを送って返事を待っている。 */
  | { readonly kind: '開いている'; readonly list: PayList; readonly answered: boolean }
  /** 一覧は閉じている。選択が続けば、同じ一覧を `scroll` の位置で開き直す。 */
  | { readonly kind: '開き直す予定'; readonly list: PayList; readonly scroll: number }

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
): PayState | undefined {
  if (choice === undefined || !isPayZone(pressed) || !choosesFromZone(board, choice, player, pressed)) return undefined

  const zones = PAY_ZONES.filter((zone) => choosesFromZone(board, choice, player, zone))

  return { kind: '開いている', list: { player, zones, pressed }, answered: false }
}

/** 払う一覧の動きに関わる出来事。 */
export type PayEvent =
  /** 1 枚払う答えを送った。 */
  | { readonly kind: '答えた' }
  /** 行動をやめる答えを送った。 */
  | { readonly kind: 'やめた' }
  /** 盤面が届いた。`actions` は一緒に届いた行える手の数、`scroll` は届いた時点の一覧のスクロールの位置。 */
  | { readonly kind: '盤面'; readonly actions: number; readonly scroll: number }
  /** 選んでほしいことが届いた。`board` は、そのとき見えている盤面。 */
  | { readonly kind: '選んでほしい'; readonly board: WirePerspective; readonly choice: WireChoice }
  /** 送った答えが断られた。選択はそのまま続いている。 */
  | { readonly kind: '断られた' }
  /** 席についた・繋がりが切れた・対戦を離れたなど、一覧にも予定にも続きが無くなった。 */
  | { readonly kind: '捨てる' }

/**
 * 出来事を受けた、払う一覧の状態。何も無くなれば `undefined`。
 *
 * - 答えたあとの盤面は、一覧を閉じて開き直す予定にする。行える手が付いてきた盤面は行動が終わったあとのもの
 *   （選んでいる間、サーバは行える手を空で送る）なので、予定も残さない。答えていないのに届いた盤面も同じ。
 * - 予定のあとに届いた選択が、一覧の置き場のどれかに払うカードを含めば、一覧を開き直す。含まなければ予定を捨てる。
 *   予定を捨てたあとに選択が遅れて届いても、予定が無いので開かない。
 * - 選択以外のものが予定のあとに届いたら、予定を捨てる。
 */
export function settlePayState(state: PayState | undefined, event: PayEvent): PayState | undefined {
  if (state === undefined) return undefined

  switch (event.kind) {
    case '答えた':
      return state.kind === '開いている' ? { ...state, answered: true } : state
    case 'やめた':
    case '捨てる':
      return undefined
    case '盤面':
      return state.kind === '開いている' && state.answered && event.actions === 0
        ? { kind: '開き直す予定', list: state.list, scroll: event.scroll }
        : undefined
    case '選んでほしい': {
      const holds = state.list.zones.some((zone) => choosesFromZone(event.board, event.choice, state.list.player, zone))
      if (!holds) return undefined

      return state.kind === '開いている' ? { ...state, answered: false } : { kind: '開いている', list: state.list, answered: false }
    }
    case '断られた':
      return state.kind === '開いている' ? { ...state, answered: false } : undefined
  }
}
