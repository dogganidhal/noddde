import type { DefineCommands } from "@noddde/core";
import type { InitializeInventoryPayload } from "./initialize-inventory";
import type { UpdateRoomTypeCountPayload } from "./update-room-type-count";
import type { DecrementAvailabilityPayload } from "./decrement-availability";
import type { IncrementAvailabilityPayload } from "./increment-availability";

export type { InitializeInventoryPayload } from "./initialize-inventory";
export type { UpdateRoomTypeCountPayload } from "./update-room-type-count";
export type { DecrementAvailabilityPayload } from "./decrement-availability";
export type { IncrementAvailabilityPayload } from "./increment-availability";

/** Discriminated union of all inventory commands. */
export type InventoryCommand = DefineCommands<{
  InitializeInventory: InitializeInventoryPayload;
  UpdateRoomTypeCount: UpdateRoomTypeCountPayload;
  DecrementAvailability: DecrementAvailabilityPayload;
  IncrementAvailability: IncrementAvailabilityPayload;
}>;
