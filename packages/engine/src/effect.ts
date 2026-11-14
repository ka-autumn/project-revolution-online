import type {
  AttackOccasion,
  CreatedTrigger,
  CreatedInDiscardPileAbility,
  CreatedOnSquareAbility,
  CreatedTriggeredAbility,
  CreatedUntargetedAbility,
  DreamAbility,
  GrantedTriggeredAbility,
  IntrusionOccasion,
  NamedKeyword,
  SmashOccasion,
} from './ability.js'
import type { MoveDirection, Square } from './board.js'
import type { Attribute, Card, CardType, UnitCard } from './card.js'
import type { CardId, LibraryPosition } from './duel.js'
import type { Orientation } from './orientation.js'
import type { Player } from './player.js'
import type { Turn } from './turn.js'
import type { PlayerZone } from './zone.js'

/**
 * 効果から見た、スクエアにいるユニット 1 枚。
 *
 * 盤面が持っているカードそのものではなく、そこから効果に見せてよい分だけを写したもの。
 * 効果はこれを命令の対象として engine に返すだけで、中身を書き換えても盤面は変わらない。
 */
export interface UnitOnSquare {
  readonly id: CardId
  /** そのユニットがいるスクエア（総合ルール 第2部 第21章 8-2）。 */
  readonly square: Square
  readonly card: UnitCard
  /** そのユニットの支配者。 */
  readonly controller: Player
}

/**
 * 効果から見た、ゾーンにあるカード 1 枚。
 *
 * `UnitOnSquare` と同じく、盤面が持っているカードそのものではなく、効果に見せてよい分だけを
 * 写したものである。支配者を持たないのは、これで見せるゾーンが支配者自身のものだけであり
 * （`DuelView`）、ゾーンの持ち主で決まるためである。相手のゾーンにもあるトラップゾーンの
 * カードは、中身を持たない別の値（`CardInTrapZone`）で見せる。
 */
export interface CardInZone {
  readonly id: CardId
  /** そのカードがいまあるゾーン。 */
  readonly zone: PlayerZone
  readonly card: Card
}

/**
 * 効果から見た、捨札にあるカード 1 枚。
 *
 * `CardInZone` の、ゾーンが捨札に決まっているもの。作成された誘発型能力が捨札のカードを
 * 対象にする時に、対象の型で捨札に限る（`createTriggeredAbilityForDiscardedCard`、ADR-0057）。
 */
export interface CardInDiscardPile extends CardInZone {
  readonly zone: '捨札'
}

/**
 * 効果から見た、エネルギーゾーンにあるカード 1 枚（エネルギー）。
 *
 * `CardInZone` に、いまの向きを足したもの。エネルギーゾーンのカードは向きを持つ（総合ルール
 * 第2部 第24章 1）ので、「リリース状態のエネルギーを 1 枚選び、フリーズする」のような
 * テキストの候補をカードの側で絞れる。向きを変える命令（`freeze`・`release`）の対象にできる。
 *
 * 向きは読んだ時点のものである。命令で向きを変えても、すでに手元にある写しは変わらない。
 *
 * 命令（`freeze`・`release`）は、実行されたかどうかを効果に返さない。すでにその向きなら
 * 何も起こらない（総合ルール 第2部 第24章 1-1）ので、「フリーズしてよい。そうしたら〜」の
 * ように結果に続く処理を書く時は、フリーズする前にカードの側で向きを見て、候補を絞ること。
 */
export interface EnergyInZone extends CardInZone {
  readonly zone: 'エネルギーゾーン'
  readonly orientation: Orientation
}

/**
 * 効果から見た、スマッシュゾーンにある裏向きのカード 1 枚（スマッシュ）。
 *
 * `CardInZone` と違って、カードの中身を持たない。スマッシュは両方のプレイヤーに対して
 * 裏向きに置かれていて、持ち主であっても中身を見られない（総合ルール 第2部 第21章 7-3）。
 * 効果が選んで動かすことはできるが、何を選んだかは分からない。支配者を持たないのは、効果に
 * 見せるスマッシュゾーンが支配者自身のものだけだからである（`DuelView.smashZone`）。
 *
 * 通信では、このカードを選ぶ候補は「見えていない」候補として届く（`protocol.ts` の
 * `describeCandidate`）。
 */
export interface SmashCard {
  readonly id: CardId
  readonly zone: 'スマッシュゾーン'
}

/**
 * 効果から見た、トラップゾーンにあるカード 1 枚（ADR-0040）。
 *
 * `SmashCard` と同じく、カードの中身を持たない。トラップゾーンのカードは裏向きで置かれ、
 * 相手のものは非公開の情報である（総合ルール 第2部 第23章 2-1）。効果が選んで動かすことは
 * できるが、何を選んだかは分からない。支配者自身のカードでも中身を渡さないのは、1 つの
 * 問い合わせが中身つきと中身なしの 2 種類の値を返すと、カードの側に見分ける分岐が要るため
 * である（ADR-0040 の「検討した選択肢」）。
 *
 * `SmashCard` と違って、どちらのプレイヤーのトラップゾーンにあるかを持つ。効果に両方の
 * プレイヤーの分を見せるため（`DuelView.trapZone`）で、「相手のトラップゾーンの」のように
 * 側を絞るテキストは、カードの側でこれを見て絞る。トラップゾーンはプレイヤーごとに分かれた
 * ゾーンなので、これはそのカードの持ち主でもある。
 *
 * 通信では、このカードを選ぶ候補は、選ぶプレイヤーから見えていれば「見えている」候補、
 * そうでなければ「見えていない」候補として届く（`protocol.ts` の `describeCandidate`）。
 */
export interface CardInTrapZone {
  readonly id: CardId
  readonly zone: 'トラップゾーン'
  /** そのカードがあるトラップゾーンのプレイヤー。 */
  readonly player: Player
}

/**
 * 効果が盤面について問い合わせられること。
 *
 * 効果に渡されるのはこのインターフェースだけで、盤面そのものは渡さない。カードの実装が
 * engine の内部状態に直接触れないようにするための境目がここにある（ADR-0002）。ここに
 * 生えていないことは、カード側からは知りようがない。
 *
 * 味方・敵はいずれも能力の支配者から見た呼び方である（総合ルール 第2部 第21章 8-2）。
 */
