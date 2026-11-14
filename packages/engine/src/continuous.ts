import { abilityGrantingAbilitiesOf, attributeAddingAbilitiesOf, modifyingAbilitiesOf, bpOf, spOf } from './card.js'
import type { MoveDirection } from './board.js'
import type { Attribute, Card } from './card.js'
import type { CardId, DuelState } from './duel.js'
import type { ContinuousChange, DuelView, Duration, GrantableAbility } from './effect.js'
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
 * 盤面（`DuelState`）はカードに書かれているデータを持ち、効果に見せるビュー（`DuelView`）は
 * これを通した後のデータを持つ。カードの実装が読む場所を 1 つにするためで、そうしないと
 * 「書かれている属性」と「いま持っている属性」の 2 か所ができ、間違って書かれても型には
 * 出ない。総合ルールの「データ」には属性もＢＰも含まれる（同 第2部 第2章 2）。
 *
 * 適用の順番は種類ごとに決まっている（同 第4部 第12章 5-2）。ここで扱うのは(2)テキストを
 * 変更する継続効果（能力を与える効果）・(3)属性を変更する継続効果・(4)一般的な継続効果（移動方向を
 * 変更する効果、ADR-0071）・(5)ＢＰ・ＳＰを変更する継続効果で、この順に適用する。ＢＰの変更とＳＰの変更は同じ種類（同 5-2 の(5)）だが、互いの値は
 * 見ないので、適用の順で結果は変わらない。
 */
export function continuousData(state: DuelState): UnitData {
  const granted = grantedAbilitiesOn(state)
  const text = textApplied(granted)
  const added = attributesAddedOn(state, text)
  const modified = modifiedBy(state, applying(added, text))
  const directionsOf = moveDirectionsOn(state)
  const bpModifier = modified.bp
  const spModifier = modified.sp

  return (id, written) => {
    const abilities = granted(id)
    const attributes = added(id)
    const bpChange = bpModifier(id)
    const spChange = spModifier(id)
    const directions = directionsOf(id, written.moveIcon)
    if (
      abilities.length === 0 &&
      attributes.length === 0 &&
      directions === written.moveIcon &&
      bpChange === 0 &&
      spChange === 0
    ) {
      return written
    }
    return {
      ...written,
      moveIcon: directions,
      abilities: [...written.abilities, ...abilities],
      attributes: [...written.attributes, ...attributes],
      bp: bpOf(written, bpChange),
      sp: spOf(written, spChange),
    }
  }
}

/**
 * 作成された継続効果が変更した後の移動方向を取得するもの。渡された書かれた移動方向から始めて、
 * 発生した順に適用する（総合ルール 第4部 第12章 5-4）。変更を受けていなければ、渡された値
 * そのものを返す。
 *
 * 移動方向の変更は支配者・テキスト・種別・属性のどの変更でもないので、一般的な継続効果として、
 * 属性の変更より後、ＢＰ・ＳＰの変更より前に適用する（同 5-2 の(4)）。常在型能力が移動方向を
 * 変更する形は、そのテキストを実装する時に追加する（ADR-0071）。
 */
function moveDirectionsOn(
  state: DuelState,
): (id: CardId, written: readonly MoveDirection[]) => readonly MoveDirection[] {
  const changes = new Map<CardId, Extract<ContinuousChange, { readonly kind: '移動方向の変更' }>[]>()
  for (const created of state.createdContinuousEffects) {
    if (created.change.kind !== '移動方向の変更') continue
    if (!onSquare(state, created.target)) continue
    changes.set(created.target, [...(changes.get(created.target) ?? []), created.change])
  }
  if (changes.size === 0) return (_id, written) => written

  return (id, written) =>
    (changes.get(id) ?? []).reduce<readonly MoveDirection[]>((current, change) => {
      switch (change.method) {
        case '置き換える':
          return change.directions
        default:
          return change.method satisfies never
      }
    }, written)
}

