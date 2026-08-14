import { attributeAddingAbilitiesOf, bpModifyingAbilitiesOf } from './card.js'
import type { Attribute } from './card.js'
import type { CardId, DuelState } from './duel.js'
import type { DuelView, UnitOnSquare } from './effect.js'
import { duelView, unitsOnSquares } from './view.js'
import type { UnitData } from './view.js'

/**
 * いま盤面にあるユニットの、継続効果によるＢＰの修整の合計を引くもの。
 * 修整を受けていないユニットは 0 になる。
 *
 * 表そのものではなく関数として返すのは、読む側が `bpOf(instance.card, modification(id))` と
 * 書けるようにするためである。表を渡すと、読む側それぞれが「修整が無ければ 0」を書くことに
 * なる。
 */
export type BpModification = (id: CardId) => number

/**
 * 継続効果を適用した後の、スクエアにいるユニットのデータ（総合ルール 第4部 第12章 2）。
 *
 * **盤面（`DuelState`）はカードに書かれているデータを持ち、効果に見せる写し（`DuelView`）は
 * これを通した後のデータを持つ。** カードの実装が読む場所を 1 つにするためで、そうしないと
 * 「書かれている属性」と「いま持っている属性」の 2 か所ができ、間違って書かれても型には
 * 出ない。総合ルールの「データ」には属性もＢＰも含まれる（同 第2部 第2章 2）。
 *
 * 適用の順番は種類ごとに決まっている（同 第4部 第12章 5-2）。ここで扱うのは(3)属性を変更
 * する継続効果と(5)ＢＰを変更する継続効果の 2 つで、この順に適用する。
 */
export function continuousData(state: DuelState): UnitData {
  const added = attributesAddedOn(state)
  const modification = bpModifiedBy(state, applying(added))

  return (id, written) => {
    const attributes = added(id)
    const modifier = modification(id)
    if (attributes.length === 0 && modifier === 0) return written
    return { ...written, attributes: [...written.attributes, ...attributes], bp: written.bp + modifier }
  }
}

/**
 * いま発生している、ＢＰを修整する継続効果をすべて集める（総合ルール 第4部 第12章）。
 *
 * **ＢＰを読むたびに集め直す。** 常在型能力の生み出す継続効果は、能力を持つカードが必要な
 * ゾーンに置かれている間ずっと続き（同 4-1）、発生した時点で影響を受けなかったカードにも
 * 影響を与える（同 4-2）。集め直す形にすれば、発生元がスクエアを離れた時に修整を取り消す
 * 処理も、後から置かれたユニットに効かせる処理も要らない。
 */
export function bpModification(state: DuelState): BpModification {
  return bpModifiedBy(state, applying(attributesAddedOn(state)))
}

/**
 * ＢＰの修整を、渡された写し方の上で集める。
 *
 * 修整を決める能力に見せるのは、属性が加わった後の盤面である（総合ルール 第4部 第12章 5-2）。
 * 「〈属性〉の味方のＢＰを＋Ｘ」は、継続効果によって属性が加わったユニットも数える。
 * **ＢＰのほうはまだ修整されていない。** 同じ種類どうしの順序と依存（同 5-3・5-4）を
 * 扱えるようになるまで、他の修整の結果を見る修整は書けない。
 */
function bpModifiedBy(state: DuelState, data: UnitData): BpModification {
  const total = new Map<CardId, number>()

  for (const modifier of gather(state, data, (source, duel) =>
    bpModifyingAbilitiesOf(source.card).flatMap((ability) => ability.bpModifiers(duel)),
  )) {
    if (!onSquare(state, modifier.target)) continue
    total.set(modifier.target, (total.get(modifier.target) ?? 0) + modifier.amount)
  }

  return (id) => total.get(id) ?? 0
}

/** そのユニットに継続効果によって加わっている属性を引くもの。 */
type AddedAttributes = (id: CardId) => readonly Attribute[]

/**
 * いま発生している、属性を加える継続効果をすべて集める
 * （総合ルール 第2部 第13章 4、第4部 第12章 5-2 の(3)）。
 *
 * 加えるだけで、カードに書かれている属性は残る（同 第13章 4）。すでに持っている属性を
 * 重ねて加えても持ち方は変わらないので、重複は落とす。
 *
 * 加える属性を決める能力に見せるのは、何も適用していない盤面である。属性を変更する継続効果
 * どうしの順序（同 第4部 第12章 5-3・5-4）を扱えるようになるまで、他の継続効果が加えた属性を
 * 見て加える属性を決めることはできない。
 */
function attributesAddedOn(state: DuelState): AddedAttributes {
  const added = new Map<CardId, Attribute[]>()

  for (const addition of gather(state, asWritten, (source, duel) =>
    attributeAddingAbilitiesOf(source.card).flatMap((ability) => ability.attributesAdded(duel)),
  )) {
    const target = unitsOnSquares(state).find((unit) => unit.id === addition.target)
    if (target === undefined) continue
    if (target.card.attributes.includes(addition.attribute)) continue

    const current = added.get(addition.target) ?? []
    if (current.includes(addition.attribute)) continue
    added.set(addition.target, [...current, addition.attribute])
  }

  return (id) => added.get(id) ?? []
}

/** 何も適用しない写し。継続効果を集める最初の段階で使う。 */
const asWritten: UnitData = (_id, written) => written

/** 加わった属性までを適用した写し。 */
function applying(added: AddedAttributes): UnitData {
  return (id, written) => {
    const attributes = added(id)
    return attributes.length === 0 ? written : { ...written, attributes: [...written.attributes, ...attributes] }
  }
}

/**
 * スクエアにいるユニットが持つ常在型能力を 1 つずつ呼んで、返ってきたものを集める。
 *
 * 発生元として見るのはスクエアにいるユニットだけである。常在型能力は、カードに特別の記載が
 * 無い限りスクエアに置かれている時にのみ効果を発揮する（総合ルール 第4部 第4章 1）。
 * スクエアにあるユニット以外のカードは、次に優先権が発生した時にルールエフェクトで捨札に
 * 置かれる（同 第14章 4-3）ので、そこにある間にデータが読まれることは無い。手札にある時に
 * 働く常在型能力を持つようになった時に、そのゾーンを見に来る。
 *
 * 能力そのものはカードに書かれているものから引く。テキストを変更する継続効果（同
 * 第12章 5-2 の(2)）はまだ無いので、写しから引いても同じものになる。
 */
function gather<T>(
  state: DuelState,
  data: UnitData,
  from: (source: UnitOnSquare, duel: DuelView) => readonly T[],
): readonly T[] {
  return unitsOnSquares(state).flatMap((source) => {
    // 発生源はいまスクエアにいるユニット自身である。継続効果が発生しているのはそこに
    // 置かれているからで（総合ルール 第4部 第12章 4-1）、解決を待つ間に位置が変わること
    // が無い。問い合わせるだけで命令を出さないので、見せたカードも覚えない。
    const duel = duelView(() => state, {
      controller: source.controller,
      self: () => source,
      show: () => {},
      data: () => data,
    })
    return from(source, duel)
  })
}

/**
 * そのカードがスクエアにいるユニットか。
 *
 * 継続効果の影響を受けられるのはスクエアにいるユニットだけである。能力が id を返してきても、
 * その時スクエアにいなければ何も起こらない（総合ルール 第1部 第1章 3）。
 */
function onSquare(state: DuelState, id: CardId): boolean {
  return unitsOnSquares(state).some((unit) => unit.id === id)
}
