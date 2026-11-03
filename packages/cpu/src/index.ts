/**
 * 自動で打つ相手（CPU）と、CPU 同士の勝率を測る仕組み（ADR-0060）。
 *
 * engine にだけ依存する。対戦サーバのほか、探索をワーカーへ出す時や画面で動かす時にも、
 * そのまま読めるようにするためである。
 */
export { actionViewOf, choiceViewOf, ownDeckOf } from './player.js'
export type { ActionView, ChoiceView, CpuPlayer } from './player.js'
export { ENERGY_TARGET, randomCandidates, randomCpu } from './random-cpu.js'
export { energyTargetOf, scoredCpu } from './scored-cpu.js'
export { playCpuDuel } from './duel.js'
export type { CpuDuelOptions, CpuDuelResult, CpuDuelSeat } from './duel.js'
export { compareCpus, verdictOf, wilsonInterval } from './compare.js'
export type { ComparisonOptions, ComparisonResult, DeckPairing, Tally, Verdict } from './compare.js'
export { CPU_PLAYERS } from './players.js'
