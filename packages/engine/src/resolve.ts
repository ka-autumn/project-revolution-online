import { BATTLE_SPACE } from './board.js'
import type { UnitCard } from './card.js'
import { discardFromSquares } from './discard.js'
import { cardsIn, damagePlayer, draw, locateOnSquares, moveToSquare, moveToZone, topOfLibrary } from './duel.js'
import type { CardId, DuelState } from './duel.js'
import type { CardInZone, DuelView, Effect, Instruction, UnitOnSquare } from './effect.js'
import type { Player } from './player.js'
import type { PlayerZone } from './zone.js'

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
  const steps = effect(duelView(() => current, context.controller, shown))

  let sent: unknown = undefined
  for (;;) {
    const step = steps.next(sent)
    if (step.done === true) return current

    const outcome = apply(current, step.value, context, shown)
    if (outcome === undefined) return current

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
 * 命令を 1 つ実行する。効果をここで打ち切るなら `undefined`。
 *
 * 実行できない行動は実行されない（総合ルール 第1部 第1章 3）。行動が実行されなかった
 * だけなら効果は続くが、選べなかった場合だけは、選んだものを対象にする行動が後ろに
 * 続いているのが普通なので、そこで打ち切る。
 */
function apply(
  state: DuelState,
  instruction: Instruction,
  context: EffectContext,
  shown: ReadonlySet<CardId>,
): Outcome | undefined {
  switch (instruction.kind) {
    case '選ぶ': {
      // 候補が空の時、「1 枚選び」は選ぶという行動そのものが実行できないので打ち切るが、
      // 「1 枚まで選び」は 0 枚を許しているので、選ばなかったものとして効果が続く。
      if (instruction.candidates.length === 0) {
        return instruction.mayDecline ? { state, value: undefined } : undefined
      }
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
        state: moveToZone(state, instruction.card.id, instruction.to, instruction.orientation),
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
    case 'カードを引く': {
      // 引けない場合は何も起こらないだけで、効果は続く（総合ルール 第1部 第1章 3）。
      let current = state
      for (let drawn = 0; drawn < instruction.count; drawn += 1) current = draw(current, instruction.player)
      return { state: current, value: undefined }
    }
  }
}

/**
 * 効果に見せる盤面。
 *
 * 命令を実行するたびに盤面は入れ替わるので、そのつど最新のものを読み直す。
 */
function duelView(currentState: () => DuelState, controller: Player, shown: Set<CardId>): DuelView {
  const unitsOnSquares = (): readonly UnitOnSquare[] =>
    currentState().squares.flatMap((cards, index) => {
      const square = BATTLE_SPACE[index]
      if (square === undefined) return []
      return cards.flatMap((instance) =>
        // スクエアにあってもユニット以外のカードは「味方」「敵」ではない
        // （総合ルール 第2部 第21章 8-2）。
        instance.card.type === 'ユニット'
          ? [{ id: instance.id, square, card: instance.card, controller: instance.controller }]
          : [],
      )
    })

  const show = (units: readonly UnitOnSquare[]): readonly UnitOnSquare[] => {
    for (const unit of units) shown.add(unit.id)
    return units
  }

  // 支配者自身のゾーンだけを見せる。相手の手札は非公開の情報なので、渡す手段を持たせない
  // （`effect.ts` の `DuelView.hand`）。
  const showZone = (zone: PlayerZone) => (): readonly CardInZone[] => {
    const cards = cardsIn(currentState(), controller, zone).map((instance) => ({
      id: instance.id,
      zone,
      card: instance.card,
    }))
    for (const card of cards) shown.add(card.id)
    return cards
  }

  return {
    controller,
    allies: () => show(unitsOnSquares().filter((unit) => unit.controller === controller)),
    enemies: () => show(unitsOnSquares().filter((unit) => unit.controller !== controller)),
    hand: showZone('手札'),
    discardPile: showZone('捨札'),
    planZone: showZone('プランゾーン'),
  }
}
