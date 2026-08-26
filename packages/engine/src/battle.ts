import { triggerAttack, triggerBattleWin } from './bank.js'
import { BATTLE_SPACE, indexOfSquare } from './board.js'
import type { Square } from './board.js'
import { bpOf, hasPep } from './card.js'
import { bpModification } from './continuous.js'
import type { UnitCard } from './card.js'
import { discardFromSquares, discardedFromSquares } from './discard.js'
import { cardsOn, dealDamage } from './duel.js'
import type { BankedAbility, CardId, CardInstance, DuelState } from './duel.js'
import { record } from './log.js'
import { trigger } from './trigger.js'

/**
 * バトルを構成する 5 つの連続するステップ（総合ルール 第3部 第11章 3）。
 *
 * それぞれのステップは、何も起こらない場合でも存在する（同）。並びは総合ルールの順の
 * ままで、ステップはこの順に進む。フェイズ（`turn.ts` の `PHASES`）と同じ扱いだが、
 * ステップはバトルの中にしかない。
 */
export const BATTLE_STEPS = [
  '第１バトルステップ',
  '第１ダメージステップ',
  '第２バトルステップ',
  '第２ダメージステップ',
  'バトル終了ステップ',
] as const

export type BattleStep = (typeof BATTLE_STEPS)[number]

/**
 * 発生しているバトル 1 つ（総合ルール 第3部 第11章）。
 *
 * 支配者の異なる 2 つのユニットが同一のスクエアに置かれた時に発生する特別な手順であり、
 * バンクを使用しないルールエフェクトである（同 1、第4部 第14章 4-4）。
 */
export interface Battle {
  /** バトルが発生したスクエア。 */
  readonly square: Square
  /** 攻撃したユニット。そのスクエアに後から置かれたほう（総合ルール 第3部 第11章 4）。 */
  readonly attacker: CardId
  /** 攻撃されたユニット。そのスクエアに先に置かれていたほう（同 4）。 */
  readonly attacked: CardId
  readonly step: BattleStep
  /**
   * 第１ダメージステップですでにバトルダメージを与えたユニット。
   *
   * 第２ダメージステップにダメージを与えるのは「第１ダメージステップでダメージを与えて
   * いないユニット」（総合ルール 第3部 第15章 1）なので、実際に与えたかどうかを記録して
   * おく。「元気」を持つかどうかから引き直せそうに見えるが、第１ダメージステップに一方が
   * スクエアを離れていてバトルダメージが発生しなかった場合、「元気」を持っていても与えて
   * いない。
   */
  readonly dealtDamage: readonly CardId[]
  /**
   * バトル終了ステップで、勝敗の決定後のルールエフェクトを解決し「バトルの終わりに」の
   * 能力を誘発させたか（総合ルール 第3部 第16章 2-1〜2-3）。
   *
   * バトル終了ステップは連続放棄を 2 度必要とする。1 度目で攻撃側のユニットなどが捨札に
   * 置かれて「バトルの終わりに」の能力が誘発し（同 2-1〜2-3）、2 度目でステップが終わる
   * （同 3）。リカバリーフェイズの `endOfTurnTriggered`（`turn.ts`）と同じ形。
   */
  readonly endOfBattleTriggered: boolean
  /**
   * バトルによって待機中のバンク（総合ルール 第3部 第11章 2）。
   *
   * バンクに能力が入っている状態でバトルが発生した場合、その能力は待機中となり、解決する
   * 前にバトルを開始する。待機中のバンクはバトルが終了するまで存在しないものとして扱われ、
   * バトル中に誘発した能力は別の新しいバンク（`DuelState.bank`）で解決される。バトルが
   * 終了した後、通常のバンクに戻って処理される（同 4）。
   */
  readonly heldBank: readonly BankedAbility[]
  /**
   * バンクに入ることが予約されている状態で待機させられた能力（総合ルール 第3部 第11章 2）。
   *
   * 誘発しただけでまだバンクに入っていない能力（`DuelState.triggered`）も、バトルが
   * 発生した時点で待機中のバンクと同じ扱いになる。同 2 の【例】がこれにあたる。
   */
  readonly heldTriggered: readonly BankedAbility[]
  /**
   * このバトルが始まった時点の `DuelState.log` の長さ。
   *
   * バトルとスマッシュ判定のどちらが後から始まったか（どちらを先に処理すべきか、総合ルール
   * 第3部 第11章 2-2・第17章 2-1）を比べるためだけに持つ。ログは単調に伸びる
   * （`log.ts` の `record`）ので、値が大きいほうが後から始まっている。
   */
  readonly startedAt: number
}