/**
 * そのカードあての、与えられた能力を引くもの。与えられていなければ空になる。
 *
 * 能力を与える効果（総合ルール 第4部 第12章 5-2 の(2)）は、ＢＰ・ＳＰの変更と違って、対象が
 * スクエアにいるユニットとは限らない。プランゾーンのユニットに「夢」を与えるテキストのためで、
 * どのゾーンにいるカードあてのものも含める。並びは、作成された継続効果の発生した順、
 * 常在型能力の順である。
 */
export type GrantedAbilities = (id: CardId) => readonly GrantableAbility[]

/**
 * 与えられた能力を集計する。集計元は 2 つある。
 *
 * - 解決が残した、作成された継続効果。盤面が値として持っている（ADR-0036）。
 * - 能力を与える常在型能力（ADR-0070）。参照するたびに、スクエアにいるユニットから集計し直す。
 *
 * 常在型能力に見せるのは、書かれたとおりの盤面である。この関数が返す集計を通したビューを見せると、
 * 集計が自分自身を呼んで止まらなくなる。テキストを変更する継続効果は最初に適用される（総合ルール
 * 第4部 第12章 5-2 の(2)）ので、属性もまだ追加されていない。
 */
export function grantedAbilitiesOn(state: DuelState): GrantedAbilities {
  const entries = grantedEntriesOn(state)
  return (id) => entries(id).map((entry) => entry.ability)
}

/** 与えられた能力 1 つと、その期限。常在型能力が与えた分は、発生源がいる間続くので期限を持たない。 */
export interface GrantedEntry {
  readonly ability: GrantableAbility
  readonly until?: Duration
}

/**
 * 与えられた能力を、期限と一緒に集計する。並びと集計元は `grantedAbilitiesOn` と同じである。
 * 期限は、画面が与えられた能力に添えるために使う（ADR-0071）。
 */
export function grantedEntriesOn(state: DuelState): (id: CardId) => readonly GrantedEntry[] {
  const granted = new Map<CardId, GrantedEntry[]>()
  const add = (target: CardId, entry: GrantedEntry): void => {
    granted.set(target, [...(granted.get(target) ?? []), entry])
  }

  for (const created of state.createdContinuousEffects) {
    if (created.change.kind !== '能力の付与') continue
    add(created.target, { ability: created.change.ability, until: created.until })
  }

  const written: UnitData = (_id, card) => card
  for (const grant of gather(state, written, abilityGrantingAbilitiesOf, (ability, duel) =>
    ability.abilitiesGranted(duel),
  )) {
    add(grant.target, { ability: grant.ability })
  }

  return (id) => granted.get(id) ?? []
}

/**
 * 継続効果を適用した後の、スクエアの外にいるカードのデータ（総合ルール 第4部 第12章 2）。
 *
 * 与えられた能力が、カードの `abilities` の末尾に載る。与えられていなければ、渡されたカードを
 * そのまま返す。スクエアにいるユニットは `continuousData` が同じことをする。カードが「夢」を
 * 持つかを尋ねる側（プランゾーンからのプレイの判定など）は、書かれた能力ではなく、このデータから
 * 読む（ADR-0036）。
 */
export function appliedCard<C extends Card>(state: DuelState, id: CardId, card: C): C {
  const abilities = grantedAbilitiesOn(state)(id)
  return abilities.length === 0 ? card : { ...card, abilities: [...card.abilities, ...abilities] }
}

/** 与えられた能力までを適用した写し。テキストを変更する継続効果は、最初に適用する（同 5-2）。 */
function textApplied(granted: GrantedAbilities): UnitData {
  return (id, written) => {
    const abilities = granted(id)
    return abilities.length === 0 ? written : { ...written, abilities: [...written.abilities, ...abilities] }
  }
}

/**
 * いま発生している、ＳＰを変更する継続効果をすべて集める（総合ルール 第4部 第12章）。
 *
 * ＢＰの変更（`bpModification`）と同じく、常在型能力のぶんは読むたびに集め直し、盤面が持つ、
 * 作成された継続効果（`DuelState.createdContinuousEffects`、ADR-0036）のぶんを足す。同じ対象に
 * 重なれば、その分だけ足される。常在型能力に見せるのは、属性が加わった後の盤面である
 * （ADR-0056）。
 */
