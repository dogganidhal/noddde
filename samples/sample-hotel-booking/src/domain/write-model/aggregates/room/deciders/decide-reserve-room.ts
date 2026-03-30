import type { InferDecideHandler } from "@noddde/core";
import type { RoomDef } from "../room";

/** Decides the ReserveRoom command by emitting a RoomReserved event. */
export const decideReserveRoom: InferDecideHandler<RoomDef, "ReserveRoom"> = (
  command,
  state,
) => {
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