export interface DuelView {
  /** この能力の支配者（総合ルール 第4部 第7章 1）。 */
  readonly controller: Player
  /**
   * 支配者から見た相手。テキストの「相手」にあたる。
   *
   * 誰が相手かは公開されている情報なので名指しできる。ただし名指しできることと、その
   * プレイヤーのゾーンを読めることは別である。相手のゾーンの中身を読むアクセサは無い
   * ままで、相手に対してできるのは、中身を参照せずに済む働きかけだけである（枚数を取得する
   * `handCount`・`energyCount`・`smashCount`、中身なしで選ぶ `trapZone`）。
   */
  readonly opponent: Player
  /**
   * この能力の発生源。スクエアにいなければ `undefined`。
   *
   * 「隣にいる敵」のように、自分の位置を基準にするテキストのために要る。隣接の判定は
   * `squaresBeside`、エリアの判定は `areaOf` が公開されているので、位置さえ分かれば
   * カードの側で絞り込める。
   *
   * 解決する時の位置を返す。誘発してから解決するまでの間に「スクエアからスクエア」の
   * 移動をしていれば、移動した後の位置になる。発生源がスクエアを離れていた場合は、誘発した
   * 時点の位置を返す（総合ルール 第4部 第8章 2-5。ゾーン移動をしていた場合は移動する直前の
   * 情報を使用する）。
   *
   * `undefined` になるのは、発生源がそもそもスクエアにいない場合である。プレイされた
   * ストラテジーはリゾルブゾーンで解決され、発動したトラップも同じなので、そちらの効果から
   * 見るとここは常に `undefined` になる。
   */
  self(): UnitOnSquare | undefined
  /** スクエアにいる、支配者から見た味方すべて。 */
  allies(): readonly UnitOnSquare[]
  /** スクエアにいる、支配者から見た敵すべて。 */
  enemies(): readonly UnitOnSquare[]
  /**
   * 支配者自身の手札にあるカードすべて。
   *
   * 相手の手札を読むためのアクセサは無い。相手の手札は非公開の情報であり、効果が読めては
   * ならないためである。「読めない」ことを、ここに生やさないことで型として保証している
   * （ADR-0002・ADR-0004）。相手のゾーンを見る必要が出てきた場合は、それが公開されている
   * 情報であることを確かめたうえで、そのゾーン専用のアクセサを足す。
   *
   * 山札を読むアクセサも無い。「山札の 1 番上」はカードを選ぶ行為ではなく位置の指定なので、
   * 中身を見せずに動かせる。
   */
  hand(): readonly CardInZone[]
  /**
   * そのプレイヤーの手札の枚数（総合ルール 第2部 第23章 1-1）。
   *
   * どちらのプレイヤーぶんも読める。手札の枚数は公開情報である。枚数だけを返すので、数えた
   * ことによって相手の手札の中身を読めたり、そのカードを対象にできたりはしない
   * （`energyCount` と同じ。ADR-0002・ADR-0004・ADR-0056）。
   */
  handCount(player: Player): number
  /** 支配者自身の捨札にあるカードすべて。 */
  discardPile(): readonly CardInDiscardPile[]
  /** 支配者自身のプランゾーンにあるカードすべて。 */
  planZone(): readonly CardInZone[]
  /**
   * そのプレイヤーのエネルギーゾーンにあるカードの枚数。
   *
   * どちらのプレイヤーぶんも読める。エネルギーゾーンは公開情報であり（総合ルール 第2部
   * 第23章 1-1）、両方のエネルギーゾーンにあるカードは全てのプレイヤーが見られる
   * （同 第21章 6-3）。
   *
   * カードそのものではなく枚数を返す。エネルギーゾーンにあるカードをエネルギーと呼ぶ
   * （同 6-2）ので、「エネルギーが◯枚」はそのまま枚数のことになる。中身が要るテキストは
   * `energyZone` を使う。
   */
  energyCount(player: Player): number
  /**
   * そのユニットがこのターンに移動した回数（総合ルール 第3部 第8章 2-5。ADR-0068）。
   *
   * 数えるのは移動の行動だけで、効果による配置は含まない。スクエアを離れてゾーンへ動いた
   * カードは新しいカードとして扱われる（同 第2部 第21章 1-4）ので、出し直せば 0 に戻る。
   * 盤面にいるユニットがいつ移動したかは公開情報である。
   */
  movesThisTurn(unit: UnitOnSquare): number
  /**
   * 支配者自身のエネルギーゾーンにあるカードすべて。
   *
   * 中身も公開されている（同 6-3）ので相手のぶんも見せられるが、返すのは支配者自身の
   * ぶんだけにしている。相手のエネルギーゾーンから選ぶテキストの消費者がまだいないため
   * で、手札・捨札・プランゾーンと同じ形である。要るようになった時に足す。
   *
   * いまの向きも読める（`EnergyInZone`）。向きも公開されている情報である（同 第2部 第23章
   * 1-1、第21章 6-4）。
   */
  energyZone(): readonly EnergyInZone[]
  /**
   * そのプレイヤーのスマッシュの枚数（総合ルール 第2部 第21章 7-2）。
   *
   * 数え方は `smash.ts` の `smashesOf` と同じで、スマッシュゾーンにある裏向きのカードだけを
   * 数える。希望ステップで表向きに置かれているカードはスマッシュではない（同 第3部 第19章 1）
   * ので数えない。スマッシュ判定中だからといって特別な扱いは足していない。
   *
   * どちらのプレイヤーぶんも読める。スマッシュの枚数は公開されている情報である（第2部 第21章 7-3。
   * 表側は見られないが、いつでも両方のスマッシュゾーンの枚数を数えられる）。枚数だけを返す
   * ので、数えたことによってそのカードを対象にできるようにはならない（`energyCount` と同じ）。
   */
  smashCount(player: Player): number
  /**
   * 支配者自身のスマッシュゾーンにある、スマッシュすべて。
   *
   * 中身は返さない（`SmashCard`）。ゾーンへ置く命令（`placeInZone`）の対象にできる。相手の
   * スマッシュを返すアクセサは無い。選んで動かすテキストが無いためで、要る時に足す。
   */
  smashZone(): readonly SmashCard[]
  /**
   * 両方のプレイヤーのトラップゾーンにあるカードすべて（ADR-0040）。
   *
   * 中身は返さない（`CardInTrapZone`）。支配者自身のカードでも返さない。ゾーンへ置く命令
   * （`placeInZone`）の対象にできる。並びは支配者の分が先で、相手の分が後である。
   *
   * 相手のトラップゾーンを読めるのは、中身を見ずに済むからである。どちらのプレイヤーの
   * トラップゾーンかを書いていないテキストは、両方から選べる。側を絞るテキストは、値の
   * `player` で絞る。
   */
  trapZone(): readonly CardInTrapZone[]
  /**
   * そのユニットが、そのキーワード能力を持つか。
   *
   * 「他の、友情を持つ味方のＢＰを＋Ｎ」のように、持つ能力で対象を絞るテキストのために
   * 要る。数値を持つキーワード能力でも、数値は問わない。
   *
   * 継続効果を適用した後のデータを読む。属性（`UnitOnSquare.card.attributes`）と同じ扱いで、
   * 能力を与える効果（`granting`）が与えた能力は、`units()` の返す写しの `card.abilities`
   * に載る（`continuous.ts` の `continuousData`）。尋ねる口はここなので、写しの作り方が
   * 変わってもカードの側は直さずに済む。ただし、与えられた能力が生むＢＰの変更を集める側
   * （`continuous.ts` の `gather`）は、書かれた能力から引いているので、与えられる種類
   * （`GrantableAbility`）を増やす時に別に直す。盤面から来た写しの `card` に `card.ts` の
   * `hasKeyword` を呼んでも同じ答えになる。
   */
  hasKeyword(unit: UnitOnSquare, keyword: NamedKeyword): boolean
}

/**
 * 「してもよい」で「はい」と答えた時に、エンジンが実行する動き（ADR-0064）。
 *
 * テキストの動詞まで含めた 1 つの値にする。同じ手札へ置く動きでも、テキストが「加える」と「戻す」を
 * 書き分けているので、使うテキストを実装する時に、ダイアログとログの言い方を合わせるために別の値を
 * 追加する。値は、それを使うテキストを実装する時に追加する。画面は、値ごとの言い方の表を持つ
 * （`MAY_ACTIONS` を網羅する）。
 */
export const MAY_ACTIONS = ['手札に加える', '1枚引く', '山札の1番上のカードをエネルギーゾーンにフリーズして置く'] as const

export type MayAction = (typeof MAY_ACTIONS)[number]

/**
 * 対象を持たない動き（ADR-0065）。対象のカードが無いので、「対象が場所を離れていたら聞かない」ことが起こらず、
 * いつも聞く。聞く文とログの行は、対象の「〜を」を入れない。
 */
export const UNTARGETED_MAY_ACTIONS: readonly MayAction[] = ['1枚引く', '山札の1番上のカードをエネルギーゾーンにフリーズして置く']

/**
 * 効果が engine に出す命令。
 *
 * 効果は盤面を自分で書き換えず、何をしたいかを命令として返す。実際に盤面を変えるのは
 * engine 側（`resolveEffect`）だけである。
 *
 * カードの実装がこの型を直接組み立てることは想定していない。`choose` や `destroy` と
 * いった、この下にある記述用の関数を使う。
 */
