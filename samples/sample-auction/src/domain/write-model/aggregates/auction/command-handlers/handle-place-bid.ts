import type { Command } from "@noddde/core";
import type { AuctionState } from "../state";
import type { AuctionEvent } from "../../../../event-model";
import type { AuctionInfrastructure } from "../../../../../infrastructure";
import type { PlaceBidPayload } from "../commands/place-bid";

/**
 * Handles the PlaceBid command. Validates the bid against the auction state
 * and clock, emitting BidPlaced on success or BidRejected on failure.
 *
 * Rejection reasons:
 * - Auction is closed (status === "closed")
 * - Auction has ended (clock.now() > endsAt)
 * - Bid does not exceed the current highest bid (or starting price)
 */
export const handlePlaceBid = (
  command: Command & { name: "PlaceBid"; payload: PlaceBidPayload },
  state: AuctionState,
  { clock }: AuctionInfrastructure,
): AuctionEvent => {
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
