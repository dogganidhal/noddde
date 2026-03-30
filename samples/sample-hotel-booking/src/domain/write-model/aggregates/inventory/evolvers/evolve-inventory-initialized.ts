import type { InferEvolveHandler } from "@noddde/core";
import type { InventoryDef } from "../inventory";

export const evolveInventoryInitialized: InferEvolveHandler<
  InventoryDef,
  "InventoryInitialized"
> = (event) => ({
  initialized: true,
  roomCounts: { ...event.roomCounts },
});