/** これから発生するバトルの、スクエアとそこで重なっている 2 つのユニット。 */
interface PendingBattle {
  readonly square: Square
  /** そのスクエアに先に置かれていたユニット（総合ルール 第3部 第11章 4）。 */
  readonly attacked: UnitInstance
  /** そのスクエアに後から置かれたユニット（同 4）。 */
  readonly attacker: UnitInstance
}

/**
 * 支配者の異なる 2 つのユニットが重なっていて、バトルが発生するスクエアとそのユニット。
 * 重なっていなければ `undefined`（総合ルール 第4部 第14章 4-4）。
 *
 * すでにそのスクエアでバトルが処理中なら見ない——バトルが終わるまで両方のユニットが
 * そのスクエアに残り続ける（第3部 第11章 1-2）ので、見てしまうと同じ重なりを何度も
 * 新しいバトルとして検出してしまう。処理中でない別のスクエアの重なりは、バトル中の
 * バトル（同 2-1）として見る。
 *
 * 中央エリアを指定してプレイされたユニットが捨札に置かれるのが今なのかバトル終了時なのか
 * （同 4-9・4-10）を決めるのに、`rule-effect.ts` もこれを使う。
 */
export function pendingBattle(state: DuelState): PendingBattle | undefined {
  for (const square of BATTLE_SPACE) {
    if (state.battles.some((battle) => indexOfSquare(battle.square) === indexOfSquare(square))) continue
    const units = opposingUnits(state, square)
    if (units !== undefined) return { square, ...units }
  }
  return undefined
}

/**
 * バトルが発生していれば、それを始める（総合ルール 第3部 第11章 1、第4部 第14章 4-4）。
 * 発生していなければ盤面はそのまま。
 *
 * バトル発生のルールエフェクトは他のルールエフェクトよりも後で処理される（同 4-4-1）ため、
 * 呼ぶのは他のルールエフェクトをすべて解決し終えた後だけである（`priority.ts` の
 * `settleBeforePriority`）。他のルールエフェクトによって一方のユニットがスクエアを
 * 離れていれば、その時点でもう重なっていないので、ここでバトルは発生しない（同 4-4-2、
 * 第3部 第11章 1-1）。
 *
 * すでに処理中のバトルがあれば、それは「待機中のバトル」になる（同 2-1）。新しいバトルの
 * バンクとバンクに入ることが予約されている能力を、このバトルが終わるまで待機させる。
 * この後で誘発する能力は新しいバンクに入る。`smash.ts` の `startSmashJudgmentIfAny` と
 * 同じ形。
 *
 * 優先権をここでは動かさない。ステップの始めに非アクティブプレイヤーが優先権を獲得する
 * （同 第12章 1）のは呼ぶ側の仕事である。
 */
export function startBattleIfAny(state: DuelState): DuelState {
  const pending = pendingBattle(state)
  if (pending === undefined) return state

  const battle: Battle = {
    square: pending.square,
    attacker: pending.attacker.id,
    attacked: pending.attacked.id,
    step: '第１バトルステップ',
    dealtDamage: [],
    endOfBattleTriggered: false,
    heldBank: state.bank,
    heldTriggered: state.triggered,
    startedAt: state.log.length,
  }

  // バトルを並びに載せる**前に**積む。そうすると、この行は自分自身のバトルの中には入らず、
  // 手順の見出しとして外側に立つ（`log.ts` の `LoggedEvent.during`、#133）。処理中のバトルが
  // あれば、それはこのバトルが終わるまで待機中になる（同 2-1）。
  const held = state.battles.at(-1)
  const waiting = held === undefined ? state : record(state, { kind: 'バトルが待機中になった', square: held.square })
  const announced = record(waiting, {
    kind: 'バトルが始まった',
    square: battle.square,
    attacker: battle.attacker,
    attacked: battle.attacked,
  })

  const started = { ...announced, battles: [...announced.battles, battle], bank: [], triggered: [] }
  return beginStep(started, battle)
}

