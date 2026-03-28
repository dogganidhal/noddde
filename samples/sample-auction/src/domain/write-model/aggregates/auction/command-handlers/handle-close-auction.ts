import type { Command } from "@noddde/core";
import type { AuctionState } from "../state";
import type { AuctionEvent } from "../../../../event-model";

/**
 * Handles the CloseAuction command. Captures the winner (if any) from
 * the current highest bid and emits AuctionClosed.
 */
export const handleCloseAuction = (
  _command: Command & { name: "CloseAuction" },
  state: AuctionState,
): AuctionEvent => ({
  name: "AuctionClosed",
  payload: {
    winnerId: state.highestBid?.bidderId ?? null,
    winningBid: state.highestBid?.amount ?? null,
  },
});
