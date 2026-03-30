import type { InferEvolveHandler } from "@noddde/core";
import type { AuctionDef } from "../auction";

/** Evolves the BidRejected event — no state change. */
export const evolveBidRejected: InferEvolveHandler<
  AuctionDef,
  "BidRejected"
> = (_event, state) => state;
