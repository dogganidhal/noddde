import type { CreateRoomPayload } from "../commands/create-room";
import type { RoomState } from "../state";
import type { RoomEvent } from "../../../../event-model";

/** Handles the CreateRoom command by emitting a RoomCreated event. */
export const handleCreateRoom = (
  command: { targetAggregateId: string; payload: CreateRoomPayload },
  state: RoomState,
): RoomEvent => {
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
