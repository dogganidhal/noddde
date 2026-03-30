import type { InferProjectionQueryHandler } from "@noddde/core";
import type { RoomAvailabilityProjectionDef } from "../room-availability";

/** Handles the ListAvailableRooms query by finding available rooms in the store. */
export const handleListAvailableRooms: InferProjectionQueryHandler<
  RoomAvailabilityProjectionDef,
  "ListAvailableRooms"
> = async (query, { views }) => views.findAvailable(query.type);
