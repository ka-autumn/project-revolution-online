import type { TriggeredAbility } from './ability.js'
import { BATTLE_SPACE, indexOfSquare } from './board.js'
import type { Square } from './board.js'
import type { Card } from './card.js'
import type { Orientation } from './orientation.js'
import { PLAYERS } from './player.js'
import type { Player } from './player.js'
import { firstTurn } from './turn.js'
import type { Turn } from './turn.js'
import { PLAYER_ZONES } from './zone.js'
import type { PlayerZone } from './zone.js'

/**
 * デュエル中、1 枚のカードを指し続ける識別子。
 *
 * カード名では指せない。構築戦では同じカード名のカードをデッキに 4 枚まで入れられる
 * （総合ルール 第3部 第1章 3-1）ため、盤面に持ち込む時に 1 枚ずつ与える。
 */
export type CardId = string

/**
 * デュエル中に存在している 1 枚のカード。
 *
 * 「どのカードか」（`card`）と「誰のカードか」を分けて持つ。
 */
export interface CardInstance {
  readonly id: CardId
  readonly card: Card
  /** 持ち主。デュエル開始時にどちらのデッキにあったかで決まり、デュエル中に変化しない。 */
  readonly owner: Player
  /** 支配者。効果によって持ち主と食い違うことがある。 */
  readonly controller: Player
  /**
   * リリース状態かフリーズ状態か。
   *
   * 向きを持つのはスクエア・トラップゾーン・エネルギーゾーン・スマッシュゾーンにある
   * カードだけである（総合ルール 第2部 第24章 1）。それ以外のゾーンにある間、この値に
   * 意味はない。ゾーンごとに持たせず 1 枚のカードの属性にしているのは、どの向きで置かれる
   * かがゾーン移動のたびに決まる（同 第21章 6-3・7-3・8-3・9-3）ためで、置く側が指定した
   * 向きをそのまま持たせるほうが取り違えにくい。
   */
  readonly orientation: Orientation
}

/**
 * デュエルの進行中の状態すべて。ADR-0001 でいう「盤面」。
 *
 * すべての要素が読み取り専用で、盤面を変える関数は新しい盤面を返す。
 */
export interface DuelState {
  /**
   * バトルスペースの 9 つのスクエアそれぞれにあるカード。`BATTLE_SPACE` と同じ並び。
   *
   * スクエア 1 つにつき 1 枚ではなくカードの並びを持つのは、同じスクエアに複数のカードが
   * 置かれることがあるためである。同じプレイヤーのユニットが重なった場合や、ユニット以外の
   * カードが置かれた場合に、それらを捨札に置くのはルールエフェクトの仕事であって、置くこと
   * 自体は起こる（総合ルール 第4部 第14章 4-7、第2部 第21章 8-4）。並びの後ろが後から
   * 置かれたカードで、ルールエフェクトはこの前後を見る。
   */
  readonly squares: readonly (readonly CardInstance[])[]
  /**
   * プレイヤーごとに存在するゾーンの中身。
   *
   * 山札・捨札のように順番のあるゾーンでは、配列の先頭が「一番上」である
   * （総合ルール 第2部 第21章 2-2・5-2）。
   */
  readonly zones: Readonly<Record<Player, Readonly<Record<PlayerZone, readonly CardInstance[]>>>>
  /**
   * 進行中のターンとフェイズ、そして優先権。
   *
   * カードの位置ではないがここに置いている。どちらのプレイヤーにも見せてよい公開情報
   * であり、視点ごとに射影した盤面（ADR-0004）にもそのまま載るためである。シードや
   * 乱数列を盤面に持たないのは、それを送ると先の山札が読めてしまうからであって、
   * 「カードの位置ではないから」ではない。
   */
  readonly turn: Turn
  /**
   * バンクにある、解決を待っている能力（総合ルール 第2部 第21章 11-1）。
   *
   * 後から入った能力もすでにある能力と同列に扱われる（同 11-2）ため、並びに意味はない。
   * どれを解決するかは、積まれた順ではなく支配者で決まる（同 11-3）。
   */
  readonly bank: readonly TriggeredInstance[]
  /**
   * リゾルブゾーンにあるカード（総合ルール 第2部 第21章 12-1）。
   *
   * プレイされたストラテジー・超必殺ストラテジー！と、発動されたトラップが、解決されて
   * いる間だけここに置かれる。解決の最後にリゾルブゾーンにあるなら持ち主の捨札に置かれる
   * （同 12-3）が、解決の途中で効果によって別のゾーンへ動かされることもあるため、解決中の
   * 置き場所を盤面が持つ必要がある。
   *
   * 両方のプレイヤーが共有するゾーンなので、`zones` ではなくここに置いている。
   */
  readonly resolveZone: readonly CardInstance[]
  /**
   * 誘発したが、まだバンクに入っていない能力。
   *
   * 誘発した時点では何も起こらず、次にどちらかのプレイヤーが優先権を獲得する時に
   * まとめてバンクに入る（総合ルール 第4部 第7章 2・3）。その間の置き場所がここになる。
   */
  readonly triggered: readonly TriggeredInstance[]
  /**
   * 中央エリアのスクエアを指定してプレイされ、そのスクエアに置かれたユニット
   * （総合ルール 第4部 第14章 4-9・4-10）。
   *
   * 中央エリアに置かれたことではなく「中央エリアを指定してプレイされた」ことが条件なので、
   * 効果によって中央エリアに置かれたユニットと区別できるように、プレイした側が覚えておく
   * 必要がある。次にルールエフェクトがチェックされる時に捨札に置かれ、この並びも空になる。
   */
  readonly playedIntoCenter: readonly CardId[]
}

