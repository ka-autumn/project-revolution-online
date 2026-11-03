import type { DiscardOccasion, OwnDiscardOccasion } from './ability.js'
import { continuousData } from './continuous.js'
import { findAnywhere, findInZone, findOnSquares, locateOnSquares, moveToZoneWithoutTriggers } from './duel.js'
import type { CardId, CardInstance, DuelState, LibraryPosition, TriggeredInstance } from './duel.js'
import type { Orientation } from './orientation.js'
import { PLAYERS } from './player.js'
import { addTriggered, hasOwnDiscardAbility, triggeredByOwnDiscard, triggeredOnSquares } from './trigger.js'
import { PLAYER_ZONES } from './zone.js'
import type { PlayerZone } from './zone.js'

/**
 * 指定されたカードのうち、`moveToZone` が実際にスクエアから動かすもの。
 *
 * ルールエフェクトは、同時に発生したものをまとめて 1 つの盤面から決める（総合ルール
 * 第4部 第14章 2）ため、同じカードが複数の条件で挙がることも、挙がった時にはもう
 * スクエアに無いこともある。記録に残すのは「置こうとしたもの」ではなく「置かれるもの」
 * なので、ログを積む側もここを通してから積む。スクエアにあるものだけを動かしたい呼び出し側
 * （破壊、ルールエフェクト）は、この結果を `moveToZone` に渡す。
 */
export function discardedFromSquares(state: DuelState, ids: readonly CardId[]): readonly CardId[] {
  return onSquares(state, ids).map((instance) => instance.id)
}

/** 指定されたカードのうち、いずれかのスクエアにあるもの。重複は除く。 */
function onSquares(state: DuelState, ids: readonly CardId[]): readonly CardInstance[] {
  return [...new Set(ids)].flatMap((id) => {
    const instance = findOnSquares(state, id)
    return instance === undefined ? [] : [instance]
  })
}

/** `moveToZone` に渡す、置き方の指定。 */
export interface ZoneMoveOptions {
  /** 置かれる向き。指定しなければリリース状態になる。 */
  readonly orientation?: Orientation
  /** 置く位置。指定しなければそのゾーンの 1 番上になる。 */
  readonly position?: LibraryPosition
}

/**
 * 指定されたカードを、持ち主の指定されたゾーンへ動かす。カードのゾーン移動は、誘発の有無に
 * よらずすべてこれを通す（ADR-0059）。
 *
 * 動かす前に、行き先のゾーンに置かれた時に誘発する能力を探してから動かす。同時に複数枚を
 * 動かす時は、能力を持つカード自身も同時にゾーンを離れ得るため、すべての能力を移動前の盤面から
 * 探してからカードを動かす（総合ルール 第4部 第7章 10）。いま誘発を探すのは、行き先が
 * 捨札の時だけである。ほかのゾーンが行き先の時は、誘発を探さずに動かす。
 *
 * 同じカードが複数の条件を満たしていても、1 回のゾーン移動につき誘発イベントを満たすのは
 * 1 度だけである（同 第7章 6）ため、id は重複除去する。どこにも無いカードは動かさない。
 *
 * 動かし方（持ち主以外のゾーンには動かせない、支配者が持ち主に戻る、ダメージを失うなど）は
 * `moveToZoneWithoutTriggers` の仕事である。
 */
export function moveToZone(
  state: DuelState,
  ids: readonly CardId[],
  zone: PlayerZone,
  options: ZoneMoveOptions = {},
): DuelState {
  const unique = [...new Set(ids)]
  const withTriggered = zone === '捨札' ? addTriggered(state, triggeredByDiscard(state, unique)) : state
  return unique.reduce(
    (current, id) => moveToZoneWithoutTriggers(current, id, zone, options.orientation, options.position),
    withTriggered,
  )
}

/**
 * 捨札へ置かれるカードについて、置かれる前の盤面で誘発する能力を探す。
 *
 * 先に、スクエアにいるユニットの「あなたのユニットがスクエアから捨札に置かれた時」を探し、
 * そのあとに、置かれるカード自身の「このカードが捨札に置かれた時」を探す。バンクに入った能力は
 * 並びに意味が無く（`bank.ts`）、解決する順は支配者が選ぶので、この順は既存の能力の並びを
 * 変更しないためのものである。
 */