export type Instruction =
  | {
      readonly kind: '選ぶ'
      readonly candidates: readonly unknown[]
      /**
       * 候補があっても「選ばない」ことを選べるか。テキストが「◯枚まで選び」と書いている
       * 場合に真になる（総合ルール 第4部 第8章 2-3。選択はテキストの指定に従う）。
       */
      readonly mayDecline: boolean
      /**
       * 候補とは別に、選ぶプレイヤーへ見せるカードの一覧（ADR-0041・ADR-0042）。
       *
       * 渡した時は、候補が 1 枚も無くても聞く（選ばないことだけを選べる）。候補は一覧のカードの
       * 中から選ぶ。出せるのは `chooseAtMostOneFromLibrary` と `letOpponentChooseFromMyHand` だけで、
       * カードの側からは渡せない。`picker` が `相手` の時は支配者の手札、そうでなければ山札の一覧である。
       */
      readonly shown?: readonly CardInZone[]
      /**
       * 選ぶのは誰か（ADR-0052）。省略すると `支配者`。テキストが相手を指定した選択は、相手が選ぶ
       * （総合ルール 第4部 第8章 2-3）。
       *
       * `相手` を出せるのは `letOpponentChooseFromMyHand` だけである。候補が支配者の手札で、相手の
       * 画面にその一覧を見せる形（ADR-0041 の向きを逆にしたもの）に限るためである。
       */
      readonly picker?: '支配者' | '相手'
    }
  /**
   * 支配者が、候補の中から `count` 枚を選ぶ（ADR-0055）。選んだ並びが効果に返る。
   *
   * 1 枚ずつ `count` 回聞き、選んだものを次の候補から外す。選択の要求には、何枚目かを表す `series` が載る。
   * 候補が `count` 枚以下なら、選ぶ余地が無いので聞かずに全部を選ぶ。選ぶ人は支配者だけで、選ばないことは選べない。
   */
  | { readonly kind: '複数を選ぶ'; readonly candidates: readonly unknown[]; readonly count: number }
  | { readonly kind: '破壊する'; readonly target: UnitOnSquare }
  | { readonly kind: 'プレイヤーにダメージを与える'; readonly player: Player; readonly amount: number }
  | { readonly kind: 'ユニットにダメージを与える'; readonly target: UnitOnSquare; readonly amount: number }
  | { readonly kind: '向きを変える'; readonly target: UnitOnSquare | EnergyInZone; readonly orientation: Orientation }
  | {
      readonly kind: 'ゾーンへ置く'
      readonly card: CardInZone | UnitOnSquare | SmashCard | CardInTrapZone
      readonly to: PlayerZone
      readonly orientation: Orientation
      readonly position: LibraryPosition
    }
  | { readonly kind: 'トラップゾーンのカードを捨札に置く'; readonly card: CardInTrapZone }
  | { readonly kind: '山札の1番上をゾーンへ置く'; readonly to: PlayerZone; readonly orientation: Orientation }
  | { readonly kind: 'カードを引く'; readonly player: Player; readonly count: number }
  /**
   * 支配者が、相手の手札を見る（ADR-0041）。見たカードは効果に返さない。
   *
   * 項目を持たないのは、書ける形をテキストにある形に限るためである。
   */
  | { readonly kind: '相手の手札を見る' }
  /**
   * 支配者が、相手の手札を見て、`conditions` をすべて満たすカードから 1 枚を選び、`disposal` する（ADR-0069）。
   * 効果には何も返さない。
   *
   * 候補の作成・選択・処置は、エンジンが行う。相手の手札のカードは、見た後も効果に渡さない
   * （ADR-0004）ので、絞り込みは関数ではなく値で渡す。`mayDecline` は、「1 枚まで」（選ばないことを選べる）
   * か、「1 枚」（必ず選ぶ）か。枚数は 1 枚に限る。
   */
  | {
      readonly kind: '相手の手札を見て選ぶ'
      readonly conditions: readonly HandCondition[]
      readonly disposal: HandDisposal
      readonly mayDecline: boolean
    }
  /**
   * 相手が自分の手札から、1 枚ずつ `count` 枚を選んで捨てる（ADR-0052）。効果には何も返さない。
   *
   * 候補は相手の手札で、エンジンが作る。効果は候補にも選ばれたカードにも触れない。項目を
   * `count` だけに絞っているのは、書ける形をテキストにある形に限るためである。
   */
  | { readonly kind: '相手に手札を捨てさせる'; readonly count: number }
  /**
   * 支配者が、自分の山札を読む（ADR-0042）。山札とプランゾーンのカードが、中身つきで効果に
   * 返る。並びは山札の順序と関係のない並びで、順序は返さない。
   *
   * 項目を持たないのは、書ける形をテキストにある形（自分の山札）に限るためである。
   */
  | { readonly kind: '自分の山札を読む' }
  /**
   * 支配者の山札をシャッフルする（ADR-0042）。プランゾーンにカードがあれば、裏向きにして
   * から混ぜる。混ぜた後はプランゾーンは無い。
   */
  | { readonly kind: '山札をシャッフルする' }
  /**
   * 支配者に、「してもよい」かを「はい／いいえ」で聞く（ADR-0064）。「はい」なら、`targets` に `action` を
   * エンジンが実行する。効果には、「はい」なら `true` が返る。
   *
   * 聞く時点で、対象のすべてが、効果が読んだ場所を離れていれば、聞かずに `false` を返す（総合ルール 第1部
   * 第1章 3）。ログも積まない。
   */
  | {
      readonly kind: 'してもよいか聞く'
      readonly targets: readonly (CardInZone | UnitOnSquare | SmashCard | CardInTrapZone)[]
      readonly action: MayAction
    }
  | { readonly kind: 'プランを裏返す'; readonly player: Player }
  | {
      readonly kind: 'スクエアへ置く'
      readonly card: CardInZone | UnitOnSquare
      readonly square: Square
      readonly orientation: Orientation
    }
  | {
      // 置く瞬間にスクエアにいるユニットの向きをそのまま使う（`placeOnSquareKeepingOrientation`）。
      // スクエアにいるユニットを置き直す時だけ指定できるので、`card` はユニットに限る。
      readonly kind: 'スクエアへ置く'
      readonly card: UnitOnSquare
      readonly square: Square
      readonly orientation: '変えない'
    }
  | { readonly kind: '対象を持たない誘発型能力を作る'; readonly ability: CreatedUntargetedAbility }
  | {
      readonly kind: '誘発型能力を作る'
      readonly ability: CreatedOnSquareAbility | CreatedInDiscardPileAbility
      /**
       * その能力が影響を与える特定のカード（総合ルール 第4部 第3章 4-1）。
       *
       * 能力が対象にする場所（`ability.place`）と同じ場所にあるカードである。作成する関数の型が
       * 揃えているので、ここでは確認しない。
       */
      readonly affecting: CardInZone | UnitOnSquare
    }
  | {
      readonly kind: '継続効果を作成する'
      readonly duration: Duration
      /** 影響を受けるカード。作った後は、このカードあての値として盤面が持つ。 */
      readonly target: CardId
      readonly change: ContinuousChange
    }

/**
 * 効果の途中経過。`T` はその手順が効果に返す値。
 *
 * 記述用の関数はこれを返し、カードの実装は `yield*` でつないでいく。
 */
export type EffectStep<T> = Generator<Instruction, T, unknown>

/**
 * カードや能力の指示によって生み出される結果（総合ルール 第4部 第1章 1）。
 *
 * 盤面を引数に取って次の盤面を返す関数ではなく、命令を並べたものとして書く。効果の途中で
 * プレイヤーの選択をはさめるようにするためである。
 */
export type Effect = (duel: DuelView) => EffectStep<void>

/**
 * 発動したトラップの効果。第 2 引数で、発動条件を満たしたできごとの写しを受け取る
 * （総合ルール 第2部 第20章 3-6・3-11）。
 *
 * きっかけは `DuelView` には載せない。あれは「盤面はどうなっているか」を答えるもので
 * あり、きっかけは盤面ではない。混ぜると `DuelView` の意味が濁る。
 *
 * `Effect` を広げずにトラップだけ別の型にしているのは、渡されるきっかけの形が経路ごとに
 * 決まっているためである。広い型（あらゆるきっかけ）で受けると、カードの側にどのきっかけ
 * なのかを確かめる分岐が要る。その分岐は engine が渡すものによって常に同じ側へ倒れるので、
 * 書いても確かめようがない。
 *
 * 発動したトラップの効果は発生源のユニットを持たない（リゾルブゾーンで解決される、同
 * 第2部 第21章 12-1）ので、`DuelView.self` は常に `undefined` になる。侵入してきた敵と
 * 侵入されたスクエアは、どちらもここからしか取れない。
 */
export type TrapEffect = (duel: DuelView, occasion: IntrusionOccasion) => EffectStep<void>

/**
 * 攻撃のトラップの効果。攻撃したユニットと攻撃されたユニットを、きっかけから受け取る
 * （`ability.ts` の `AttackOccasion`、ADR-0039）。
 *
 * きっかけの型は、トリガーアイコンの種類から決まる。攻撃のトラップが侵入のきっかけを
 * 受け取る形にはしない。
 */
export type AttackTrapEffect = (duel: DuelView, occasion: AttackOccasion) => EffectStep<void>

/**
 * スマッシュのトラップの効果。スマッシュしたユニットを、きっかけから受け取る
 * （`ability.ts` の `SmashOccasion`、ADR-0039）。
 */
export type SmashTrapEffect = (duel: DuelView, occasion: SmashOccasion) => EffectStep<void>

/**
 * 「このカードが捨札に置かれた時」に誘発する能力の効果。第 2 引数で、捨札に置かれたそのカードを
 * 受け取る（ADR-0059）。
 *
 * `CreatedAbilityEffect` と同じく、盤面への問い合わせでは取れないものを engine から手渡される。
 * 手札や山札から置かれたカードは、スクエアにいないので `DuelView.self` では取れない。渡される
 * のは、誘発した時点で置かれていたそのカードである。解決する時までに捨札を離れていても、
 * 効果は実行される。そのカードを対象にする命令が、実行されないだけである（総合ルール 第1部
 * 第1章 3）。
 *
 * 手渡されたカードは、効果が命令の対象にできる（`createTriggeredAbilityForDiscardedCard` に
 * 渡して、そのターンの終わりに手札へ加えるなど、ADR-0057）。
 */
export type OwnDiscardEffect = (duel: DuelView, placed: CardInDiscardPile) => EffectStep<void>

