import type { InferApplyHandler } from "@noddde/core";
import type { AuctionDef } from "../auction";

/** Applies the BidRejected event — no state change. */
export const applyBidRejected: InferApplyHandler<AuctionDef, "BidRejected"> = (
  _event,
  state,
) => state;