function triggeredByDiscard(state: DuelState, ids: readonly CardId[]): readonly TriggeredInstance[] {
  return [...triggeredOnSquaresByDiscard(state, ids), ...ids.flatMap((id) => triggeredByOwnDiscardOf(state, id))]
}

/**
 * スクエアにいるユニットごとに、その支配者の「あなたのユニットがスクエアから捨札に置かれた
 * 時」の能力を探す。置かれたユニットごとに、そのユニットをきっかけ（`DiscardOccasion`）として
 * 判定する。能力の側は、置かれたのが自分自身かどうかをきっかけから確認できる。きっかけの
 * ユニットは、継続効果を適用した後のデータ（置かれる直前の属性とＢＰ）で渡す。
 */
function triggeredOnSquaresByDiscard(state: DuelState, ids: readonly CardId[]): readonly TriggeredInstance[] {
  const event = 'あなたのユニットがスクエアから捨札に置かれた時'
  const discarded = onSquares(state, ids)
  // 継続効果を集計するのは重いので、スクエアから置かれるカードが無い時は求めない。
  if (discarded.length === 0) return []

  const dataBefore = continuousData(state)
  return discarded.flatMap((instance) => {
    const { card } = instance
    const located = locateOnSquares(state, instance.id)
    if (card.type !== 'ユニット' || located === undefined) return []

    const occasion: DiscardOccasion = {
      kind: '捨札',
      id: instance.id,
      square: located.square,
      card: dataBefore(instance.id, card),
      controller: instance.controller,
    }
    return triggeredOnSquares(state, event, (each) => each.controller === instance.controller, occasion)
  })
}

/**
 * 置かれるカード自身の「このカードが捨札に置かれた時」の能力を探す（ADR-0059）。
 *
 * どのゾーンから置かれる場合も探す。すでに捨札にあるカードは、捨札から置かれることにはならない
 * ので探さない。スクエアから置かれる時のきっかけは、スクエアにいるユニットの能力と同じく、継続効果を
 * 適用した後のデータを持つ。スクエアの外から置かれる時は、カードに書かれているデータを持つ。
 */
function triggeredByOwnDiscardOf(state: DuelState, id: CardId): readonly TriggeredInstance[] {
  const instance = findAnywhere(state, id)
  if (instance === undefined || !hasOwnDiscardAbility(instance.card)) return []

  const located = locateOnSquares(state, id)
  if (located !== undefined) {
    // スクエアにあるユニット以外のカードは、誘発させない。総合ルールは、ユニットのテキストがスクエアに
    // ある間有効になるとだけ書いていて（第2部 第10章 3）、ユニット以外のカードはスクエアに置かれると
    // ルールエフェクトですぐ捨札に置かれる（第4部 第14章 4-3）。そのカードのテキストが、その短い間に
    // 誘発するかは、実際の運用を確認できていない。該当するカードも無い。該当するカードが出た時に運用を
    // 確認し、誘発させるなら `OwnDiscardFromSquare`（`UnitOnSquare` を拡張している）をユニット以外にも
    // 広げて、ここで `from: 'スクエア'` のきっかけを作成する。ここで返さなくても、下の `zoneOf` が
    // スクエアを探さないので結果は同じになるが、それでは誘発しないことが偶然になる。
    if (instance.card.type !== 'ユニット') return []

    const unit = continuousData(state)(id, instance.card)
    return triggeredByOwnDiscard(state, instance, {
      kind: '自身の捨札',
      from: 'スクエア',
      id,
      square: located.square,
      card: unit,
      controller: instance.controller,
    })
  }

  const from = zoneOf(state, id)
  if (from === undefined || from === '捨札') return []

  const occasion: OwnDiscardOccasion = {
    kind: '自身の捨札',
    from,
    id,
    card: instance.card,
    controller: instance.controller,
  }
  return triggeredByOwnDiscard(state, instance, occasion)
}

/** スクエアの外にあるそのカードが、いまどのゾーンにあるか。どこにも無ければ `undefined`。 */
function zoneOf(state: DuelState, id: CardId): PlayerZone | 'リゾルブゾーン' | undefined {
  if (state.resolveZone.some((card) => card.id === id)) return 'リゾルブゾーン'

  for (const player of PLAYERS) {
    for (const zone of PLAYER_ZONES) {
      if (findInZone(state, player, zone, id) !== undefined) return zone
    }
  }
  return undefined
}
