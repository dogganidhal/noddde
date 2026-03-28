import type { PutUnderMaintenancePayload } from "../commands/put-under-maintenance";
import type { RoomState } from "../state";
import type { RoomEvent } from "../../../../event-model";

/** Handles the PutUnderMaintenance command by emitting a RoomUnderMaintenance event. */
export const handlePutUnderMaintenance = (
  command: { targetAggregateId: string; payload: PutUnderMaintenancePayload },
  state: RoomState,
): RoomEvent => {
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
