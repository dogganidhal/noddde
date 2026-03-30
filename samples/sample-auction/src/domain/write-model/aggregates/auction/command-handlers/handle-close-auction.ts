import type { InferCommandHandler } from "@noddde/core";
import type { AuctionDef } from "../auction";

/**
 * Handles the CloseAuction command. Captures the winner (if any) from
 * the current highest bid and emits AuctionClosed.
 */
export const handleCloseAuction: InferCommandHandler<
  AuctionDef,
  "CloseAuction"
> = (_command, state) => ({
  name: "AuctionClosed",
  payload: {
    winnerId: state.highestBid?.bidderId ?? null,
    winningBid: state.highestBid?.amount ?? null,
  },
});
