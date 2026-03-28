import { defineAggregate } from "@noddde/core";
import type { AuctionEvent } from "../../../event-model";
import type { AuctionInfrastructure } from "../../../../infrastructure";
import type { AuctionCommand } from "./commands";
import { AuctionState, initialAuctionState } from "./state";
import {
  handleCreateAuction,
  handlePlaceBid,
  handleCloseAuction,
} from "./command-handlers";
import { auctionUpcasters } from "./upcasters";

/** Type bundle for the auction aggregate. */
type AuctionDef = {
  state: AuctionState;
  events: AuctionEvent;
  commands: AuctionCommand;
  infrastructure: AuctionInfrastructure;
};

/**
 * Auction aggregate following the Decider pattern.
 *
 * Commands: CreateAuction, PlaceBid, CloseAuction
 * Events: AuctionCreated, BidPlaced, BidRejected, AuctionClosed
 *
 * Command handlers are extracted to standalone functions for testability.
 * Apply handlers are inline — they are tiny pure state transitions.
 */
export const Auction = defineAggregate<AuctionDef>({
  initialState: initialAuctionState,

  commands: {
    CreateAuction: handleCreateAuction,
    PlaceBid: handlePlaceBid,
    CloseAuction: handleCloseAuction,
  },

  apply: {
    AuctionCreated: (event) => ({
      item: event.item,
      startingPrice: event.startingPrice,
      endsAt: event.endsAt,
      status: "open" as const,
      highestBid: null,
      bidCount: 0,
    }),

    BidPlaced: (event, state) => ({
      ...state,
      highestBid: { bidderId: event.bidderId, amount: event.amount },
      bidCount: state.bidCount + 1,
    }),

    BidRejected: (_event, state) => state,

    AuctionClosed: (_event, state) => ({
      ...state,
      status: "closed" as const,
    }),
  },

  upcasters: auctionUpcasters,
});