/**
 * 作成された誘発型能力の効果。第 2 引数で、影響を与える対象のユニットを受け取る
 * （総合ルール 第4部 第3章 4-1）。
 *
 * `TrapEffect` と同じ形である。どちらも、盤面への問い合わせでは取れないものを engine から
 * 手渡される。対象は作られた時に決まっていて（「そのユニットを」）、後から盤面を見ても
 * どれだったのかを見分ける手立てが無いためである。
 *
 * 渡されるのは、作られた時点のものではなく、誘発した時点のものである。作られてから誘発するまでの
 * 間にスクエアからスクエアへ移動していれば、移動した後の位置になる。それ以外のゾーン移動を
 * していれば能力そのものが消滅している（同 4-1）ので、誘発する時点で対象は必ずスクエアに
 * いる。
 *
 * 発生源のカードが無いので、`DuelView.self` は常に `undefined` になる。
 */
export type CreatedAbilityEffect = (duel: DuelView, affected: UnitOnSquare) => EffectStep<void>

/**
 * 捨札のカードを対象にする、作成された誘発型能力の効果（ADR-0057）。第 2 引数で、影響を与える
 * 対象のカードを受け取る。
 *
 * `CreatedAbilityEffect` と同じく、渡されるのは誘発した時点のものである。対象は、誘発する時に
 * 捨札にある場合だけ誘発する。作成された後に捨札を離れていれば能力は消滅している（総合ルール
 * 第4部 第3章 4-1）ので、通常、誘発する時点で対象は捨札にある。捨札に無ければ誘発しない
 * （`trigger.ts` の `triggerCreated`）。
 *
 * 発生源のカードが無いので、`DuelView.self` は常に `undefined` になる。
 */
export type CreatedDiscardAbilityEffect = (duel: DuelView, affected: CardInDiscardPile) => EffectStep<void>

/**
 * 対象を持たない、作成された誘発型能力の効果（ADR-0065）。影響を与える特定のカードが無いので、
 * 対象を受け取らない。
 *
 * 発生源のカードが無いので、`DuelView.self` は常に `undefined` になる。
 */
export type CreatedUntargetedAbilityEffect = (duel: DuelView) => EffectStep<void>

/**
 * 継続効果が 1 枚のユニットのＢＰに与える変更（総合ルール 第4部 第12章 5-2 の(5)）。
 *
 * 単発効果と違って命令にならない。命令は engine が 1 つずつ実行して盤面を変えていくもの
 * だが、継続効果は盤面を変えず、効果が続いている間ずっとＢＰの読み方を変えるだけだから
 * である（同 第12章 1）。常在型能力が返したものは、engine が盤面に書き込まず、ＢＰを読む
 * たびに集める（`continuous.ts`）。解決が残す継続効果は、これを `createContinuousEffect` に
 * 渡して作り、盤面が期限まで持つ（`CreatedContinuousEffect`）。
 *
 * どのユニットへの変更かを `UnitOnSquare` ではなく `CardId` で持つのは、変更を集める
 * 側が id で引けるようにするためである。写しを持ち回っても、集めた後に必要になるのは
 * 「誰に」だけになる。
 */
export interface BpModifier {
  readonly kind: 'ＢＰの変更'
  readonly target: CardId
  readonly amount: number
}

/**
 * 継続効果が 1 枚のユニットのＳＰに与える変更（総合ルール 第4部 第12章 5-2 の(5)）。
 *
 * `BpModifier` と対になる。解決が残す継続効果（`createContinuousEffect`）と、常在型能力
 * （`ModifyingAbility.modifiers`、ADR-0056）に渡せる。
 */
export interface SpModifier {
  readonly kind: 'ＳＰの変更'
  readonly target: CardId
  readonly amount: number
}

/**
 * 継続効果が与えられる能力（総合ルール 第4部 第12章 5-2 の(2)）。
 *
 * 型で絞っているのは、engine が「与えられた分」まで読むようにした種類だけである。いまは
 * 「夢」と誘発型能力（ADR-0071）で、それ以外を渡すとコンパイルの時点で弾かれる。与えたのに
 * 働かない能力を、実装できないようにするためである。種類を追加する時は、その種類を取得する所
 * （`continuous.ts` の `gather` など、書かれた能力から取得している所）を、適用した後のデータから
 * 取得するように切り替えてから、ここに追加する。誘発型能力は、誘発の取得（`trigger.ts` の
 * `triggeredBy`）が与えられた分を含めて取得する。
 */
export type GrantableAbility = DreamAbility | GrantedTriggeredAbility

/** 与えられるキーワード能力の名前。ログが持つのはこちらである（`LoggedContinuousChange`）。 */
export type GrantableKeyword = DreamAbility['keyword']

/**
 * 継続効果が 1 枚のカードに与える能力（総合ルール 第4部 第12章 5-2 の(2)、第1章 1）。
 *
 * カードのテキストを変更する継続効果である。`BpModifier` と違い、対象はスクエアにいるユニット
 * とは限らない。プランゾーンのユニットに「夢」を与えるように、スクエアの外のカードにも与えられる。
 * 与える能力そのものを持つのは、数値を持つキーワード能力を与えるテキストを、同じ形で書けるように
 * するためである。
 */
export interface GrantModifier {
  readonly kind: '能力の付与'
  readonly target: CardId
  readonly ability: GrantableAbility
}

/**
 * 継続効果が 1 枚のユニットの移動方向に与える変更（総合ルール 第2部 第2章 2、ADR-0071）。
 *
 * 変更の方法は種類で持つ。いまは「置き換える」だけで、対象のユニットは、変更されている間、
 * 指定された方向にだけ移動できる。ムーブアイコンを持たないユニットも、指定された方向に移動できる
 * ようになる。「与える・得る」（追加）は、そのテキストを実装する時に方法を追加する。
 */
export interface MoveDirectionModifier {
  readonly kind: '移動方向の変更'
  readonly method: '置き換える'
  readonly target: CardId
  readonly directions: readonly MoveDirection[]
}

/** `createContinuousEffect` に渡せる変更。種類の札（`kind`）で、何を変えるかが決まる。 */
export type ContinuousModifier = BpModifier | SpModifier | GrantModifier | MoveDirectionModifier

/**
 * 作成された継続効果が続く期限（総合ルール 第4部 第12章 3-1）。
 *
 * 述語にしないのは、取りうる期限が数えられるほどしか無いためである（作成された誘発型能力の
 * 誘発するできごと `CREATED_TRIGGERS` と同じ形）。「このターンの間」は「ターンの終わりまで」と
 * 同じ時に終わる（同 第3部 第10章 1）ので、そのテキストが出た時に値を足す。
 */
export const DURATIONS = ['ターンの終わりまで', '次の相手のターンの終わりまで'] as const

export type Duration = (typeof DURATIONS)[number]

/**
 * その期限が、いま始まったリカバリーフェイズで終了するか（総合ルール 第3部 第10章 1。ADR-0065）。
 *
 * 作成された継続効果と作成された誘発型能力が共有する。「ターンの終わりまで」は、作成された後に来る
 * 最初のリカバリーフェイズの始めに終了する。「次の相手のターンの終わりまで」は、作成されたターンより後に
 * 来る、支配者の相手のターンのリカバリーフェイズの始めに終了する。支配者のターンに作成されれば
 * 続く相手のターンで、相手のターンに作成されれば、そのターンではなく次の相手のターンで終了する。
 */
export function durationEnds(duration: Duration, createdIn: number, controller: Player, turn: Turn): boolean {
  switch (duration) {
    case 'ターンの終わりまで':
      return true
    case '次の相手のターンの終わりまで':
      return turn.number > createdIn && turn.active !== controller
  }
}

/**
 * 作成された継続効果が、カードのデータをどう変えるか（総合ルール 第4部 第12章 5-2）。
 *
 * 種類の札（`kind`）で分かれる。盤面はこの型を持つ。ログが持つのは、能力そのものを
 * キーワードの名前に置き換えた `LoggedContinuousChange` である（ログは通信にそのまま載る）。
 */
export type ContinuousChange =
  | { readonly kind: 'ＢＰの変更'; readonly amount: number }
  | { readonly kind: 'ＳＰの変更'; readonly amount: number }
  | { readonly kind: '能力の付与'; readonly ability: GrantableAbility }
  | {
      readonly kind: '移動方向の変更'
      readonly method: '置き換える'
      readonly directions: readonly MoveDirection[]
    }

/**
 * ログに残す形にした `ContinuousChange`。数値の変更と移動方向の変更はそのまま、能力の付与は
 * キーワード能力なら名前だけ、誘発型能力なら表示のための文だけを持つ（能力そのものは関数を含み、
 * 通信に含まれない）。
 */