export function spModification(state: DuelState): SpModification {
  const text = textApplied(grantedAbilitiesOn(state))
  return modifiedBy(state, applying(attributesAddedOn(state, text), text)).sp
}

/**
 * 盤面が持つ、作成された継続効果のうち、その種類のものを対象ごとに足し合わせる。
 *
 * スクエアにいないユニットあてのものは数えない。engine がＢＰ・ＳＰを読むのは、スクエアにいる
 * ユニットの分だけである（`continuousData`・`bpModification`・`spModification` の読み手は
 * `unitsOnSquares` のユニットだけ）。数えなくても、対象がゾーンを移った時（`duel.ts` の
 * `withoutEffectsCreatedOn`）か期限が来た時に取り除かれる。
 */
function createdChangeTotals(state: DuelState, kind: ContinuousChange['kind']): Map<CardId, number> {
  const total = new Map<CardId, number>()
  for (const created of state.createdContinuousEffects) {
    if (created.change.kind !== kind) continue
    const amount = amountOf(created.change)
    if (amount === undefined) continue
    if (!onSquare(state, created.target)) continue
    total.set(created.target, (total.get(created.target) ?? 0) + amount)
  }
  return total
}

/**
 * 数値を変える変更の量。能力の付与は数値を持たないので `undefined`（`grantedAbilitiesOn` が
 * 集める）。種類を足したら、ここで型検査が止まる。種類を引数に取るだけでは、足した種類が
 * どのデータにも適用されないまま通ってしまうため。
 */
function amountOf(change: ContinuousChange): number | undefined {
  switch (change.kind) {
    case 'ＢＰの変更':
    case 'ＳＰの変更':
      return change.amount
    case '能力の付与':
    case '移動方向の変更':
      return undefined
    default:
      return change satisfies never
  }
}

/**
 * いま発生している、ＢＰを変更する継続効果をすべて集める（総合ルール 第4部 第12章）。
 *
 * 常在型能力のぶんは、ＢＰを参照するたびに集計し直す。常在型能力の生み出す継続効果は、能力を
 * 持つカードが必要なゾーンに置かれている間ずっと続き（同 4-1）、発生した時点で影響を受け
 * なかったカードにも影響を与える（同 4-2）。集め直す形にすれば、発生元がスクエアを離れた時に
 * 変更を取り消す処理も、後から置かれたユニットに効かせる処理も要らない。
 *
 * 解決が残した、作成された継続効果は、盤面が持つものをそこへ足す（同 3、ADR-0036）。
 * こちらは集め直す元が無いので、盤面が値として持っている（`DuelState.createdContinuousEffects`）。
 */
export function bpModification(state: DuelState): BpModification {
  const text = textApplied(grantedAbilitiesOn(state))
  return modifiedBy(state, applying(attributesAddedOn(state, text), text)).bp
}

/**
 * ＢＰの変更とＳＰの変更を、渡された写し方の上で集める。
 *
 * 変更を決める能力に見せるのは、属性が加わった後の盤面である（総合ルール 第4部 第12章 5-2）。
 * 「〈属性〉の味方のＢＰを＋Ｘ」は、継続効果によって属性が加わったユニットも数える。
 * ＢＰ・ＳＰのほうはまだ変更されていない。同じ種類どうしの順序と依存（同 5-3・5-4）を
 * 扱えるようになるまで、他の変更の結果を参照する変更は実装できない。ＢＰの変更とＳＰの変更は
 * 同じ種類（同 5-2 の(5)）だが互いの値を参照しないので、常在型能力は 1 回呼べば両方が集まる。
 */
