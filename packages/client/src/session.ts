import type {
  DeckId,
  DeckViolation,
  LegalAction,
  LoggedEvent,
  Opponent,
  PassOutcome,
  Player,
  RecipeListOrder,
  RoomCode,
  ToClient,
  WireChoice,
  WireDeck,
  WireOwnedDeck,
  WirePerspective,
  WirePoolCard,
  WireRecipe,
  WireRecipeSummary,
  WireRestrictionList,
  WireRoom,
  WireShare,
} from '@revolution/engine'

/**
 * クライアントがいまどこにいるか。
 *
 * 5 つしか無く、どれになるかはサーバから届いたもので決まる。「盤面が届いているか」のような
 * 述語をいくつも並べるかわりに、なりうる形そのものを数え上げている。
 */
export type Stage =
  | {
      /** 繋いだが、まだ何も届いていない。 */
      readonly kind: '繋いでいる'
    }
  | {
      /**
       * 表示名を決めるまで、ほかへは進めない（ADR-0020）。
       *
       * **画面は名前が要るかどうかを判断しない**（ADR-0010、ADR-0019）。サーバが尋ねてきたから
       * ここにいるのであり、決まりに通ったかどうかもサーバが決める。
       */
      readonly kind: '名前を決める'
      /** いま付いている名前。まだ決めていなければ `undefined`。 */
      readonly current: string | undefined
      /** 送ったものが通らなかった理由。初めて尋ねられた時は `undefined`。 */
      readonly reason: string | undefined
    }
  | {
      /** どの部屋にもいない。開いている部屋を見て、作るか入るかを選ぶ（#175）。 */
      readonly kind: 'ロビー'
      readonly rooms: readonly WireRoom[]
      /**
       * コピーして自分のデッキにできる既製デッキ（ADR-0021、ADR-0022）。**届いたものをそのまま出す。**
       *
       * 画面はどんなデッキがあるかを知らない。名前も識別子もサーバから届く値で、カードの表記と
       * 同じである（ADR-0010）。
       *
       * **席に着く時に選ぶものではない**（#194）。座るのは自分のデッキ（`Session.ownedDecks`）で、
       * これはデッキを組むところにコピー元として並ぶ。
       */
      readonly presets: readonly WireDeck[]
      /**
       * 何も選ばずに座った時に使われる自分のデッキ（ADR-0021、#194）。**選んだ状態で出す。**
       *
       * 自分のデッキを持てない立て方では `undefined` で、その時は既製デッキで座る。**画面は
       * どれが既定かを決めない**（ADR-0010）——前に選んだものが残っているかを見るのはサーバである。
       */
      readonly chosen: DeckId | undefined
      /**
       * CPU の席に何も選ばずに座らせた時に使われるデッキ（ADR-0021、#195）。`chosen` と同じく、
       * **選んだ状態で出す。** どれを既定にするかを決めるのはサーバである（ADR-0010）。
       */
      readonly cpuChosen: DeckId | undefined
      /**
       * 部屋を作る時に選べる禁止／制限リスト（ADR-0021）。**届いたものをそのまま出す。** 空でよい。
       *
       * デッキと同じく、名前も識別子もサーバから届く値である。
       */
      readonly restrictions: readonly WireRestrictionList[]
    }
  | {
      /** 部屋に入って、相手が来るのを待っている。 */
      readonly kind: '相手を待っている'
      /**
       * いる部屋の合言葉。
       *
       * **繋ぎ直す時に入り直す先である**（`connection.ts`）。部屋を作った時の合言葉を決めるのは
       * サーバなので（ADR-0009、#175）、届いたものをここに持つ。
       */
      readonly room: RoomCode
    }
  | {
      /** 席について打っている。 */
      readonly kind: '打っている'
      /** いる部屋の合言葉。`相手を待っている` と同じ理由で持つ。 */
      readonly room: RoomCode
      /**
       * 誰と打っているか。人が相手なら表示名も入る（ADR-0020）。
       *
       * **投げ出せる対戦かがこれで決まる**（#175）。
       */
      readonly opponent: Opponent
      /**
       * 相手が繋がっているか（#175）。決めているのはサーバである（`server` の `serve.ts`）。
       *
       * 繋がっていない間、その対戦は投げ出せる（同 `room.ts` の `canLeave`）。**繋がっていた
       * ものとして始める。** 席についた時点では相手も繋がっており、変わったらそう届く。
       */
      readonly opponentConnected: boolean
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
  /**
   * デッキに入れられるカード全部（ADR-0021）。届いていなければ `undefined`。
   *
   * **`Stage` の中ではなくここに持つ。** 届くのは名前を決めた後に 1 度だけで（`server` の
   * `serve.ts` の `admit`）、その後ロビーに出ても部屋に入っても変わらない。ログインを持たない
   * 立て方では届かないので、`undefined` のままであることが「デッキを組めない」ことになる。
   *
   * 並び順に意味は無い。画面は識別子で引き、並べる順は画面が決める。
   */
  readonly pool: readonly WirePoolCard[] | undefined
  /**
   * いま持っている自分のデッキ全部（ADR-0021）。届いていなければ `undefined`。
   *
   * `pool` と同じ理由でここに持つ。**まるごと届くのは繋いだ時だけ**（ADR-0026）。保存・コピー・
   * 削除のたびには、変わった 1 件（`デッキを保存した`・`デッキを消した`）が届くので、ここで
   * 差分を当てる（`withSavedDeck`、`デッキを消した` は `applyMessage` の中で直接取り除く）。
   */
  readonly ownedDecks: readonly WireOwnedDeck[] | undefined
  /**
   * 最後に保存したデッキと、構築戦の規定を満たしていない点。まだ保存していなければ `undefined`。
   *
   * **新しく作ったデッキの識別子は、ここで初めて分かる。**
   */
  readonly saved: { readonly deck: DeckId; readonly violations: readonly DeckViolation[] } | undefined
  /**
   * 最後に確かめたデッキが、選んだルールで通らない点（ADR-0021）。まだ確かめていなければ `undefined`。
   *
   * **どのデッキをどのルールで確かめたかは覚えていない。** 返事には添えられておらず、送ったものの
   * ほうを覚えているのは画面である。
   */
  readonly checked: readonly DeckViolation[] | undefined
  /**
   * いま持っている自分の共有全部（ADR-0022）。届いていなければ `undefined`。
   *
   * `ownedDecks` と同じ理由でここに持つ。共有・取り消し・公開範囲の変更のたびに、まるごと届き直す。
   */
  readonly myShares: readonly WireShare[] | undefined
  /** 最後に共有できた共有（ADR-0022）。**画面はここからリンクを組み立てる。** */
  readonly sharedShare: WireShare | undefined
  /**
   * 最後に尋ねたレシピへの返事（ADR-0022）。まだ届いていなければ `undefined`。
   *
   * **どの鍵を尋ねたかは覚えていない。** `デッキを確かめた` と同じで、送った順に届くので、
   * 尋ねた側（`index.ts`）が最後に尋ねた鍵を覚えておく。
   */
  readonly recipeView: { readonly recipe: WireRecipe | undefined } | undefined
  /** 最後に尋ねた一覧への返事（ADR-0022）。まだ届いていなければ `undefined`。 */
  readonly recipeList: { readonly order: RecipeListOrder; readonly recipes: readonly WireRecipeSummary[] } | undefined
}

