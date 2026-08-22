import type { CreatedTriggeredAbility, IntrusionOccasion, TriggeredAbility } from './ability.js'
import type { Battle } from './battle.js'
import { BATTLE_SPACE, indexOfSquare } from './board.js'
import type { Square } from './board.js'
import type { Card } from './card.js'
import type { UnitOnSquare } from './effect.js'
import type { DuelEvent } from './log.js'
import type { Orientation } from './orientation.js'
import { PLAYERS } from './player.js'
import type { Player } from './player.js'
import type { SmashJudgment } from './smash.js'
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
  /**
   * そのカードが受けているダメージの量（総合ルール 第4部 第14章 4-6）。
   *
   * 意味を持つのはスクエアにあるカードだけである。ダメージはリカバリーフェイズの始めに
   * 取り除かれる（同 第3部 第10章 1）ほか、「スクエアからスクエア」以外のゾーン移動をした
   * カードは新しいカードとして扱われる（同 第2部 第21章 1-4）ので、そこでも失われる。
   * 移動でスクエアからスクエアへ動いた場合は維持される。
   */
  readonly damage: number
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
   * プレイヤーが受けているダメージの量（総合ルール 第3部 第9章 1）。
   *
   * カードが受けているダメージ（`CardInstance.damage`）と同じく蓄積する。合計 1000 以上に
   * なるとスマッシュ判定が発生し（同 第4部 第14章 4-12）、その回復ステップで 1000 の
   * 倍数の分だけ回復する（同 第3部 第18章 1）ため、1000 未満の端数はそこに残る。残った
   * ダメージはリカバリーフェイズの始めに取り除かれる（同 第10章 1）。
   */
  readonly damage: Readonly<Record<Player, number>>
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
  readonly bank: readonly BankedAbility[]
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
  readonly triggered: readonly BankedAbility[]
  /**
   * カードや能力によって作成された、まだ誘発していない誘発型能力
   * （総合ルール 第4部 第3章 4）。
   *
   * どのカードにも書かれていない能力なので、スクエアにあるカードを走査しても見つからない
   * （`trigger.ts` の `triggeredOnSquares`）。盤面が直接持つ場所がここになる。
   */
  readonly createdAbilities: readonly CreatedAbility[]
  /**
   * 中央エリアのスクエアを指定してプレイされ、そのスクエアに置かれたユニット
   * （総合ルール 第4部 第14章 4-9・4-10）。
   *
   * 中央エリアに置かれたことではなく「中央エリアを指定してプレイされた」ことが条件なので、
   * 効果によって中央エリアに置かれたユニットと区別できるように、プレイした側が覚えておく
   * 必要がある。
   *
   * **ここにあるのは、いずれかのスクエアにあるユニットだけである。** 対象になるのは
   * 「いずれかのスクエアに置かれていれば」（同 第3部 第16章 2-2）なので、スクエアを
   * 離れてゾーンへ動いた時点でここから落ちる（`moveToZone`）。スクエアからスクエアへ
   * 動いただけなら残る。読む側は、まだスクエアにあるかどうかを確かめ直さなくてよい。
   */
  readonly playedIntoCenter: readonly CardId[]
  /**
   * トラップゾーンにあり、発動条件が満たされているカード（総合ルール 第2部 第20章 3-8）。
   *
   * 発動条件が満たされたこと（`trap.ts` の `checkIntrusion`）を持続する状態として持たせ、
   * 優先権をパスした時（`loseTrapRightOnPass`）や、そのカードがトラップゾーンを離れた時
   * （`detach`）に取り除く。
   *
   * 発動する権利そのものではない。権利は「優先権を得る時」に発生するもので、その時に
   * バトルまたはスマッシュ判定が発生していれば、それが終了するまで発生しない（同 3-8 の
   * ただし書き）。権利があるかどうかは、この並びと進行中のバトル・スマッシュ判定から
   * `trap.ts` の `trapRightOf` が決める。
   */
  readonly trapConditionsMet: readonly TrapConditionMet[]
  /**
   * 「勇気」の起動条件が満たされているプレイヤーと、そのできごと
   * （総合ルール 第5部 第2章 2）。
   *
   * `trapConditionsMet` と同じく、満たされたことを持続する状態として持ち、優先権をパスした時
   * （`courage.ts` の `loseCourageRightOnPass`）に取り除く。
   *
   * **入れ物を分けているのは、紐づく先が違うためである。** トラップの発動条件はトラップ
   * ゾーンにある 1 枚に紐づき、発動すればそのカードがゾーンを離れて消える。「勇気」の起動
   * 条件は手札を持つプレイヤーに紐づき、起動しても消えない。同一のイベントによって複数の
   * 勇気を起動できる（同 3）ためである。
   */
  readonly courageConditionsMet: readonly CourageConditionMet[]
  /**
   * 進行中のバトル（総合ルール 第3部 第11章）。発生していなければ `undefined`。
   *
   * バトルはルールエフェクトによって発生する特別な手順であり（同 1）、5 つのステップの間、
   * フェイズに代わって優先権のやりとりを受け持つ（同 3、第4章 4）。フェイズと違って
   * 起きていないこともあるので、`turn` とは別にここに持つ。
   *
   * 1 つしか持てない。複数のスクエアで同時に起こるバトル（同 1-3）も、バトル中に発生する
   * バトル（同 2-1）も、ユニットがスクエアに置かれるのが 1 枚ずつである今は起こらない。
   * 効果でユニットをスクエアに置けるようになったら、並びにして持つ必要が出る。
   */
  readonly battle: Battle | undefined
  /**
   * 発生しているスマッシュ判定（総合ルール 第3部 第17章）。発生していなければ空。
   *
   * バトルと同じく、ルールエフェクトによって発生し、バンクを使用しない特別な手順である
   * （同 1）。ステップの間、フェイズに代わって優先権のやりとりを受け持つ。
   *
   * 並びの最後が処理中のスマッシュ判定で、その前にあるものは「待機中のスマッシュ判定」で
   * ある（同 2-2）。スマッシュ判定中にスマッシュ判定が発生した場合、先に発生していたほうが
   * 待機中になり、後から発生したほうを先に処理する。**判定の最中にスマッシュはできない**
   * （ADR-0012）ので、これが起こる経路は判定の中で解決される効果が与えるダメージ——希望
   * （同 第19章 1）と、判定中の新しいバンクで解決される能力（同 第17章 2）——である。
   * 同 第20章 1 の【例】にある「相手に1000ダメージ！」の希望がその形にあたる。
   *
   * バトル中のスマッシュ判定（同 第11章 2-2）とスマッシュ判定中のバトル（同 第17章 2-1）も、
   * 同じく効果から起こりうる。効果はプレイヤーにダメージを与えられ（`effect.ts` の
   * `damagePlayer`）、ユニットをスクエアに置ける（同 `placeOnSquare`）ためである。
   */
  readonly smashJudgments: readonly SmashJudgment[]
  /**
   * 決まった勝敗（総合ルール 第3部 第3章）。まだ決まっていなければ `undefined`。
   *
   * 勝敗が決まったデュエルは即座に終了する（同 3）ので、これが `undefined` でなくなった
   * 後の盤面はもう動かない。
   */
  readonly result: DuelResult | undefined
  /**
   * ここまでに起きたできごと（ADR-0011、`log.ts`）。古いものから並ぶ。
   *
   * **盤面の一部として持つ。** できごとを外へ知らせる口をエンジンに生やすことはできない
   * （ADR-0001）ので、積んでおいて盤面と同じ道で届ける。**ルールの判断には使わない。**
   * 読むのは射影（`perspective.ts`）だけで、ここを見て盤面が変わることは無い。
   */
  readonly log: readonly DuelEvent[]
}