/**
 * 誘発した誘発型能力 1 つ。
 *
 * カードではなく能力がバンクに入る（総合ルール 第2部 第21章 11-1）ため、`CardInstance`
 * とは別に持つ。同じカードの同じ能力が誘発イベントを満たすたびに 1 つずつでき
 * （同 第4部 第7章 6）、解決の最後にバンクから取り除かれて消滅する（同 第8章 2-7）。
 *
 * 誘発してからバンクに入るまでの間も、バンクにある間も、同じ形で持つ。どちらであるかは
 * 盤面のどちらの並びにいるかで決まる。
 */
export interface TriggeredInstance {
  readonly ability: TriggeredAbility
  /** 発生源のカード。 */
  readonly source: CardId
  /**
   * 能力の支配者。発生源の支配者である（総合ルール 第4部 第7章 1）。
   *
   * バンクにある能力の支配者は、その能力が誘発した時に発生源を支配していたプレイヤーで
   * ある（同 第2部 第1章 5-1）ため、誘発した時点の支配者を写して持つ。発生源がスクエアを
   * 離れても能力は残るので、解決する時に発生源から引き直すことはできない。
   */
  readonly controller: Player
}

interface InstanceSpec {
  readonly id: CardId
  readonly card: Card
  readonly owner: Player
  /** 省略した場合は持ち主が支配する。 */
  readonly controller?: Player
  /** 省略した場合はリリース状態。カードは通常リリース状態で置かれる（総合ルール 第2部 第21章 6-3・7-3・9-3）。 */
  readonly orientation?: Orientation
}

/** カードをデュエルに持ち込む。 */
export function instantiate(spec: InstanceSpec): CardInstance {
  return {
    id: spec.id,
    card: spec.card,
    owner: spec.owner,
    controller: spec.controller ?? spec.owner,
    orientation: spec.orientation ?? 'リリース',
  }
}

/**
 * カードが 1 枚も置かれていない、デュエルの最初のターンの盤面。
 *
 * デッキを山札にして初手を引くところまでは、デュエルの準備の仕事なのでここではやらない。
 */
export function emptyDuelState(): DuelState {
  return {
    squares: BATTLE_SPACE.map(() => []),
    zones: { 先攻: emptyZones(), 後攻: emptyZones() },
    turn: firstTurn(),
    bank: [],
    resolveZone: [],
    triggered: [],
    playedIntoCenter: [],
  }
}

// ゾーンを 1 つずつ書いているのは、`PlayerZone` に足したゾーンを埋め忘れたら
// 型検査で落とすため。
function emptyZones(): Record<PlayerZone, readonly CardInstance[]> {
  return {
    山札: [],
    プランゾーン: [],
    手札: [],
    捨札: [],
    エネルギーゾーン: [],
    スマッシュゾーン: [],
    トラップゾーン: [],
    リムーブゾーン: [],
    パートナーゾーン: [],
  }
}

/** そのスクエアにあるカード。後から置かれたものほど後ろにある。 */
export function cardsOn(state: DuelState, square: Square): readonly CardInstance[] {
  return state.squares[indexOfSquare(square)] ?? []
}

