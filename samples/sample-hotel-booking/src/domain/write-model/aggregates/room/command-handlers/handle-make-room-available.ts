import type { RoomState } from "../state";
import type { RoomEvent } from "../../../../event-model";

/** Handles the MakeRoomAvailable command by emitting a RoomMadeAvailable event. */
export const handleMakeRoomAvailable = (
  command: { targetAggregateId: string },
  state: RoomState,
): RoomEvent => {
  if (state.status === "occupied") {
    throw new Error("Cannot make occupied room available");
  }
  return {
    name: "RoomMadeAvailable",
    payload: { roomId: command.targetAggregateId },
  };
};
