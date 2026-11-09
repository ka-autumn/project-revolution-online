import { UNTARGETED_MAY_ACTIONS, hasKeyword, movePreventingAbilitiesOf } from '@revolution/engine'
import type {
  CardId,
  CardInDiscardPile,
  CardInTrapZone,
  CardInZone,
  DuelPerspective,
  DuelView,
  EffectStep,
  EnergyInZone,
  Instruction,
  Player,
  PlayerZone,
  Square,
  SmashCard,
  UnitOnSquare,
  WireCandidate,
} from '@revolution/engine'
import { seenBasePoints, unitBasePoints } from './forecast.js'
import { countIn, opponentOf, smashCountOf, unitsOf, visibleIn } from './sight.js'
import type { SeenUnit } from './sight.js'

/**
 * 効果の空回し（ADR-0062）。
 *
 * 効果（`Effect`）は命令を順に出すジェネレータである。射影した盤面から効果に見せる問い合わせ
 * （`DuelView`）を作成して効果を回し、出てきた命令の並びに点数を付ける。盤面は変更しない。
 * 選択は、答えの並び（`script`）を決定して回し直すことで、答えごとの命令の並びを比べる。
 *
 * 見せるのは射影した盤面にあるものだけである。支配者が相手なら、相手の手札は空として見せる。
 */

/** 効果に見せる盤面を作成する時の設定。 */
export interface ProbeSetting {
  readonly perspective: DuelPerspective
  /** 能力の支配者。 */
  readonly controller: Player
  /** 発生源のユニット。スクエアにいなければ渡さない。 */
  readonly self?: UnitOnSquare
  /** まだ盤面にいないが、いるものとして見せるユニット（これから登場させるユニット）。 */
  readonly arriving?: SeenUnit
}

/** 見えていないカードに付ける、空回しの中だけの識別子。通信の「見えていない」候補の位置と同じ組み立て。 */
function hiddenId(player: Player, zone: PlayerZone, index: number): CardId {
  return `hidden:${player}:${zone}:${index}`
}

function onSquareOf(unit: SeenUnit): UnitOnSquare {
  // 継続効果を適用した後の BP を見せる。効果が書かれた BP を参照して判定するテキストもあるが、
  // 損得の見積もりにはこちらが近い。
  return { id: unit.id, square: unit.square, card: { ...unit.card, bp: unit.bp, sp: unit.sp }, controller: unit.controller }
}

/**
 * そのユニットのその移動を、移動を妨げる常在型能力が妨げているか（ADR-0068）。
 *
 * エンジンの `moveUnit` が行う判定を、射影した盤面で再現する。見積もりのための空回しなので、
 * 能力が射影した盤面で見えないものを参照しようとして例外になることがある。その時の戻り値は `onError`
 * で指定する。動けるものと見込むと危険を大きく見積もり、動けないものと見込むと期待を小さく見積もる。
 */
export function movePrevented(
  perspective: DuelPerspective,
  mover: SeenUnit,
  destination: Square,
  onError: boolean,
): boolean {
  const occasion = { kind: '移動' as const, unit: onSquareOf(mover), destination }
  return unitsOf(perspective).some((source) =>
    movePreventingAbilitiesOf(source.card).some((ability) => {
      try {
        return ability.preventsMove(
          viewFrom({ perspective, controller: source.controller, self: onSquareOf(source) }),
          occasion,
        )
      } catch {
        return onError
      }
    }),
  )
}

