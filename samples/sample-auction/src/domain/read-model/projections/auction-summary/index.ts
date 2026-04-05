import { defineProjection } from "@noddde/core";
import type { ViewStore } from "@noddde/core";
import type { AuctionEvent } from "../../../event-model";
import type { AuctionPorts } from "../../../../infrastructure";
import type { AuctionSummaryView } from "./auction-summary";
import { initialAuctionSummaryView } from "./auction-summary";
import type { AuctionSummaryQuery } from "./queries";
import { onAuctionCreated } from "./on-entries/on-auction-created";
import { onBidPlaced } from "./on-entries/on-bid-placed";
import { onAuctionClosed } from "./on-entries/on-auction-closed";
import { handleGetAuctionSummary } from "./query-handlers/handle-get-auction-summary";

export type { AuctionSummaryView } from "./auction-summary";
export { initialAuctionSummaryView } from "./auction-summary";
export type { AuctionSummaryQuery } from "./queries";

/** Type bundle for the AuctionSummary projection. */
type AuctionSummaryProjectionDef = {
  events: AuctionEvent;
  queries: AuctionSummaryQuery;
  view: AuctionSummaryView;
  ports: AuctionPorts;
  viewStore: ViewStore<AuctionSummaryView>;
};

/**
 * Projection that builds an auction summary view from domain events.
 *
 * Handles: AuctionCreated, BidPlaced, AuctionClosed.
 * Ignores: BidRejected (no state change needed).
 *
 * Queries: GetAuctionSummary — loads a single auction summary by ID.
 */
export const AuctionSummaryProjection =
  defineProjection<AuctionSummaryProjectionDef>({
    initialView: initialAuctionSummaryView,

    on: {
      AuctionCreated: {
        reduce: onAuctionCreated,
      },

      BidPlaced: {
        reduce: onBidPlaced,
      },

      AuctionClosed: {
        reduce: onAuctionClosed,
      },
    },

    queryHandlers: {
      GetAuctionSummary: handleGetAuctionSummary,
    },
  });
