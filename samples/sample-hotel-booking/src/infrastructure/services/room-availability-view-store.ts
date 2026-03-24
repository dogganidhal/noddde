import { InMemoryViewStore } from "@noddde/engine";
import type {
  RoomAvailabilityView,
  RoomAvailabilityViewStore,
} from "../../domain/read-model/queries";
import type { RoomType } from "../types";

/**
 * In-memory {@link RoomAvailabilityViewStore} for testing.
 * Extends the engine's InMemoryViewStore with the domain-specific
 * `findAvailable` method (filters in memory).
 */
export class InMemoryRoomAvailabilityViewStore
  extends InMemoryViewStore<RoomAvailabilityView>
  implements RoomAvailabilityViewStore
{
  async findAvailable(type?: RoomType): Promise<RoomAvailabilityView[]> {
    return this.find(
      (room) => room.status === "available" && (!type || room.type === type),
    );
  }
}