/** 射影した盤面から、効果に見せる問い合わせを作成する。 */
export function viewFrom(setting: ProbeSetting): DuelView {
  const { perspective, controller } = setting
  const opponent = opponentOf(controller)
  const units = [...unitsOf(perspective), ...(setting.arriving === undefined ? [] : [setting.arriving])].map(onSquareOf)
  const own = (zone: PlayerZone): readonly CardInZone[] =>
    visibleIn(perspective, controller, zone).map((instance) => ({ id: instance.id, zone, card: instance.card }))

  return {
    controller,
    opponent,
    self: () => setting.self,
    allies: () => units.filter((unit) => unit.controller === controller),
    enemies: () => units.filter((unit) => unit.controller !== controller),
    hand: () => (controller === perspective.viewer ? own('手札') : []),
    handCount: (player) => countIn(perspective, player, '手札'),
    movesThisTurn: (unit) => perspective.movedThisTurn.filter((each) => each === unit.id).length,
    discardPile: () => own('捨札') as readonly CardInDiscardPile[],
    planZone: () => own('プランゾーン'),
    energyCount: (player) => countIn(perspective, player, 'エネルギーゾーン'),
    energyZone: () =>
      visibleIn(perspective, controller, 'エネルギーゾーン').map(
        (instance): EnergyInZone => ({
          id: instance.id,
          zone: 'エネルギーゾーン',
          card: instance.card,
          orientation: instance.orientation,
        }),
      ),
    smashCount: (player) => smashCountOf(perspective, player),
    smashZone: () =>
      perspective.zones[controller]['スマッシュゾーン'].map(
        (card, index): SmashCard => ({
          id: card.kind === '見えている' ? card.instance.id : hiddenId(controller, 'スマッシュゾーン', index),
          zone: 'スマッシュゾーン',
        }),
      ),
    trapZone: () =>
      [controller, opponent].flatMap((player) =>
        perspective.zones[player]['トラップゾーン'].map(
          (card, index): CardInTrapZone => ({
            id: card.kind === '見えている' ? card.instance.id : hiddenId(player, 'トラップゾーン', index),
            zone: 'トラップゾーン',
            player,
          }),
        ),
      ),
    hasKeyword: (unit, keyword) => hasKeyword(unit.card, keyword),
  }
}

/** 候補を見分けるための文字列。通信の候補（`WireCandidate`）と、効果が並べた候補を同じ文字列にする。 */
export function keyOfWire(candidate: WireCandidate): string | undefined {
  switch (candidate.kind) {
    case '見えている':
      return `card:${candidate.card}`
    case '見えていない':
      return candidate.at === undefined
        ? undefined
        : `card:${hiddenId(candidate.at.player, candidate.at.zone, candidate.at.index)}`
    case 'スクエア':
      return `square:${candidate.square.row},${candidate.square.column}`
    case 'エリア':
      return `area:${candidate.row}`
    default:
      return undefined
  }
}

/** 効果が並べた候補の、見分けるための文字列。 */
export function keyOfProbe(candidate: unknown): string | undefined {
  if (typeof candidate === 'number') return `area:${candidate}`
  if (typeof candidate !== 'object' || candidate === null) return undefined
  if ('id' in candidate && typeof candidate.id === 'string') return `card:${candidate.id}`
  if ('row' in candidate && 'column' in candidate) return `square:${String(candidate.row)},${String(candidate.column)}`
  return undefined
}

/** 答えの並びの 1 つ。候補の番号か、選ばないこと。 */
export type ScriptStep = number | '選ばない'

type Run =
  | { readonly kind: '終わった'; readonly instructions: readonly Instruction[] }
  | {
      readonly kind: '選ぶ'
      readonly candidates: readonly unknown[]
      readonly mayDecline: boolean
      readonly picker: '支配者' | '相手'
    }
  | { readonly kind: '回せない' }

/** 1 回に回す命令の上限。終わらない効果で止まらないようにする。 */
const MAX_STEPS = 200

/**
 * 答えの並びを決定して、効果を 1 回回す。
 *
 * 並びを使い切って、さらに選ぶことがあれば、そこで止めて候補を返す。`複数を選ぶ` は前から順に
 * 選ぶ。山札を読む命令には、空の山札を返す（山札の中身は見えない）。
 */