export type LoggedContinuousChange =
  | { readonly kind: 'ＢＰの変更'; readonly amount: number }
  | { readonly kind: 'ＳＰの変更'; readonly amount: number }
  | { readonly kind: '能力の付与'; readonly keyword: GrantableKeyword }
  | { readonly kind: '誘発型能力の付与'; readonly description: string }
  | {
      readonly kind: '移動方向の変更'
      readonly method: '置き換える'
      readonly directions: readonly MoveDirection[]
    }

/** 継続効果の変更を、ログに残す形にする。 */
export function loggedChangeOf(change: ContinuousChange): LoggedContinuousChange {
  switch (change.kind) {
    case 'ＢＰの変更':
    case 'ＳＰの変更':
      return change
    case '能力の付与':
      return change.ability.kind === '誘発型能力'
        ? { kind: '誘発型能力の付与', description: change.ability.description }
        : { kind: '能力の付与', keyword: change.ability.keyword }
    case '移動方向の変更':
      return change
    default:
      return change satisfies never
  }
}

/**
 * 「そのユニットのＢＰを＋Ｘ」。減らす変更は負の数で書く。
 *
 * 対象に取れるのは engine が `DuelView` を通して見せたユニットだけである。カードは盤面を
 * 自分で探せないので、ここに渡せるものはすべて engine が見せたものになる。
 */
export function bpPlus(target: UnitOnSquare, amount: number): BpModifier {
  return { kind: 'ＢＰの変更', target: target.id, amount }
}

/**
 * 「そのユニットのＳＰを＋Ｘ」。減らす変更は負の数で書く。対象の取り方は `bpPlus` と同じ。
 */
export function spPlus(target: UnitOnSquare, amount: number): SpModifier {
  return { kind: 'ＳＰの変更', target: target.id, amount }
}

/**
 * 「そのユニットの移動方向を、指定した向きにする」（置き換え。ADR-0071）。対象の取り方は `bpPlus` と同じ。
 */
export function replacingMoveDirection(target: UnitOnSquare, directions: readonly MoveDirection[]): MoveDirectionModifier {
  return { kind: '移動方向の変更', method: '置き換える', target: target.id, directions }
}

/**
 * 「そのカードに、ターンの終わりまで、その能力を与える」。
 *
 * 対象に取れるのは engine が `DuelView` を通して見せたカードで、スクエアにいるユニットに
 * 限らない（プランゾーンのユニットに「夢」を与えるテキストのため）。与えられる能力の種類は
 * `GrantableAbility` で絞られる。
 */
export function granting(target: UnitOnSquare | CardInZone, ability: GrantableAbility): GrantModifier {
  return { kind: '能力の付与', target: target.id, ability }
}

/**
 * 継続効果が 1 枚のユニットに加える属性 1 つ（総合ルール 第2部 第13章 4、
 * 第4部 第12章 5-2 の(3)）。
 *
 * 加えるだけで、書かれている属性は残る（同 第13章 4）。指定した属性だけを別のものに
 * 変える形（同 3）は、それを書くテキストが出てきた時に足す。
 */
export interface AttributeAddition {
  readonly target: CardId
  readonly attribute: Attribute
}

/** 「そのユニットは〈属性〉としても扱う」。 */
export function alsoTreatedAs(target: UnitOnSquare, attribute: Attribute): AttributeAddition {
  return { target: target.id, attribute }
}

/**
 * 候補の中から 1 つ選ぶ。選ぶのは能力の支配者（総合ルール 第4部 第8章 2-3）。テキストが相手を指定した選択は
 * 相手が選ぶが、それを書けるのは `letOpponentChooseFromMyHand` と `discardOpponentHand` だけである（ADR-0052）。
 * 候補が 1 つもなければ `undefined` を返す。
 *
 * 候補が無い時、選ぶという行動は実行できない（同 第1部 第1章 3）。しかし効果はそこで
 * 終わらない。解決はテキストに書かれている順番の通りに指示に従うものであり
 * （同 第4部 第8章 2-2）、実行されないのはその行動だけだからである。
 *
 * 選んだものを対象にする指示が後ろに続く場合、それも実行できない。それを飛ばすかどうかは
 * 呼ぶ側が `undefined` を見て決める。選んだものに依存しない指示が後ろに続くテキストが
 * あり、その場合は飛ばさずに続ける。engine には、後ろの指示が選んだものに依存するかどうかを
 * 知る手立てが無い。
 *
 * `chooseAtMostOne` との違いは、候補があるときに「選ばない」ことを選べるかどうかだけで
 * ある（同 第8章 2-3。選択はテキストの指定に従う）。返す値の形は同じになる。
 */
export function* choose<T>(candidates: readonly T[]): EffectStep<T | undefined> {
  const chosen = yield { kind: '選ぶ', candidates, mayDecline: false }
  // 命令を解釈する側が候補の中から選んで返すことを、この関数だけが知っている。
  return chosen as T | undefined
}

/**
 * 候補の中から `count` 枚を選ぶ。テキストの「◯枚選び」（◯は 2 以上）にあたる。選ぶのは能力の支配者で、
 * 選んだものが選んだ順の並びで返る（ADR-0055）。
 *
 * 1 枚ずつ聞くこと、選んだものを次の候補から外すこと、何枚目かを選択の要求に載せることは、エンジンが
 * 受け持つ。効果が `choose` を繰り返して書くと、それらをカードの側で書くことになり、書き違えうる。
 * 候補が `count` 枚以下なら聞かずに全部を選ぶ（総合ルール 第1部 第1章 3）。候補が無ければ空の並びが
 * 返り、効果は続く。
 *
 * 「◯枚まで選び」（選ばないことも選べる形）と、相手が選ぶ形はまだ書けない。そのテキストを書く時に足す。
 *
 * 候補はカードに限る。画面が N 枚に印を付けて決めさせる一覧にできるのは、候補が全部カードの時だけで、
 * スクエアやエリアを渡しても `series` は付くが、画面は 1 枚ずつ選ぶ形のままになる。
 */
export function* chooseSeveral<T>(candidates: readonly T[], count: number): EffectStep<readonly T[]> {
  const chosen = yield { kind: '複数を選ぶ', candidates, count }
  // 命令を解釈する側が候補の中から選んだ並びを返すことを、この関数だけが知っている。
  return chosen as readonly T[]
}

/**
 * 候補の中から 1 つ選ぶ。ただし選ばないことも選べる。テキストの「◯枚まで選び」にあたる。
 * 選ばなかった場合は `undefined` を返す（総合ルール 第4部 第8章 2-3）。
 *
 * `choose` との違いは、候補があるときに選ばないことを選べる点だけである。候補が無い時に
 * `undefined` を返して効果が続くところは同じで、「まで」は 0 枚を許しているため、選べな
 * かったことと選ばなかったことが同じ結果になる。選ばれなかった時に何もしないのは、
 * 呼ぶ側が `undefined` を見て決める。
 *
 * 山札から選ぶ時は、見せる一覧が要るので、これではなく `chooseAtMostOneFromLibrary` を使う。
 *
 * 「◯」が 2 以上のテキストはまだ書けない。複数を選ぶ仕組みを持っていないためで、
 * 必要になった時に足す（`card.ts` の属性・トリガーアイコンと同じ考え方）。
 */
export function* chooseAtMostOne<T>(candidates: readonly T[]): EffectStep<T | undefined> {
  const chosen = yield { kind: '選ぶ', candidates, mayDecline: true }
  // 選ばなかったことを `undefined` で表せるのは、候補がスクエアにいるユニットのように
  // 必ず値を持つものだけだからである。候補そのものが `undefined` になり得る使い方は無い。
  return chosen as T | undefined
}

/**
 * スクエアにいるユニットを持ち主の捨札に置く。
 *
 * 「スクエアにあるカードを捨札に置く」ことを「破壊する」と表現する
 * （総合ルール 第2部 第21章 1-5）。
 *
 * 対象がすでにスクエアを離れていた場合、破壊するという行動は実行されない
 * （総合ルール 第1部 第1章 3）。効果はそのまま続く。
 */
export function* destroy(target: UnitOnSquare): EffectStep<void> {
  yield { kind: '破壊する', target }
}

/**
 * プレイヤーにダメージを与える。
 *
 * ダメージはそのプレイヤーに載って蓄積する。合計 1000 以上になった時にスマッシュ判定が
 * 発生する（総合ルール 第4部 第14章 4-12）のはルールエフェクトの仕事であり、効果の解決中に
 * チェックされることはない（同 第8章 4）。次にどちらかのプレイヤーが優先権を獲得する時に
 * まとめて処理されるので、ここでは与えるだけでよい。
 *
 * 与える相手をプレイヤーとして受け取るが、効果が名指しできるのは `DuelView` が渡している
 * 支配者だけである。相手を指せるようにするのは、それを必要とするカードを書く時でよい。
 */
export function* damagePlayer(player: Player, amount: number): EffectStep<void> {
  yield { kind: 'プレイヤーにダメージを与える', player, amount }
}

