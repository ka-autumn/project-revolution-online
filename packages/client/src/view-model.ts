import { areaOf, indexOfSquare, lineOf, PLAYERS, squareFromView } from '@revolution/engine'
import type {
  Area,
  Attribute,
  BattleStep,
  CardId,
  EffectiveUnitData,
  DuelEvent,
  DuelResult,
  LoggedInstruction,
  Orientation,
  Player,
  PlayerZone,
  ResolutionVia,
  SmashJudgmentStep,
  Square,
  SquareIndex,
  Turn,
  WireCardFace,
  WireCardInstance,
  WireCardPosition,
  WirePerspective,
  WireVisibleCard,
} from '@revolution/engine'

/**
 * 届いた盤面から、画面に出す値を作る（#14）。
 *
 * **ここが唯一のテストできる層である。** DOM を触るところ（`render.ts`）はこれを読んで書くだけ
 * にして、画面に何が出るかの判断はすべてここに寄せている。
 *
 * **隠す判断は持たない。** 見えていないカードは `見えていない` として届く（ADR-0004）ので、
 * ここでできるのは届いたものを描く形に直すことだけである。届いていないものは、描きようがない
 * から画面に出ない。
 */

/** カードの詳細に出す 1 行。 */
export interface DetailRow {
  readonly label: string
  readonly value: string
}

/**
 * 継続効果によって、カードに書かれているのとは違うデータになっているところ（#91）。
 *
 * **書かれている値を置き換えない。** 画面には印刷された数字も残す。バトルで比べられるのは
 * 修整後の数字（総合ルール 第4部 第12章、`card.ts` の `bpOf`）なので、打つ人が見る数字が
 * 印刷のままだと判断材料が嘘をつくが、**どちらがカードに書かれている値かも要る**。
 */
export interface ModifiedData {
  /** 修整後のＢＰ。書かれている数字と同じなら `undefined`。 */
  readonly bp: number | undefined
  /** 継続効果によって加わった属性だけ。加わっていなければ空。 */
  readonly addedAttributes: readonly Attribute[]
}

/** 画面に出す 1 枚。 */
export type CardView =
  | {
      /** 表側が見えている。 */
      readonly kind: '表'
      readonly id: CardId
      readonly name: string
      /**
       * 支配者が見る人自身か、相手か（総合ルール 第4部 第7章 1）。
       *
       * **持ち主ではなく支配者で決める。** スクエアにいるユニットが「味方」か「敵」かを分ける
       * のは支配者である（同 第2部 第21章 8-2）。持ち主と支配者は食い違いうる（`duel.ts` の
       * `instantiate`）ので、食い違っていれば詳細のほうに両方出る。
       *
       * **1 枚ごとに持つ。** バトル中は支配者の違う 2 体が同じスクエアに並ぶ（同 第3部 第11章 1）
       * ので、スクエア単位では決まらない。
       */
      readonly controlledBy: '自分' | '相手'
      /** 小さいカードに添える 1 行。「Lv1 赤 BP1000 SP1000」のような形。 */
      readonly summary: string
      /**
       * 継続効果を適用した後のＢＰと属性（#91）。修整を受けていなければ `undefined`。
       *
       * **持つのはスクエアにいるユニットだけである。** 継続効果がデータを変えるのはそこに
       * いるユニットで（総合ルール 第4部 第12章）、盤面もその分だけを送ってくる
       * （`perspective.ts` の `EffectiveUnitData`）。
       */
      readonly modified: ModifiedData | undefined
      /** 詳しく見たときに出す全部。行と値の組で書けるものだけがここに入る。 */
      readonly details: readonly DetailRow[]
      /**
       * カードに印刷されているテキスト（#93）。改行ごとに 1 行（総合ルール 第2部 第10章 1、
       * 第4部 第1章 3）。書かれていなければ空。
       *
       * `details` に入れていないのは、これが「項目と値」ではなく**そのまま読ませる文**だから
       * である。行の並びのまま渡して、改行を潰さずに出す。
       */
      readonly text: readonly string[]
      readonly orientation: Orientation
      /** 乗っているダメージ（総合ルール 第2部 第16章）。 */
      readonly damage: number
    }
  | {
      /**
       * 表側が見えていない。
       *
       * **識別子を持たない。** 識別子はシャッフル前のデッキでの番号から作られている
       * （`setup.ts` の `library`）ので、自分のデッキの並びを知っていればそれがカードの正体に
       * なる。そもそも届いていない（`perspective.ts` の `VisibleCard`）。
       */
      readonly kind: '裏'
      readonly orientation: Orientation
      /**
       * 盤面での置き場所（#127）。
       *
       * **識別子の代わりに押すところを指す。** 裏向きのカードも候補になる（プランのコストの
       * スマッシュ、総合ルール 第2部 第21章 7-5）が、識別子が無いので盤面のどの札のことかを
       * 結び付けられなかった。ゾーンと何番目かなら、見えないままで結び付けられる。
       *
       * 持つのはゾーンに並ぶカードだけである。スクエアにあるカードは公開情報（同 第23章 1-1）
       * なので、裏で並ぶことがない。
       */
      readonly at: WireCardPosition
    }

