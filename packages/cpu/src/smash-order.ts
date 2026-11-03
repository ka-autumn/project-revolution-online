import { hopeOf } from '@revolution/engine'
import type { CardId, DuelPerspective, Instruction, Player } from '@revolution/engine'
import { smashDamageFrom } from './forecast.js'
import { probeEffectRun, scoreInstructions } from './probe.js'
import { energyColorsOf, countIn, opponentOf, planOf, smashCountOf, unitsOf } from './sight.js'

/**
 * スマッシュする順番を決定する（ADR-0060 の段階 2、#366）。
 *
 * 相手が受けたダメージは 1000 ごとにスマッシュ判定になり、希望ステップで山札の 1 番上が表向きに
 * 置かれる（総合ルール 第3部 第17章 1・3、第19章 1）。そのカードの希望が、こちらのユニットを倒すことが
 * ある（同 第5部 第3章）。判定はスマッシュのたびに起こるので、どの順にスマッシュするかで、希望が
 * 発動する前に与えられるダメージが変化する。
 *
 * 順番をすべて試し、相手のスマッシュを 7 枚にできる順（同 第3部 第3章 1）を最優先にする。次に、
 * 増えるスマッシュの見込みが多い順を選ぶ。途中で止める（残りのユニットでスマッシュしない）ことも
 * 比べる。
 */

/** スマッシュできるユニット 1 枚と、与えるダメージ。 */
interface Smasher {
  readonly id: CardId
  readonly damage: number
}

/** 相手のスマッシュが何枚になれば勝つか（総合ルール 第3部 第3章 1）。 */
const LOSING_SMASHES = 7
/** スマッシュ 1 枚の点数。 */
const SMASH_POINTS = 1000
/** 勝ちが決定する順の点数。 */
const WIN_POINTS = 1_000_000
/** 中身の分からない希望ステップで、その後に控えているダメージ 1 につき見込む危険。 */
const UNKNOWN_HOPE_RISK = 0.1
/** 次の判定へ持ち越すダメージ 1 につき付ける点数。 */
const CARRIED_POINTS = 0.3
/** 試す順番の数を抑えるため、並べるユニットの上限。ダメージの大きい順に残す。 */
const MAX_SMASHERS = 6

/** 相手のプランの希望が発動した時に起きること。発動しないなら `undefined`。 */
interface KnownHope {
  /** こちらのユニットのうち、スクエアを離れるもの。 */
  readonly gone: ReadonlySet<CardId>
  /** 相手のスマッシュのうち、スマッシュゾーンを離れる枚数。 */
  readonly smashesRemoved: number
  /** 相手から見た損得。 */
  readonly gain: number
}

/**
 * 相手のプランが希望を持ち、発動するなら、その効果で起きることを見積もる。
 *
 * プランは山札の 1 番上を表にしたもので（総合ルール 第2部 第21章 3-1）、次の希望ステップで
 * 表向きに置かれる。発動するかは、相手のエネルギーゾーンの色と枚数で決定される（同 第5部 第3章 2）。
 */
function knownHopeOf(perspective: DuelPerspective, opponent: Player): KnownHope | undefined {
  const plan = planOf(perspective, opponent)
  if (plan === undefined) return undefined

  const hope = hopeOf(plan)
  if (hope === undefined) return undefined

  const colors = energyColorsOf(perspective, opponent)
  const fires =
    countIn(perspective, opponent, 'エネルギーゾーン') >= plan.level && plan.colors.every((color) => colors.has(color))
  if (!fires) return undefined

  const setting = { perspective, controller: opponent }
  const run = probeEffectRun(setting, hope.effect)
  if (run === undefined) return undefined

  const gone = new Set<CardId>()
  scoreInstructions(setting, run.instructions, gone)
  return { gone, smashesRemoved: smashesRemovedBy(run.instructions), gain: run.score }
}

function smashesRemovedBy(instructions: readonly Instruction[]): number {
  return instructions.filter(
    (instruction) =>
      instruction.kind === 'ゾーンへ置く' &&
      'zone' in instruction.card &&
      instruction.card.zone === 'スマッシュゾーン' &&
      instruction.to !== 'スマッシュゾーン',
  ).length
}

/** その順に、前から `length` 枚でスマッシュした時の点数。 */
function simulate(
  order: readonly Smasher[],
  length: number,
  start: { readonly damage: number; readonly smashes: number },
  hope: KnownHope | undefined,
): number {
  let damage = start.damage
  let smashes = start.smashes
  let planAhead = true
  let points = 0
  const lost = new Set<CardId>()

  for (let index = 0; index < length; index += 1) {
    const smasher = order[index]
    if (smasher === undefined || lost.has(smasher.id)) continue

    damage += smasher.damage
    const steps = Math.floor(damage / 1000)
    damage -= steps * 1000
    for (let step = 0; step < steps; step += 1) {
      // 希望ステップ（総合ルール 第3部 第19章）の後に、確定ステップで裏返る（同 第20章 1）。
      if (planAhead && hope !== undefined) {
        for (const id of hope.gone) lost.add(id)
        smashes -= hope.smashesRemoved
        points -= hope.gain
      } else {
        const ahead = order.slice(index + 1, length).filter((each) => !lost.has(each.id))
        points -= UNKNOWN_HOPE_RISK * ahead.reduce((sum, each) => sum + each.damage, 0)
      }
      planAhead = false

      smashes += 1
      if (smashes >= LOSING_SMASHES) return WIN_POINTS - index
    }
  }

  return points + (smashes - start.smashes) * SMASH_POINTS + damage * CARRIED_POINTS
}

/** 並べ方すべて。 */
function permutations<T>(items: readonly T[]): readonly (readonly T[])[] {
  if (items.length <= 1) return [items]
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]),
  )
}

/**
 * 次にスマッシュするユニット。スマッシュしないほうがよければ `undefined`。
 *
 * `candidates` はいまスマッシュできるユニット（行える行動のうち `スマッシュする` のもの）。
 */
export function nextSmasher(perspective: DuelPerspective, me: Player, candidates: readonly CardId[]): CardId | undefined {
  const opponent = opponentOf(me)
  const smashers = unitsOf(perspective)
    .filter((unit) => candidates.includes(unit.id))
    .map((unit) => ({ id: unit.id, damage: smashDamageFrom(me, unit.square, unit.sp) }))
    .filter((smasher) => smasher.damage > 0)
    .sort((a, b) => b.damage - a.damage)
    .slice(0, MAX_SMASHERS)
  if (smashers.length === 0) return undefined

  const start = { damage: perspective.damage[opponent], smashes: smashCountOf(perspective, opponent) }
  const hope = knownHopeOf(perspective, opponent)

  let best: { readonly points: number; readonly first: CardId | undefined } = { points: 0, first: undefined }
  for (const order of permutations(smashers)) {
    for (let length = 1; length <= order.length; length += 1) {
      const points = simulate(order, length, start, hope)
      if (points > best.points) best = { points, first: order[0]?.id }
    }
  }
  return best.first
}
