import type { Card, UnitCard } from './card.js'
import { continuousData } from './continuous.js'
import { checkCourageCondition } from './courage.js'
import { discardFromSquares } from './discard.js'
import {
  cardsIn,
  damagePlayer,
  dealDamage,
  draw,
  faceDownPlan,
  findAnywhere,
  locateOnSquares,
  moveToSquare,
  moveToZone,
  putInZone,
  setOrientationInEnergyZone,
  setOrientationOnSquare,
  topOfLibrary,
} from './duel.js'
import type { CardId, CardInstance, DuelState, TriggeredInstance } from './duel.js'
import type { CardInZone, DuelView, Effect, Instruction, UnitOnSquare } from './effect.js'
import { loggedInstruction, record } from './log.js'
import type { LoggedInstruction, ResolutionVia } from './log.js'
import { opponentOf } from './player.js'
import type { Player } from './player.js'
import { shuffle } from './random.js'
import { checkIntrusion } from './trap.js'
import { duelView } from './view.js'
import type { PlayerZone } from './zone.js'

/**
 * 候補の中から 1 つ選ぶ役。
 *
 * エンジンは I/O を持てない（ADR-0001）ため、選択は外から渡してもらう。人間の入力でも
 * AI の思考でも、記録した対戦の再生でも、ここに差し込む形は同じになる。
 *
 * 誰が選ぶかは選ばせる場面ごとに決まる（効果の中ならテキストが指定した人で、指定が無ければその能力の
 * 支配者、相手を指定したテキストなら相手。バンクにある能力を選ぶならその能力の支配者）ため、`player` として渡す。どちらのプレイヤーに尋ねればよいか
 * を、受け取った側が盤面から組み立て直さずに済むようにする。
 *
 * `mayDecline` が真の時だけ、候補があっても `undefined`（選ばない）を返してよい
 * （効果の中の「◯枚まで選び」、`effect.ts` の `chooseAtMostOne`）。省略されている場合は
 * 必ず候補の中から 1 つ選ぶ。コストの支払いやバンクにある能力の選択のように、選ばない
 * ことが認められていない場面ではこの引数は渡されない。
 */
/**
 * 何のために選ばせているか。
 *
 * **ルールの判断には使わない。** 選ぶ人に「いま何を聞かれているのか」を伝えるためだけに持つ。
 * 候補だけを見せても、それがコストの支払いなのか効果の対象なのかは分からない。
 *
 * 述語をいくつも足すかわりに数え上げているのは、選ばせる場所が数えられるためである
 * （engine の中で `Chooser` を呼ぶのは 4 か所しかない）。
 *
 * 効果が選ばせる場合は、どれも `効果の対象` になる。何のための対象かはカードのテキストが
 * 決めることで、テキストは engine に無い（#93）。
 */
