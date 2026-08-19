import { BATTLE_SPACE, PLAYER_ZONES } from '@revolution/engine'
import type {
  Player,
  PlayerZone,
  WireCardInstance,
  WirePerspective,
  WireUnitFace,
  WireVisibleCard,
} from '@revolution/engine'

/**
 * テストで盤面を組み立てる道具。
 *
 * クライアントが受け取るのは通信に載った盤面（`WirePerspective`）だけで、エンジンを動かして
 * 作ることはできない（ADR-0010）。**手で組み立てるしかない**ので、空の盤面と、そこに 1 枚
 * 置くところをここにまとめている。
 */

/** カードが 1 枚も無い、ひとりぶんのゾーン。 */
function emptyZones(): Readonly<Record<PlayerZone, readonly WireVisibleCard[]>> {
  return Object.fromEntries(
    PLAYER_ZONES.map((zone): readonly [PlayerZone, readonly WireVisibleCard[]] => [zone, []]),
  ) as Record<PlayerZone, readonly WireVisibleCard[]>
}

/** カードが 1 枚も無い盤面。ここに置きたいものだけを足していく。 */
export function emptyBoard(viewer: Player): WirePerspective {
  return {
    viewer,
    squares: BATTLE_SPACE.map(() => []),
    zones: { 先攻: emptyZones(), 後攻: emptyZones() },
    damage: { 先攻: 0, 後攻: 0 },
    turn: {
      number: 1,
      active: '先攻',
      phase: 'メインフェイズ',
      priority: '先攻',
      passedBy: undefined,
      endOfTurnTriggered: false,
      energyPlaced: false,
    },
    bank: [],
    resolveZone: [],
    triggered: [],
    createdAbilities: [],
    playedIntoCenter: [],
    trapConditionsMet: [],
    courageConditionsMet: [],
    battle: undefined,
    smashJudgments: [],
    result: undefined,
    log: [],
  }
}

/** 表記だけを差し替えたユニット。ＢＰとＳＰ以外は使う側で気にしなくてよい。 */
export function unitFace(name: string, values: Partial<WireUnitFace> = {}): WireUnitFace {
  return {
    type: 'ユニット',
    name,
    level: 1,
    colors: ['赤'],
    stars: 0,
    reverseStars: 0,
    attributes: [],
    text: [],
    bp: 1000,
    sp: 1000,
    moveIcon: ['上'],
    ...values,
  }
}

/** 盤面に置く 1 枚。 */
export function instance(id: string, owner: Player, values: Partial<WireCardInstance> = {}): WireCardInstance {
  return {
    id,
    card: unitFace(`テスト・${id}`),
    owner,
    controller: owner,
    orientation: 'リリース',
    damage: 0,
    ...values,
  }
}

/** そのプレイヤーのそのゾーンを差し替える。 */
export function withZone(
  board: WirePerspective,
  owner: Player,
  zone: PlayerZone,
  cards: readonly WireVisibleCard[],
): WirePerspective {
  return {
    ...board,
    zones: { ...board.zones, [owner]: { ...board.zones[owner], [zone]: cards } },
  }
}
