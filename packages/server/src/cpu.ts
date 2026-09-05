import { BATTLE_SPACE, areaOf, cardsIn, cardsOn, findAnywhere, legalActions, nextInt } from '@revolution/engine'
import type { ChoiceAnswer, DuelState, LegalAction, Random, RoomCode, WireChoice } from '@revolution/engine'
import type { ParticipantId } from './room.js'

/**
 * 席に座って自動で打つ相手（#175）。
 *
 * **合法手からランダムに選ぶだけである**（ADR-0005）。元はルールエンジンのファザとして作った
 * ものを、そのまま仮の対戦相手に流用している。強くはない。1 人でも最後まで打てることだけを
 * 満たす。
 *
 * **繋がっていない参加者である。** 部屋から見れば人と同じ 1 人（`ParticipantId`）だが、
 * ソケットを持たない。送られたものは届く先が無いので捨てられる（`room.ts` の `driveCpu`）。
 *
 * 決まりごとと同じく、ここも純粋な関数だけを持つ（`room.ts`）。乱数は値として受け取り、
 * 使った分だけ進めて返す（`random.ts`）。
 */

/**
 * CPU の名乗りの頭に付ける印。
 *
 * **人がこれを名乗って繋ぐのは断る**（`serve.ts`）。名乗りは認証ではなく、知っている人が
 * その席に座れる合言葉である（ADR-0009）ため、名乗りの形が読めれば CPU の席に座れてしまう。
 */
export const CPU_PREFIX = 'cpu:'

/** その部屋に座る CPU の名乗り。部屋ごとに違う（同じ名乗りは 1 つの席しか持てない）。 */
export function cpuParticipantOf(code: RoomCode): ParticipantId {
  return `${CPU_PREFIX}${code}`
}

/** その名乗りが CPU のものか。 */
export function isCpu(participant: ParticipantId): boolean {
  return participant.startsWith(CPU_PREFIX)
}

/**
 * CPU が選ばない手か。
 *
 * **トラップ以外のカードをトラップゾーンに置かない。** 手札のカードはトラップでなくても
 * トラップとしてプレイできる（総合ルール 第2部 第20章 3-1）が、発動条件を持たないので、
 * 置いてしまうと二度と使えない（同 3-6、`play.ts` の `activateTrap`）。実際の対戦でもまず
 * 行われない手なので、対戦相手としては選ばせない。
 *
 * **伏せてあるトラップを自分から捨てない**（同 3-12）。捨てるのは、置き直すために場所を空ける
 * 手である（トラップゾーンに置けるのは 1 枚だけ、同 3-1）。いつ空けるべきかを見られない以上、
 * ランダムに選ばせると、伏せたそばから捨てるだけになる。**そのかわり、一度伏せたトラップは
 * 発動するまで置き替えられない。** 使いどころを判断できるようになったら、そこで解く。
 *
 * **合法手そのものを狭めるのではない。** 狭めるのはここで選ぶ候補だけで、`legalActions` は
 * 変えない。ファザは合法手すべてを引き続き引く（ADR-0005）——選ばせない手を作ると、その手が
 * 通る道筋がテストされなくなる。
 */
function pointless(state: DuelState, action: LegalAction): boolean {
  if (action.kind === 'トラップを廃棄する') return true
  if (action.kind !== 'トラップとしてプレイする') return false

  return findAnywhere(state, action.card)?.card.type !== 'トラップ'
}

/**
 * その手が、味方エリアを空けたまま中央エリアへ登場させる手か（#175）。
 *
 * **相手がユニットを出せるのは自分の味方エリアと中央エリアだけである**（敵エリアには出せない、
 * 総合ルール 第2部 第20章 1-3）。空いている中央へ出したユニットは、そのまま相手の登場先に
 * なる。味方エリアが空いているなら、まずそちらへ出す。
 *
 * **敵ユニットがいる中央のスクエアへ出す手は残す。** そこへ出すのは攻め込む手であって、
 * 空いた中央へ置きに行く手ではない。
 */
function entersEmptyCenter(state: DuelState, action: LegalAction): boolean {
  if (action.kind !== 'カードをプレイする') return false

  const square = action.declaration.square
  if (square === undefined) return false

  // 登場させられるのはアクティブプレイヤーだけである（`play.ts` の `playCard`）。
  const player = state.turn.active
  if (areaOf(player, square) !== '中央エリア') return false
  if (cardsOn(state, square).some((each) => each.controller !== player)) return false

  return BATTLE_SPACE.some((each) => areaOf(player, each) === '味方エリア' && cardsOn(state, each).length === 0)
}

/**
 * ここに届くまでは、置けるなら必ずエネルギーを置く枚数。
 *
 * カードをプレイできるかは、エネルギーゾーンの枚数で決まる（レベルを満たす、総合ルール 第1部
 * 第2章 3-1）。**置けるのはエネルギーフェイズに 1 枚だけ**（同 第3部 第7章 1）なので、置くかどうかを
 * ランダムに任せると置き損ねがそのまま積み上がり、いつまでも何も出せない相手になる。
 *
 * ここまで貯まれば大抵のカードはレベルを満たせるので、そこから先は貯めることを優先しない。
 */
const ENERGY_TARGET = 7

/**
 * CPU が選ぶ余地のある手（#175）。合法手から、選ばない手を除いたもの。
 *
 * 除くのは 2 つ——**選んでも意味の無い手**（`pointless`）と、**置き先がまずい手**
 * （`entersEmptyCenter`）である。どちらも合法手そのものは変えない（ADR-0005）。
 *
 * **エネルギーが足りていない間は、置く手だけを候補にする。** どの札を置くかはランダムのままで
 * ある。置けるのは自分のエネルギーフェイズだけ（総合ルール 第3部 第7章 1）なので、ほかの場面
 * では何も狭まらない。
 *
 * `優先権を放棄する` は終わっていない限り必ず合法手にある（`legal-action.ts`）ので、除いても
 * 空にはならない。
 */
export function cpuCandidates(state: DuelState): readonly LegalAction[] {
  const candidates = legalActions(state).filter(
    (action) => !pointless(state, action) && !entersEmptyCenter(state, action),
  )

  const placing = candidates.filter((action) => action.kind === 'エネルギーを置く')
  if (placing.length === 0) return candidates

  // 置けるのはアクティブプレイヤーだけ（同）なので、数えるのもその人のゾーンである。
  const placed = cardsIn(state, state.turn.active, 'エネルギーゾーン').length

  return placed < ENERGY_TARGET ? placing : candidates
}

/** CPU が次に行う手。行える手が無ければ `undefined`。 */
export function pickCpuAction(
  state: DuelState,
  random: Random,
): { readonly action: LegalAction; readonly random: Random } | undefined {
  const candidates = cpuCandidates(state)
  const picked = nextInt(random, candidates.length)
  const action = candidates[picked.value]

  return action === undefined ? undefined : { action, random: picked.random }
}

/**
 * CPU が選択に答える 1 つ。
 *
 * 選ばないことが認められている場面では、それも 1 つの選択肢として同じ確率で引く
 * （`self-play.ts` の `randomChooser` と同じ）。答えは番号で返す（ADR-0008）ので、人が
 * 答えるのと同じ道筋を通る。
 */
export function pickCpuAnswer(
  choice: WireChoice,
  random: Random,
): { readonly answer: ChoiceAnswer; readonly random: Random } {
  const width = choice.mayDecline ? choice.candidates.length + 1 : choice.candidates.length
  const picked = nextInt(random, width)

  return {
    answer: picked.value < choice.candidates.length ? picked.value : '選ばない',
    random: picked.random,
  }
}