/** 画面に出すスクエア 1 つ。 */
export interface SquareView {
  /** 盤面に固定した位置。行動を送るときに使う（`board.ts` の `Square`）。 */
  readonly square: Square
  /** 見る人から見たエリア（総合ルール 第2部 第22章 6）。 */
  readonly area: Area
  readonly cards: readonly CardView[]
}

/** 画面に出すゾーン 1 つ。 */
export interface ZoneView {
  readonly zone: PlayerZone
  /** 枚数。公開情報である（総合ルール 第2部 第23章 1-1）。 */
  readonly count: number
  /**
   * 並べるカード。**山札だけは空になる。**
   *
   * 山札は持ち主であっても中身を見てはならない（総合ルール 第2部 第21章 2-2）ので、届くのは
   * 裏向きばかりである。1 枚ずつ並べても見分けが付かず、意味があるのは枚数だけである。
   */
  readonly cards: readonly CardView[]
}

/** 画面に出す、片方のプレイヤーの持ち物。 */
export interface SideView {
  readonly player: Player
  /** 見る人自身か、相手か。 */
  readonly whose: '自分' | '相手'
  /** 受けているダメージ（総合ルール 第2部 第17章）。 */
  readonly damage: number
  /** 並べる順に並んだゾーン。 */
  readonly zones: readonly ZoneView[]
}

/**
 * 解決を待っている能力 1 つ（総合ルール 第2部 第21章 11）。
 *
 * **何をする能力かは出せない。** 効果は関数なので射影の時点で落としてある
 * （`perspective.ts` の `VisibleAbility`）。出せるのは誰の能力で、どのカードから出たかまで。
 * それでも「バンクに何か積まれている」はスマッシュを行えるかを左右する（`priority.ts` の
 * `activePlayerMayAct`）ので、見えるだけで判断に効く。
 */
export interface AbilityView {
  readonly whose: '自分' | '相手'
  /** 発生源のカードの名前。作成された誘発型能力など、指せないものは `undefined`。 */
  readonly source: string | undefined
}

/** 発生しているバトル（総合ルール 第3部 第11章）。 */
export interface BattleView {
  /** 見る人から見たスクエアの呼び名。 */
  readonly where: string
  readonly step: BattleStep
  /** 攻撃したユニットの名前（総合ルール 第3部 第11章 4）。 */
  readonly attacker: string
  /** 攻撃されたユニットの名前（同 4）。 */
  readonly attacked: string
}

/**
 * 発生しているスマッシュ判定 1 つ（総合ルール 第3部 第17章）。#102。
 *
 * バトル（`BattleView`）と同じ扱いにしている。**進行中であることが画面に出ないと、正しい
 * 挙動が誤りに見える**——スマッシュゾーンにカードが置かれるのは希望ステップ（同 第19章 1）で、
 * そこへ進むには優先権のやり取りが要るので、判定が始まったことが分からないと「スマッシュ
 * したのに増えない」ように見える。
 */
export interface SmashJudgmentView {
  /** 誰のスマッシュ判定か。ダメージを受けたプレイヤーである（総合ルール 第3部 第17章 1）。 */
  readonly whose: '自分' | '相手'
  readonly step: SmashJudgmentStep
  /**
   * 希望ステップと確定ステップを繰り返す回数（総合ルール 第3部 第17章 3）。回復ステップで
   * 回復する量もこの回数で決まる（同 第18章 1）。
   */
  readonly repeats: number
  /** いま何回目か（同 3 の「第１希望ステップ」）。回復ステップの間はまだ始まっていない。 */
  readonly round: number | undefined
  /**
   * 希望ステップで、規定によって表向きに置かれているカードの名前（総合ルール 第3部 第19章 1）。
   * 無ければ `undefined`。
   *
   * **これはスマッシュではない**（同 第2部 第21章 7-2）ので、スマッシュゾーンの枚数には
   * 数えない（`smash.ts` の `smashesOf` と同じ）。
   */
  readonly faceUp: string | undefined
}

/**
 * 操作ログの 1 行（#95）。
 *
 * **落とす判断はここには無い。** 見てはならないカードは、名指しされないまま届く
 * （`perspective.ts` の `DuelPerspective.log`）。ここでできるのは、届いたできごとを読める
 * 文に直すことだけである。
 */
export interface LogLine {
  /**
   * 誰のできごとか。どちらのものでもなければ `undefined`。
   *
   * ルールエフェクトはどちらのプレイヤーにも支配されない（総合ルール 第4部 第14章 1）ので、
   * 誰のものでもない行になる。
   */
  readonly whose: '自分' | '相手' | undefined
  readonly text: string
}

/**
 * 効果の解決 1 つ分のカットイン（#104）。
 *
 * **落とす判断はここに無い。** 見てはならないカードは名指しされないまま届く。盤面の一部
 * ではなく、盤面より上に一時的に重なるものなので `BoardView` には持たせない。
 */
export interface CutInView {
  readonly whose: '自分' | '相手'
  /** 「◯◯の効果、誘発！」のような 1 行。 */
  readonly heading: string
  /** 効果が何をしたか。命令 1 つが 1 行。 */
  readonly lines: readonly string[]
}

/**
 * フェイズ・ターンが変わったことを知らせる演出 1 つ（#96）。
 *
 * 効果解決のカットイン（`CutInView`）と同じ層に重ねるが、どちらのプレイヤーの
 * できごとでもない進行の合図なので、プレイヤーの色は持たない。
 */