function runScripted(start: () => EffectStep<void>, script: readonly ScriptStep[], controller: Player): Run {
  const instructions: Instruction[] = []
  let used = 0
  try {
    const effect = start()
    let reply: unknown = undefined
    for (let step = 0; step < MAX_STEPS; step += 1) {
      const next = effect.next(reply)
      if (next.done === true) return { kind: '終わった', instructions }

      const instruction = next.value
      reply = undefined
      switch (instruction.kind) {
        case '選ぶ': {
          if (used >= script.length) {
            return {
              kind: '選ぶ',
              candidates: instruction.candidates,
              mayDecline: instruction.mayDecline || instruction.candidates.length === 0,
              picker: instruction.picker ?? '支配者',
            }
          }
          const answer = script[used]
          used += 1
          reply = answer === '選ばない' || answer === undefined ? undefined : instruction.candidates[answer]
          break
        }
        case '複数を選ぶ':
          reply = instruction.candidates.slice(0, instruction.count)
          break
        // 「してもよい」は、「はい」（候補の 0 番）と「いいえ」（選ばない）の 2 通りとして回す（ADR-0064）。エンジンと
        // 同じに、対象が無ければ聞かずに「いいえ」で進む。「はい」の動き（手札へ置く）は、エンジンが実行するので、
        // ここで同じ命令を並べて、点数に反映する。
        case 'してもよいか聞く': {
          // 対象を持たない動き（「1枚引く」など。ADR-0065）は、対象が無くても聞く。
          const untargeted = UNTARGETED_MAY_ACTIONS.includes(instruction.action)
          if (instruction.targets.length === 0 && !untargeted) break
          if (used >= script.length) return { kind: '選ぶ', candidates: [{ kind: '確認' }], mayDecline: true, picker: '支配者' }

          const answer = script[used]
          used += 1
          if (answer === '選ばない' || answer === undefined) break

          if (instruction.action === '1枚引く') {
            instructions.push({ kind: 'カードを引く', player: controller, count: 1 })
          } else if (instruction.action === '山札の1番上のカードをエネルギーゾーンにフリーズして置く') {
            instructions.push({ kind: '山札の1番上をゾーンへ置く', to: 'エネルギーゾーン', orientation: 'フリーズ' })
          }
          for (const target of untargeted ? [] : instruction.targets) {
            instructions.push({ kind: 'ゾーンへ置く', card: target, to: '手札', orientation: 'リリース', position: '1番上' })
          }
          reply = true
          break
        }
        case '自分の山札を読む':
          reply = []
          break
        default:
          instructions.push(instruction)
      }
    }
    return { kind: '回せない' }
  } catch {
    // 射影した盤面からは用意できないものを効果が参照した。損得は分からない。
    return { kind: '回せない' }
  }
}

/** 1 回の見積もりで効果を回してよい回数。 */
const BUDGET = 300

interface Budget {
  remaining: number
  /** 空回しをする能力の支配者。引くなどの動きを、誰のものとして点数にするかを決定する。 */
  readonly controller: Player
}

/** その選択で選べる答え。 */
function stepsOf(run: Extract<Run, { kind: '選ぶ' }>): readonly ScriptStep[] {
  const indexes = run.candidates.map((_, index) => index)
  return run.mayDecline ? [...indexes, '選ばない'] : indexes
}

/** 点数と、その点数になった命令の並び。 */
export interface Scored {
  readonly score: number
  readonly instructions: readonly Instruction[]
}

/**
 * 答えの並びの続きを、いちばん得になるように選んだ時の点数。回せなければ `undefined`。
 *
 * 支配者が選ぶ所は支配者の得が大きい方を、相手が選ぶ所は小さい方を選ぶ。
 */
function best(
  start: () => EffectStep<void>,
  script: readonly ScriptStep[],
  score: (instructions: readonly Instruction[]) => number,
  budget: Budget,
): Scored | undefined {
  if (budget.remaining <= 0) return undefined
  budget.remaining -= 1

  const run = runScripted(start, script, budget.controller)
  if (run.kind === '回せない') return undefined
  if (run.kind === '終わった') return { score: score(run.instructions), instructions: run.instructions }

  let found: Scored | undefined = undefined
  for (const step of stepsOf(run)) {
    const each = best(start, [...script, step], score, budget)
    if (each === undefined) continue
    const better = run.picker === '支配者' ? each.score > (found?.score ?? -Infinity) : each.score < (found?.score ?? Infinity)
    if (better) found = each
  }
  return found
}

/** 効果を回して、支配者から見た損得の点数と、その時の命令の並びを返す。回せなければ `undefined`。 */
export function probeEffectRun(setting: ProbeSetting, start: (view: DuelView) => EffectStep<void>): Scored | undefined {
  const view = viewFrom(setting)
  return best(() => start(view), [], (instructions) => scoreInstructions(setting, instructions), { remaining: BUDGET, controller: setting.controller })
}

/** 効果を回して、支配者から見た損得の点数を返す。回せなければ `undefined`。 */
export function probeEffect(setting: ProbeSetting, start: (view: DuelView) => EffectStep<void>): number | undefined {
  return probeEffectRun(setting, start)?.score
}