/** 繋いだ直後の状態。 */
export function connecting(): Session {
  return {
    stage: { kind: '繋いでいる' },
    refusal: undefined,
    pool: undefined,
    ownedDecks: undefined,
    saved: undefined,
    checked: undefined,
    myShares: undefined,
    sharedShare: undefined,
    recipeView: undefined,
    recipeList: undefined,
  }
}

/**
 * いま入っている部屋の合言葉。どこにもいなければ `undefined`（#175）。
 *
 * **繋ぎ直した時に入り直す先である**（`connection.ts`）。部屋にいるかどうかは、いまどこに
 * いるか（`Stage`）そのものなので、別に覚えない。
 */
export function roomOf(session: Session): RoomCode | undefined {
  const stage = session.stage

  return stage.kind === '相手を待っている' || stage.kind === '打っている' ? stage.room : undefined
}

/**
 * 保存した 1 件を、覚えている自分のデッキに当てる（ADR-0026）。
 *
 * **同じ識別子があれば置き換え、無ければ末尾に足す。** 置き場の `decksOf` も作った順に並ぶ
 * （`store.ts`）ので、新しく作ったものは常に末尾になる。まだ何も届いていなければ、この 1 件
 * だけの並びにする——繋ぐ前にデッキ操作は行えないはずだが、順序を仮定せずに済む形にしておく。
 */
