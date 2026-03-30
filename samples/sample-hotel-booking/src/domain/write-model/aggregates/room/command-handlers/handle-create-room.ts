import type { InferCommandHandler } from "@noddde/core";
import type { RoomDef } from "../room";

/** Handles the CreateRoom command by emitting a RoomCreated event. */
export const handleCreateRoom: InferCommandHandler<RoomDef, "CreateRoom"> = (
  command,
  state,
) => {
  if (state.roomNumber !== null) {
    throw new Error("Room already created");
  }
  return {
    name: "RoomCreated",
    payload: {
      roomId: command.targetAggregateId,
      roomNumber: command.payload.roomNumber,
      type: command.payload.type,
      floor: command.payload.floor,
      pricePerNight: command.payload.pricePerNight,
    },
  };
};