export interface TransitionView {
  /** 「第 4 ターン：後攻のターン」「メインフェイズ」のような 1 行。 */
  readonly heading: string
}

/**
 * いま出す演出ひとまとめ（#96・#104）。
 *
 * フェイズ・ターンの切り替わりと効果解決のカットインは、出す中身は別だが**溜めない**という
 * 出し方の決まりは同じである。1 回の盤面到着から作られる分を 1 つの塊として、同じ待ち行列
 * （`index.ts`）で順に出す。
 */
export interface Overlay {
  readonly transitions: readonly TransitionView[]
  readonly cutIns: readonly CutInView[]
}

/** 出すものがあるか。無ければ演出は画面に無い。 */
export function showsOverlay(overlay: Overlay): boolean {
  return overlay.transitions.length > 0 || overlay.cutIns.length > 0
}

/**
 * 演出 1 件を出しておく長さ（#115）。`waiting` は、その後ろで待っている件数である。
 *
 * **待ち行列が長いほど短くする。** 演出が出ている間は打てない（`index.ts`）ので、この長さは
 * そのまま待ち時間になる。放棄しか行えない場面の自動送信（`input-model.ts` の
 * `automaticAction`）で何段も一気に進むと、1 回の盤面到着で何件も溜まる。
 *
 * 溜まった分を出し切るのに使ってよい合計を決めて、待っている件数で割る。1 件だけなら通常の
 * 長さで、溜まっているほど短くなる。**読めなくなるほどは短くしない**ので、溜まり方によっては
 * 合計が予算を超える。予算は上限ではなく、短くする度合いを決めるための目安である。
 */
export function overlayDurationMs(waiting: number): number {
  /** 後ろに何も待っていない時の長さ。押し付けがましくならない程度に。 */
  const FULL_MS = 2000
  /** 溜まっている分を出し切るのに使ってよい合計の目安。 */
  const BUDGET_MS = 4000
  /** これより短いと読む前に消える。 */
  const SHORTEST_MS = 400

  const share = Math.floor(BUDGET_MS / (waiting + 1))
  return Math.min(FULL_MS, Math.max(SHORTEST_MS, share))
}

/** 画面に出す盤面ひととおり。 */
export interface BoardView {
  readonly seat: Player
  /** 「第 3 ターン・メインフェイズ・自分の優先権」のような 1 行。 */
  readonly turn: string
  /** 発生しているバトル。無ければ `undefined`。 */
  readonly battle: BattleView | undefined
  /**
   * 発生しているスマッシュ判定（#102）。無ければ空。
   *
   * 進行中にもう 1 つ発生しうる（総合ルール 第3部 第17章 2-2）ので、1 つではなく並びで持つ。
   */
  readonly smashJudgments: readonly SmashJudgmentView[]
  /** バンクで解決を待っている能力（総合ルール 第2部 第21章 11-1）。 */
  readonly bank: readonly AbilityView[]
  /** 誘発したが、まだバンクに置かれていない能力（同 第4部 第3章 3）。 */
  readonly triggered: readonly AbilityView[]
  /** 相手の持ち物。画面の上に出す。 */
  readonly opponent: SideView
  /** 自分の持ち物。画面の下に出す。 */
  readonly own: SideView
  /**
   * 3×3 のスクエア。**見る人の向きに直してある**（上が敵エリア、下が味方エリア）。
   *
   * 外側が上から下の行、内側が左から右の列である。
   */
  readonly squares: readonly (readonly SquareView[])[]
  /** 決着していれば、その 1 行。 */
  readonly result: string | undefined
  /** 起きたできごと。新しいものから並ぶ（#95、#111）。 */
  readonly log: readonly LogLine[]
}

/** ゾーンを並べる順。届く順ではなく、画面での置き場所である。 */
const ZONE_ORDER: readonly PlayerZone[] = [
  '手札',
  'エネルギーゾーン',
  'トラップゾーン',
  'スマッシュゾーン',
  'プランゾーン',
  '捨札',
  '山札',
  'リムーブゾーン',
  'パートナーゾーン',
]

/** 中身を並べず、枚数だけを出すゾーン。 */
const COUNTED_ZONES: readonly PlayerZone[] = ['山札']

const SQUARE_INDEXES: readonly SquareIndex[] = [0, 1, 2]

/**
 * 名前を出してよいカードすべて。盤面に載っているものと、ログが名指ししているものの両方。
 *
 * **2 つある理由は、名前が要る時と見えている時がずれるためである**（#139）。ログの名指しは
 * そのできごとの時に見えていたかで残る（#129）ので、山札に戻ったカードのように、名指しは
 * 残っているのに盤面から引けないことがある。届く側で足りないぶんを補うのではなく、
 * **引ける先をサーバが揃えて送ってくる**（`wire.ts` の `namedInLog`）。
 */
function namableInstances(board: WirePerspective): readonly WireCardInstance[] {
  return [...visibleInstances(board), ...board.namedInLog]
}

