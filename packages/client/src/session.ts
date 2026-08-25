import type {
  LegalAction,
  LoggedEvent,
  PassOutcome,
  Player,
  ToClient,
  WireChoice,
  WirePerspective,
} from '@revolution/engine'

/**
 * クライアントがいまどこにいるか。
 *
 * 3 つしか無く、どれになるかはサーバから届いたもので決まる。「盤面が届いているか」のような
 * 述語をいくつも並べるかわりに、なりうる形そのものを数え上げている。
 */
export type Stage =
  | {
      /** 繋いだが、まだ何も届いていない。 */
      readonly kind: '繋いでいる'
    }
  | {
      /** 部屋に入って、相手が来るのを待っている。 */
      readonly kind: '相手を待っている'
    }
  | {
      /** 席について打っている。 */
      readonly kind: '打っている'
      readonly seat: Player
      /** 席についた直後、最初の盤面が届くまでは `undefined`。 */
      readonly board: WirePerspective | undefined
      /** いま行える手。優先権を持っていなければ空（`server` の `room.ts` の `boards`）。 */
      readonly actions: readonly LegalAction[]
      /**
       * いま優先権を放棄したら何が起きるか（#130）。
       *
       * 決めているのはサーバである（`progress.ts` の `passOutcome`、ADR-0010）。放棄の見出しを
       * 場面で変えるのに使う（`input-model.ts` の `labelOf`）。
       */
      readonly passOutcome: PassOutcome | undefined
      /** 答えを待たれている選択。待たれていなければ `undefined`。 */
      readonly choice: WireChoice | undefined
      /**
       * この盤面で新しく届いたできごと（#104）。最初の盤面と入り直しでは空。
       *
       * ログは毎回まるごと届く（ADR-0011）ので、**1 つ前の盤面のログの長さから先**が新しい分に
       * なる。行き先が見えなくなったできごとは後から名指しが落ちる（`perspective.ts`）ので、
       * 中身を見比べてはならない。長さで切る。
       */
      readonly fresh: readonly LoggedEvent[]
    }

/**
 * サーバから届いたものを畳んだ、いまのクライアントの状態（ADR-0010）。
 *
 * **ここにルールの判断は無い。** 届いたものを覚えているだけで、次に何を行えるかを決めているのは
 * サーバである。行える手も、選ぶ候補も、盤面と一緒に送られてくる。
 *
 * 通信の手立ても持たない。`ToClient` を 1 つ受け取って次の状態を返す純粋な関数（`applyMessage`）
 * だけを公開し、ソケットを張るのは `connection.ts` の仕事にしている。盤面を進めるところ
 * （ADR-0001）や部屋の決まりごと（`server` の `room.ts`）と同じ分け方である。
 */
export interface Session {
  readonly stage: Stage
  /**
   * 直前に断られた理由。断られていなければ `undefined`。
   *
   * 席につく前にも断られる（部屋がいっぱい、名乗っていない）ので、`Stage` の中ではなくここに
   * 持つ。
   */
  readonly refusal: string | undefined
}

/** 繋いだ直後の状態。 */
export function connecting(): Session {
  return { stage: { kind: '繋いでいる' }, refusal: undefined }
}

/**
 * 届いたメッセージ 1 つを畳み込む。
 *
 * 盤面が届いたら、選択と断られた理由は消える。どちらも 1 つ前の行動についてのことで、盤面が
 * 動いた時点で答えるものも直すものも無くなっている。
 *
 * 席につく前に盤面が届くことは無い。デュエルが始まる時も、切れて入り直した時も、サーバは
 * `席についた` を先に送る（`server` の `room.ts` の `start`・`rejoin`）。それでも届いたなら
 * 席が分からず盤面を置く先が無いので、捨てる。
 */
export function applyMessage(session: Session, message: ToClient): Session {
  const stage = session.stage
  switch (message.kind) {
    case '相手を待っている':
      return { stage: { kind: '相手を待っている' }, refusal: undefined }
    case '席についた':
      return {
        stage: {
          kind: '打っている',
          seat: message.seat,
          board: undefined,
          actions: [],
          passOutcome: undefined,
          choice: undefined,
          fresh: [],
        },
        refusal: undefined,
      }
    case '盤面': {
      if (stage.kind !== '打っている') return session

      // 最初の盤面には比べる相手がいない。入り直しても最初の盤面から届く（ADR-0009）ので、
      // ここでも履歴を演出し直さない。
      const fresh = stage.board === undefined ? [] : message.perspective.log.slice(stage.board.log.length)
      return {
        stage: {
          ...stage,
          board: message.perspective,
          actions: message.actions,
          passOutcome: message.passOutcome,
          choice: undefined,
          fresh,
        },
        refusal: undefined,
      }
    }
    case '選んでほしい':
      if (stage.kind !== '打っている') return session

      // 選んでいる間は行えることが無い。サーバも `選ぶのを待っている` として断る（`room.ts` の
      // `act`）ので、1 つ前の盤面と一緒に届いた手をそのまま並べ続けてはならない。
      return { stage: { ...stage, actions: [], passOutcome: undefined, choice: message.choice }, refusal: undefined }
    case '行えなかった':
      return { ...session, refusal: message.reason }
  }
}
