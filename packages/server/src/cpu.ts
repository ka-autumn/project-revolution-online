import { findAnywhere, legalActions, nextInt } from '@revolution/engine'
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
 * **合法手そのものを狭めるのではない。** 狭めるのはここで選ぶ候補だけで、`legalActions` は
 * 変えない。ファザは合法手すべてを引き続き引く（ADR-0005）——選ばせない手を作ると、その手が
 * 通る道筋がテストされなくなる。
 */
function pointless(state: DuelState, action: LegalAction): boolean {
  if (action.kind !== 'トラップとしてプレイする') return false

  return findAnywhere(state, action.card)?.card.type !== 'トラップ'
}

/**
 * CPU が選ぶ余地のある手（#175）。合法手から、選ばない手（`pointless`）を除いたもの。
 *
 * `優先権を放棄する` は終わっていない限り必ず合法手にある（`legal-action.ts`）ので、除いても
 * 空にはならない。
 */
export function cpuCandidates(state: DuelState): readonly LegalAction[] {
  return legalActions(state).filter((action) => !pointless(state, action))
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
