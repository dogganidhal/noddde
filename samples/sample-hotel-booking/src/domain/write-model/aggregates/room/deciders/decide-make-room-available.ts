import type { InferDecideHandler } from "@noddde/core";
import type { RoomDef } from "../room";

/** Decides the MakeRoomAvailable command by emitting a RoomMadeAvailable event. */
export const decideMakeRoomAvailable: InferDecideHandler<
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
