/**
 * サーバの公開 API。
 *
 * サーバが完全な盤面を持つ唯一の権威となる（ADR-0004）。決まりごと（`room.ts`）と、それを
 * WebSocket に載せるところ（`serve.ts`、ADR-0009）に分かれている。前者は受け取ったメッセージ
 * 1 つから次の状態と送るものを返すだけの純粋な関数で、通信の手立ては持たない。
 */
export { checkDecks, setupFromDecks } from './deck.js'
export type { SeatedDeckViolation } from './deck.js'
export { CPU_PREFIX, isCpu } from './cpu.js'
export { emptyRooms, lobbyOf, receive, roomOf } from './room.js'
export type { Delivery, ParticipantId, Room, RoomOutcome, RoomSetup, Rooms } from './room.js'
export { serve } from './serve.js'
export type { RunningServer, ServeOptions } from './serve.js'