/** そのプレイヤーのそのゾーンにあるカード。先頭が「一番上」。 */
export function cardsIn(state: DuelState, player: Player, zone: PlayerZone): readonly CardInstance[] {
  return state.zones[player][zone]
}

/**
 * カードをスクエアに置く。
 *
 * プレイされたユニットがスクエアに置かれることは「登場」と呼ばれ（総合ルール 第2部
 * 第20章 1-4-a）、効果によって置かれる場合と区別される。この関数は置くことそのものだけを
 * 行い、登場かどうかは呼ぶ側が決める。
 */
export function putOnSquare(state: DuelState, square: Square, card: CardInstance): DuelState {
  const index = indexOfSquare(square)
  return {
    ...state,
    squares: state.squares.map((cards, i) => (i === index ? [...cards, card] : cards)),
  }
}

/** そのプレイヤーのそのゾーンにあるそのカード。そこになければ `undefined`。 */
export function findInZone(
  state: DuelState,
  player: Player,
  zone: PlayerZone,
  id: CardId,
): CardInstance | undefined {
  return cardsIn(state, player, zone).find((card) => card.id === id)
}

/** リゾルブゾーンにあるカード（総合ルール 第2部 第21章 12-1）。 */
export function cardsInResolveZone(state: DuelState): readonly CardInstance[] {
  return state.resolveZone
}

/**
 * スクエアにあるカードを、そのカードの持ち主のゾーンの一番上に移す。スクエアになければ
 * 盤面はそのまま。
 *
 * スクエアを離れたカードだけを動かす。破壊やルールエフェクトの対象がすでにスクエアを
 * 離れていた場合に、手札や捨札にあるそのカードまで動かしてしまわないためである。
 */
export function moveFromSquareTo(state: DuelState, id: CardId, zone: PlayerZone): DuelState {
  if (findOnSquares(state, id) === undefined) return state
  return moveToZone(state, id, zone)
}

/**
 * カードをいまある場所から取り除いて、持ち主のゾーンの 1 番上に置く。どこにもなければ
 * 盤面はそのまま。
 *
 * 持ち主以外のゾーンには動かせない。持ち主以外のゾーンに動かされる場合、代わりに持ち主の
 * 該当するゾーンに動かされる（総合ルール 第2部 第21章 1-2）ためである。
 *
 * 動いたカードの支配者は持ち主に戻る。「スクエアからスクエア」以外のゾーン移動をした
 * カードは新しいカードとして扱われ、以前のゾーンに関連した効果は失われる（同 1-4）ため、
 * 支配者を移し替えていた効果もそこで切れる。
 *
 * 置かれる向きはリリース状態になる。エネルギーゾーン・スマッシュゾーン・トラップゾーンの
 * いずれも、カードは通常リリース状態で置かれる（同 6-3・7-3・9-3）。フリーズ状態で置く
 * 効果を書けるようになったら、向きを指定できるようにする。
 */
export function moveToZone(state: DuelState, id: CardId, zone: PlayerZone): DuelState {
  const detached = detach(state, id)
  if (detached === undefined) return state

  const { card } = detached
  const moved: CardInstance = { ...card, controller: card.owner, orientation: 'リリース' }
  return putInZone(detached.state, card.owner, zone, [moved, ...cardsIn(detached.state, card.owner, zone)])
}

/**
 * カードをいまある場所から取り除いてリゾルブゾーンに置く（総合ルール 第4部 第8章 2-1）。
 * どこにもなければ盤面はそのまま。
 *
 * リゾルブゾーンは両方のプレイヤーが共有するゾーンなので、持ち主のゾーンに置き換える
 * 規定（同 第2部 第21章 1-2）は働かない。支配者は、そのカードをプレイまたは発動した
 * プレイヤーのまま変わらない。
 */
export function moveToResolveZone(state: DuelState, id: CardId): DuelState {
  const detached = detach(state, id)
  if (detached === undefined) return state

  return { ...detached.state, resolveZone: [...detached.state.resolveZone, detached.card] }
}

/**
 * カードをいまある場所から取り除いてスクエアに置く。どこにもなければ盤面はそのまま。
 *
 * スクエアに置かれる時、支配者と向きはその場で決まる。プレイされたユニットならプレイした
 * プレイヤーの支配下でフリーズ状態（総合ルール 第2部 第20章 1-4、第21章 8-3）になる。
 * 置くことそのものだけを行い、それが登場かどうかは呼ぶ側が決める（同 第20章 1-4-a）。
 */