function withSavedDeck(
  owned: readonly WireOwnedDeck[] | undefined,
  saved: WireOwnedDeck,
): readonly WireOwnedDeck[] {
  if (owned === undefined) return [saved]

  return owned.some((deck) => deck.id === saved.id)
    ? owned.map((deck) => (deck.id === saved.id ? saved : deck))
    : [...owned, saved]
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
 *
 * **どの場面に移っても、カードプールと自分のデッキは持ち越す。** 場面ごとに届くものではない
 * （`Session.pool`）ので、ここで落とすと届き直さない。
 */
export function applyMessage(session: Session, message: ToClient): Session {
  const stage = session.stage
  switch (message.kind) {
    case 'ロビー':
      return {
        ...session,
        stage: {
          kind: 'ロビー',
          rooms: message.rooms,
          presets: message.presets,
          chosen: message.chosen,
          // 古いサーバからは付いてこない。その時は `undefined`（既定が決まっていないのと同じ）になる。
          cpuChosen: message.cpuChosen,
          // **届かなかったものを、在るものとして扱わない**（`view-model.ts` の `occupantsLine`）。
          // サーバが古ければ付いてこない。選べるリストが無いだけで、部屋は作れる。
          restrictions: (message.restrictions as typeof message.restrictions | undefined) ?? [],
        },
        refusal: undefined,
      }
    case '名前を決めてほしい':
      // 断られた理由は `名前を決めてほしい` が自分で持つ（ADR-0020）。ここに残すと、名前の
      // ことなのか 1 つ前に送った手のことなのかが読めなくなる。
      return {
        ...session,
        stage: { kind: '名前を決める', current: message.current, reason: message.reason },
        refusal: undefined,
      }
    case '相手を待っている':
      return { ...session, stage: { kind: '相手を待っている', room: message.room }, refusal: undefined }
    case '席についた':
      return {
        ...session,
        stage: {
          kind: '打っている',
          room: message.room,
          opponent: message.opponent,
          opponentConnected: true,
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
        ...session,
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
    case '相手の繋がり':
      // 席につく前には届かない（`server` の `serve.ts`）。届いても置く先が無いので捨てる。
      if (stage.kind !== '打っている') return session

      return { ...session, stage: { ...stage, opponentConnected: message.connected } }
    case '選んでほしい':
      if (stage.kind !== '打っている') return session

      // 選んでいる間は行えることが無い。サーバも `選ぶのを待っている` として断る（`room.ts` の
      // `act`）ので、1 つ前の盤面と一緒に届いた手をそのまま並べ続けてはならない。
      return {
        ...session,
        stage: { ...stage, actions: [], passOutcome: undefined, choice: message.choice },
        refusal: undefined,
      }
    case '行えなかった':
      return { ...session, refusal: message.reason }
    // デッキにまつわるものは場面を変えない。部屋にいる間に届いても覚えておく。
    case 'カードプール':
      return { ...session, pool: message.cards }
    case '自分のデッキ':
      return { ...session, ownedDecks: message.decks }
    case 'デッキを保存した':
      return {
        ...session,
        ownedDecks: withSavedDeck(session.ownedDecks, message.deck),
        saved: { deck: message.deck.id, violations: message.violations },
      }
    case 'デッキを消した':
      return { ...session, ownedDecks: session.ownedDecks?.filter((deck) => deck.id !== message.deck) }
    case 'デッキを確かめた':
      return { ...session, checked: message.violations }
    case '共有した':
      return { ...session, sharedShare: message.share }
    case '自分の共有':
      return { ...session, myShares: message.shares }
    case 'レシピ':
      return { ...session, recipeView: { recipe: message.recipe } }
    case 'レシピの一覧':
      return { ...session, recipeList: { order: message.order, recipes: message.recipes } }
  }
}
