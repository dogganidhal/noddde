import type { InferApplyHandler } from "@noddde/core";
import type { AuctionDef } from "../auction";

/** Applies the AuctionClosed event by setting the auction status to closed. */
export const applyAuctionClosed: InferApplyHandler<
  AuctionDef,
  "AuctionClosed"
> = (_event, state) => ({
  ...state,
  status: "closed" as const,
});