/**
 * デュエルの勝敗（総合ルール 第3部 第3章）。
 *
 * 敗北したプレイヤーではなく勝利したプレイヤーを持つ。敗北の条件を満たしたプレイヤーが
 * 敗北し、相手が勝利する（同 1・2）という形しかなく、両方が同時に敗北した場合は引き分けに
 * なる（同 4）ためである。
 */
export type DuelResult =
  | { readonly kind: '勝利'; readonly winner: Player }
  | { readonly kind: '引き分け' }

/**
 * そのデュエルが終了しているか（総合ルール 第3部 第3章 3）。
 *
 * 勝敗が決まった場合や引き分けになった場合、そのデュエルは即座に終了する。そこから先は
 * ルールエフェクトも優先権も発生せず、どの行動も行えない。「終わったなら何も起こらない」と
 * いう同じ判定を各所で書かずに済むように、ここに 1 つ置く。
 */
export function hasEnded(state: DuelState): boolean {
  return state.result !== undefined
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
/**
 * 盤面が持っている、作成された誘発型能力 1 つ（総合ルール 第4部 第3章 4）。
 *
 * まだ誘発していない。誘発すると `CreatedAbilityInstance` になってバンクへ向かい、ここからは
 * 取り除かれる。特別に規定された期限が無ければ次に 1 度だけ誘発する（同 4）ので、誘発と
 * 同時に取り除けばそれがそのまま守られる。
 *
 * `TriggeredInstance` と違って発生源のカードを持たない。作った効果はすでに解決を終えて
 * いて、作ったカードもたいていは捨札にある。支配者は作った効果の支配者を写して持つ。
 */
export interface CreatedAbility {
  readonly ability: CreatedTriggeredAbility
  /** 能力の支配者。作った効果の支配者である（総合ルール 第4部 第7章 1）。 */
  readonly controller: Player
  /**
   * 影響を与える特定のカード（総合ルール 第4部 第3章 4-1）。
   *
   * 作られた後、誘発イベントが満たされる前に、このカードが「スクエアからスクエア」以外の
   * ゾーン移動をした場合、この能力は消滅する（同 4-1）。取り除くのは `duel.ts` の
   * `moveToZone` と `moveToSquare` である。
   */
  readonly affecting: CardId
}

/**
 * 誘発した、作成された誘発型能力 1 つ。
 *
 * `TriggeredInstance` と同じく、誘発してからバンクに入るまでの間も、バンクにある間も同じ形で
 * 持つ。違うのは、発生源のカードを持たないことと、影響を与える対象を誘発した時点の姿で
 * 写して持つことである。
 */
export interface CreatedAbilityInstance {
  readonly ability: CreatedTriggeredAbility
  readonly controller: Player
  /**
   * 発生源のカードを持たない、ということを型に書いたもの。値は常に無い。
   *
   * こう書いておくと、バンクの中身を種類で分けずに `source` を読めて、返るのは `undefined`
   * になる。「発生源のカードがあるとは限らない」という事実がそのまま型に出る。
   */
  readonly source?: undefined
  /**
   * 誘発した時点の対象。解決する時に効果へ手渡される（`effect.ts` の `CreatedAbilityEffect`）。
   *
   * 誘発してから解決するまでの間に対象がスクエアを離れることはありうる。その場合、対象への
   * 命令が実行されないだけである（総合ルール 第1部 第1章 3）。消滅する（同 第4部 第3章 4-1）
   * のは誘発するまでの間だけなので、誘発した後は残る。
   */
  readonly affected: UnitOnSquare
}

/**
 * 誘発して、バンクへ向かう能力 1 つ。
 *
 * カードに書かれている誘発型能力（`TriggeredInstance`）と、作成された誘発型能力
 * （`CreatedAbilityInstance`）の 2 つがある。どちらもバンクに入って解決される
 * （総合ルール 第2部 第21章 11-1）ので、盤面は 1 つの並びで持つ。見分けるのは
 * `ability.kind` である。
 */
export type BankedAbility = TriggeredInstance | CreatedAbilityInstance

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
  /**
   * 誘発した時点の発生源。効果が「自分の位置」を見るために使う（`resolve.ts` の `duelView`）。
   *
   * 解決する時にはまず盤面から引き直し、**発生源がスクエアを離れていた場合にだけ**これを
   * 使う。ゾーン移動をしていた場合は移動する直前の情報を使用する（総合ルール 第4部
   * 第8章 2-5）という規定にあたる。
   *
   * 厳密には「移動する直前」ではなく「誘発した時点」を写している。両者が食い違うのは、
   * 誘発してからスクエアからスクエアへ移動し、そのうえでスクエアを離れた場合だけである。
   * その並びが起こせるようになった時に、移動の側で写し直す。
   *
   * `source` と `controller` を別に持っているのは、バンクからどれを解決するかを選ぶ側
   * （`bank.ts`）が位置を必要としないためである。
   */
  readonly self: UnitOnSquare
}

