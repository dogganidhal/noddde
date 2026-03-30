import type { InferCommandHandler } from "@noddde/core";
import type { RoomDef } from "../room";

/** Handles the MakeRoomAvailable command by emitting a RoomMadeAvailable event. */
export const handleMakeRoomAvailable: InferCommandHandler<
  RoomDef,
  "MakeRoomAvailable"
> = (command, state) => {
  if (state.status === "occupied") {
    throw new Error("Cannot make occupied room available");
  }
  return {
    name: "RoomMadeAvailable",
    payload: { roomId: command.targetAggregateId },
  };
};