function modifiedBy(state: DuelState, data: UnitData): { readonly bp: BpModification; readonly sp: SpModification } {
  const bp = new Map<CardId, number>()
  const sp = new Map<CardId, number>()

  for (const modifier of gather(state, data, modifyingAbilitiesOf, (ability, duel) => ability.modifiers(duel))) {
    if (!onSquare(state, modifier.target)) continue
    const total = modifier.kind === 'ＢＰの変更' ? bp : sp
    total.set(modifier.target, (total.get(modifier.target) ?? 0) + modifier.amount)
  }

  // 作成された継続効果は、集め直す元が無いので盤面が持っている（ADR-0036）。常在型能力から
  // 集めた分に足す。同じ対象に重なれば、その分だけ足される。
  for (const [target, amount] of createdChangeTotals(state, 'ＢＰの変更')) {
    bp.set(target, (bp.get(target) ?? 0) + amount)
  }
  for (const [target, amount] of createdChangeTotals(state, 'ＳＰの変更')) {
    sp.set(target, (sp.get(target) ?? 0) + amount)
  }

  return { bp: (id) => bp.get(id) ?? 0, sp: (id) => sp.get(id) ?? 0 }
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
 * 加える属性を決める能力に見せるのは、テキストを変更する継続効果だけを適用した盤面である
 * （同 5-2 の順）。属性を変更する継続効果どうしの順序（同 5-3・5-4）を扱えるようになるまで、
 * 他の継続効果が加えた属性を見て加える属性を決めることはできない。
 */
function attributesAddedOn(state: DuelState, text: UnitData): AddedAttributes {
  const added = new Map<CardId, Attribute[]>()

  for (const addition of gather(state, text, attributeAddingAbilitiesOf, (ability, duel) =>
    ability.attributesAdded(duel),
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

/** テキストを変更する継続効果に続けて、加わった属性までを適用した写し。 */
function applying(added: AddedAttributes, text: UnitData): UnitData {
  return (id, written) => {
    const texted = text(id, written)
    const attributes = added(id)
    return attributes.length === 0 ? texted : { ...texted, attributes: [...texted.attributes, ...attributes] }
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
 * 能力そのものはカードに書かれているものから取得する（`abilitiesOf`）。能力を与える効果（同 第12章
 * 5-2 の(2)）が与えるのは「夢」と誘発型能力（ADR-0071）である。「夢」はＢＰの変更も誘発も起動も生まず、
 * 誘発型能力は `triggeredBy`（`trigger.ts`）が、与えられた分を含めて取得する。このため、常在型能力の
 * 集計は、書かれた能力のままでよい。与えられた能力はビューの `card.abilities` に含まれる形で表し
 * （`effect.ts` の `DuelView.hasKeyword`）、尋ねる側はビューから取得する。起動型・ＢＰを変更する常在型の
 * 能力を与える時は、ここも与えられた分から取得するように切り替えてから、渡せる種類
 * （`GrantableAbility`）に追加する。
 *
 * 該当する能力を持たないユニットには、盤面を表すビューを作成しない。この集計は、カードを 1 枚
 * 参照するたびに呼ばれる（`appliedCard`）ので、ユニットごとにビューを作成すると呼ぶ回数に比例して重くなる。
 */
function gather<A, T>(
  state: DuelState,
  data: UnitData,
  abilitiesOf: (card: Card) => readonly A[],
  from: (ability: A, duel: DuelView) => readonly T[],
): readonly T[] {
  return unitsOnSquares(state).flatMap((source) => {
    const abilities = abilitiesOf(source.card)
    if (abilities.length === 0) return []
    // 発生源はいまスクエアにいるユニット自身である。継続効果が発生しているのはそこに
    // 置かれているからで（総合ルール 第4部 第12章 4-1）、解決を待つ間に位置が変わること
    // が無い。問い合わせるだけで命令を出さないので、見せたカードも覚えない。
    const duel = duelView(() => state, {
      controller: source.controller,
      self: () => source,
      show: () => {},
      data: () => data,
    })
    return abilities.flatMap((ability) => from(ability, duel))
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