/**
 * 効果を回して、いま聞かれている選択の候補ごとの点数を返す。
 *
 * 効果が出す選択のうち、候補が `keys` と同じものを探し、そこで候補を 1 つずつ選んだ時の点数を
 * 返す。並びは `keys` の並び、`選ばない` の点数は `declined` に入る。見つからなければ `undefined`。
 */
export function probeChoice(
  setting: ProbeSetting,
  start: (view: DuelView) => EffectStep<void>,
  keys: readonly (string | undefined)[],
): { readonly scores: readonly (number | undefined)[]; readonly declined: number | undefined } | undefined {
  if (keys.some((key) => key === undefined)) return undefined

  const view = viewFrom(setting)
  const begin = (): EffectStep<void> => start(view)
  const score = (instructions: readonly Instruction[]): number => scoreInstructions(setting, instructions)
  const budget: Budget = { remaining: BUDGET, controller: setting.controller }
  const wanted = [...keys].sort().join('|')

  const search = (script: readonly ScriptStep[]): ReturnType<typeof probeChoice> => {
    if (budget.remaining <= 0) return undefined
    budget.remaining -= 1

    const run = runScripted(begin, script, budget.controller)
    if (run.kind !== '選ぶ') return undefined

    const probeKeys = run.candidates.map(keyOfProbe)
    if ([...probeKeys].sort().join('|') === wanted) {
      return {
        scores: keys.map((key) => {
          const index = probeKeys.indexOf(key)
          return index < 0 ? undefined : best(begin, [...script, index], score, budget)?.score
        }),
        declined: run.mayDecline ? best(begin, [...script, '選ばない'], score, budget)?.score : undefined,
      }
    }

    for (const step of stepsOf(run)) {
      const found = search([...script, step])
      if (found !== undefined) return found
    }
    return undefined
  }

  return search([])
}

/** 支配者から見て、そのユニットが味方なら -1、敵なら 1。失うと損、倒すと得。 */
function sideOf(setting: ProbeSetting, controller: Player): number {
  return controller === setting.controller ? -1 : 1
}

/** 継続効果の BP の変更 1 につき付ける点数。 */
const BP_CHANGE_WEIGHT = 0.3
/** 倒すまでに至らないダメージ 1 につき付ける点数。 */
const PARTIAL_DAMAGE_WEIGHT = 0.2
/** プレイヤーへのダメージ 1 につき付ける点数。1000 で 1 枚スマッシュになる。 */
const PLAYER_DAMAGE_WEIGHT = 0.6
/** 支配者自身のスマッシュを 1 枚、スマッシュゾーンから離す点数。 */
export const SMASH_REMOVAL_POINTS = 600
/** カード 1 枚を手札に加える点数。 */
const CARD_GAIN = 300

/**
 * 命令の並びに、支配者から見た損得の点数を付ける。
 *
 * ユニットを倒す命令はそのユニットの基礎点を、味方なら減点・敵なら加点する。ダメージは同じ
 * ユニットへの分を足し合わせ、BP に届けば倒したものとする。
 */