/** 表側が見えているカードすべて。盤面のどこかに載っているものだけである。 */
function visibleInstances(board: WirePerspective): readonly WireCardInstance[] {
  return [
    ...board.squares.flat(),
    ...board.resolveZone,
    ...Object.values(board.zones).flatMap((zones) =>
      Object.values(zones).flatMap((cards) =>
        cards.flatMap((card) => (card.kind === '見えている' ? [card.instance] : [])),
      ),
    ),
  ]
}

/** 盤面が実際に描いているもの（#150）。 */
export interface DrawnOnBoard {
  /** 表側が見えていて、押すところが盤面にあるカード。 */
  readonly ids: ReadonlySet<CardId>
  /** 裏向きのまま並んでいる札の置き場所（`keyOfPosition` の鍵）。 */
  readonly positions: ReadonlySet<string>
}

/**
 * 盤面のどこに描かれているかが分かるカードすべて（#150）。
 *
 * **`visibleInstances` とは別物である。** あちらは名前を引くためのもので、盤面に描かれない
 * リゾルブゾーンまで見ている。押せるかどうかをそこから決めると、**画面のどこにも無いカードが
 * 押せる扱いになる。** 数えるのは実際に描いているところ——スクエア（`squareViews`）と、中身を
 * 並べるゾーン（`zoneView`）——だけである。山札は枚数しか出さない（`COUNTED_ZONES`）ので入らない。
 */
export function drawnOnBoard(board: WirePerspective): DrawnOnBoard {
  const ids = new Set<CardId>(board.squares.flat().map((instance) => instance.id))
  const positions = new Set<string>()

  for (const player of PLAYERS) {
    for (const zone of ZONE_ORDER) {
      if (COUNTED_ZONES.includes(zone)) continue
      board.zones[player][zone].forEach((card, index) => {
        if (card.kind === '見えている') ids.add(card.instance.id)
        else positions.add(keyOfPosition({ player, zone, index }))
      })
    }
  }

  return { ids, positions }
}

/**
 * 名前を出してよいカードを、識別子で名前が引ける表にする。
 *
 * 行える手（`input-model.ts`）もバトルもバンクもログも、カードを識別子で指してくる。名前に
 * 直せるのは、届いているもの（`namableInstances`）だけである。
 */
export function namesIn(board: WirePerspective): ReadonlyMap<CardId, string> {
  return new Map(namableInstances(board).map((instance) => [instance.id, instance.card.name]))
}

/**
 * 名前を出してよいカード 1 枚。届いていなければ `undefined`。
 *
 * バトルの勝敗（#111）を「自分」「相手」の名前とカード名の両方で言うのに使う。名前も支配者も
 * 同じ 1 枚から引くので、届いているかどうかの判断が 1 回で済む。
 */
function namableInstanceOf(board: WirePerspective, id: CardId): WireCardInstance | undefined {
  return namableInstances(board).find((instance) => instance.id === id)
}

/**
 * その識別子のカードの名前。見えていなければ、名前ではなく見えていないことを返す。
 *
 * **名前を作り出さない。** 届いていないカードが指されたら、そのまま見えていないと出す。
 */
export function nameOf(names: ReadonlyMap<CardId, string>, id: CardId): string {
  return names.get(id) ?? '見えていないカード'
}

/**
 * 置き場所を 1 つの鍵に直す（#127）。
 *
 * 置き場所は組（`protocol.ts` の `WireCardPosition`）なので、そのままでは `Map` の鍵にできず、
 * 見比べるのにも項目を 3 つ突き合わせることになる。スクエアを盤面の並びの番号で引く
 * （`indexOfSquare`）のと同じ扱いである。**画面に出すものではない。**
 */
export function keyOfPosition(at: WireCardPosition): string {
  return `${at.player}/${at.zone}/${at.index}`
}

/** 見る人から見たスクエアの呼び方（総合ルール 第2部 第22章 4・6）。 */
export function squareLabel(viewer: Player, square: Square): string {
  return `${areaOf(viewer, square)}の${lineOf(viewer, square)}`
}

/**
 * 印刷された図に描かれたスクエアの呼び方（トリガーアイコン）。
 *
 * 印刷は支配者の手前を基準にしている（`board.ts` の `squareFromView`）。先攻がその基準の向き
 * なので、先攻から見た呼び名がそのまま「カードに描かれている位置」の呼び名になる。**盤面の
 * どこかを指しているのではない**ので、見る人が誰かとは関係しない。
 */
function printedSquareLabel(printed: Square): string {
  return squareLabel('先攻', printed)
}

const COLORLESS = '無色'

function colorsOf(face: WireCardFace): string {
  return face.colors.length === 0 ? COLORLESS : face.colors.join('・')
}

/**
 * 属性の並び。継続効果によって加わった分（#91）は `+` を付けて区別する。
 *
 * 加わった属性はカードに書かれていない（総合ルール 第4部 第12章 5-2 の(3)）。並べて出すだけ
 * だと、どれが印刷されている属性かが分からなくなる。
 */
function attributesLabel(face: WireCardFace, modified: ModifiedData | undefined): string {
  const added = (modified?.addedAttributes ?? []).map((attribute) => `+${attribute}`)
  const all = [...face.attributes, ...added]

  return all.length === 0 ? '' : ` 《${all.join('・')}》`
}

