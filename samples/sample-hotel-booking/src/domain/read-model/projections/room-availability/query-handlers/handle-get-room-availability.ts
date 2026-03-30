import type { InferProjectionQueryHandler } from "@noddde/core";
import type { RoomAvailabilityProjectionDef } from "../room-availability";

/** Handles the GetRoomAvailability query by loading the view from the store. */
export const handleGetRoomAvailability: InferProjectionQueryHandler<
  RoomAvailabilityProjectionDef,
  "GetRoomAvailability"
> = async (query, { views }) => (await views.load(query.roomId)) ?? null;
