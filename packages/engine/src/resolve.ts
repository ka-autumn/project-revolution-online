import type { UnitCard } from './card.js'
import { continuousData } from './continuous.js'
import { discardFromSquares } from './discard.js'
import {
  damagePlayer,
  dealDamage,
  draw,
  faceDownPlan,
  locateOnSquares,
  moveToSquare,
  moveToZone,
  setOrientationOnSquare,
  topOfLibrary,
} from './duel.js'
import type { CardId, DuelState } from './duel.js'
import type { DuelView, Effect, Instruction, UnitOnSquare } from './effect.js'
import type { Player } from './player.js'
import { duelView } from './view.js'

/**
 * 候補の中から 1 つ選ぶ役。
 *
 * エンジンは I/O を持てない（ADR-0001）ため、選択は外から渡してもらう。人間の入力でも
 * AI の思考でも、記録した対戦の再生でも、ここに差し込む形は同じになる。
 *
 * 誰が選ぶかは選ばせる場面ごとに決まる（効果の中ならその能力の支配者、バンクにある能力を
 * 選ぶならその能力の支配者）ため、`player` として渡す。どちらのプレイヤーに尋ねればよいか
 * を、受け取った側が盤面から組み立て直さずに済むようにする。
 *
 * `mayDecline` が真の時だけ、候補があっても `undefined`（選ばない）を返してよい
 * （効果の中の「◯枚まで選び」、`effect.ts` の `chooseAtMostOne`）。省略されている場合は
 * 必ず候補の中から 1 つ選ぶ。コストの支払いやバンクにある能力の選択のように、選ばない
 * ことが認められていない場面ではこの引数は渡されない。
 */
export type Chooser = (candidates: readonly unknown[], player: Player, mayDecline?: boolean) => unknown

export interface EffectContext {
  /** 能力の支配者（総合ルール 第4部 第7章 1）。味方・敵はこのプレイヤーから見た呼び方になる。 */
  readonly controller: Player
  readonly chooser: Chooser
  /**
   * 誘発した時点の発生源（`duel.ts` の `TriggeredInstance.self`）。
   *
   * 効果に `self` を見せるために使う。渡さなければ `DuelView.self` は常に `undefined` に
   * なる。プレイされたストラテジーや発動したトラップのように、発生源がスクエアにいない
   * 効果では渡さない。
   */
  readonly self?: UnitOnSquare
  /**
   * `DuelView` を通さずに効果へ直接手渡したユニット。
   *
   * 発動したトラップのきっかけに載っている「侵入してきた敵」がこれにあたる（`ability.ts` の
   * `IntrusionOccasion`）。あれは盤面への問い合わせでは取れない。侵入してきたユニットが
   * 盤面に残っていても、どれが引き金だったかを盤面から見分ける手立ては無いためである。
   *
   * 効果が命令の対象にできるのは engine が見せたカードだけである（`resolveEffect` の
   * `shown`）。手渡したものも engine が見せたものなので、ここに渡して同じ扱いにする。
   * スクエアを離れていれば、その対象への命令は実行されないだけである
   * （総合ルール 第1部 第1章 3）。
   */
  readonly handed?: readonly UnitOnSquare[]
}

/**
 * 効果を解決して、次の盤面を返す。
 *
 * 効果が出す命令をここだけが解釈する。カードの実装は盤面を書き換えられず、何をしたいかを
 * 命令として並べるだけである（ADR-0002）。
 *
 * 誘発型能力がバンクを経由して解決されるまでの流れ（総合ルール 第4部 第7章 2）は
 * まだ実装していない。この関数は、そこにたどり着いた後の 1 つの効果だけを扱う。
 */
export function resolveEffect(state: DuelState, effect: Effect, context: EffectContext): DuelState {
  let current = state
  // 効果に見せたユニット。効果は自分で盤面を探せないので、対象にできるのはここを
  // 通って渡したものだけである（ADR-0002）。
  const shown = new Set<CardId>()
  for (const unit of context.handed ?? []) shown.add(unit.id)
  const steps = effect(effectView(() => current, context, shown))

  let sent: unknown = undefined
  for (;;) {
    const step = steps.next(sent)
    if (step.done === true) return current

    const outcome = apply(current, step.value, context, shown)
    current = outcome.state
    sent = outcome.value
  }
}