export function scoreInstructions(
  setting: ProbeSetting,
  instructions: readonly Instruction[],
  gone: Set<CardId> = new Set(),
): number {
  const units = new Map<CardId, SeenUnit>()
  for (const unit of unitsOf(setting.perspective)) units.set(unit.id, unit)
  if (setting.arriving !== undefined) units.set(setting.arriving.id, setting.arriving)

  const damage = new Map<CardId, number>()
  const bpChange = new Map<CardId, number>()
  let total = 0

  const remove = (id: CardId, ratio: number): void => {
    const unit = units.get(id)
    if (unit === undefined || gone.has(id)) return
    gone.add(id)
    total += sideOf(setting, unit.controller) * seenBasePoints(unit) * ratio
  }
  const hurt = (id: CardId, amount: number): void => {
    const unit = units.get(id)
    if (unit === undefined || gone.has(id)) return
    const dealt = (damage.get(id) ?? 0) + amount
    damage.set(id, dealt)
    if (unit.damage + dealt >= unit.bp + (bpChange.get(id) ?? 0)) remove(id, 1)
    else total += sideOf(setting, unit.controller) * amount * PARTIAL_DAMAGE_WEIGHT
  }

  for (const instruction of instructions) {
    switch (instruction.kind) {
      case '破壊する':
        remove(instruction.target.id, 1)
        break
      case 'ユニットにダメージを与える':
        hurt(instruction.target.id, instruction.amount)
        break
      case 'プレイヤーにダメージを与える':
        total += (instruction.player === setting.controller ? -1 : 1) * instruction.amount * PLAYER_DAMAGE_WEIGHT
        break
      case '向きを変える': {
        const unit = units.get(instruction.target.id)
        const freezing = instruction.orientation === 'フリーズ'
        if (unit !== undefined) {
          // 敵をフリーズすれば動けなくなり、味方をリリースすれば動ける。
          total += sideOf(setting, unit.controller) * (freezing ? 150 : -100)
        } else {
          // エネルギーをリリースすれば、もう 1 枚プレイできる。
          total += freezing ? -80 : 150
        }
        break
      }
      case 'ゾーンへ置く':
        total += scoreZoneMove(setting, units, instruction.card, instruction.to, remove)
        break
      case 'トラップゾーンのカードを捨札に置く':
        total += scoreZoneMove(setting, units, instruction.card, '捨札', remove)
        break
      case '山札の1番上をゾーンへ置く':
        total +=
          instruction.to === '手札' ? CARD_GAIN : instruction.to === 'エネルギーゾーン' ? 250 : instruction.to === 'スマッシュゾーン' ? -600 : 0
        break
      case 'カードを引く':
        total += (instruction.player === setting.controller ? 1 : -1) * CARD_GAIN * instruction.count
        break
      case '相手に手札を捨てさせる':
        total += CARD_GAIN * instruction.count
        break
      case 'スクエアへ置く': {
        const card = instruction.card.card
        if (!units.has(instruction.card.id) && card.type === 'ユニット') total += unitBasePoints(card.bp, card.sp) * 0.8
        break
      }
      case '継続効果を作成する': {
        const unit = units.get(instruction.target)
        if (unit === undefined) break
        const side = -sideOf(setting, unit.controller)
        const change = instruction.change
        if (change.kind === 'ＢＰの変更') {
          const changed = (bpChange.get(unit.id) ?? 0) + change.amount
          bpChange.set(unit.id, changed)
          if (unit.bp + changed <= unit.damage + (damage.get(unit.id) ?? 0)) remove(unit.id, 1)
          else total += side * change.amount * BP_CHANGE_WEIGHT
        } else if (change.kind === 'ＳＰの変更') {
          total += side * change.amount * 0.5
        } else {
          total += side * 200
        }
        break
      }
      case '誘発型能力を作る':
      case '対象を持たない誘発型能力を作る':
        total += 50
        break
      default:
        break
    }
  }
  return total
}

/** カードをゾーンへ置く命令の点数。 */
function scoreZoneMove(
  setting: ProbeSetting,
  units: ReadonlyMap<CardId, SeenUnit>,
  card: CardInZone | UnitOnSquare | SmashCard | CardInTrapZone,
  to: PlayerZone,
  remove: (id: CardId, ratio: number) => void,
): number {
  if (units.has(card.id)) {
    // スクエアから離す。手札へ戻すのは、相手がまたプレイできる分、倒すより少し劣る。
    remove(card.id, to === '手札' ? 0.8 : 1)
    return 0
  }
  if (!('zone' in card)) return 0

  switch (card.zone) {
    case 'スマッシュゾーン':
      // 自分のスマッシュが減れば、敗北から遠ざかる（総合ルール 第3部 第3章 1）。
      return to === 'スマッシュゾーン' ? 0 : SMASH_REMOVAL_POINTS
    case 'トラップゾーン':
      return 'player' in card && card.player !== setting.controller ? 300 : -200
    case '捨札':
      return to === '手札' ? CARD_GAIN : 0
    case '手札':
      return to === '手札' ? 0 : -CARD_GAIN
    case 'エネルギーゾーン':
      return to === 'エネルギーゾーン' ? 0 : -300
    case '山札':
    case 'プランゾーン':
      return to === '手札' ? CARD_GAIN : 0
    default:
      return 0
  }
}