/**
 * 発動条件が満たされているトラップ 1 枚と、そのきっかけ
 * （総合ルール 第2部 第20章 3-8・3-8-a）。
 *
 * `TriggeredInstance` が誘発した時点の事情を写して持つのと同じ形である。どちらも、
 * 解決される時には盤面から引き直せないことを持つ。
 */
export interface TrapConditionMet {
  readonly trap: CardId
  /** 発動条件を満たしたできごと。発動した効果に渡される（`play.ts` の `activateTrap`）。 */
  readonly occasion: IntrusionOccasion
}

/**
 * 「勇気」の起動条件が満たされていること（総合ルール 第5部 第2章 2）。
 *
 * 起動条件は 2 つの部分からできている。「相手のユニットが味方エリアか中央エリアに置かれた時」
 * というできごとと、「このカードと同じ色のカードがあなたのエネルギーゾーンにあり、かつこの
 * カードのレベルと同じかそれ以上の枚数のカードがあなたのエネルギーゾーンにあるならば」という
 * エネルギーの条件である。**どちらも、できごとが起きたその瞬間に判定される。**
 *
 * トラップとは形が違う。あちらは発動条件（同 第2部 第20章 3-6）とレベルの充足・コストの支払い
 * （同 3-9・3-10）が別の条文に分かれているので、後者は発動しようとする時に見る。「勇気」は
 * エネルギーの条件が起動条件の中にあり、権利を失うのは優先権をパスした時だけである。
 */