/**
 * カードに書かれていることを 1 行にする。
 *
 * 継続効果を適用した後のＢＰ（#91）は、印刷された数字を消さずに `BP1000→2000` と続けて出す。
 * バトルで比べられるのは後ろの数字（`card.ts` の `bpOf`）だが、**どちらがカードに書かれて
 * いる値かも要る**。
 */
function summaryOf(face: WireCardFace, modified: ModifiedData | undefined = undefined): string {
  const bp = modified?.bp === undefined ? '' : `→${modified.bp}`
  const body = face.type === 'ユニット' ? `BP${face.bp}${bp} SP${face.sp}` : face.type

  return `Lv${face.level} ${colorsOf(face)} ${body}${attributesLabel(face, modified)}`
}

/**
 * 詳しく見たときに出す全部。
 *
 * 持っていない項目は行ごと出さない（スターを持たないカードに「スター 0」と書かない）。
 * **能力テキストはここに無い。** 通信に載っていないためで、載せるのは #93。
 */
function detailsOf(
  instance: WireCardInstance,
  viewer: Player,
  modified: ModifiedData | undefined,
): readonly DetailRow[] {
  const face = instance.card
  const rows: DetailRow[] = [
    { label: '種別', value: face.type },
    { label: 'レベル', value: String(face.level) },
    { label: '色', value: colorsOf(face) },
    { label: '支配者', value: whoseLabel(viewer, instance.controller) },
  ]

  // 持ち主と支配者は食い違いうる。同じなら 1 行で足りる。
  if (instance.owner !== instance.controller) {
    rows.push({ label: '持ち主', value: whoseLabel(viewer, instance.owner) })
  }

  if (face.type === 'ユニット') {
    rows.push({ label: 'ＢＰ', value: String(face.bp) })
    // 印刷された数字の次に置く。同じ「ＢＰ」でも別のものなので、行を分けて両方出す（#91）。
    if (modified?.bp !== undefined) rows.push({ label: 'ＢＰ（修整後）', value: String(modified.bp) })
    rows.push({ label: 'ＳＰ', value: String(face.sp) })
    if (face.moveIcon.length > 0) rows.push({ label: 'ムーブアイコン', value: face.moveIcon.join('・') })
  }
  if (face.type === 'トラップ' && face.triggerIcon.length > 0) {
    rows.push({ label: 'トリガーアイコン', value: face.triggerIcon.map(printedSquareLabel).join('・') })
  }
  if (face.stars > 0) rows.push({ label: 'スター', value: String(face.stars) })
  if (face.reverseStars > 0) rows.push({ label: 'リバーススター', value: String(face.reverseStars) })
  if (face.attributes.length > 0) rows.push({ label: '属性', value: face.attributes.join('・') })
  // 加わった属性もカードには書かれていない（総合ルール 第4部 第12章 5-2 の(3)）ので分ける。
  if (modified !== undefined && modified.addedAttributes.length > 0) {
    rows.push({ label: '加わった属性', value: modified.addedAttributes.join('・') })
  }

  rows.push({ label: '向き', value: instance.orientation })
  if (instance.damage > 0) rows.push({ label: 'ダメージ', value: String(instance.damage) })

  return rows
}

/**
 * 継続効果によって、カードに書かれているのとは違うデータになっているところ（#91）。
 * 違いが無ければ `undefined`。
 *
 * 適用した後の値を送ってくるのは盤面の側（`perspective.ts` の `EffectiveUnitData`）である。
 * ここでするのは、書かれている値と見比べて**どこが変わったか**を取り出すことだけで、
 * **修整を計算しない**（ADR-0010）。
 */
function modifiedDataOf(
  instance: WireCardInstance,
  effective: readonly EffectiveUnitData[],
): ModifiedData | undefined {
  const applied = effective.find((each) => each.card === instance.id)
  if (applied === undefined) return undefined

  const face = instance.card
  const bp = face.type === 'ユニット' && applied.bp !== face.bp ? applied.bp : undefined
  const addedAttributes = [...new Set(applied.attributes)].filter(
    (attribute) => !face.attributes.includes(attribute),
  )
  if (bp === undefined && addedAttributes.length === 0) return undefined

  return { bp, addedAttributes }
}

function faceUpView(
  instance: WireCardInstance,
  viewer: Player,
  effective: readonly EffectiveUnitData[] = [],
): CardView {
  const modified = modifiedDataOf(instance, effective)

  return {
    kind: '表',
    id: instance.id,
    name: instance.card.name,
    controlledBy: whoseLabel(viewer, instance.controller),
    summary: summaryOf(instance.card, modified),
    modified,
    details: detailsOf(instance, viewer, modified),
    // 見えていないカードのテキストは、そもそも届かない（`wire.ts` の `WireWrittenCard`）。
    text: instance.card.text,
    orientation: instance.orientation,
    damage: instance.damage,
  }
}

/**
 * ゾーンに並ぶ 1 枚。
 *
 * 裏向きのカードには置き場所を持たせる（#127）。届いた並びの何番目かがそのまま位置になる
 * （`protocol.ts` の `WireCardPosition`）ので、数え直さない。
 */
function cardView(card: WireVisibleCard, viewer: Player, at: WireCardPosition): CardView {
  return card.kind === '見えている'
    ? faceUpView(card.instance, viewer)
    : { kind: '裏', orientation: card.orientation, at }
}