/**
 * 進行中のバトルを 1 ステップ進める。
 *
 * 呼ぶのは、バンクが空で両方のプレイヤーが連続して優先権を放棄した時だけである
 * （総合ルール 第3部 第4章 4）。フェイズのかわりに、進行中のステップが終了する。
 *
 * 最後のステップまで来ていたらバトルが終了する。ただしバトル終了ステップだけは連続放棄を
 * 2 度必要とする。1 度目で勝敗の決定後のルールエフェクトを解決して「バトルの終わりに」の
 * 能力を誘発させ（同 第16章 2-1〜2-3）、2 度目で終わる（同 3）。
 *
 * ステップが進んだ後は、どのステップでも非アクティブプレイヤーが優先権を獲得する
 * （同 第12章 1・第13章 1・第14章 1・第15章 1・第16章 1）。それは呼ぶ側（`progress.ts`）
 * が行う。
 */
export function advanceBattle(state: DuelState, battle: Battle): DuelState {
  const next = BATTLE_STEPS[BATTLE_STEPS.indexOf(battle.step) + 1]
  if (next === undefined) {
    return battle.endOfBattleTriggered ? endBattle(state, battle) : resolveEndOfBattle(state, battle)
  }
  return beginStep(state, { ...battle, step: next })
}

/**
 * 始まったステップの、始めの処理を行う。
 *
 * バトルステップは誘発した能力をバンクに入れ（総合ルール 第3部 第12章 1・第14章 1）、
 * ダメージステップはバトルダメージの応酬を解決し（同 第13章 1・第15章 1）、バトル終了
 * ステップは勝敗を判定する（同 第16章 1）。フェイズにおける `progress.ts` の
 * `beginCurrentPhase` と同じ位置づけ。
 *
 * **ステップが始まったことをログに積むのはここだけである**（#133）。バトルが始まった時の
 * 第１バトルステップも、進んだ先のステップも同じくここを通る。始めの処理より前に積むので、
 * そのステップで起きたことが後ろに並ぶ。
 */
function beginStep(state: DuelState, battle: Battle): DuelState {
  const begun = record(withBattle(state, battle), { kind: 'バトルのステップが変わった', step: battle.step })
  switch (battle.step) {
    case '第１バトルステップ': {
      // バトルが始まったことによる誘発（同 第12章 1）。「攻撃した時」「攻撃された時」は
      // そのユニット自身のできごとなので、盤面の全ユニットは見ない。
      const triggered = trigger(trigger(begun, 'バトルの始め'), '第１バトルステップの始め')
      return triggerAttack(triggered, battle.attacker, battle.attacked)
    }
    case '第１ダメージステップ':
    case '第２ダメージステップ':
      return exchangeBattleDamage(begun, battle)
    case '第２バトルステップ':
      return trigger(begun, '第２バトルステップの始め')
    case 'バトル終了ステップ':
      return beginEndStep(begun, battle)
  }
}

/**
 * バトルダメージの応酬（総合ルール 第3部 第13章 1・第15章 1）。
 *
 * 支配者の異なる 2 つのユニットが同一のスクエアにあるならば、そのステップにダメージを
 * 与えるユニットの、この時点でのＢＰと同じ数字のダメージが、同じスクエアに置かれている
 * 相手のユニットに与えられる。バトルを発生させたユニットの一方あるいは両方がそのスクエアを
 * 離れていた場合、バトルダメージは発生しない（同）。
 *
 * ひとかたまりの効果として解決される（同 第13章 2・第15章 2）ため、両方が与える場合は
 * 同時に与えられる。与える量を先にすべて決めてから与えることで、片方のダメージが
 * もう片方の与える量に影響しないようにしている。
 */
function exchangeBattleDamage(state: DuelState, battle: Battle): DuelState {
  const attacker = unitInBattle(state, battle, battle.attacker)
  const attacked = unitInBattle(state, battle, battle.attacked)
  if (attacker === undefined || attacked === undefined) return state

  const dealers = [attacker, attacked].filter((unit) => dealsDamageIn(battle, unit))
  if (dealers.length === 0) return state

  // 継続効果による修整も「この時点でのＢＰ」に含まれる。与える量を決める前に 1 度だけ
  // 集めることで、両方が与える場合の 2 つの量が同じ盤面から決まる。
  const modification = bpModification(state)
  const damages = dealers.map((unit) => ({
    from: unit.id,
    target: unit.id === attacker.id ? attacked.id : attacker.id,
    amount: bpOf(unit.card, modification(unit.id)),
  }))
  const damaged = damages.reduce(
    (current, { from, target, amount }) =>
      record(dealDamage(current, target, amount), {
        kind: 'バトルダメージを与えた',
        from,
        to: target,
        amount,
      }),
    state,
  )

  return withBattle(damaged, { ...battle, dealtDamage: [...battle.dealtDamage, ...dealers.map((unit) => unit.id)] })
}

