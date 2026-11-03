import { BATTLE_SPACE, areaOf, indexOfSquare, nextInt } from '@revolution/engine'
import type { CardId, CardInstance, DuelPerspective, LegalAction } from '@revolution/engine'
import type { ActionView, CpuPlayer } from './player.js'

/**
 * 合法手からランダムに選ぶ CPU（#175）。
 *
 * 元はルールエンジンの検証用のランダム自己対戦（ADR-0005）のために作成したものを、仮の対戦相手に
 * 流用したもの。強くはない。1 人でも最後まで打てることだけを満たす。ADR-0060 の段階 1 では、
 * 選び方を変更せずに、射影した盤面だけで選ぶようにした。後の段階の CPU の強さを測る時の、比べる
 * 相手になる。
 */

/**
 * 射影した盤面で見えているカード。見えていなければ `undefined`。
 *
 * CPU が自分で引けるのは、見えているカードだけである。裏向きのゾーンにある相手のカードは、
 * 射影の時点で `見えていない` になっている（`perspective.ts` の `seesFace`）。
 */
function findVisible(perspective: DuelPerspective, id: CardId): CardInstance | undefined {
  const onSquares = perspective.squares.flat().find((card) => card.id === id)
  if (onSquares !== undefined) return onSquares

  for (const zones of Object.values(perspective.zones)) {
    for (const cards of Object.values(zones)) {
      for (const card of cards) {
        if (card.kind === '見えている' && card.instance.id === id) return card.instance
      }
    }
  }
  return perspective.resolveZone.find((card) => card.id === id)
}

/**
 * CPU が選ばない手か。
 *
 * トラップ以外のカードをトラップゾーンに置かない。手札のカードはトラップでなくても
 * トラップとしてプレイできる（総合ルール 第2部 第20章 3-1）が、発動条件を持たないので、
 * 置いてしまうと二度と使えない（同 3-6、`play.ts` の `activateTrap`）。実際の対戦でもまず
 * 行われない手なので、対戦相手としては選ばせない。
 *
 * 伏せてあるトラップを自分から捨てない（同 3-12）。捨てるのは、置き直すために場所を空ける
 * 手である（トラップゾーンに置けるのは 1 枚だけ、同 3-1）。いつ空けるべきかを見られない以上、
 * ランダムに選ばせると、伏せたそばから捨てるだけになる。そのかわり、一度伏せたトラップは
 * 発動するまで置き替えられない。
 *
 * 合法手そのものを狭めるのではない。狭めるのはここで選ぶ候補だけで、`legalActions` は
 * 変更しない。検証用のランダム自己対戦は合法手すべてを引き続き引く（ADR-0005）。
 */
function pointless(perspective: DuelPerspective, action: LegalAction): boolean {
  if (action.kind === 'トラップを廃棄する') return true
  if (action.kind !== 'トラップとしてプレイする') return false

  // トラップとしてプレイできるのは自分の手札のカードなので、自分には見えている。
  return findVisible(perspective, action.card)?.card.type !== 'トラップ'
}

/**
 * その手が、味方エリアを空けたまま中央エリアへ登場させる手か（#175）。
 *
 * 相手がユニットを出せるのは自分の味方エリアと中央エリアだけである（敵エリアには出せない、
 * 総合ルール 第2部 第20章 1-3）。空いている中央へ出したユニットは、そのまま相手の登場先に
 * なる。味方エリアが空いているなら、まずそちらへ出す。
 *
 * 敵ユニットがいる中央のスクエアへ出す手は残す。そこへ出すのは攻め込む手であって、
 * 空いた中央へ置きに行く手ではない。
 */
function entersEmptyCenter(perspective: DuelPerspective, action: LegalAction): boolean {
  if (action.kind !== 'カードをプレイする') return false

  const square = action.declaration.square
  if (square === undefined) return false

  // 登場させられるのはアクティブプレイヤーだけである（`play.ts` の `playCard`）。
  const player = perspective.turn.active
  const cardsOn = (each: typeof square): readonly CardInstance[] => perspective.squares[indexOfSquare(each)] ?? []
  if (areaOf(player, square) !== '中央エリア') return false
  if (cardsOn(square).some((each) => each.controller !== player)) return false

  return BATTLE_SPACE.some((each) => areaOf(player, each) === '味方エリア' && cardsOn(each).length === 0)
}

/**
 * ここに届くまでは、置けるなら必ずエネルギーを置く枚数。
 *
 * カードをプレイできるかは、エネルギーゾーンの枚数で決まる（レベルを満たす、総合ルール 第1部
 * 第2章 3-1）。置けるのはエネルギーフェイズに 1 枚だけ（同 第3部 第7章 1）なので、置くかどうかを
 * ランダムに任せると置き損ねがそのまま積み上がり、いつまでも何も出せない相手になる。
 *
 * ここまで貯まれば大抵のカードはレベルを満たせるので、そこから先は貯めることを優先しない。
 */
export const ENERGY_TARGET = 7

/**
 * ランダムな CPU が選ぶ余地のある手（#175）。行える手から、選ばない手を除いたもの。
 *
 * 除くのは 2 つ——選んでも意味の無い手（`pointless`）と、置き先がまずい手
 * （`entersEmptyCenter`）である。どちらも合法手そのものは変更しない（ADR-0005）。
 *
 * エネルギーが足りていない間は、置く手だけを候補にする。どの札を置くかはランダムのままで
 * ある。置けるのは自分のエネルギーフェイズだけ（総合ルール 第3部 第7章 1）なので、ほかの場面
 * では何も狭まらない。
 *
 * `優先権を放棄する` は終わっていない限り必ず合法手にある（`legal-action.ts`）ので、除いても
 * 空にはならない。
 */
export function randomCandidates(view: ActionView): readonly LegalAction[] {
  const { perspective } = view
  const candidates = view.actions.filter(
    (action) => !pointless(perspective, action) && !entersEmptyCenter(perspective, action),
  )

  const placing = candidates.filter((action) => action.kind === 'エネルギーを置く')
  if (placing.length === 0) return candidates

  // 置けるのはアクティブプレイヤーだけ（同）なので、枚数を取得するのもその人のゾーンである。
  // エネルギーゾーンは公開情報なので、枚数は射影した盤面からも取得できる（同 第2部 第23章 1-1）。
  const placed = perspective.zones[perspective.turn.active]['エネルギーゾーン'].length

  return placed < ENERGY_TARGET ? placing : candidates
}

/** 合法手からランダムに選ぶ CPU。 */
export const randomCpu: CpuPlayer = {
  pickAction: (view, random) => {
    const candidates = randomCandidates(view)
    const picked = nextInt(random, candidates.length)
    const action = candidates[picked.value]

    return action === undefined ? undefined : { action, random: picked.random }
  },

  /**
   * 選ばないことが認められている場面では、それも 1 つの選択肢として同じ確率で引く
   * （`self-play.ts` の `randomChooser` と同じ）。答えは番号で返す（ADR-0008）ので、人が
   * 答えるのと同じ道筋を通る。
   */
  answer: ({ choice }, random) => {
    const width = choice.mayDecline ? choice.candidates.length + 1 : choice.candidates.length
    const picked = nextInt(random, width)

    return {
      answer: picked.value < choice.candidates.length ? picked.value : '選ばない',
      random: picked.random,
    }
  },
}
