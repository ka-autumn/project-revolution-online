import type { TriggeredAbility } from './ability.js'
import { BATTLE_SPACE, indexOfSquare } from './board.js'
import type { Square } from './board.js'
import type { Card } from './card.js'
import type { Player } from './player.js'
import { firstTurn } from './turn.js'
import type { Turn } from './turn.js'
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
}

/**
 * デュエルの進行中の状態すべて。ADR-0001 でいう「盤面」。
 *
 * すべての要素が読み取り専用で、盤面を変える関数は新しい盤面を返す。
 *
 * リゾルブゾーンはまだ持っていない。カードのプレイと組でしか意味を持たないため、
 * プレイを実装する時に足す。
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
   * 誘発したが、まだバンクに入っていない能力。
   *
   * 誘発した時点では何も起こらず、次にどちらかのプレイヤーが優先権を獲得する時に
   * まとめてバンクに入る（総合ルール 第4部 第7章 2・3）。その間の置き場所がここになる。
   */
  readonly triggered: readonly TriggeredInstance[]
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
}

/** カードをデュエルに持ち込む。 */
export function instantiate(spec: InstanceSpec): CardInstance {
  return {
    id: spec.id,
    card: spec.card,
    owner: spec.owner,
    controller: spec.controller ?? spec.owner,
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
    triggered: [],
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

/**
 * スクエアにあるカードを、そのプレイヤーのゾーンの一番上に移す。スクエアになければ
 * 盤面はそのまま。
 *
 * スクエアから出たカードの支配者は持ち主に戻る。「スクエアからスクエア」以外のゾーン移動を
 * したカードは新しいカードとして扱われ、以前のゾーンに関連した効果は失われる
 * （総合ルール 第2部 第21章 1-4）ため、支配者を移し替えていた効果もそこで切れる。
 */
export function moveFromSquareTo(state: DuelState, id: CardId, zone: PlayerZone): DuelState {
  const card = findOnSquares(state, id)
  if (card === undefined) return state

  const moved: CardInstance = { ...card, controller: card.owner }
  const removed: DuelState = {
    ...state,
    squares: state.squares.map((cards) => (cards.includes(card) ? cards.filter((each) => each !== card) : cards)),
  }
  return putInZone(removed, card.owner, zone, [moved, ...cardsIn(removed, card.owner, zone)])
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
 * 山札の 1 番上のカードを手札に加える。これを「カードを 1 枚引く」と表現する
 * （総合ルール 第2部 第21章 1-5）。
 *
 * 山札が空なら何も起こらない。山札が 0 枚になったプレイヤーが次に優先権が発生した時に
 * 敗北すること（総合ルール 第3部 第3章 2）は、引けないこととは別のルールエフェクトで
 * あり、デュエルの終了を実装する時に足す。
 */
export function draw(state: DuelState, player: Player): DuelState {
  const [top, ...rest] = cardsIn(state, player, '山札')
  if (top === undefined) return state

  const taken = putInZone(state, player, '山札', rest)
  return putInZone(taken, player, '手札', [...cardsIn(taken, player, '手札'), top])
}

/** スクエアにあるそのカード。どのスクエアにもなければ `undefined`。 */
export function findOnSquares(state: DuelState, id: CardId): CardInstance | undefined {
  for (const cards of state.squares) {
    const found = cards.find((card) => card.id === id)
    if (found !== undefined) return found
  }
  return undefined
}