/**
 * そのユニットが、そのダメージステップにバトルダメージを与えるか。
 *
 * 第１ダメージステップに与えるのは「元気」を持つユニット（総合ルール 第3部 第13章 1、
 * 第5部 第8章 2）、第２ダメージステップに与えるのは第１ダメージステップで与えていない
 * ユニット（同 第3部 第15章 1）である。
 */
function dealsDamageIn(battle: Battle, unit: UnitInstance): boolean {
  return battle.step === '第１ダメージステップ'
    ? hasPep(unit.card)
    : !battle.dealtDamage.includes(unit.id)
}

/**
 * バトル終了ステップを始める（総合ルール 第3部 第16章 1）。
 *
 * まずバトルの勝敗を判定し、勝敗によって誘発する能力と「バトル終了ステップの始め」に
 * 誘発する能力をバンクに乗せる。カードから見た「勝敗そのもの」は盤面に残さない。勝者や
 * 敗者を後から見るカードがまだ書けないためで、参照するのはこの誘発だけである。
 *
 * **判定した勝敗は、その場でログに積む**（#160）。バトルが終わるまで持ち回すと、勝敗の
 * 決定後のルールエフェクト（同 2-1・2-2）で捨札に置かれた行のほうが先に並び、勝った結果と
 * して置かれたことが読み取れなくなる。積んでしまえば盤面に残す必要も無い——`winnerOf` を
 * 後から呼び直すと結果が変わってしまう、という持ち回りの理由がここで消える。
 */
function beginEndStep(state: DuelState, battle: Battle): DuelState {
  const winner = winnerOf(state, battle)
  const decided = record(state, { kind: 'バトルの勝敗が決まった', winner })
  const won = winner === undefined ? decided : triggerBattleWin(decided, winner)
  return trigger(withBattle(won, battle), 'バトル終了ステップの始め')
}

/**
 * バトルの勝者（総合ルール 第3部 第16章 1-1）。引き分けなら `undefined`。
 *
 * バトル終了ステップの開始時に、いずれかひとつのユニットだけがバトルを行っているスクエアに
 * 置かれている場合、そのユニットが勝者となる。両方が置かれている場合と、両方が置かれて
 * いない場合は引き分けになる。
 */
function winnerOf(state: DuelState, battle: Battle): CardId | undefined {
  const attacker = unitInBattle(state, battle, battle.attacker)
  const attacked = unitInBattle(state, battle, battle.attacked)
  if (attacker !== undefined && attacked === undefined) return attacker.id
  if (attacked !== undefined && attacker === undefined) return attacked.id
  return undefined
}

/**
 * バトルの勝敗が決定した後、バンクが空で両方のプレイヤーが連続して優先権を放棄した時の
 * 処理（総合ルール 第3部 第16章 2-1〜2-3）。
 *
 * 両方のユニットがまだスクエアにいれば攻撃側のユニットが捨札に置かれ（同 2-1、第4部
 * 第14章 4-11）、中央エリアを指定してプレイされたユニットがいずれかのスクエアにあれば
 * それも捨札に置かれる（同 2-2、第4部 第14章 4-10）。この 2 つのルールエフェクトを
 * 解決した後、「バトルの終わりに」と書かれた能力が誘発する（同 2-3）。
 */
