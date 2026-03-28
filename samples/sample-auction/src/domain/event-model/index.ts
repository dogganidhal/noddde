import { DefineEvents } from "@noddde/core";
import type { AuctionCreatedPayload } from "./auction-created";
import type { BidPlacedPayload } from "./bid-placed";
import type { BidRejectedPayload } from "./bid-rejected";
import type { AuctionClosedPayload } from "./auction-closed";

export type { AuctionCreatedPayload } from "./auction-created";
export type { BidPlacedPayload } from "./bid-placed";
export type { BidRejectedPayload } from "./bid-rejected";
export type { AuctionClosedPayload } from "./auction-closed";

/** Discriminated union of all auction domain events. */
export type AuctionEvent = DefineEvents<{
  AuctionCreated: AuctionCreatedPayload;
  BidPlaced: BidPlacedPayload;
  BidRejected: BidRejectedPayload;
  AuctionClosed: AuctionClosedPayload;
}>;
