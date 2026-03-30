import type { InferDecideHandler } from "@noddde/core";
import type { AuctionDef } from "../auction";

/**
 * Decides the PlaceBid command. Validates the bid against the auction state
 * and clock, emitting BidPlaced on success or BidRejected on failure.
 *
 * Rejection reasons:
 * - Auction is closed (status === "closed")
 * - Auction has ended (clock.now() > endsAt)
 * - Bid does not exceed the current highest bid (or starting price)
 */
export const decidePlaceBid: InferDecideHandler<AuctionDef, "PlaceBid"> = (
  command,
  state,
  { clock },
) => {
  const { bidderId, amount } = command.payload;
  const now = clock.now();

  if (state.status === "closed") {
    return {
      name: "BidRejected",
      payload: { bidderId, amount, reason: "Auction is closed" },
    };
  }

  if (now > state.endsAt) {
    return {
      name: "BidRejected",
      payload: { bidderId, amount, reason: "Auction has ended" },
    };
  }

  const minimumBid = state.highestBid?.amount ?? state.startingPrice;
  if (amount <= minimumBid) {
    return {
      name: "BidRejected",
      payload: {
        bidderId,
        amount,
        reason: `Bid must exceed ${minimumBid}`,
      },
    };
  }

  return {
    name: "BidPlaced",
    payload: { bidderId, amount, timestamp: now },
  };
};
