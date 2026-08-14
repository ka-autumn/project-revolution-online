import { bpModifyingAbilitiesOf } from './card.js'
import type { CardId, DuelState } from './duel.js'
import { duelView, unitsOnSquares } from './view.js'

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
 * いま発生している、ＢＰを修整する継続効果をすべて集める（総合ルール 第4部 第12章）。
 *
 * **ＢＰを読むたびに集め直す。** 常在型能力の生み出す継続効果は、能力を持つカードが必要な
 * ゾーンに置かれている間ずっと続き（同 4-1）、発生した時点で影響を受けなかったカードにも
 * 影響を与える（同 4-2）。集め直す形にすれば、発生元がスクエアを離れた時に修整を取り消す
 * 処理も、後から置かれたユニットに効かせる処理も要らない。
 *
 * **適用の順序はまだ持っていない。** 別の種類に属する継続効果の間の順序（同 5-2）も、
 * 同じ種類の中での順序（同 5-3・5-4）も、いま書ける修整には関わらない。書けるのは足し算
 * だけで、足す順番を変えても合計は変わらず、修整の量や条件が他の修整の結果を見るものが
 * まだ無いためである。他の修整を見る修整（依存、同 5-4）を書けるようになった時に足す。
 *
 * 発生元として見るのはスクエアにいるユニットだけである。常在型能力は、カードに特別の記載が
 * 無い限りスクエアに置かれている時にのみ効果を発揮する（同 第4章 1）。スクエアにあるユニット
 * 以外のカードは、次に優先権が発生した時にルールエフェクトで捨札に置かれる（同 第14章 4-3）
 * ので、そこにある間にＢＰが読まれることは無い。手札にある時に働く常在型能力を持つように
 * なった時に、そのゾーンを見に来る。
 */
export function bpModification(state: DuelState): BpModification {
  const units = unitsOnSquares(state)
  // 修整を受けられるのはスクエアにいるユニットだけである。効果が id を返してきても、
  // その時スクエアにいなければ何も起こらない（総合ルール 第1部 第1章 3）。
  const targetable = new Set(units.map((unit) => unit.id))
  const total = new Map<CardId, number>()

  for (const source of units) {
    for (const ability of bpModifyingAbilitiesOf(source.card)) {
      // 発生源はいまスクエアにいるユニット自身である。継続効果が発生しているのはそこに
      // 置かれているからで（総合ルール 第4部 第12章 4-1）、解決を待つ間に位置が変わる
      // ことが無い。問い合わせるだけで命令を出さないので、見せたカードも覚えない。
      const view = duelView(() => state, {
        controller: source.controller,
        self: () => source,
        show: () => {},
      })

      for (const modifier of ability.bpModifiers(view)) {
        if (!targetable.has(modifier.target)) continue
        total.set(modifier.target, (total.get(modifier.target) ?? 0) + modifier.amount)
      }
    }
  }

  return (id) => total.get(id) ?? 0
}