export function moveToSquare(
  state: DuelState,
  id: CardId,
  square: Square,
  placement: { readonly controller: Player; readonly orientation: Orientation },
): DuelState {
  const detached = detach(state, id)
  if (detached === undefined) return state

  return putOnSquare(detached.state, square, { ...detached.card, ...placement })
}

/**
 * カードをいまある場所から取り除く。どのゾーンにもスクエアにもなければ `undefined`。
 *
 * カードが同時に 2 か所にあることはないので、見つかったところから取り除けばよい。
 */
function detach(state: DuelState, id: CardId): { readonly state: DuelState; readonly card: CardInstance } | undefined {
  const onSquare = findOnSquares(state, id)
  if (onSquare !== undefined) {
    return {
      state: {
        ...state,
        squares: state.squares.map((cards) => cards.filter((each) => each !== onSquare)),
      },
      card: onSquare,
    }
  }

  const resolving = state.resolveZone.find((card) => card.id === id)
  if (resolving !== undefined) {
    return {
      state: { ...state, resolveZone: state.resolveZone.filter((card) => card !== resolving) },
      card: resolving,
    }
  }

  for (const player of PLAYERS) {
    for (const zone of PLAYER_ZONES) {
      const cards = cardsIn(state, player, zone)
      const found = cards.find((card) => card.id === id)
      if (found !== undefined) {
        return { state: putInZone(state, player, zone, cards.filter((card) => card !== found)), card: found }
      }
    }
  }
  return undefined
}

/**
 * そのプレイヤーのそのゾーンの中身を入れ替える。
 *
 * ゾーンの入れ物の形を知っているのはこのファイルだけにして、ゾーンを変える側が
 * 盤面の作り直し方を書かずに済むようにする。
 */
export function putInZone(
  state: DuelState,
  player: Player,
  zone: PlayerZone,
  cards: readonly CardInstance[],
): DuelState {
  return {
    ...state,
    zones: { ...state.zones, [player]: { ...state.zones[player], [zone]: cards } },
  }
}

/**
 * 山札の 1 番上のカード。山札が空なら `undefined`。
 *
 * プランゾーンにカードがあれば、それが同時に山札の 1 番上のカードでもある
 * （総合ルール 第2部 第21章 3-1）。
 */
export function topOfLibrary(state: DuelState, player: Player): CardInstance | undefined {
  return cardsIn(state, player, 'プランゾーン')[0] ?? cardsIn(state, player, '山札')[0]
}

/**
 * 山札の 1 番上のカードを手札に加える。これを「カードを 1 枚引く」と表現する
 * （総合ルール 第2部 第21章 1-5）。
 *
 * プランゾーンにカードがあるなら、それが山札の 1 番上なのでそれを手札に加える。その後
 * プランゾーンはなくなり、次に現れる山札の 1 番上のカードは裏向きのままになる（同 3-3）。
 *
 * 山札が空なら何も起こらない。山札が 0 枚になったプレイヤーが次に優先権が発生した時に
 * 敗北すること（総合ルール 第3部 第3章 2）は、引けないこととは別のルールエフェクトで
 * あり、デュエルの終了を実装する時に足す。
 */
export function draw(state: DuelState, player: Player): DuelState {
  const top = topOfLibrary(state, player)
  if (top === undefined) return state

  const taken = detach(state, top.id)
  if (taken === undefined) return state

  return putInZone(taken.state, player, '手札', [
    ...cardsIn(taken.state, player, '手札'),
    { ...top, controller: top.owner },
  ])
}

/** スクエアにあるそのカード。どのスクエアにもなければ `undefined`。 */
export function findOnSquares(state: DuelState, id: CardId): CardInstance | undefined {
  for (const cards of state.squares) {
    const found = cards.find((card) => card.id === id)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * スクエアにあるそのカードと、置かれているスクエア。どのスクエアにもなければ `undefined`。
 *
 * カードと位置の両方が要る呼び出し側（`move.ts`）が、`findOnSquares` とスクエアを探す走査を
 * 別々に 2 度行わずに済むように、まとめて 1 回の走査で返す。
 */
export function locateOnSquares(
  state: DuelState,
  id: CardId,
): { readonly instance: CardInstance; readonly square: Square } | undefined {
  const index = state.squares.findIndex((cards) => cards.some((card) => card.id === id))
  const square = BATTLE_SPACE[index]
  const instance = state.squares[index]?.find((card) => card.id === id)
  return instance === undefined || square === undefined ? undefined : { instance, square }
}