/**
 * いま規定によって表向きに置かれているカードの識別子（総合ルール 第3部 第19章 1）。#102。
 *
 * 希望ステップの間だけ、スマッシュゾーンに表向きのカードが 1 枚ある。**これはスマッシュでは
 * ない**（同 第2部 第21章 7-2）ので、枚数から外す。エンジンが数えるところ（`smash.ts` の
 * `smashesOf`）と同じ数え方にしている。
 */
function faceUpInSmashZone(board: WirePerspective): readonly CardId[] {
  return board.smashJudgments.flatMap((judgment) => (judgment.faceUp === undefined ? [] : [judgment.faceUp]))
}

function zoneView(board: WirePerspective, owner: Player, zone: PlayerZone): ZoneView {
  const cards = board.zones[owner][zone]
  const faceUp = zone === 'スマッシュゾーン' ? faceUpInSmashZone(board) : []
  const counted = cards.filter((card) => !(card.kind === '見えている' && faceUp.includes(card.instance.id)))

  return {
    zone,
    count: counted.length,
    cards: COUNTED_ZONES.includes(zone)
      ? []
      : cards.map((card, index) => cardView(card, board.viewer, { player: owner, zone, index })),
  }
}

/** そのプレイヤーが見る人自身か、相手か。 */
function whoseLabel(viewer: Player, player: Player): '自分' | '相手' {
  return player === viewer ? '自分' : '相手'
}

/** 見る人自身のものか、相手のものか。 */
function whoseOf(board: WirePerspective, player: Player): '自分' | '相手' {
  return whoseLabel(board.viewer, player)
}

function sideView(board: WirePerspective, player: Player): SideView {
  return {
    player,
    whose: whoseOf(board, player),
    damage: board.damage[player],
    zones: ZONE_ORDER.map((zone) => zoneView(board, player, zone)),
  }
}

/**
 * 見る人の向きに直したスクエアの並び。
 *
 * 盤面はどちらのプレイヤーから見ても同じ行・列で届く（`board.ts` の `Square`）が、画面では
 * **見る人の味方エリアを下に**置きたい。行と列を見る人から見た向きに折り返すのは
 * `squareFromView` がすでに知っているので、それを使う。折り返した後の行 0 が見る人の手前
 * なので、画面では上下を逆にして並べる。
 */
function squareViews(board: WirePerspective): readonly (readonly SquareView[])[] {
  const seen = (row: SquareIndex, column: SquareIndex): Square => squareFromView(board.viewer, { row, column })

  return [...SQUARE_INDEXES].reverse().map((row) =>
    SQUARE_INDEXES.map((column): SquareView => {
      const square = seen(row, column)
      return {
        square,
        area: areaOf(board.viewer, square),
        // 継続効果を適用した後のデータを持つのは、スクエアにいるユニットだけである（#91）。
        cards: board.squares[indexOfSquare(square)]?.map((card) => faceUpView(card, board.viewer, board.effective)) ?? [],
      }
    }),
  )
}

/** ターンの様子を 1 行にする。 */
function turnLine(board: WirePerspective): string {
  const whose = (player: Player): string => whoseOf(board, player)

  return `第 ${board.turn.number} ターン・${whose(board.turn.active)}のターン・${board.turn.phase}・${whose(
    board.turn.priority,
  )}の優先権`
}

/** 発生しているバトル。 */
function battleView(board: WirePerspective, names: ReadonlyMap<CardId, string>): BattleView | undefined {
  const battle = board.battle
  if (battle === undefined) return undefined

  return {
    where: squareLabel(board.viewer, battle.square),
    step: battle.step,
    attacker: nameOf(names, battle.attacker),
    attacked: nameOf(names, battle.attacked),
  }
}

/**
 * 発生しているスマッシュ判定（総合ルール 第3部 第17章）。#102。
 *
 * 届いているものをそのまま並べる（`wire.ts` の `smashJudgments`）。通信の形式は変えていない。
 */
function smashJudgmentViews(
  board: WirePerspective,
  names: ReadonlyMap<CardId, string>,
): readonly SmashJudgmentView[] {
  return board.smashJudgments.map((judgment) => ({
    whose: whoseOf(board, judgment.player),
    step: judgment.step,
    repeats: judgment.repeats,
    // 回復ステップの間は 0 で届く（`smash.ts` の `SmashJudgment.round`）。まだ 1 回目に
    // 入っていないので、回数として出さない。
    round: judgment.round === 0 ? undefined : judgment.round,
    faceUp: judgment.faceUp === undefined ? undefined : nameOf(names, judgment.faceUp),
  }))
}

/** 解決を待っている能力の並び。 */
function abilityViews(
  board: WirePerspective,
  abilities: readonly { readonly controller: Player; readonly source: CardId | undefined }[],
  names: ReadonlyMap<CardId, string>,
): readonly AbilityView[] {
  return abilities.map((ability) => ({
    whose: whoseOf(board, ability.controller),
    source: ability.source === undefined ? undefined : nameOf(names, ability.source),
  }))
}

/** 決着していれば、その 1 行。 */
function resultLine(board: WirePerspective): string | undefined {
  return board.result === undefined ? undefined : resultLabel(board.result, board.viewer)
}

