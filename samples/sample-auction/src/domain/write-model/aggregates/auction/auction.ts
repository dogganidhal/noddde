import { defineAggregate } from "@noddde/core";
import type { AuctionEvent } from "../../../event-model";
import type { AuctionInfrastructure } from "../../../../infrastructure";
import type { AuctionCommand } from "./commands";
import { AuctionState, initialAuctionState } from "./state";
import {
  decideCreateAuction,
  decidePlaceBid,
  decideCloseAuction,
} from "./deciders";
import {
  evolveAuctionCreated,
  evolveBidPlaced,
  evolveBidRejected,
  evolveAuctionClosed,
} from "./evolvers";
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
 * Deciders are extracted to standalone functions for testability.
 * Evolvers are extracted to standalone functions for consistency.
 */
export const Auction = defineAggregate<AuctionDef>({
  initialState: initialAuctionState,

  decide: {
    CreateAuction: decideCreateAuction,
    PlaceBid: decidePlaceBid,
    CloseAuction: decideCloseAuction,
  },

  evolve: {
    AuctionCreated: evolveAuctionCreated,
    BidPlaced: evolveBidPlaced,
    BidRejected: evolveBidRejected,
    AuctionClosed: evolveAuctionClosed,
  },

  upcasters: auctionUpcasters,
});