export interface CourageConditionMet {
  /** 起動する権利を得るプレイヤー。置いた側から見た相手にあたる。 */
  readonly player: Player
  /**
   * その時点でエネルギーの条件を満たしていた、手札にある「勇気」を持つカード。
   *
   * エネルギーの条件は「このカード」の色とレベルを見るので、カードごとに答えが変わる。
   * だからカードの並びで持つ。**この後にエネルギーが減っても、ここに入っているカードは
   * 起動できる。** 権利を失うのは優先権をパスした時だけだからである（同 第5部 第2章 2）。
   *
   * 逆に、この後に引いた「勇気」は起動できない。そのカードについて起動条件が満たされた
   * ことが無いためである。
   */
  readonly satisfied: readonly CardId[]
  /**
   * そのプレイヤーの味方エリアか中央エリアに置かれた、相手のユニット。
   *
   * 置かれた**その瞬間**の姿を写して持つ。`IntrusionOccasion.invader` と同じ理由で、起動
   * するまでにそのユニットがスクエアを離れていても、後から盤面を見てどれだったのかを
   * 見分ける手立てが無いためである。効果はこのユニットにダメージを与える（同 2）。
   */
  readonly placed: UnitOnSquare
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
    damage: 0,
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
    damage: { 先攻: 0, 後攻: 0 },
    turn: firstTurn(),
    bank: [],
    resolveZone: [],
    triggered: [],
    createdAbilities: [],
    playedIntoCenter: [],
    trapConditionsMet: [],
    courageConditionsMet: [],
    battle: undefined,
    smashJudgments: [],
    result: undefined,
    log: [],
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
 * 置かれる向きは、指定しなければリリース状態になる。エネルギーゾーン・スマッシュゾーン・
 * トラップゾーンのいずれも、カードは通常リリース状態で置かれる（同 6-3・7-3・9-3）。
 * 「フリーズして置く」効果はこれを変えるので、向きを指定して呼ぶ。
 *
 * 受けていたダメージも失われる。新しいカードとして扱われる（同 1-4）以上、以前のゾーンで
 * 与えられていたダメージは残らない。
 *
 * 置く位置は、指定しなければそのゾーンの 1 番上になる。山札の 1 番下に戻す効果はこれを
 * 変えるので、位置を指定して呼ぶ。山札・プランゾーン・捨札にあるカードの順番は効果か
 * ルールによらなければ並べ替えられない（同 1-3）ので、位置は置く側が決める。
 *
 * 山札の 1 番上に置く場合、そのプレイヤーにプランがあれば先に裏向きにする（同 3-4）。
 * プランゾーンにあるカードは同時に山札の 1 番上のカードでもある（同 3-1）ため、裏向きに
 * しないまま上に別のカードを置くと、山札の 1 番上が 2 枚あることになってしまう。
 */
export function moveToZone(
  state: DuelState,
  id: CardId,
  zone: PlayerZone,
  orientation: Orientation = 'リリース',
  position: LibraryPosition = '1番上',
): DuelState {
  const detached = detach(state, id)
  if (detached === undefined) return state

  const { card } = detached
  // 行き先がスクエアではないので、これは必ず「スクエアからスクエア」以外のゾーン移動である。
  const vanished = withoutPlayedIntoCenter(withoutCreatedAbilitiesAffecting(detached.state, id), id)
  const flipped = zone === '山札' && position === '1番上' ? faceDownPlan(vanished, card.owner) : vanished

  const moved: CardInstance = { ...card, controller: card.owner, orientation, damage: 0 }
  const rest = cardsIn(flipped, card.owner, zone)
  return putInZone(flipped, card.owner, zone, position === '1番上' ? [moved, ...rest] : [...rest, moved])
}

/** ゾーンの中で置く位置。順番に意味があるのは山札・プランゾーン・捨札だけである。 */
export type LibraryPosition = '1番上' | '1番下'

/**
 * プランを裏向きにする（総合ルール 第2部 第21章 3-4）。プランが無ければ盤面はそのまま。
 *
 * 山札の 1 番上のカードが表向きの場合にそれをプランゾーンと呼ぶ（同 3-1）ので、裏向きに
 * することはプランゾーンから山札へ移すことにあたる。表向きかどうかを盤面が別に持って
 * いないのは、それが置かれている場所から決まるためである（`play.ts` 参照）。
 */
export function faceDownPlan(state: DuelState, player: Player): DuelState {
  const [plan] = cardsIn(state, player, 'プランゾーン')
  if (plan === undefined) return state

  const emptied = putInZone(state, player, 'プランゾーン', [])
  return putInZone(emptied, player, '山札', [plan, ...cardsIn(emptied, player, '山札')])
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

  const vanished = withoutCreatedAbilitiesAffecting(detached.state, id)
  return { ...vanished, resolveZone: [...vanished.resolveZone, detached.card] }
}

/**
 * カードをいまある場所から取り除いてスクエアに置く。どこにもなければ盤面はそのまま。
 *
 * スクエアに置かれる時、支配者と向きはその場で決まる。プレイされたユニットならプレイした
 * プレイヤーの支配下でフリーズ状態（総合ルール 第2部 第20章 1-4、第21章 8-3）になる。
 * 置くことそのものだけを行い、それが登場かどうかは呼ぶ側が決める（同 第20章 1-4-a）。
 *
 * 受けているダメージはそのまま持って動く。「スクエアからスクエア」のゾーン移動をしても
 * そのカードは新しいカードにならない（同 第21章 1-4）ためである。
 *
 * 同じ理由で、そのカードに影響を与える作成された誘発型能力も、スクエアから来た場合には
 * 消滅しない（同 第4部 第3章 4-1）。**このスクエアへの移動だけが、消滅しないゾーン移動で
 * ある。**
 */
export function moveToSquare(
  state: DuelState,
  id: CardId,
  square: Square,
  placement: { readonly controller: Player; readonly orientation: Orientation },
): DuelState {
  const fromSquare = findOnSquares(state, id) !== undefined
  const detached = detach(state, id)
  if (detached === undefined) return state

  const vanished = fromSquare ? detached.state : withoutCreatedAbilitiesAffecting(detached.state, id)
  return putOnSquare(vanished, square, { ...detached.card, ...placement })
}

/**
 * カードをいまある場所から取り除く。どのゾーンにもスクエアにもなければ `undefined`。
 *
 * カードが同時に 2 か所にあることはないので、見つかったところから取り除けばよい。
 *
 * トラップゾーンを離れる経路はすべてここを通るので、`trapConditionsMet` に残っていれば
 * ここで一緒に取り除く（総合ルール 第2部 第20章 3-8 の発動条件は、そのカードがトラップ
 * ゾーンにあってこそ意味を持つ）。トラップゾーン以外のカードの id が `trapConditionsMet`
 * にあることは無いので、無条件に取り除いてよい。
 */
function detach(state: DuelState, id: CardId): { readonly state: DuelState; readonly card: CardInstance } | undefined {
  const onSquare = findOnSquares(state, id)
  if (onSquare !== undefined) {
    return {
      state: withoutTrapCondition(
        {
          ...state,
          squares: state.squares.map((cards) => cards.filter((each) => each !== onSquare)),
        },
        id,
      ),
      card: onSquare,
    }
  }

  const resolving = state.resolveZone.find((card) => card.id === id)
  if (resolving !== undefined) {
    return {
      state: withoutTrapCondition(
        { ...state, resolveZone: state.resolveZone.filter((card) => card !== resolving) },
        id,
      ),
      card: resolving,
    }
  }

  for (const player of PLAYERS) {
    for (const zone of PLAYER_ZONES) {
      const cards = cardsIn(state, player, zone)
      const found = cards.find((card) => card.id === id)
      if (found !== undefined) {
        return {
          state: withoutTrapCondition(putInZone(state, player, zone, cards.filter((card) => card !== found)), id),
          card: found,
        }
      }
    }
  }
  return undefined
}

/**
 * そのカードに影響を与える、作成された誘発型能力を消滅させる（総合ルール 第4部 第3章 4-1）。
 * 無ければ盤面はそのまま。
 *
 * 呼ぶのは「スクエアからスクエア」以外のゾーン移動をした時だけである。`detach` の中ではなく
 * 呼ぶ側に置いているのは、`detach` からはどこへ動かすのかが見えないためで、スクエアから
 * スクエアへの移動（`moveToSquare`）だけがこれを呼ばない。
 */
function withoutCreatedAbilitiesAffecting(state: DuelState, id: CardId): DuelState {
  if (!state.createdAbilities.some((created) => created.affecting === id)) return state
  return { ...state, createdAbilities: state.createdAbilities.filter((created) => created.affecting !== id) }
}

/**
 * `playedIntoCenter` からそのカードを取り除く。無ければ盤面はそのまま。
 *
 * 呼ぶのは、そのカードがスクエアを離れてゾーンへ動く時だけである。中央エリア指定の
 * ルールエフェクトが見るのは「いずれかのスクエアに置かれていれば」（総合ルール 第3部
 * 第16章 2-2）なので、スクエアからスクエアへ動いたユニットは対象のままでなければ
 * ならない。`withoutCreatedAbilitiesAffecting` と同じく `detach` の中に置けないのは
 * このためである。
 */
function withoutPlayedIntoCenter(state: DuelState, id: CardId): DuelState {
  if (!state.playedIntoCenter.includes(id)) return state
  return { ...state, playedIntoCenter: state.playedIntoCenter.filter((each) => each !== id) }
}

/** `trapConditionsMet` からそのカードのぶんを取り除く。無ければ盤面はそのまま。 */
function withoutTrapCondition(state: DuelState, id: CardId): DuelState {
  if (!state.trapConditionsMet.some((met) => met.trap === id)) return state
  return { ...state, trapConditionsMet: state.trapConditionsMet.filter((met) => met.trap !== id) }
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
 * あり、`rule-effect.ts` が見る。
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

/**
 * スクエアにあるカードにダメージを与える。スクエアになければ盤面はそのまま。
 *
 * ダメージはそのカードに載って蓄積する。ＢＰと同じかそれ以上のダメージを受けたユニットが
 * 捨札に置かれること（総合ルール 第4部 第14章 4-6）はルールエフェクトの仕事なので、
 * ここでは与えるだけである。
 */
export function dealDamage(state: DuelState, id: CardId, amount: number): DuelState {
  if (findOnSquares(state, id) === undefined) return state

  return {
    ...state,
    squares: state.squares.map((cards) =>
      cards.map((card) => (card.id === id ? { ...card, damage: card.damage + amount } : card)),
    ),
  }
}

/**
 * プレイヤーにダメージを与える（総合ルール 第3部 第9章 1）。
 *
 * ダメージはそのプレイヤーに載って蓄積する。合計 1000 以上になった時にスマッシュ判定が
 * 発生すること（同 第4部 第14章 4-12）はルールエフェクトの仕事なので、ここでは与えるだけ
 * である。
 */
export function damagePlayer(state: DuelState, player: Player, amount: number): DuelState {
  if (amount === 0) return state

  return { ...state, damage: { ...state.damage, [player]: state.damage[player] + amount } }
}

/**
 * プレイヤーが受けているダメージを回復する（総合ルール 第3部 第18章 1）。
 *
 * 受けている量より多くは回復しない。ダメージは受けている量として持つもので、負の量を
 * 持つことに意味は無いためである。
 */
export function recoverDamage(state: DuelState, player: Player, amount: number): DuelState {
  const recovered = Math.max(state.damage[player] - amount, 0)
  if (recovered === state.damage[player]) return state

  return { ...state, damage: { ...state.damage, [player]: recovered } }
}

/**
 * すべてのカードとすべてのプレイヤーからダメージを取り除く（総合ルール 第3部 第10章 1）。
 * どこにもダメージが無ければ盤面はそのまま。
 */
export function removeAllDamage(state: DuelState): DuelState {
  const damaged =
    state.squares.some((cards) => cards.some((card) => card.damage > 0)) ||
    PLAYERS.some((player) => state.damage[player] > 0)
  if (!damaged) return state

  return {
    ...state,
    squares: state.squares.map((cards) => cards.map((card) => (card.damage === 0 ? card : { ...card, damage: 0 }))),
    damage: { 先攻: 0, 後攻: 0 },
  }
}

/**
 * スクエアにあるカードの向きを変える（総合ルール 第2部 第24章 1）。スクエアに無ければ
 * 盤面はそのまま。
 *
 * リリース状態のカードをフリーズ状態にすることを「フリーズする」、フリーズ状態のカードを
 * リリース状態にすることを「リリースする」と呼ぶ（同 1）。すでにその向きのカードに対して
 * それを行うことはできない（同 1-1）ので、その場合は盤面をそのまま返す。
 *
 * **行えるかどうかを条件やコストにする側は、ここではなく自分で確かめる。** この関数は
 * 行える時だけ変えて、行えなければ何もしないというところまでしか引き受けない。スマッシュ
 * （`action.ts` の `smash`）はフリーズできることを選べる条件にしているので、そちらが
 * 先に確かめている。
 */
export function setOrientationOnSquare(state: DuelState, id: CardId, orientation: Orientation): DuelState {
  const found = findOnSquares(state, id)
  if (found === undefined || found.orientation === orientation) return state

  return {
    ...state,
    squares: state.squares.map((cards) =>
      cards.map((card) => (card.id === id ? { ...card, orientation } : card)),
    ),
  }
}

/**
 * そのプレイヤーが支配する、フリーズ状態のカードをすべてリリースする
 * （総合ルール 第3部 第5章 1）。
 *
 * リリースするのはスクエア・トラップゾーン・エネルギーゾーン・スマッシュゾーンにある
 * カードだけである。向きを持つのはこの 4 つのゾーンにあるカードだけ（総合ルール 第2部
 * 第24章 1）だからである。
 *
 * トラップゾーン・エネルギーゾーン・スマッシュゾーンはプレイヤーごとに分かれたゾーンで、
 * そこにあるカードは常にそのプレイヤー自身が支配する（`moveToZone` がそこへ動かす時に
 * 支配者を持ち主へ戻すため）。スクエアは両者のカードが混在するので、支配者で選ぶ。
 */
export function releaseAll(state: DuelState, player: Player): DuelState {
  const released = (['エネルギーゾーン', 'スマッシュゾーン', 'トラップゾーン'] as const).reduce(
    (current, zone) => releaseZone(current, player, zone),
    state,
  )
  return releaseSquares(released, player)
}

/** そのプレイヤーのそのゾーンにあるフリーズ状態のカードをすべてリリースする。 */
function releaseZone(state: DuelState, player: Player, zone: PlayerZone): DuelState {
  const cards = cardsIn(state, player, zone)
  if (!cards.some((card) => card.orientation === 'フリーズ')) return state

  return putInZone(
    state,
    player,
    zone,
    cards.map((card) => (card.orientation === 'フリーズ' ? { ...card, orientation: 'リリース' } : card)),
  )
}

/** そのプレイヤーが支配する、スクエアにあるフリーズ状態のカードをすべてリリースする。 */
function releaseSquares(state: DuelState, player: Player): DuelState {
  const frozen = state.squares.some((cards) =>
    cards.some((card) => card.controller === player && card.orientation === 'フリーズ'),
  )
  if (!frozen) return state

  return {
    ...state,
    squares: state.squares.map((cards) =>
      cards.map((card) =>
        card.controller === player && card.orientation === 'フリーズ' ? { ...card, orientation: 'リリース' } : card,
      ),
    ),
  }
}

/**
 * そのプレイヤーの山札にあるカードの枚数。
 *
 * プランゾーンにあるカードも山札の 1 番上のカードなので数える（総合ルール 第2部
 * 第21章 3-1）。山札が 0 枚以下になったプレイヤーは敗北する（同 第3部 第3章 2）ので、
 * その判定を `topOfLibrary` の有無で代用せず枚数で行えるようにしている。
 */
export function librarySize(state: DuelState, player: Player): number {
  return cardsIn(state, player, '山札').length + cardsIn(state, player, 'プランゾーン').length
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
