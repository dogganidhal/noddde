import type { InferCommandHandler } from "@noddde/core";
import type { RoomDef } from "../room";

/** Handles the PutUnderMaintenance command by emitting a RoomUnderMaintenance event. */
export const handlePutUnderMaintenance: InferCommandHandler<
  RoomDef,
  "PutUnderMaintenance"
> = (command, state) => {
  if (state.status === "occupied") {
    throw new Error("Cannot put occupied room under maintenance");
  }
  return {
    name: "RoomUnderMaintenance",
    payload: {
      roomId: command.targetAggregateId,
      reason: command.payload.reason,
      estimatedUntil: command.payload.estimatedUntil,
    },
  };
};
