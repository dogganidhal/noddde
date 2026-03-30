import type { InferApplyHandler } from "@noddde/core";
import type { InventoryDef } from "../inventory";

export const applyInventoryInitialized: InferApplyHandler<
  InventoryDef,
  "InventoryInitialized"
> = (event) => ({
  initialized: true,
  roomCounts: { ...event.roomCounts },
});
