/**
 * サーバの公開 API。
 *
 * サーバが完全な盤面を持つ唯一の権威となる（ADR-0004）。ここにあるのは、ルームコードで 2 人を
 * 繋いでデュエルを進める決まりごとだけで、**通信の手立ては持たない**（`room.ts`）。ソケットを
 * 張ってこれを呼ぶところは、クライアント（#14）と合わせて入る。
 */
export { emptyRooms, receive } from './room.js'
export type { Delivery, ParticipantId, Room, RoomOutcome, RoomSetup, Rooms } from './room.js'