interface Outcome {
  readonly state: DuelState
  /** その命令が効果に返す値。 */
  readonly value: unknown
}

/**
 * 命令を 1 つ実行する。
 *
 * 実行できない行動は実行されない（総合ルール 第1部 第1章 3）が、効果はそのまま続く。
 * **効果が途中で打ち切られることはない。** 解決はテキストに書かれている順番の通りに
 * 指示に従うものであり（同 第4部 第8章 2-2）、実行できない指示があってもそれを飛ばして
 * 次へ進むだけだからである。
 */
function apply(
  state: DuelState,
  instruction: Instruction,
  context: EffectContext,
  shown: ReadonlySet<CardId>,
): Outcome {
  switch (instruction.kind) {
    case '選ぶ': {
      // 候補が空なら、選ぶという行動は実行できない（総合ルール 第1部 第1章 3）。効果は
      // そこで終わらせず、選ばれなかったものとして次の指示へ進む。解決はテキストに
      // 書かれている順番の通りに指示に従うものであり（同 第4部 第8章 2-2）、実行されない
      // のはその行動だけだからである。選んだものを対象にする後ろの指示を飛ばすかどうかは、
      // 効果の側が `undefined` を見て決める（`effect.ts` の `choose`）。
      if (instruction.candidates.length === 0) return { state, value: undefined }
      // 選ぶのは能力の支配者（総合ルール 第4部 第8章 2-3）。
      const chosen = context.chooser(instruction.candidates, context.controller, instruction.mayDecline)
      // 選ばないことが認められている場面でだけ、候補にないもの（`undefined`）を受け取れる。
      if (instruction.mayDecline && chosen === undefined) return { state, value: undefined }
      if (!instruction.candidates.includes(chosen)) {
        throw new Error('候補にないものが選ばれた')
      }
      return { state, value: chosen }
    }
    case '破壊する': {
      if (!shown.has(instruction.target.id)) {
        throw new Error('効果に見せていないカードが対象にされた')
      }
      // 破壊されたユニットは持ち主の捨札の一番上に置かれる（総合ルール 第2部 第21章 5-1）。
      // すでにスクエアを離れていればこの行動は実行されない。
      return { state: discardFromSquares(state, [instruction.target.id]), value: undefined }
    }
    case 'プレイヤーにダメージを与える': {
      // スマッシュ判定はここでは始めない。効果の解決中はルールエフェクトがチェックされない
      // （総合ルール 第4部 第8章 4）ため、次に優先権が発生する時に `settleBeforePriority`
      // がまとめて処理する。
      return { state: damagePlayer(state, instruction.player, instruction.amount), value: undefined }
    }
    case 'ユニットにダメージを与える': {
      if (!shown.has(instruction.target.id)) {
        throw new Error('効果に見せていないカードが対象にされた')
      }
      // ＢＰと同じかそれ以上のダメージを受けたユニットが捨札に置かれること（総合ルール
      // 第4部 第14章 4-6）もルールエフェクトの仕事なので、ここでは始めない。すでに
      // スクエアを離れていればこの行動は実行されない（同 第1部 第1章 3）。`dealDamage` が
      // スクエアにないカードをそのまま見送るので、ここでは何も足さない。
      return { state: dealDamage(state, instruction.target.id, instruction.amount), value: undefined }
    }
    case '向きを変える': {
      if (!shown.has(instruction.target.id)) {
        throw new Error('効果に見せていないカードが対象にされた')
      }
      // すでにその向きなら、リリースすることもフリーズすることもできない（総合ルール
      // 第2部 第24章 1-1）ので、この行動は実行されない（同 第1部 第1章 3）。スクエアを
      // 離れていた場合も同じで、どちらも `setOrientationOnSquare` が盤面をそのまま返す。
      return {
        state: setOrientationOnSquare(state, instruction.target.id, instruction.orientation),
        value: undefined,
      }
    }
    case 'ゾーンへ置く': {
      if (!shown.has(instruction.card.id)) {
        throw new Error('効果に見せていないカードが対象にされた')
      }
      // スクエアから捨札へ置くことは「破壊する」にあたり（総合ルール 第2部 第21章 1-5）、
      // それを見て誘発する能力がある（同 第4部 第7章 6）。`moveToZone` はその誘発を
      // 起こさないので、この場合だけ `destroy` と同じ経路を通す。向きの指定は使わない。
      // 捨札のカードは常にリリース状態で置かれる（同 第2部 第21章 5-3）ためである。
      if (instruction.to === '捨札' && locateOnSquares(state, instruction.card.id) !== undefined) {
        return { state: discardFromSquares(state, [instruction.card.id]), value: undefined }
      }

      // すでにそのゾーンを離れていればこの行動は実行されない（総合ルール 第1部 第1章 3）。
      // `moveToZone` がどこにも無いカードを黙って見送るので、ここでは何も足さない。
      return {
        state: moveToZone(
          state,
          instruction.card.id,
          instruction.to,
          instruction.orientation,
          instruction.position,
        ),
        value: undefined,
      }
    }
    case '山札の1番上をゾーンへ置く': {
      // 効果に見せていないカードだが、選ばれたものではなく位置で指定されたものなので
      // `shown` の検査は要らない。効果はどのカードが動いたかを知らないままである。
      const top = topOfLibrary(state, context.controller)
      // 山札が空ならこの行動は実行されない（総合ルール 第1部 第1章 3）。効果は続く。
      if (top === undefined) return { state, value: undefined }

      return { state: moveToZone(state, top.id, instruction.to, instruction.orientation), value: undefined }
    }
    case 'スクエアへ置く': {
      if (!shown.has(instruction.card.id)) {
        throw new Error('効果に見せていないカードが対象にされた')
      }
      // 「登場」ではないので、`play.ts` の `placePlayedUnit` を通さない。ここを通らない
      // ことで、「登場した時」の誘発（`triggerAppearance`）も「根性」による向きの置換
      // （総合ルール 第5部 第6章 3）も起こらない。指定された向きがそのまま使われる。
      return {
        state: moveToSquare(state, instruction.card.id, instruction.square, {
          controller: context.controller,
          orientation: instruction.orientation,
        }),
        value: undefined,
      }
    }
    case 'プランを裏返す': {
      // プランが無ければこの行動は実行されない（総合ルール 第1部 第1章 3）。効果は続く。
      // `faceDownPlan` がプランの無い盤面をそのまま返すので、ここでは何も足さない。
      return { state: faceDownPlan(state, instruction.player), value: undefined }
    }
    case 'カードを引く': {
      // 引けない場合は何も起こらないだけで、効果は続く（総合ルール 第1部 第1章 3）。
      let current = state
      for (let drawn = 0; drawn < instruction.count; drawn += 1) current = draw(current, instruction.player)
      return { state: current, value: undefined }
    }
  }
}

/**
 * 効果に見せる盤面。写し方そのものは `view.ts` にあり、ここは効果の経路に固有のところ
 * （発生源の引き直しと、見せたカードの記録）だけを渡す。
 */
function effectView(currentState: () => DuelState, context: EffectContext, shown: Set<CardId>): DuelView {
  return duelView(currentState, {
    controller: context.controller,
    /**
     * 発生源を解決する時の姿で返す。スクエアを離れていれば誘発した時点の写しを使う
     * （総合ルール 第4部 第8章 2-5、`effect.ts` の `DuelView.self`）。
     */
    self: () => {
      if (context.self === undefined) return undefined

      const located = locateOnSquares(currentState(), context.self.id)
      if (located === undefined || located.instance.card.type !== 'ユニット') return context.self
      return {
        id: located.instance.id,
        square: located.square,
        card: located.instance.card,
        controller: located.instance.controller,
      }
    },
    show: (id) => shown.add(id),
    // 効果が見るのは継続効果を適用した後のデータである（総合ルール 第4部 第12章 2）。
    data: continuousData,
  })
}
