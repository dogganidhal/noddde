import type { QueryHandler } from "@noddde/core";
import type { HotelPorts } from "../../infrastructure/types";
import type { SearchQuery } from "./queries";

/**
 * Standalone query handler that searches available rooms.
 * Reads from the RoomAvailability ViewStore (injected via infrastructure).
 */
export const SearchAvailableRoomsHandler: QueryHandler<
  HotelPorts,
  Extract<SearchQuery, { name: "SearchAvailableRooms" }>
> = async (query, ports) =>
  ports.roomAvailabilityViewStore.findAvailable(query.type);
