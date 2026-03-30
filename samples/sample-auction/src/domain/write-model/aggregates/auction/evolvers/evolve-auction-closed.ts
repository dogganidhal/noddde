import type { InferEvolveHandler } from "@noddde/core";
import type { AuctionDef } from "../auction";

/** Evolves the AuctionClosed event by setting the auction status to closed. */
export const evolveAuctionClosed: InferEvolveHandler<
  AuctionDef,
  "AuctionClosed"
> = (_event, state) => ({
  ...state,
  status: "closed" as const,
});