/**
 * 起きたできごとを、読める行にする（#95）。
 *
 * 名指しされていないカードは、そのまま出さない。**「見えていないカード」とも書かない。**
 * 名指しが落ちたのか、そもそもカードを指していないできごとなのかは、届いたものからは
 * 見分けられない（`log.ts` の `DuelEvent`）。分からないことを書き分けようとしない。
 *
 * **新しいものを先頭にする（#111）。** `board.log` 自体は起きた順（古いものが先）のままで、
 * 並べ替えるのはここだけである。最新を確認するのに毎回下までスクロールしなくて済む。
 */
export function logLines(board: WirePerspective): readonly LogLine[] {
  const names = namesIn(board)
  const whose = (player: Player): '自分' | '相手' => whoseOf(board, player)
  /** 名指しされているなら、その名前。名指しされていなければ `undefined`。 */
  const named = (card: CardId | undefined): string | undefined =>
    card === undefined ? undefined : nameOf(names, card)

  return board.log.map((event): LogLine => {
    switch (event.kind) {
      case '行動した': {
        const name = named(event.card)
        const where = event.square === undefined ? '' : `（${squareLabel(board.viewer, event.square)}）`
        return { whose: whose(event.player), text: `${event.action}${name === undefined ? '' : `：${name}`}${where}` }
      }
      case '能力を解決した': {
        const source = named(event.source)
        return { whose: whose(event.controller), text: source === undefined ? event.via : `${event.via}：${source}` }
      }
      case '命令を実行した':
        return { whose: whose(event.controller), text: instructionLine(event.instruction, board, named, whose) }
      case 'ダメージを受けた':
        return { whose: whose(event.player), text: `ダメージ ${event.amount} を受けた` }
      case 'バトルが始まった': {
        const where = squareLabel(board.viewer, event.square)
        const units = [named(event.attacker), named(event.attacked)].filter((name) => name !== undefined)
        return { whose: undefined, text: `バトル（${where}）${units.length === 0 ? '' : `：${units.join(' と ')}`}` }
      }
      case 'バトルダメージを与えた':
        return { whose: undefined, text: about(named(event.to), 'に', `バトルダメージ ${event.amount}`) }
      case 'バトルが終わった': {
        if (event.winner === undefined) return { whose: undefined, text: 'バトル終了：引き分け' }
        const winner = namableInstanceOf(board, event.winner)
        const text = winner === undefined ? 'バトル終了' : `バトル終了：${whose(winner.controller)}の${winner.card.name}の勝ち`
        return { whose: undefined, text }
      }
      case 'ルールで捨札に置かれた': {
        const cards = event.cards.map((card) => nameOf(names, card))
        return { whose: undefined, text: `ルールで捨札：${cards.join('・')}` }
      }
      case '決着した':
        return { whose: undefined, text: `決着：${resultLabel(event.result, board.viewer)}` }
      case 'コストを支払った': {
        // スマッシュは裏向きで、持ち主からも見られない（総合ルール 第2部 第21章 7-3）ので
        // 名前を出しようが無い。かわりにゾーンの名前で言う。
        if (event.zone === 'スマッシュゾーン') {
          return { whose: whose(event.player), text: 'コストとしてスマッシュをフリーズした' }
        }
        return { whose: whose(event.player), text: about(named(event.card), 'を', 'コストとしてフリーズした') }
      }
      case 'プランをめくった': {
        const revealed = named(event.card)
        const discarded = named(event.discarded)
        const text = `${revealed === undefined ? 'プランをめくった' : `プランをめくった：${revealed}`}${
          discarded === undefined ? '' : `（${discarded}を捨札へ）`
        }`
        return { whose: whose(event.player), text }
      }
      // 裏返された後も名前を持ち続ける（`log.ts` の `DuelEvent`）ので、盤面から引き直さない。
      case '希望ステップでめくった':
        return { whose: whose(event.player), text: `${event.name}を希望ステップでめくった` }
    }
  }).reverse()
}

/**
 * 名前が分かっていれば「◯◯を破壊した」の形にする。名指しされていなければ、そのまま出す。
 *
 * 助詞を呼ぶ側から渡すのは、**名前が落ちた時に助詞だけが残らないようにする**ためである。
 */
function about(name: string | undefined, particle: 'を' | 'に', text: string): string {
  return name === undefined ? text : `${name}${particle}${text}`
}

/** 命令 1 つを 1 行にする。 */
function instructionLine(
  instruction: LoggedInstruction,
  board: WirePerspective,
  named: (card: CardId | undefined) => string | undefined,
  whose: (player: Player) => '自分' | '相手',
): string {
  switch (instruction.kind) {
    case '選ぶ':
      return about(named(instruction.card), 'を', '選んだ')
    case '破壊する':
      return about(named(instruction.card), 'を', '破壊した')
    case 'プレイヤーにダメージを与える':
      return `${whose(instruction.player)}にダメージ ${instruction.amount}`
    case 'ユニットにダメージを与える':
      return about(named(instruction.card), 'に', `ダメージ ${instruction.amount}`)
    case '向きを変える':
      return about(named(instruction.card), 'を', instruction.orientation)
    case 'ゾーンへ置く':
      return about(named(instruction.card), 'を', `${instruction.to}へ`)
    case '山札の1番上をゾーンへ置く':
      return about(named(instruction.card), 'を', `${instruction.to}へ（山札の 1 番上）`)
    case 'スクエアへ置く':
      return about(named(instruction.card), 'を', `${squareLabel(board.viewer, instruction.square)}へ`)
    case '誘発型能力を作る':
      return about(named(instruction.card), 'に', '能力を作った')
    case 'プランを裏返す':
      return `${whose(instruction.player)}のプランを裏返した`
    case 'カードを引く':
      return `${whose(instruction.player)}が ${instruction.count} 枚引いた`
  }
}