function resolveEndOfBattle(state: DuelState, battle: Battle): DuelState {
  const bothRemain =
    unitInBattle(state, battle, battle.attacker) !== undefined &&
    unitInBattle(state, battle, battle.attacked) !== undefined

  // 2 つのルールエフェクトは同時に発生するので、どれを捨札に置くかを先にまとめて決める。
  // 攻撃側のユニットが中央エリアを指定してプレイされたユニットでもあることがあるため、
  // 実際に置かれるものを `discardedFromSquares` に決めさせてから記録する。
  const discarded = discardedFromSquares(state, [
    ...(bothRemain ? [battle.attacker] : []),
    ...state.playedIntoCenter,
  ])
  const moved = discardFromSquares(state, discarded)
  const resolved =
    discarded.length === 0 ? moved : record(moved, { kind: 'ルールで捨札に置かれた', cards: discarded })

  const triggered = trigger(resolved, 'バトルの終わりに')
  return withBattle(triggered, { ...battle, endOfBattleTriggered: true })
}

/**
 * バトル終了ステップを終え、バトルを終了する（総合ルール 第3部 第16章 3・4）。
 *
 * 待機していたバンク（及びバンクに乗ることが予約されている能力）は、通常のバンクに戻って
 * 処理される（同 4、第11章 2）。バトル中のバンクはこの時点で空である（空でなければ連続
 * した放棄にならず、ここへは来ない）。
 *
 * 「バトルの終わりまで」の効果と「このバトルの間」の効果の終了（同 第16章 3）は、継続効果を
 * まだ盤面が持たないため何もすることがない。
 *
 * **終わらせるのは並びの最後のバトルである。** バトル中にもう 1 つ発生した場合（同 2-1）、
 * 後から発生したほうが先に終わり、待機していた前のバトルが残りの手順を続ける。`smash.ts` の
 * `endSmashJudgment` と同じ形。
 */
function endBattle(state: DuelState, battle: Battle): DuelState {
  const ended = {
    ...state,
    battles: state.battles.slice(0, -1),
    bank: [...state.bank, ...battle.heldBank],
    triggered: [...state.triggered, ...battle.heldTriggered],
  }
  // 並びから外した**後に**積む。見出しは手順の外側に立つ（`log.ts` の `LoggedEvent.during`）。
  // 勝敗はバトル終了ステップの始めに積んである（`beginEndStep`）。ここが閉じるのは
  // バトルという手順そのものである。
  const closed = record(ended, { kind: 'バトルが終わった' })
  const resumed = closed.battles.at(-1)
  return resumed === undefined ? closed : record(closed, { kind: 'バトルが戻った', square: resumed.square })
}

/** 効果から見えるかたちではなく、盤面が持っているままのユニット。 */
type UnitInstance = CardInstance & { readonly card: UnitCard }

/**
 * バトルが行われているスクエアにある、そのユニット。そこになければ `undefined`。
 *
 * バトルダメージも勝敗も「バトルを行っているスクエアに置かれているか」で決まる
 * （総合ルール 第3部 第13章 1・第16章 1-1）ので、別のスクエアに動いていた場合も
 * 離れたものとして扱う。
 */
function unitInBattle(state: DuelState, battle: Battle, id: CardId): UnitInstance | undefined {
  return cardsOn(state, battle.square).filter(isUnit).find((unit) => unit.id === id)
}

/**
 * そのスクエアで重なっている、支配者の異なる 2 つのユニット。重なっていなければ
 * `undefined`。
 *
 * 後から置かれたユニットが「攻撃したユニット」、先に置かれていたユニットが「攻撃された
 * ユニット」である（総合ルール 第3部 第11章 4）。スクエアの並びは後ろが後から置かれた
 * カードである（`duel.ts` の `squares`）。
 *
 * 同じプレイヤーが支配するユニットの重なりは別のルールエフェクトで解消される
 * （同 第4部 第14章 4-7）ため、ここへ来る時点で 1 つのスクエアにあるユニットは
 * 支配者ごとに高々 1 枚である。
 */
function opposingUnits(
  state: DuelState,
  square: Square,
): { readonly attacked: UnitInstance; readonly attacker: UnitInstance } | undefined {
  const units = cardsOn(state, square).filter(isUnit)
  const [attacked] = units
  if (attacked === undefined) return undefined

  const attacker = units.find((unit) => unit.controller !== attacked.controller)
  return attacker === undefined ? undefined : { attacked, attacker }
}

function isUnit(instance: CardInstance): instance is UnitInstance {
  return instance.card.type === 'ユニット'
}

/** 処理中のバトル（並びの最後）を差し替える。 */
function withBattle(state: DuelState, battle: Battle): DuelState {
  return { ...state, battles: [...state.battles.slice(0, -1), battle] }
}
