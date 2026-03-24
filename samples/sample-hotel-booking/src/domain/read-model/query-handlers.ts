import type { QueryHandler } from "@noddde/core";
import type { HotelInfrastructure } from "../../infrastructure/types";
import type { SearchQuery } from "./queries";

/**
 * Standalone query handler that searches available rooms.
 * Reads from the RoomAvailability ViewStore (injected via infrastructure).
 */
export const SearchAvailableRoomsHandler: QueryHandler<
  HotelInfrastructure,
  Extract<SearchQuery, { name: "SearchAvailableRooms" }>
> = async (query, infrastructure) =>
  infrastructure.roomAvailabilityViewStore.findAvailable(query.type);