export const CHOICE_PURPOSES = [
  /** プレイするためのレベルの支払い（総合ルール 第1部 第2章 3-1、`cost.ts` の `payEnergyCost`）。 */
  'プレイのコスト',
  /** プランするためのコストの支払い（同 第3部 第8章 2-3）。スマッシュでも支払える（同 第2部 第21章 7-5）。 */
  'プランのコスト',
  /**
   * 相手の手札を見た内容の確認（ADR-0041）。候補は「確認した」の 1 つだけで、見せるカードの
   * 一覧が付く。候補が 1 つでも聞く——聞かなければ、見た側に一覧が届かない。
   */
  '見たカードの確認',
  /**
   * 自分の山札を読んで、条件に合うカードを選ぶ（ADR-0042）。候補は条件に合うカードで、山札の
   * 全体が見せる一覧として付く。候補が無くても聞く（選ばないことを選ぶ）。
   */
  '山札から選ぶ',
  /**
   * 相手が自分の手札から選んで捨てる（`effect.ts` の `discardOpponentHand`、ADR-0052）。候補は選ぶ人
   * 自身の手札で、効果には見えない。N 枚を選ばせる時は、1 枚ずつ N 回聞く（`ChoiceSeries`）。
   */
  '捨てる手札',
  /** ユニットを移動するための追加コストの支払い（同 第4部 第6章 2-2）。 */
  '移動のコスト',
  /** 起動型能力のコストの支払い（同 第4部 第2章 1）。 */
  '起動のコスト',
  /** バンクから解決する能力を選ぶ（同 第2部 第21章 11-3）。 */
  '解決する能力',
  /** プランのめくりを置き換える能力を適用するか（同 第4部 第13章）。 */
  'プランの置き換え',
  /** 効果が命令の中で選ばせている（`effect.ts` の `choose`・`chooseAtMostOne`）。 */
  '効果の対象',
  /**
   * 発動する権利が発生しているきっかけが複数ある時に、どれに対して発動するかを選ぶ（総合ルール
   * 第2部 第20章 3-8、ADR-0039）。候補は満たされた発動条件（`duel.ts` の `TrapConditionMet`）。
   */
  'トラップのきっかけ',
  /**
   * 起動する権利が発生しているきっかけが複数ある時に、どのユニットにダメージを与えるかを選ぶ
   * （同 第5部 第2章 2、ADR-0039）。候補は満たされた起動条件（`duel.ts` の `CourageConditionMet`）。
   */
  '勇気のきっかけ',
] as const

export type ChoicePurpose = (typeof CHOICE_PURPOSES)[number]

/**
 * N 枚を続けて選ばせる時の、何枚目か（ADR-0052）。`nth` は 1 から数える。1 枚だけ選ばせる時は渡さない。
 * 画面が N 枚をまとめて選ばせるために使う。**返す答えを左右しない。**
 */
export interface ChoiceSeries {
  readonly nth: number
  readonly of: number
}

/**
 * 選ばせる手立て。呼ぶ側が渡す。
 *
 * `purpose` は選ぶ人に見せるためのもので、返す答えを左右しない。答えを自動で決める実装
 * （`legal-action.ts` の `chooseFirst`、`self-play.ts` の `randomChooser`）は受け取らなくてよい。
 *
 * `board` は**その選択が起きている盤面**である。行動が終わるまで盤面は確定しない（ADR-0008）
 * ので、選ぶ人に見せてよいのはこれであって、行動を始める前の盤面ではない（#142）。戻れるか
 * どうかもここから決まる——行動を始めてから新しく見えたものがあれば、見たうえで取り消せて
 * しまうので戻せない（`protocol.ts` の `describeChoice`）。
 *
 * `source` は**選ばせている当のカード**である（#122）。`purpose` は種類しか言えず、効果が
 * 選ばせる場面はどれも `効果の対象` になる（何のための対象かはカードのテキストが決めることで、
 * テキストは engine に無い）。どのカードの効果かが分かれば場面は絞れるので、それだけを渡す。
 * `purpose` と同じく**返す答えを左右しない。**
 *
 * 渡すのは効果が選ばせる場面だけである。作成された誘発型能力は発生源を持たない
 * （`EffectContext.source`）ので、その時は渡らない。
 *
 * `shown` は、候補とは別に選ぶ人へ見せるカードの一覧である（ADR-0041）。一覧のうち候補に
 * なっているものが、選べるカードである。見せるだけで、返す答えを左右しない。
 *
 * `player` は、テキストが指定した選ぶ人である。効果の中なら、能力の支配者か、その相手（ADR-0052）。
 *
 * `series` は、N 枚を続けて選ばせる選択の何枚目かである。`purpose` と同じく返す答えを左右しない。
 */
export type Chooser = (
  candidates: readonly unknown[],
  player: Player,
  purpose: ChoicePurpose,
  board: DuelState,
  mayDecline?: boolean,
  source?: CardId,
  shown?: readonly CardInstance[],
  series?: ChoiceSeries,
) => unknown