/**
 * スクエアにいるユニットにダメージを与える。
 *
 * ダメージはそのカードに載って蓄積する。ＢＰと同じかそれ以上のダメージを受けたユニットが
 * 捨札に置かれること（総合ルール 第4部 第14章 4-6）はルールエフェクトの仕事であり、効果の
 * 解決中にはチェックされない（同 第8章 4）。`damagePlayer` と同じく、次にどちらかの
 * プレイヤーが優先権を獲得する時にまとめて処理されるので、ここでは与えるだけでよい。
 *
 * 捨札に置かれるのを待たずに済ませたい場合は `destroy` を使う。ＢＰより多いダメージを
 * 与えることと破壊することは、盤面の上では別の出来事である。
 *
 * 載ったダメージは、リカバリーフェイズの始めに取り除かれる（同 第3部 第10章 1）。また
 * 「スクエアからスクエア」以外のゾーン移動をしたカードは新しいカードとして扱われる
 * （同 第2部 第21章 1-4）ので、そこでも失われる。
 *
 * 対象がすでにスクエアを離れていた場合、この行動は実行されない
 * （同 第1部 第1章 3）。効果はそのまま続く。
 */
export function* damageUnit(target: UnitOnSquare, amount: number): EffectStep<void> {
  yield { kind: 'ユニットにダメージを与える', target, amount }
}

/**
 * スクエアにいるユニット、または支配者のエネルギーをリリースする（総合ルール 第2部 第24章 1）。
 *
 * フリーズ状態のカードをリリース状態にすることを「リリースする」と呼ぶ。
 *
 * すでにリリース状態のカードをリリースすることはできない（同 1-1）。その場合この行動は
 * 実行されない（同 第1部 第1章 3）。効果はそのまま続く。対象がすでにスクエアやエネルギー
 * ゾーンを離れていた場合も同じである。
 *
 * これは向きを変えるだけで、ゾーンの移動ではない。置く経路（`placeOnSquare`）に同じ
 * スクエアを渡して代用しないこと。置く経路を通すと、ユニットがあるスクエアに同じ
 * プレイヤーの支配するユニットが置かれた時に働くルールエフェクト（同 第4部 第14章 4-7）の
 * 判定に、向きを変えただけのカードが紛れ込む。
 */
export function* release(target: UnitOnSquare | EnergyInZone): EffectStep<void> {
  yield { kind: '向きを変える', target, orientation: 'リリース' }
}

/**
 * スクエアにいるユニット、または支配者のエネルギーをフリーズする（総合ルール 第2部 第24章 1）。
 *
 * リリース状態のカードをフリーズ状態にすることを「フリーズする」と呼ぶ。すでにフリーズ
 * 状態のカードをフリーズすることはできない（同 1-1）。実行できない場合の扱いは `release`
 * と同じである。
 *
 * スマッシュのようにフリーズすることをコストにする行動（`action.ts` の `smash`）とは別で、
 * こちらは効果が行うものである。コストとしてのフリーズは、フリーズできることを先に
 * 確かめたうえで支払われる。
 */
export function* freeze(target: UnitOnSquare | EnergyInZone): EffectStep<void> {
  yield { kind: '向きを変える', target, orientation: 'フリーズ' }
}

/**
 * ゾーンにあるカードを、持ち主の別のゾーンの 1 番上に置く。向きを指定する。
 *
 * 置けるのは持ち主のゾーンだけである。持ち主以外のゾーンに動かされる場合、代わりに持ち主の
 * 該当するゾーンに動かされる（総合ルール 第2部 第21章 1-2）。効果に見せているゾーンは、
 * トラップゾーンを除いて支配者自身のものだけなので、その区別が表に出るのは、相手の
 * トラップゾーンのカードを動かす時だけである。
 *
 * 置く位置は、指定しなければそのゾーンの 1 番上になる。「山札の 1 番下に戻す」であれば
 * 1 番下を指定する。順番に意味があるのは山札・プランゾーン・捨札だけである
 * （同 第2部 第21章 1-3）。
 *
 * 「スクエアからスクエア」以外のゾーン移動をしたカードは新しいカードとして扱われ、以前の
 * ゾーンに関連した効果は失われる（同 1-4）。すでにそのゾーンを離れていた場合、この行動は
 * 実行されない（同 第1部 第1章 3）。効果はそのまま続く。
 *
 * スクエアにいるユニットも渡せる。スクエアから捨札に置くことは「破壊する」と呼ばれ
 * （同 第2部 第21章 1-5）、それを見て誘発する能力がある（同 第4部 第7章 6）。カードを書く
 * 側はその場合 `destroy` を使うが、ここに捨札を渡された場合も誘発は起こる。
 *
 * スマッシュ（`SmashCard`）も渡せる。「スマッシュを捨札に置く」は、スマッシュゾーンから
 * 持ち主の捨札へ動かす、ふつうのゾーン移動である。中身は効果に見えないまま動く。
 *
 * トラップゾーンのカード（`CardInTrapZone`）も渡せる（ADR-0040）。相手のトラップゾーンの
 * カードも、置かれる先は持ち主のゾーンである（同 第2部 第21章 1-2）。満たされた発動条件が
 * 残っていれば、トラップゾーンを離れる時に取り除かれる（`duel.ts` の `detach`）。
 *
 * スクエアへ置く効果はここでは扱わない。プレイされたユニットがスクエアに置かれることは
 * 「登場」と呼ばれて効果によって置かれる場合と区別され（同 第2部 第20章 1-4-a）、
 * 「登場した時」の誘発や「根性」（同 第5部 第6章 3）が働くかどうかがそこで分かれるためである。
 */
export function* placeInZone(
  card: CardInZone | UnitOnSquare | SmashCard | CardInTrapZone,
  to: PlayerZone,
  orientation: Orientation,
  position: LibraryPosition = '1番上',
): EffectStep<void> {
  yield { kind: 'ゾーンへ置く', card, to, orientation, position }
}

/**
 * そのプレイヤーがカードを引く（総合ルール 第2部 第21章 1-5）。
 *
 * 山札の 1 番上のカードを手札に加えることを「引く」と表現する。プランゾーンにカードが
 * あれば、それが同時に山札の 1 番上のカードである（同 3-1）ので、そちらを引く。
 *
 * 山札が空なら引けない。山札が 0 枚になったプレイヤーが次に優先権が発生した時に敗北する
 * こと（同 第3部 第3章 2）は引けないこととは別のルールエフェクトなので、ここでは何も
 * 起こらないだけである。
 *
 * 引く相手をプレイヤーとして受け取るが、効果が名指しできるのは `DuelView` が渡している
 * 支配者だけである（`damagePlayer` と同じ）。
 */
export function* drawCards(player: Player, count: number): EffectStep<void> {
  yield { kind: 'カードを引く', player, count }
}

/**
 * 支配者が、相手の手札を見る。
 *
 * 見るのはプレイヤーであって、効果ではない。見たカードは効果に返らないので、相手の手札の
 * 中身で分岐することはできない。見た内容は、確認だけの選択として見たプレイヤーに届き
 * （`resolve.ts` の `見たカードの確認`）、確認が返ると効果は先へ進む。盤面の上では、相手の手札は
 * 枚数だけのままである（ADR-0041）。
 */
export function* lookAtOpponentHand(): EffectStep<void> {
  yield { kind: '相手の手札を見る' }
}

/**
 * 相手の手札を見て選ぶ命令（`相手の手札を見て選ぶ`）の絞り込みの条件 1 つ。軸と値の組で持つ（ADR-0069）。
 *
 * 軸は数え上げられるので、述語にはしない。述語にすると、カードの側の関数が相手の手札のカードを受け取る
 * ことになる。軸が増える時は、値を 1 つ足す。並べた条件をすべて満たすカードが候補になり、空の並びは
 * 絞り込まない。属性は、手札のカードに書かれたものを参照する。
 */
export type HandCondition =
  | { readonly axis: '種別'; readonly value: CardType }
  | { readonly axis: '属性'; readonly value: Attribute }

/**
 * 相手の手札を見て選ぶ命令で、選んだカードに行う処置（ADR-0069）。処置が増える時は、値を 1 つ足す。
 */
export type HandDisposal = '捨てる'

/**
 * 支配者が相手の手札を見て、`conditions` をすべて満たすカードを 1 枚（`upTo` なら 1 枚まで）選び、捨てる
 * （ADR-0069）。
 *
 * 見るのも選ぶのもプレイヤーであって、効果ではない。相手の手札のカードは、候補にも選ばれたカードにも、
 * 効果は触れない。選択は 1 回で、支配者には相手の手札の全部が見せる一覧として届き、条件に合うカードだけが
 * 選べる。合うカードが無くても一覧は届き、確認だけして先へ進む。相手の手札が 0 枚なら、聞かずにログだけを積む。
 */
