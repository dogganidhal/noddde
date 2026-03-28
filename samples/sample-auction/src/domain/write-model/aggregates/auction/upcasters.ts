import { defineEventUpcasterChain, defineUpcasters } from "@noddde/core";
import type { AuctionEvent } from "../../../event-model";

/**
 * BidPlaced v1 — the original schema before timestamp was added.
 * Historical events stored with this shape are upcasted to v2 at load time.
 */
interface BidPlacedV1 {
  bidderId: string;
  amount: number;
}

/**
 * BidPlaced v2 — the current schema with a timestamp field.
 * Matches {@link BidPlacedPayload}.
 */
interface BidPlacedV2 {
  bidderId: string;
  amount: number;
  timestamp: Date;
}

/**
 * Upcaster chain for BidPlaced: v1 -> v2.
 * Adds a default timestamp (epoch) for events that pre-date the schema change.
 */
const bidPlacedUpcasters = defineEventUpcasterChain<[BidPlacedV1, BidPlacedV2]>(
  (v1) => ({ ...v1, timestamp: new Date(0) }),
);

/**
 * Upcaster map for all auction events. Only BidPlaced has undergone
 * a schema change; all other events are at version 1.
 */
export const auctionUpcasters = defineUpcasters<AuctionEvent>({
  BidPlaced: bidPlacedUpcasters,
});