/**
 * カットインの見出し（#104）。
 *
 * 「発動」はトラップの言葉である（総合ルール 第2部 第20章 3-10）。起動型能力の「起動」
 * （同 第4部 第2章 1）や誘発型能力の「誘発」（同 第3章 2）と取り違えると別のことを指すので、
 * 経路ごとに総合ルールの言葉づかいへ寄せる。**画面の側で推測しない**（`event.via` をそのまま
 * 使う）。
 *
 * 名前が分かっていなければ、助詞や「の効果」を伴わない形にする。`about` と同じ考え方で、
 * 名前が落ちた時にそれだけが浮かないようにする。
 */
function headingOf(via: ResolutionVia, name: string | undefined): string {
  switch (via) {
    case '誘発':
    case '起動':
      return name === undefined ? `効果、${via}！` : `${name}の効果、${via}！`
    case '発動':
      return name === undefined ? 'トラップを発動！' : `${name}を発動！`
    case 'プレイ':
      return name === undefined ? 'カードをプレイ！' : `${name}をプレイ！`
    case '希望':
      return name === undefined ? '希望！' : `${name}の希望！`
  }
}

/**
 * 新しく届いた分から、出すカットインを作る（#104）。
 *
 * 切り出し方は「`能力を解決した` から、次の別種のできごとまでの `命令を実行した`」。1 つの
 * 解決の中に含まれる `選んでほしい` の往復（複数の答えに分かれて届く盤面）はここでは扱わない
 * ——`fresh` は 1 回の `盤面` メッセージぶんの差分でしかなく、答えを待っている間は次の盤面が
 * 届かないので、そこで途切れることはない。
 *
 * 本文は既存の `instructionLine` をそのまま使い回す。**新しい言い換えを二度書かない。**
 */
export function cutInViews(board: WirePerspective, fresh: readonly DuelEvent[]): readonly CutInView[] {
  const names = namesIn(board)
  const whose = (player: Player): '自分' | '相手' => whoseOf(board, player)
  const named = (card: CardId | undefined): string | undefined =>
    card === undefined ? undefined : nameOf(names, card)

  const views: { whose: '自分' | '相手'; heading: string; lines: string[] }[] = []
  let open: (typeof views)[number] | undefined

  for (const event of fresh) {
    if (event.kind === '能力を解決した') {
      open = { whose: whose(event.controller), heading: headingOf(event.via, named(event.source)), lines: [] }
      views.push(open)
      continue
    }
    if (event.kind === '命令を実行した' && open !== undefined) {
      open.lines.push(instructionLine(event.instruction, board, named, whose))
      continue
    }
    open = undefined
  }

  return views
}

/**
 * 前後のターンを比べて、フェイズ・ターンが変わったことを知らせる演出を作る（#96）。
 *
 * **通信の形式は変えない。** `turn.phase`・`turn.number`・`turn.active`（`WirePerspective.turn`）
 * を比べるだけで分かる。`previousTurn` は比べる相手が無ければ `undefined`（最初の盤面・
 * 入り直し、`session.ts`）で、その時は何も変わったことにしない。
 *
 * **ターンが変わる時は必ずフェイズも最初のフェイズに変わる**（`turn.ts` の `beginPhase`）。
 * 両方変わっていれば両方を出す——ターンの案内だけでは、どのフェイズから始まったかが
 * 分からない。
 */
export function transitionViews(previousTurn: Turn | undefined, board: WirePerspective): readonly TransitionView[] {
  if (previousTurn === undefined) return []
  const turn = board.turn

  const views: TransitionView[] = []
  if (previousTurn.number !== turn.number || previousTurn.active !== turn.active) {
    views.push({ heading: `第 ${turn.number} ターン：${whoseOf(board, turn.active)}のターン` })
  }
  if (previousTurn.phase !== turn.phase) {
    views.push({ heading: turn.phase })
  }

  return views
}

/** 決着した勝敗を、見る人から見た言い方にする。 */
function resultLabel(result: DuelResult, viewer: Player): string {
  if (result.kind === '引き分け') return '引き分け'

  return result.winner === viewer ? '勝ち' : '負け'
}

/** 届いた盤面を、画面に出す形にする。 */
export function boardView(board: WirePerspective): BoardView {
  const opponent = board.viewer === '先攻' ? '後攻' : '先攻'
  const names = namesIn(board)

  return {
    seat: board.viewer,
    turn: turnLine(board),
    battle: battleView(board, names),
    smashJudgments: smashJudgmentViews(board, names),
    bank: abilityViews(board, board.bank, names),
    triggered: abilityViews(board, board.triggered, names),
    opponent: sideView(board, opponent),
    own: sideView(board, board.viewer),
    squares: squareViews(board),
    result: resultLine(board),
    log: logLines(board),
  }
}