export function* lookAtOpponentHandAndDiscard(
  conditions: readonly HandCondition[],
  options: { readonly upTo: boolean },
): EffectStep<void> {
  yield { kind: '相手の手札を見て選ぶ', conditions, disposal: '捨てる', mayDecline: options.upTo }
}

/**
 * 相手に、自分の手札から `count` 枚を選んで捨てさせる（ADR-0052）。「才気」もこれを使う。
 *
 * 選ぶのは相手で、相手は自分の手札の中身を知っている。ランダムには捨てない。相手の手札が
 * `count` 枚以下なら、聞かずにあるだけ捨てる（総合ルール 第4部 第10章の【例】）。
 *
 * 捨てたカードは効果に返らない。相手の手札の中身を効果が受け取る口は作らない（ADR-0004）。
 */
export function* discardOpponentHand(count: number): EffectStep<void> {
  yield { kind: '相手に手札を捨てさせる', count }
}

/**
 * 「してもよい」かを、支配者に「はい／いいえ」で聞く（ADR-0064）。「はい」なら `targets` に `action` を
 * エンジンが実行し、`true` を返す。「いいえ」なら何も起きず、`false` を返す。
 *
 * 対象が決まっていて、するかしないかだけを選ぶテキストに使う。「選び、〜してよい」のように、選ぶ操作が
 * ある場合は、`chooseAtMostOne` を使う。続きの処置（「そうしたら、〜」）は、`true` を受け取った後に、
 * 効果の側で書く。問いの文と実際の動きがずれないよう、動きは値で渡す（`MayAction`）。
 *
 * 聞く時点で、対象のすべてが、効果が読んだ場所を離れていれば、聞かずに `false` を返す。
 */
export function* mayDo(
  targets: readonly (CardInZone | UnitOnSquare | SmashCard | CardInTrapZone)[],
  action: MayAction,
): EffectStep<boolean> {
  const answered = yield { kind: 'してもよいか聞く', targets, action }
  return answered === true
}

/**
 * 支配者の山札を読む。山札とプランゾーンのカードが、中身つきで返る（ADR-0042）。
 *
 * 返る並びは山札の順序と関係がない。順序を読む口は作らない。プランゾーンのカードも、山札の
 * 1 番上にあるカードなので含む（総合ルール 第2部 第21章 3-1）。読んだことは、相手のログに
 * 名前なしで残る。読んだカードは、効果が命令の対象にできる。
 *
 * 見るのはプレイヤーであって、効果ではない。カードの側は、返った中身で分岐するためではなく、
 * 条件で絞って `chooseAtMostOne` の候補にするために使う。山札から選ぶテキストは、見せる一覧を
 * 付け忘れないよう `chooseAtMostOneFromLibrary` を使う。
 */
export function* readLibrary(): EffectStep<readonly CardInZone[]> {
  const cards = yield { kind: '自分の山札を読む' }
  // 命令を解釈する側が、読んだカードを返すことを、この関数だけが知っている。
  return cards as readonly CardInZone[]
}

/**
 * 支配者の山札をシャッフルする。プランゾーンにカードがあれば、裏向きにしてから混ぜる。
 *
 * 読んだのにシャッフルしない効果は止めない。テキストどおりに書く責任はカードの側にある
 * （ADR-0042）。
 */
export function* shuffleLibrary(): EffectStep<void> {
  yield { kind: '山札をシャッフルする' }
}

/**
 * 自分の山札を読み、条件に合うカードを 1 枚まで選ぶ。選ぶのは能力の支配者。
 *
 * 読む → 条件で絞る → 見せる一覧つきで 1 枚まで選ぶ、までをまとめた記述用の関数で、山札から選ぶ
 * テキストはこれを使う。選ぶプレイヤーには山札の全体が見せる一覧として届き、条件に合うカードだけが
 * 選べる。見せる一覧つきの選択を出せるのは、この関数だけである（一覧の付け忘れと、山札以外のカードを
 * 一覧に載せることを防ぐため）。条件に合うカードが無くても聞く（選ばないことを選ぶ）。選ばなかった
 * 時は `undefined`。
 */
export function* chooseAtMostOneFromLibrary(matches: (card: CardInZone) => boolean): EffectStep<CardInZone | undefined> {
  const cards = yield* readLibrary()
  const chosen = yield { kind: '選ぶ', candidates: cards.filter(matches), mayDecline: true, shown: cards }
  // 命令を解釈する側が、候補の中から選んで返す（選ばなければ `undefined`）。
  return chosen as CardInZone | undefined
}

/**
 * 支配者の手札を相手に見せ、相手に 1 枚まで選ばせる。選ぶのは相手（ADR-0052）。
 *
 * 手札の全体が、候補にも相手へ見せる一覧にもなる。相手は 1 枚選ぶことも、選ばないこともできる。
 * 選ばれたカード（選ばなければ `undefined`）が効果に返る。支配者の手札は、支配者自身の手札なので、
 * 効果が受け取ってよい（`DuelView.hand`）。見せる一覧に手札を載せられるのは、この関数だけである
 * （山札を載せられるのが `chooseAtMostOneFromLibrary` だけなのと同じ）。
 *
 * 相手に見せたことは、エンジンがログに積む（`相手に手札を見せる`）。支配者の手札が 0 枚なら、聞かずに
 * ログだけを積んで、`undefined` が返る。
 */
export function* letOpponentChooseFromMyHand(duel: DuelView): EffectStep<CardInZone | undefined> {
  const hand = duel.hand()
  const chosen = yield { kind: '選ぶ', candidates: hand, mayDecline: true, shown: hand, picker: '相手' }
  // 命令を解釈する側が、候補の中から選んで返す（選ばなければ `undefined`）。
  return chosen as CardInZone | undefined
}

/**
 * カードを、能力の支配者の支配下でスクエアに置く。向きを指定する。
 *
 * これは「登場」ではない。プレイされたユニットがスクエアに置かれることだけを「登場」と
 * 呼ぶ（総合ルール 第2部 第20章 1-4-a）。効果によって置かれるこの経路では、
 *
 * - 「登場した時」「味方が登場した時」に誘発する能力は誘発しない
 * - 「根性」は働かない（同 第5部 第6章 3）。ここで指定した向きがそのまま使われる
 *
 * どちらも、プレイの経路（`play.ts` の `placePlayedUnit`）を通らないことで分かれている。
 *
 * 一方、相手のトラップの「侵入」（総合ルール 第2部 第20章 3-6）と、相手の「勇気」の起動条件
 * （同 第5部 第2章 2）は、登場と同じく満たしうる。どちらも置き方を限っていないためである。
 * 別のスクエアにいるユニットを置き直した場合も同じである。
 *
 * どのスクエアに置くかはカードのテキストが決める。「味方エリアに置く」であれば、エリアの
 * 中のどのスクエアかを支配者が選ぶ。エリアとスクエアの対応は `areaOf`、置けるスクエアの
 * 一覧は `BATTLE_SPACE` で、いずれもカードの側から使える。自分のユニットがすでにいる
 * スクエアを避けるかどうかも、テキストの読み方としてカードの側が決める。
 */
export function* placeOnSquare(
  card: CardInZone | UnitOnSquare,
  square: Square,
  orientation: Orientation,
): EffectStep<void> {
  yield { kind: 'スクエアへ置く', card, square, orientation }
}

/**
 * スクエアにいるユニットを、向きを変えずに別のスクエアに置く（「向きを変えずに置く」）。
 *
 * 向きは、置く瞬間にそのユニットがスクエアで持っている向きをそのまま使う。効果に見せたユニットの
 * 向きを取得して渡す形にしないのは、誘発した時に見せたユニットが、置くまでの間に向きを変更している
 * ことがあるためである。見せたユニットが置く時にもうスクエアにいなければ、この行動は実行されない
 * （総合ルール 第1部 第1章 3）。
 *
 * 登場ではない点、敵のいるスクエアにも置ける点は `placeOnSquare` と同じである。
 */
export function* placeOnSquareKeepingOrientation(unit: UnitOnSquare, square: Square): EffectStep<void> {
  yield { kind: 'スクエアへ置く', card: unit, square, orientation: '変えない' }
}

/**
 * そのプレイヤーのプランを裏返す（総合ルール 第2部 第21章 3-4）。
 *
 * 山札の 1 番上のカードが表向きの場合にそれをプランと呼ぶ（同 3-1・3-2）ので、裏返すことは
 * そのカードを裏向きの山札に戻すことにあたる。表向きかどうかを盤面が別に持っていないのは、
 * それが置かれている場所から決まるためである（`play.ts` 参照）。
 *
 * 裏返した後、プランゾーンはなくなる。次に現れる山札の 1 番上のカードは裏向きのままになる
 * （同 3-3）ので、めくり直されることはない。
 *
 * プランが無ければ、この行動は実行されない（同 第1部 第1章 3）。効果はそのまま続く。
 *
 * 相手のプランも裏返せる。誰が相手かは公開されている情報であり、裏返すのに中身を読む必要も
 * ないためである（`DuelView.opponent`）。
 */
