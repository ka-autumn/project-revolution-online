import { BATTLE_SPACE, squareInDirection, squaresBeside } from '@revolution/engine'
import type { Card, CardId, DuelPerspective, Player, Square, UnitCard } from '@revolution/engine'
import { areaFor, countIn, opponentOf, pepOf, sameSquare, trustOf, unitsOf } from './sight.js'
import type { SeenUnit } from './sight.js'

/**
 * バトルの勝ち負けと、ユニットの値打ちの見積もり（ADR-0060 の段階 2、#366）。
 */

/** バトルをするユニット 1 枚の、予測に使う値。 */
export interface Fighter {
  readonly bp: number
  /** すでに受けているダメージ。リカバリーフェイズまで残る（総合ルール 第3部 第10章 1）。 */
  readonly damage: number
  readonly pep: boolean
}

export interface BattleForecast {
  readonly attackerSurvives: boolean
  readonly defenderSurvives: boolean
  /** バトルが終わった時に、攻撃されたユニットが受けているダメージ。 */
  readonly defenderDamage: number
}

/** BP と同じかそれ以上のダメージを受けたユニットは捨札に置かれる（総合ルール 第4部 第14章 4-6）。 */
function survives(fighter: Fighter, damage: number): boolean {
  return fighter.bp > 0 && damage < fighter.bp
}

/**
 * バトルの結果を予測する（総合ルール 第3部 第11章〜第15章）。
 *
 * 第１ダメージステップで元気を持つユニットが（同 第13章 1、第5部 第8章 2）、第２ダメージステップで
 * まだダメージを与えていないユニットが（同 第15章 1）、その時点の BP と同じダメージを与える。
 * どちらのステップも、相手がまだスクエアにいる時だけダメージが発生する。
 *
 * バトル中に発動するトラップや、誘発する能力は見込まない。
 */
export function forecastBattle(attacker: Fighter, defender: Fighter): BattleForecast {
  let attackerDamage = attacker.damage
  let defenderDamage = defender.damage

  // 第１ダメージステップ
  if (attacker.pep) defenderDamage += attacker.bp
  if (defender.pep) attackerDamage += defender.bp
  let attackerAlive = survives(attacker, attackerDamage)
  let defenderAlive = survives(defender, defenderDamage)

  // 第２ダメージステップ。両方がまだスクエアにいる時だけ。
  if (attackerAlive && defenderAlive) {
    if (!attacker.pep) defenderDamage += attacker.bp
    if (!defender.pep) attackerDamage += defender.bp
    attackerAlive = survives(attacker, attackerDamage)
    defenderAlive = survives(defender, defenderDamage)
  }

  return { attackerSurvives: attackerAlive, defenderSurvives: defenderAlive, defenderDamage }
}

/** スクエアにいるユニットを、バトルの予測に使う値にする。 */
export function fighterOf(unit: SeenUnit): Fighter {
  return { bp: unit.bp, damage: unit.damage, pep: pepOf(unit.card) }
}

/** 手札のユニットを、登場した時の値にする。継続効果は見込まず、書かれている BP を使う。 */
export function fighterOfCard(card: UnitCard): Fighter {
  return { bp: card.bp, damage: 0, pep: pepOf(card) }
}

/**
 * ユニットの値打ち。倒した時に得るもの・倒された時に失うものの大きさに使う。
 *
 * BP は場に残る力、SP はスマッシュで与えるダメージである。カード 1 枚ぶんの値打ちを足す。
 */
export function unitWorth(bp: number, sp: number): number {
  return 300 + bp * 0.5 + sp
}

export function seenWorth(unit: SeenUnit): number {
  return unitWorth(unit.bp, unit.sp)
}

/** 手札に持っておく値打ち。エネルギーに置くカードと、捨てるカードを選ぶのに使う。 */
export function cardWorth(card: Card): number {
  switch (card.type) {
    case 'ユニット':
      return unitWorth(card.bp, card.sp)
    case 'トラップ':
      return 700
    default:
      return 800
  }
}

/** スマッシュフェイズに、そのスクエアからスマッシュした時に与えるダメージ（総合ルール 第3部 第9章 1）。 */
export function smashDamageFrom(player: Player, square: Square, sp: number): number {
  switch (areaFor(player, square)) {
    case '中央エリア':
      return Math.max(0, sp)
    case '敵エリア':
      return Math.max(0, sp + 500)
    default:
      return 0
  }
}

/** 次の相手のターンに、移動で攻め込まれた時に倒されると見込む時の、残れる見込み。 */
const SURVIVAL_AGAINST_MOVE = 0.25
/** 相手がユニットを出せるスクエアにいる時の、残れる見込み。相手の手札は見えない。 */
const SURVIVAL_AGAINST_PLAY = 0.65
/** 攻め込まれる手立てが見当たらない時の、残れる見込み。 */
const SURVIVAL_SAFE = 0.95

/**
 * そのスクエアに置いたユニットが、次の相手のターンまで残れる見込み。
 *
 * 移動で攻め込まれるかは、相手のユニットのムーブアイコンで決定される（総合ルール 第4部 第6章 2-1）。
 * 相手のユニットはリカバリーフェイズでダメージを取り除かれ（同 第3部 第10章 1）、リリースフェイズで
 * リリースされるので、どちらも見込まずに判定する。信頼を持つ味方の左右には、相手は移動できない
 * （同 第5部 第4章 2）。
 *
 * `moving` は、これから移動するユニットである。信頼で守っているかを判定する時に、自分自身を含めない。
 *
 * 相手がユニットを出せるのは、相手の味方エリアと中央エリアだけである（同 第2部 第20章 1-3）。
 * 相手の手札は見えないので、手札があれば一定の見込みで攻め込まれるものとする。
 */
