import { describe, expect, it } from "vitest";
import { evolveAggregate } from "@noddde/testing";
import { upcastEvent, upcastEvents } from "@noddde/core";
import { Auction } from "../../domain/write-model/aggregates/auction";
import { auctionUpcasters } from "../../domain/write-model/aggregates/auction/upcasters";

// ── Shared fixtures ──────────────────────────────────────────────

const futureDate = new Date("2030-01-01T00:00:00Z");
const now = new Date("2025-06-15T12:00:00Z");

const auctionCreated = {
  name: "AuctionCreated" as const,
  payload: { item: "Vintage Watch", startingPrice: 100, endsAt: futureDate },
};

/** A v1 BidPlaced event — no timestamp, stored version = 1. */
const bidPlacedV1 = (bidderId: string, amount: number) => ({
  name: "BidPlaced" as const,
  payload: { bidderId, amount },
  metadata: {
    eventId: "e-1",
    timestamp: "2025-01-01",
    correlationId: "c-1",
    causationId: "cmd-1",
    version: 1,
  },
});

/** A v2 BidPlaced event — has timestamp, stored version = 2. */
const bidPlacedV2 = (bidderId: string, amount: number) => ({
  name: "BidPlaced" as const,
  payload: { bidderId, amount, timestamp: now },
  metadata: {
    eventId: "e-2",
    timestamp: "2025-06-15",
    correlationId: "c-1",
    causationId: "cmd-1",
    version: 2,
  },
});

// ═════════════════════════════════════════════════════════════════
// Upcaster tests
// ═════════════════════════════════════════════════════════════════

describe("Auction upcasters", () => {
  it("should upcast BidPlaced v1 to v2 by adding a default timestamp", () => {
    const v1Event = bidPlacedV1("alice", 150);
    const upcasted = upcastEvent(v1Event, auctionUpcasters);

    expect(upcasted.payload).toEqual({
      bidderId: "alice",
      amount: 150,
      timestamp: new Date(0),
    });
  });

  it("should pass through BidPlaced v2 unchanged", () => {
    const v2Event = bidPlacedV2("alice", 150);
    const upcasted = upcastEvent(v2Event, auctionUpcasters);

    // Same reference — no transformation needed
    expect(upcasted).toBe(v2Event);
    expect(upcasted.payload.timestamp).toEqual(now);
  });

  it("should produce correct state from v1 events after upcasting", () => {
    const events = upcastEvents(
      [auctionCreated, bidPlacedV1("alice", 150), bidPlacedV1("bob", 200)],
      auctionUpcasters,
    );

    const state = evolveAggregate(Auction, events as any);

    expect(state.highestBid).toEqual({ bidderId: "bob", amount: 200 });
    expect(state.bidCount).toBe(2);
  });

  it("should produce correct state from mixed v1 and v2 events", () => {
    const events = upcastEvents(
      [
        auctionCreated,
        bidPlacedV1("alice", 150),
        bidPlacedV2("bob", 250),
        bidPlacedV1("charlie", 300),
      ],
      auctionUpcasters,
    );

    const state = evolveAggregate(Auction, events as any);

    expect(state.highestBid).toEqual({ bidderId: "charlie", amount: 300 });
    expect(state.bidCount).toBe(3);
  });
});