export function* flipPlan(player: Player): EffectStep<void> {
  yield { kind: 'プランを裏返す', player }
}

/**
 * トラップゾーンのカードを持ち主の捨札に置き、置いた後のカードの表記を返す（ADR-0067）。
 *
 * 「トラップを 1 枚選び、捨札に置く。それが本物のトラップなら〜」のように、置いた後のカードが
 * 何だったかで続きが分かれるテキストのための命令である。トラップゾーンのカードは、置く前は中身を
 * 持たない値（`CardInTrapZone`）でしか見えない（ADR-0040）。捨札に置かれて公開された後の表記を
 * 返すので、隠れた情報の境目は動かない。
 *
 * 返すのは表記だけで、捨札にあるそのカードを指す値は返さない。相手の捨札のカードを、対象として
 * 扱える経路を作成しないためである。本物のトラップかどうかは、カードの側が返ってきた表記の種別で
 * 判定する。
 *
 * すでにトラップゾーンを離れていて実行されなかった場合は、何も返さない（総合ルール 第1部 第1章 3）。
 * 持ち主以外のトラップゾーンのカードも、置かれる先は持ち主の捨札である（同 第2部 第21章 1-2）。
 */
export function* discardTrapZoneCard(card: CardInTrapZone): EffectStep<Card | undefined> {
  return (yield { kind: 'トラップゾーンのカードを捨札に置く', card }) as Card | undefined
}

/**
 * 支配者の山札の 1 番上のカードを、別のゾーンの 1 番上に置く。向きを指定する。
 *
 * カードを選ぶのではなく位置を指定するので、山札の中身を効果に見せずに動かせる。
 * `DuelView` に山札を読むアクセサが無いのはそのためである。どのカードが動いたかは、
 * 効果からは分からないままになる。
 *
 * プランゾーンにカードがあれば、それが同時に山札の 1 番上のカードである
 * （総合ルール 第2部 第21章 3-1）ので、そちらが動く。
 *
 * 山札が空なら、この行動は実行されない（同 第1部 第1章 3）。効果はそのまま続く。
 */
export function* placeTopOfLibrary(to: PlayerZone, orientation: Orientation): EffectStep<void> {
  yield { kind: '山札の1番上をゾーンへ置く', to, orientation }
}

/**
 * 誘発型能力を 1 つ作る（総合ルール 第4部 第3章 4）。
 *
 * 「〜する。そのカードを次のあなたのターンの終わりに、〜する」のように、いま起こすことと、
 * 後から起こすこととが 1 つのテキストに書かれている場合の、後半にあたる。作られた能力は
 * どのカードにも書かれていない状態で盤面に残り、そのできごとが次に起こった時に 1 度だけ
 * 誘発する（同 4）。
 *
 * 影響を与える対象を必ず 1 枚受け取る。作られた後・誘発する前にその対象が「スクエアから
 * スクエア」以外のゾーン移動をすると、能力は消滅する（同 4-1）。対象を持たない能力を作る
 * テキストが出てきた時に、無しで作れる形を足す。
 *
 * 対象は engine が見せたカードでなければならない（`resolve.ts` の `shown`）。誘発した時に
 * その時点のユニットが効果へ手渡される（`CreatedAbilityEffect`）ので、作る側と誘発した側で対象を
 * 取り違えようがない。
 *
 * `description` は何をするかの文で、カードのテキストと同じ、支配者の行動として書く。対象のカードを
 * 目的語（「〜を」）にした時に続く述語で、対象は含めない（「手札に加える」）。engine は中身を参照せず、
 * 画面がログとカードの詳細に表示する（ADR-0063）。
 */
export function* createTriggeredAbility(
  affecting: CardInZone | UnitOnSquare,
  trigger: CreatedTrigger,
  description: string,
  effect: CreatedAbilityEffect,
): EffectStep<void> {
  yield {
    kind: '誘発型能力を作る',
    ability: { kind: '作成された誘発型能力', place: 'スクエア', trigger, description, effect },
    affecting,
  }
}

/**
 * 対象を持たない誘発型能力を 1 つ作成する（総合ルール 第4部 第3章 4。ADR-0065）。
 *
 * 「次の相手のターンの終わりまで、あなたのカードがスマッシュゾーンに置かれた時、〜してよい」のように、
 * 影響を与える特定のカードが無い能力である。このため、第4部 第3章 4-1（対象がゾーン移動すると消滅する）は
 * 適用されない。盤面から無くなるのは、期限が終了した時と、期限を持たずに誘発した時だけである。
 *
 * `duration` を渡すと、その期限まで、誘発イベントが起きるたびに何度でも誘発する（同 4 の 2 文目）。
 * 渡さなければ、次に誘発イベントが起こった時に 1 度だけ誘発する。
 *
 * `description` は何をするかの文で、カードのテキストと同じ、支配者の行動として書く。「自分の」「相手の」は
 * 書かない（見る人ごとの言い換えが及ばないため。ADR-0065）。
 */
export function* createUntargetedTriggeredAbility(
  trigger: CreatedTrigger,
  description: string,
  effect: CreatedUntargetedAbilityEffect,
  duration?: Duration,
): EffectStep<void> {
  yield {
    kind: '対象を持たない誘発型能力を作る',
    ability: { kind: '作成された誘発型能力', place: 'なし', trigger, description, duration, effect },
  }
}

/**
 * 捨札にあるカードを対象にする誘発型能力を 1 つ作成する（総合ルール 第4部 第3章 4。ADR-0057）。
 *
 * 「このカードが捨札に置かれた時、そのターンの終わりに、捨札にあるこのカードを手札に加える」の
 * 後半にあたる。`createTriggeredAbility` と違い、誘発する時に対象が捨札にある場合だけ誘発し、
 * 効果へは捨札にあるカード（`CardInDiscardPile`）が手渡される。対象が捨札以外のカードだと、
 * 型検査が止める。
 *
 * 作成した時点で対象が捨札に無ければ、能力は作成されない（実行できない行動は実行されない。同 第1部
 * 第1章 3）。作成された後・誘発する前に対象が捨札を離れれば、能力は消滅する（同 第4部 第3章 4-1）。
 * 捨札へ戻ってきたカードは新しいカードなので、能力は戻らない。
 */
export function* createTriggeredAbilityForDiscardedCard(
  affecting: CardInDiscardPile,
  trigger: CreatedTrigger,
  description: string,
  effect: CreatedDiscardAbilityEffect,
): EffectStep<void> {
  yield {
    kind: '誘発型能力を作る',
    ability: { kind: '作成された誘発型能力', place: '捨札', trigger, description, effect },
    affecting,
  }
}

/**
 * 作成された継続効果を作る（総合ルール 第4部 第12章 3）。
 *
 * 「ターンの終わりまで、そのユニットのＢＰを＋Ｘ」のように、解決が残す継続効果である。盤面が
 * 値として持ち、期限が来るまで、ＢＰを読むたびに常在型能力の分へ足される（`continuous.ts`）。
 * 作ったカードがすぐ捨札へ行っても続く（同 3-1）。
 *
 * 渡された変更 1 つにつき 1 件を作る。対象は作る時に決まり、値は解決の時に 1 度だけ決まる
 * （同 3-2・3-3）。後から置かれたカードには及ばない。対象は engine が見せたカードでなければ
 * ならない（`resolve.ts` の `shown`）。渡せるのはＢＰの変更（`bpPlus`）・ＳＰの変更
 * （`spPlus`）・能力の付与（`granting`）で、何を変えるかは渡された値の種類の札で決まる。
 */
export function* createContinuousEffect(
  duration: Duration,
  ...modifiers: readonly ContinuousModifier[]
): EffectStep<void> {
  for (const modifier of modifiers) {
    yield { kind: '継続効果を作成する', duration, target: modifier.target, change: changeOf(modifier) }
  }
}

/** 渡された値を、盤面が持つ変更にする。種類を足したら、ここで型検査が止まる。 */
function changeOf(modifier: ContinuousModifier): ContinuousChange {
  switch (modifier.kind) {
    case 'ＢＰの変更':
    case 'ＳＰの変更':
      return { kind: modifier.kind, amount: modifier.amount }
    case '能力の付与':
      return { kind: '能力の付与', ability: modifier.ability }
    case '移動方向の変更':
      return { kind: '移動方向の変更', method: modifier.method, directions: modifier.directions }
    default:
      return modifier satisfies never
  }
}