/**
 * 「確認した」という、ただ 1 つの候補（`見たカードの確認`）。カードでも場所でもないので、
 * 識別子も位置も持たない。
 */
export const CONFIRMATION = Object.freeze({ kind: '確認' } as const)

export interface EffectContext {
  /** 能力の支配者（総合ルール 第4部 第7章 1）。味方・敵はこのプレイヤーから見た呼び方になる。 */
  readonly controller: Player
  /** どの経路の解決か（#104）。**入口が言う。**ここで推測しない。 */
  readonly via: ResolutionVia
  /** 発生源のカード。作成された誘発型能力（`duel.ts` の `CreatedAbilityInstance`）は持たない。 */
  readonly source?: CardId
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
   * 発動したトラップのきっかけに載っている、侵入してきた敵・攻撃したユニットと攻撃された
   * ユニット・スマッシュしたユニットがこれにあたる（`ability.ts` の `TrapOccasion`）。あれは
   * 盤面への問い合わせでは取れない。そのユニットが盤面に残っていても、どれが引き金だったかを
   * 盤面から見分ける手立ては無いためである。
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
 *
 * 解決を始めたことを、その効果が出す命令より先に残す（#95・#104）。**解決の入口はすべて
 * ここを通る**ので、出すところをここ 1 つに寄せている。入口ごとに書くと、足し忘れても型が
 * 通ってしまう。どの命令がどの能力から出たものかは、ログの並びで分かる。
 */
export function resolveEffect(state: DuelState, effect: Effect, context: EffectContext): DuelState {
  let current = record(state, {
    kind: '能力を解決した',
    controller: context.controller,
    via: context.via,
    source: context.source,
  })
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
    current = recorded(current, outcome, step.value, context.controller)
    sent = outcome.value
  }
}

/**
 * 誘発した条件付誘発型能力の誘発条件を、解決する時の盤面で確かめる（総合ルール 第4部
 * 第7章 8）。条件を持たない能力は常に満たす。
 *
 * 盤面の見せ方は効果と同じ（`effectView`）で、発生源がスクエアを離れていれば誘発した
 * 時点の写しを使う（同 第8章 2-5）。確かめるだけで命令を出さないので、見せたカードの記録は
 * 捨てる。
 */
export function conditionHolds(state: DuelState, instance: TriggeredInstance): boolean {
  const { condition } = instance.ability
  if (condition === undefined) return true

  const context = { controller: instance.controller, self: instance.self }
  const duel = effectView(() => state, context, new Set())
  return condition(duel)
}

interface Outcome {
  readonly state: DuelState
  /** その命令が効果に返す値。 */
  readonly value: unknown
  /**
   * その命令が実際に触れたもの。命令そのものには書かれていないものだけを持つ
   * （`log.ts` の `loggedInstruction`）。
   */
  readonly subject?: unknown
  /** 選ばないことを選んだ（`log.ts` の `選ぶ`）。盤面は変わらないが、聞いた事実は残す。 */
  readonly declined?: true
  /** 動かしたカードの持ち主。置き先のゾーンのプレイヤーにあたる（`log.ts` の `ゾーンへ置く`）。 */
  readonly owner?: Player
  /**
   * 命令が自分でログを積んだ。`recorded` はこの命令の行を足さない。聞かずに済んだ、見せただけの
   * 選択（`選ぶ` の相手に手札を見せる形で手札が 0 枚）で、選んだ行を残さないために使う。
   */
  readonly logged?: true
}

/**
 * 実行した命令をログに残す（#95）。
 *
 * **盤面が変わらなかった命令は残さない。** 実行できない行動は実行されない（総合ルール
 * 第1部 第1章 3）ので、対象がすでにその場を離れていれば何も起きていない。engine の中の
 * 手続きは、何も起こらない時に渡された盤面をそのまま返す（`duel.ts` の `moveToZone`・
 * `dealDamage` ほか）ので、入れ替わったかどうかで見分けられる。
 *
 * 選ぶことだけは盤面を変えないので、選ばれたものがあったかどうかで見る。
 */