export function survivalAt(
  perspective: DuelPerspective,
  me: Player,
  square: Square,
  fighter: Fighter,
  moving?: CardId,
): number {
  const opponent = opponentOf(me)
  const units = unitsOf(perspective)
  // 移動するユニットは、元のスクエアから移動先を守れない。
  const guarded = units.some(
    (unit) =>
      unit.controller === me &&
      unit.id !== moving &&
      trustOf(unit.card) &&
      squaresBeside(unit.square).some((beside) => sameSquare(beside, square)),
  )

  const recovered: Fighter = { ...fighter, damage: 0 }
  const moveThreat =
    !guarded &&
    units.some(
      (unit) =>
        unit.controller === opponent &&
        unit.card.moveIcon.some((direction) => {
          const reached = squareInDirection(opponent, unit.square, direction)
          return reached !== undefined && sameSquare(reached, square)
        }) &&
        !forecastBattle({ bp: unit.bp, damage: 0, pep: pepOf(unit.card) }, recovered).defenderSurvives,
    )
  if (moveThreat) return SURVIVAL_AGAINST_MOVE

  const playable = areaFor(opponent, square) !== '敵エリア'
  if (playable && countIn(perspective, opponent, '手札') > 0) return SURVIVAL_AGAINST_PLAY

  return SURVIVAL_SAFE
}

/** スマッシュ 1 回ぶんの値打ちを、ユニットの値打ちと同じ尺度にするための重み。 */
const SMASH_WEIGHT = 1
/** 場にいることそのものの値打ち。相手のユニットの行き先をふさぎ、バトルの相手になる。 */
const PRESENCE_WEIGHT = 0.25
/** 信頼を持つユニットを中央のラインに置いた時の上乗せ。左右の 2 スクエアをふさげる。 */
const TRUST_IN_MIDDLE = 300
/** 信頼を持たないユニットを中央のラインに置いた時の差し引き。信頼を持つユニットの場所を残す。 */
const PLAIN_IN_MIDDLE = 50

/** 守っているスクエアへ移動で入って来られる敵を、入って来た時に倒せる場合に見込む割合。 */
const GUARD_RATIO = 0.5

/**
 * 味方エリアのそのスクエアを守ることの値打ち。
 *
 * 次の相手のターンに、相手のユニットがそのスクエアへ移動で入って来られて（総合ルール 第4部 第6章 2-1）、
 * 入って来たらこちらが勝つなら、その敵の値打ちの一部を見込む。味方エリアへ入った敵は、次に＋500 で
 * スマッシュしてくる（同 第3部 第9章 1）ので、守る意味がある。
 */
function guardWorth(perspective: DuelPerspective, me: Player, square: Square, fighter: Fighter): number {
  if (areaFor(me, square) !== '味方エリア') return 0

  const opponent = opponentOf(me)
  const defender: Fighter = { ...fighter, damage: 0 }
  return unitsOf(perspective)
    .filter(
      (unit) =>
        unit.controller === opponent &&
        unit.card.moveIcon.some((direction) => {
          const reached = squareInDirection(opponent, unit.square, direction)
          return reached !== undefined && sameSquare(reached, square)
        }),
    )
    .reduce((sum, unit) => {
      const battle = forecastBattle({ bp: unit.bp, damage: 0, pep: pepOf(unit.card) }, defender)
      return battle.defenderSurvives && !battle.attackerSurvives ? sum + seenWorth(unit) * GUARD_RATIO : sum
    }, 0)
}

/**
 * ユニットがそのスクエアにいることの値打ち。
 *
 * スマッシュで与えるダメージと、場にいることの値打ちを、残れる見込みで割り引く。味方エリアの
 * ユニットはスマッシュできない（総合ルール 第3部 第9章 1）が、入って来る敵を倒せるなら守りの
 * 値打ちがある（`guardWorth`）。BP が高く SP が低いユニットは、敵エリアより味方エリアにいるほうが
 * 値打ちが高くなりうる。
 */
export function positionWorth(
  perspective: DuelPerspective,
  me: Player,
  square: Square,
  unit: {
    readonly card: UnitCard
    readonly bp: number
    readonly sp: number
    readonly fighter: Fighter
    readonly moving?: CardId
  },
): number {
  const survival = survivalAt(perspective, me, square, unit.fighter, unit.moving)
  const smash = smashDamageFrom(me, square, unit.sp) * SMASH_WEIGHT
  const presence = unitWorth(unit.bp, unit.sp) * PRESENCE_WEIGHT
  const middle = square.column === 1 ? (trustOf(unit.card) ? TRUST_IN_MIDDLE : -PLAIN_IN_MIDDLE) : 0

  const guard = guardWorth(perspective, me, square, unit.fighter)

  return survival * (smash + presence + guard) + middle
}

/** バトルスペースのスクエアすべて。 */
export const SQUARES: readonly Square[] = BATTLE_SPACE
