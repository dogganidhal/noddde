import type { ReserveRoomPayload } from "../commands/reserve-room";
import type { RoomState } from "../state";
import type { RoomEvent } from "../../../../event-model";

/** Handles the ReserveRoom command by emitting a RoomReserved event. */
export const handleReserveRoom = (
  command: { targetAggregateId: string; payload: ReserveRoomPayload },
  state: RoomState,
): RoomEvent => {
  if (state.status !== "available") {
    throw new Error(`Cannot reserve room in ${state.status} status`);
  }
  return {
    name: "RoomReserved",
    payload: {
      roomId: command.targetAggregateId,
      bookingId: command.payload.bookingId,
      guestId: command.payload.guestId,
      checkIn: command.payload.checkIn,
      checkOut: command.payload.checkOut,
    },
  };
};