function recorded(before: DuelState, outcome: Outcome, instruction: Instruction, controller: Player): DuelState {
  if (outcome.logged === true) return outcome.state
  if (outcome.state === before && outcome.subject === undefined && outcome.declined !== true) return outcome.state

  // 命令が動かしたカードは、動いた先が非公開のゾーンだと後の盤面から見えない。名指しを
  // 残せるよう、動く前の盤面もあわせて渡す（`log.ts` の `record`、#129）。
  return record(
    outcome.state,
    {
      kind: '命令を実行した',
      controller,
      instruction: loggedInstruction(instruction, outcome.subject, controller, outcome),
    },
    before,
  )
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
  shown: Set<CardId>,
): Outcome {
  switch (instruction.kind) {
    case '選ぶ': {
      // 選ぶのは、テキストが指定した人である（総合ルール 第4部 第8章 2-3、ADR-0052）。指定が無ければ
      // 能力の支配者。相手が選ぶ時の一覧は、支配者の手札である。
      const asksOpponent = instruction.picker === '相手'
      const chooserPlayer = asksOpponent ? opponentOf(context.controller) : context.controller

      // 見せる一覧を渡された時は、候補が無くても聞く。山札を見た人に、選ばないことを選ばせる
      // ためである（ADR-0042）。一覧が空（読める山札が無い、読んだカードが山札を離れた）なら、見せる
      // ものが無いので、一覧なしの選択として扱う。
      const listed =
        instruction.shown === undefined
          ? []
          : instancesOf(state, context.controller, instruction.shown, shown, asksOpponent ? ['手札'] : ['プランゾーン', '山札'])
      const shownCards = listed.length === 0 ? undefined : listed

      // 支配者の手札を相手に見せる（ADR-0052）。見せたことは、聞く前にログへ積む——戻れるかを決める
      // 判定が、積まれたログを見るためである（`protocol.ts` の `describeChoice`）。0 枚でも積む。
      const revealsHand = asksOpponent && instruction.shown !== undefined
      const board = revealsHand
        ? record(state, {
            kind: '命令を実行した',
            controller: context.controller,
            instruction: loggedRevealedHand([...listed].sort(byNameThenId)),
          })
        : state

      // 候補が空なら、選ぶという行動は実行できない（総合ルール 第1部 第1章 3）。効果は
      // そこで終わらせず、選ばれなかったものとして次の指示へ進む。解決はテキストに
      // 書かれている順番の通りに指示に従うものであり（同 第4部 第8章 2-2）、実行されない
      // のはその行動だけだからである。選んだものを対象にする後ろの指示を飛ばすかどうかは、
      // 効果の側が `undefined` を見て決める（`effect.ts` の `choose`）。
      if (instruction.candidates.length === 0 && shownCards === undefined) {
        return revealsHand ? { state: board, value: undefined, logged: true } : { state, value: undefined }
      }
      const chosen = context.chooser(
        instruction.candidates,
        chooserPlayer,
        shownCards === undefined || asksOpponent ? '効果の対象' : '山札から選ぶ',
        board,
        instruction.mayDecline,
        context.source,
        shownCards,
      )
      // 選ばないことが認められている場面でだけ、候補にないもの（`undefined`）を受け取れる。
      if (instruction.mayDecline && chosen === undefined) return { state: board, value: undefined, declined: true }
      if (!instruction.candidates.includes(chosen)) {
        throw new Error('候補にないものが選ばれた')
      }
      return { state: board, value: chosen, subject: chosen }
    }
    case '相手に手札を捨てさせる': {
      // 選ぶのは手札の持ち主である相手で、候補はその手札（ADR-0052）。効果は候補にも選ばれた
      // カードにも触れない。
      const opponent = opponentOf(context.controller)
      const hand = cardsIn(state, opponent, '手札')
      // 0 枚（または 0 枚を捨てさせる）なら何も起きない。ログも積まない（`recorded`）。
      if (instruction.count <= 0 || hand.length === 0) return { state, value: undefined }

      // 手札が足りなければ、聞かずにあるだけ捨てる（総合ルール 第4部 第10章 2）。
      const discarded: CardInstance[] = []
      if (hand.length <= instruction.count) {
        discarded.push(...hand)
      } else {
        // 1 枚ずつ選ばせる。選んだカードは次の候補から外れる。途中で盤面は変わらない。
        for (let nth = 1; nth <= instruction.count; nth += 1) {
          const candidates = hand.filter((one) => !discarded.includes(one))
          const chosen = context.chooser(
            candidates,
            opponent,
            '捨てる手札',
            state,
            false,
            context.source,
            undefined,
            instruction.count >= 2 ? { nth, of: instruction.count } : undefined,
          )
          if (!candidates.includes(chosen as CardInstance)) throw new Error('候補にないものが選ばれた')

          discarded.push(chosen as CardInstance)
        }
      }
      // 選び終えてから、まとめて捨札に置く。
      const next = discarded.reduce((current, one) => moveToZone(current, one.id, '捨札'), state)
      return { state: next, value: undefined, subject: discarded }
    }
    case '相手の手札を見る': {
      // 見るのは能力の支配者で、見られるのはその相手の手札である（ADR-0041）。
      // 手札の並びは公開されていない。引いた順などが一覧から読めないよう、中身だけで並べる。
      // 同じ名前の中は識別子の順にする。見せる一覧の並び（`protocol.ts` の `orderShown`）と、ログの名指しの
      // 並びをそろえるためで、手札の持ち順（引いた順など）はどちらにも出ない。
      const hand = [...cardsIn(state, opponentOf(context.controller), '手札')].sort(byNameThenId)
      // 0 枚なら新しく見えるものが無い。聞かずに、見たことだけを積む（`subject` が空の並び）。
      if (hand.length === 0) return { state, value: undefined, subject: hand }

      context.chooser(
        [CONFIRMATION],
        context.controller,
        '見たカードの確認',
        state,
        false,
        context.source,
        hand,
      )
      // 見たカードは効果に返さない。効果が相手の手札の中身で分岐する口は作らない。
      return { state, value: undefined, subject: hand }
    }
    case '自分の山札を読む': {
      // 読むのは能力の支配者で、読まれるのはその山札である（ADR-0042）。山札の順序は効果に渡さない。
      // 並びは中身だけで決める——持ち順で返すと、山札の順序が読めてしまう。
      const read = [
        ...cardsIn(state, context.controller, 'プランゾーン').map((one) => inZone(one, 'プランゾーン')),
        ...cardsIn(state, context.controller, '山札').map((one) => inZone(one, '山札')),
      ].sort(byNameThenId)
      // 読んだカードは、効果が命令の対象にできる（選んだカードを動かす命令に渡せる）。
      for (const one of read) shown.add(one.id)
      // 0 枚でも読んだことは積む（`subject` が空の並び）。
      return { state, value: read, subject: read }
    }
    case '山札をシャッフルする': {
      // 混ぜるのは支配者の山札で、プランゾーンにカードがあれば、裏向きにしてから混ぜる
      // （総合ルール 第2部 第21章 3-5）。裏向きにすると山札の 1 番上に移り、プランゾーンは無くなる。
      const player = context.controller
      const plan = cardsIn(state, player, 'プランゾーン')
      const flipped = faceDownPlan(state, player)
      // 乱数は盤面が持つ列から取り、進めた続きを盤面に戻す（ADR-0042）。
      const mixed = shuffle(cardsIn(flipped, player, '山札'), state.random)
      return {
        state: { ...putInZone(flipped, player, '山札', mixed.value), random: mixed.random },
        value: undefined,
        subject: plan,
      }
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
      // 第2部 第24章 1-1）ので、この行動は実行されない（同 第1部 第1章 3）。スクエアや
      // エネルギーゾーンを離れていた場合も同じで、どちらの手続きも盤面をそのまま返す。
      // エネルギーを指す対象だけが `zone` を持つ（`effect.ts` の `EnergyInZone`）。向きを
      // 変えられるのは支配者のエネルギーだけで、相手のエネルギーゾーンにあるカードを指して
      // いても盤面は変わらない（見せたカードがそこへ移った場合など）。
      const { target, orientation } = instruction
      return {
        state:
          'zone' in target
            ? setOrientationInEnergyZone(state, context.controller, target.id, orientation)
            : setOrientationOnSquare(state, target.id, orientation),
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
      const owner = findAnywhere(state, instruction.card.id)?.owner
      if (instruction.to === '捨札' && locateOnSquares(state, instruction.card.id) !== undefined) {
        return { state: discardFromSquares(state, [instruction.card.id]), value: undefined, owner }
      }

      // すでにそのゾーンを離れていればこの行動は実行されない（総合ルール 第1部 第1章 3）。
      // `moveToZone` がどこにも無いカードを黙って見送るので、ここでは何も足さない。
      return {
        owner,
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

      return {
        state: moveToZone(state, top.id, instruction.to, instruction.orientation),
        value: undefined,
        subject: top,
      }
    }
    case 'スクエアへ置く': {
      if (!shown.has(instruction.card.id)) {
        throw new Error('効果に見せていないカードが対象にされた')
      }
      // 「登場」ではないので、`play.ts` の `placePlayedUnit` を通さない。ここを通らない
      // ことで、「登場した時」「味方が登場した時」の誘発（`triggerAppearance`・
      // `triggerAllyAppearance`）も「根性」による向きの置換
      // （総合ルール 第5部 第6章 3）も起こらない。指定された向きがそのまま使われる。
      const moved = moveToSquare(state, instruction.card.id, instruction.square, {
        controller: context.controller,
        orientation: instruction.orientation,
      })
      return { state: checkPlacedByEffect(moved, instruction.card.id), value: undefined }
    }
    case '誘発型能力を作る': {
      // 対象を持つ命令なので、他と同じく engine が見せたカードでなければならない。
      if (!shown.has(instruction.affecting.id)) {
        throw new Error('効果に見せていないカードが対象にされた')
      }
      // 作られた能力の支配者は、作った効果の支配者である（総合ルール 第4部 第7章 1）。
      const created = {
        ability: instruction.ability,
        controller: context.controller,
        affecting: instruction.affecting.id,
      }
      return { state: { ...state, createdAbilities: [...state.createdAbilities, created] }, value: undefined }
    }
    case '継続効果を作成する': {
      if (!shown.has(instruction.target)) {
        throw new Error('効果に見せていないカードが対象にされた')
      }
      // 支配者は作った効果の支配者である（総合ルール 第4部 第7章 1）。並びの末尾に足すので、
      // 発生した順が保たれる。
      const created = {
        target: instruction.target,
        change: instruction.change,
        until: instruction.duration,
        controller: context.controller,
      }
      return { state: { ...state, createdContinuousEffects: [...state.createdContinuousEffects, created] }, value: undefined }
    }
    case 'プランを裏返す': {
      // プランが無ければこの行動は実行されない（総合ルール 第1部 第1章 3）。効果は続く。
      // `faceDownPlan` がプランの無い盤面をそのまま返すので、ここでは何も足さない。
      return { state: faceDownPlan(state, instruction.player), value: undefined }
    }
    case 'カードを引く': {
      // 引けない場合は何も起こらないだけで、効果は続く（総合ルール 第1部 第1章 3）。
      // 引けた分だけを積むので（`log.ts` の `カードを引く`）、引く前に 1 番上を控える。
      let current = state
      const drawn: CardInstance[] = []
      for (let count = 0; count < instruction.count; count += 1) {
        const top = topOfLibrary(current, instruction.player)
        if (top === undefined) break

        current = draw(current, instruction.player)
        drawn.push(top)
      }
      // 1 枚も引けなければ何も触れていない。空の並びを渡すと「0 枚引いた」が積まれる
      // （`recorded`）ので、触れなかったことを `undefined` で言う。
      return { state: current, value: undefined, subject: drawn.length === 0 ? undefined : drawn }
    }
  }
}

/** 山札かプランゾーンにあるカードを、効果に見せる形に写す。 */
function inZone(instance: CardInstance, zone: '山札' | 'プランゾーン'): CardInZone {
  return { id: instance.id, zone, card: instance.card }
}

/**
 * カード名の順、同じ名前の中は識別子の順。持ち順を使わない並べ方である。
 *
 * 識別子はシャッフルする前のデッキの並びから決まる（`setup.ts` の `library`）ので、山札の
 * 順序を表さない。
 */
function byNameThenId(a: { readonly id: CardId; readonly card: Card }, b: { readonly id: CardId; readonly card: Card }): number {
  if (a.card.name !== b.card.name) return a.card.name < b.card.name ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * 効果が見せる一覧に載せたカードを、盤面のカードに引き直す。
 *
 * 効果が読んだものだけを載せられる（`shown` に入っているもの）。`zones` のゾーンから探す。山札を
 * 見せる一覧はプランゾーンと山札、相手に見せる一覧は支配者の手札である。見つからなければ、その
 * カードはもうそこを離れているので、一覧には載せない。
 */
function instancesOf(
  state: DuelState,
  player: Player,
  listed: readonly CardInZone[],
  shown: ReadonlySet<CardId>,
  zones: readonly PlayerZone[],
): readonly CardInstance[] {
  const held = zones.flatMap((zone) => cardsIn(state, player, zone))
  return listed.flatMap(({ id }) => {
    if (!shown.has(id)) throw new Error('効果に見せていないカードが見せる一覧に載せられた')
    const found = held.find((one) => one.id === id)
    return found === undefined ? [] : [found]
  })
}

/** 支配者の手札を相手に見せたことを、ログに積む形にする。 */
function loggedRevealedHand(cards: readonly CardInstance[]): LoggedInstruction {
  return { kind: '相手に手札を見せる', count: cards.length, cards: cards.map(({ id }) => id) }
}

/**
 * 効果によってスクエアに置かれたユニットについて、トラップの発動条件（総合ルール 第2部
 * 第20章 3-6）と「勇気」の起動条件（同 第5部 第2章 2）を確かめる。どちらの条文も「相手の
 * ユニットが置かれた」とだけ書き、置き方を限っていないので、登場（`play.ts`）や移動
 * （`move.ts`）と同じく満たしうる。ゾーンから置いた場合も、別のスクエアから置き直した場合も
 * 同じに扱う。
 *
 * 置かれた後にスクエアにいなければ（カードがどこにも見つからず、`moveToSquare` が何も
 * しなかった）、何も起きていないので確かめない。ユニット以外のカードが置かれた場合も、
 * 「ユニットが」にあたらないので確かめない。
 */
function checkPlacedByEffect(state: DuelState, id: CardId): DuelState {
  const located = locateOnSquares(state, id)
  if (located === undefined) return state

  const { instance, square } = located
  if (instance.card.type !== 'ユニット') return state

  const placed: UnitOnSquare = { id, square, card: instance.card, controller: instance.controller }
  return checkCourageCondition(checkIntrusion(state, placed), placed)
}

/**
 * 効果に見せる盤面。写し方そのものは `view.ts` にあり、ここは効果の経路に固有のところ
 * （発生源の引き直しと、見せたカードの記録）だけを渡す。
 */
function effectView(
  currentState: () => DuelState,
  context: Pick<EffectContext, 'controller' | 'self'>,
  shown: Set<CardId>,
): DuelView {
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
