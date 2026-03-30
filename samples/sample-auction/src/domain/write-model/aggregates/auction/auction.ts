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
import {
  applyAuctionCreated,
  applyBidPlaced,
  applyBidRejected,
  applyAuctionClosed,
} from "./apply-handlers";
import { auctionUpcasters } from "./upcasters";

/** Type bundle for the auction aggregate. */
export type AuctionDef = {
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
 * Apply handlers are extracted to standalone functions for consistency.
 */
export const Auction = defineAggregate<AuctionDef>({
  initialState: initialAuctionState,

  commands: {
    CreateAuction: handleCreateAuction,
    PlaceBid: handlePlaceBid,
    CloseAuction: handleCloseAuction,
  },

  apply: {
    AuctionCreated: applyAuctionCreated,
    BidPlaced: applyBidPlaced,
    BidRejected: applyBidRejected,
    AuctionClosed: applyAuctionClosed,
  },

  upcasters: auctionUpcasters,
});
