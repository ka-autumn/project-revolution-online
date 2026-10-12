import { attributeAddingAbilitiesOf, bpModifyingAbilitiesOf, bpOf, spOf } from './card.js'
import type { Attribute } from './card.js'
import type { CardId, DuelState } from './duel.js'
import type { ContinuousChange, DuelView, UnitOnSquare } from './effect.js'
import { duelView, unitsOnSquares } from './view.js'
import type { UnitData } from './view.js'

/**
 * いま盤面にあるユニットの、継続効果によるＢＰの変更の合計を引くもの。
 * 変更を受けていないユニットは 0 になる。合計は負のまま持ち、0 として読むのは `bpOf` である。
 *
 * 表そのものではなく関数として返すのは、読む側が `bpOf(instance.card, modification(id))` と
 * 書けるようにするためである。表を渡すと、読む側それぞれが「変更が無ければ 0」を書くことに
 * なる。
 */
export type BpModification = (id: CardId) => number

/**
 * いま盤面にあるユニットの、継続効果によるＳＰの変更の合計を引くもの（`BpModification` と
 * 同じ形）。変更を受けていないユニットは 0 になる。合計は負のまま持ち、0 として読むのは
 * `spOf` である。
 */
export type SpModification = (id: CardId) => number

/**
 * 継続効果を適用した後の、スクエアにいるユニットのデータ（総合ルール 第4部 第12章 2）。
 *
 * **盤面（`DuelState`）はカードに書かれているデータを持ち、効果に見せる写し（`DuelView`）は
 * これを通した後のデータを持つ。** カードの実装が読む場所を 1 つにするためで、そうしないと
 * 「書かれている属性」と「いま持っている属性」の 2 か所ができ、間違って書かれても型には
 * 出ない。総合ルールの「データ」には属性もＢＰも含まれる（同 第2部 第2章 2）。
 *
 * 適用の順番は種類ごとに決まっている（同 第4部 第12章 5-2）。ここで扱うのは(3)属性を変更
 * する継続効果と(5)ＢＰ・ＳＰを変更する継続効果で、この順に適用する。ＢＰの変更とＳＰの
 * 変更は同じ種類（同 5-2 の(5)）だが、互いの値は見ないので、適用の順で結果は変わらない。
 */
export function continuousData(state: DuelState): UnitData {
  const added = attributesAddedOn(state)
  const bpModifier = bpModifiedBy(state, applying(added))
  const spModifier = spModification(state)

  return (id, written) => {
    const attributes = added(id)
    const bpChange = bpModifier(id)
    const spChange = spModifier(id)
    if (attributes.length === 0 && bpChange === 0 && spChange === 0) return written
    return {
      ...written,
      attributes: [...written.attributes, ...attributes],
      bp: bpOf(written, bpChange),
      sp: spOf(written, spChange),
    }
  }
}

/**
 * いま発生している、ＳＰを変更する継続効果をすべて集める（総合ルール 第4部 第12章）。
 *
 * ＳＰを変える常在型能力はまだ無いので、集めるのは盤面が持つ、作成された継続効果
 * （`DuelState.createdContinuousEffects`、ADR-0036）だけである。同じ対象に重なれば、その分
 * だけ足される。
 */
export function spModification(state: DuelState): SpModification {
  const total = createdChangeTotals(state, 'ＳＰの変更')
  return (id) => total.get(id) ?? 0
}

/**
 * 盤面が持つ、作成された継続効果のうち、その種類のものを対象ごとに足し合わせる。
 * スクエアにいないユニットあてのものは数えない。
 */
function createdChangeTotals(state: DuelState, kind: ContinuousChange['kind']): Map<CardId, number> {
  const total = new Map<CardId, number>()
  for (const created of state.createdContinuousEffects) {
    if (created.change.kind !== kind) continue
    if (!onSquare(state, created.target)) continue
    total.set(created.target, (total.get(created.target) ?? 0) + amountOf(created.change))
  }
  return total
}

/**
 * 変更の量。種類を足したら、ここで型検査が止まる。種類を引数に取るだけでは、足した種類が
 * どのデータにも適用されないまま通ってしまうため。
 */
function amountOf(change: ContinuousChange): number {
  switch (change.kind) {
    case 'ＢＰの変更':
    case 'ＳＰの変更':
      return change.amount
    default:
      return change satisfies never
  }
}

/**
 * いま発生している、ＢＰを変更する継続効果をすべて集める（総合ルール 第4部 第12章）。
 *
 * **常在型能力のぶんは、ＢＰを読むたびに集め直す。** 常在型能力の生み出す継続効果は、能力を
 * 持つカードが必要なゾーンに置かれている間ずっと続き（同 4-1）、発生した時点で影響を受け
 * なかったカードにも影響を与える（同 4-2）。集め直す形にすれば、発生元がスクエアを離れた時に
 * 変更を取り消す処理も、後から置かれたユニットに効かせる処理も要らない。
 *
 * 解決が残した、作成された継続効果は、盤面が持つものをそこへ足す（同 3、ADR-0036）。
 * こちらは集め直す元が無いので、盤面が値として持っている（`DuelState.createdContinuousEffects`）。
 */
export function bpModification(state: DuelState): BpModification {
  return bpModifiedBy(state, applying(attributesAddedOn(state)))
}

/**
 * ＢＰの変更を、渡された写し方の上で集める。
 *
 * 変更を決める能力に見せるのは、属性が加わった後の盤面である（総合ルール 第4部 第12章 5-2）。
 * 「〈属性〉の味方のＢＰを＋Ｘ」は、継続効果によって属性が加わったユニットも数える。
 * **ＢＰのほうはまだ変更されていない。** 同じ種類どうしの順序と依存（同 5-3・5-4）を
 * 扱えるようになるまで、他の変更の結果を見る変更は書けない。
 */
function bpModifiedBy(state: DuelState, data: UnitData): BpModification {
  const total = new Map<CardId, number>()

  for (const modifier of gather(state, data, (source, duel) =>
    bpModifyingAbilitiesOf(source.card).flatMap((ability) => ability.bpModifiers(duel)),
  )) {
    if (!onSquare(state, modifier.target)) continue
    total.set(modifier.target, (total.get(modifier.target) ?? 0) + modifier.amount)
  }

  // 作成された継続効果は、集め直す元が無いので盤面が持っている（ADR-0036）。常在型能力から
  // 集めた分に足す。同じ対象に重なれば、その分だけ足される。
  for (const [target, amount] of createdChangeTotals(state, 'ＢＰの変更')) {
    total.set(target, (total.get(target) ?? 0) + amount)
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
 * 第12章 5-2 の(2)）はまだ無いので、写しから引いても同じものになる。能力を与える効果が
 * 入った時は、与えられた能力は写しの `card.abilities` に載せる形で表す（`effect.ts` の
 * `DuelView.hasKeyword`）。尋ねる口は写しを作る所を直せば済むが、ここは書かれた能力から
 * 引いているので、与えられた能力が生むＢＰ修整を集めるには、ここを別に直す。
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
