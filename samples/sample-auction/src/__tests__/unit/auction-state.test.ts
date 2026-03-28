import { describe, expect, it } from "vitest";
import { evolveAggregate } from "@noddde/testing";
import { Auction } from "../../domain/write-model/aggregates/auction";

// ── Shared fixtures ──────────────────────────────────────────────

const futureDate = new Date("2030-01-01T00:00:00Z");
const now = new Date("2025-06-15T12:00:00Z");

const auctionCreated = {
  name: "AuctionCreated" as const,
  payload: { item: "Vintage Watch", startingPrice: 100, endsAt: futureDate },
};

const bidPlaced = (bidderId: string, amount: number) => ({
  name: "BidPlaced" as const,
  payload: { bidderId, amount, timestamp: now },
});

// ═════════════════════════════════════════════════════════════════
// State reconstruction via evolveAggregate
// ═════════════════════════════════════════════════════════════════

describe("Auction state — evolveAggregate", () => {
  it("should reconstruct state from a full event history", () => {
    const state = evolveAggregate(Auction, [
      auctionCreated,
      bidPlaced("alice", 150),
      {
        name: "BidRejected",
        payload: { bidderId: "bob", amount: 100, reason: "Too low" },
      },
      bidPlaced("charlie", 300),
      {
        name: "AuctionClosed",
        payload: { winnerId: "charlie", winningBid: 300 },
      },
    ]);

    expect(state.item).toBe("Vintage Watch");
    expect(state.status).toBe("closed");
    expect(state.highestBid).toEqual({ bidderId: "charlie", amount: 300 });
    expect(state.bidCount).toBe(2);
  });

  it("should return initialState for an empty event history", () => {
    const state = evolveAggregate(Auction, []);

    expect(state).toEqual(Auction.initialState);
  });

  it("should count only BidPlaced events, ignoring BidRejected", () => {
    const state = evolveAggregate(Auction, [
      auctionCreated,
      bidPlaced("alice", 150),
      {
        name: "BidRejected",
        payload: { bidderId: "bob", amount: 100, reason: "Too low" },
      },
      {
        name: "BidRejected",
        payload: { bidderId: "charlie", amount: 120, reason: "Too low" },
      },
      bidPlaced("dave", 200),
    ]);

    expect(state.bidCount).toBe(2);
  });

  it("should track the latest highest bidder across multiple bids", () => {
    const state = evolveAggregate(Auction, [
      auctionCreated,
      bidPlaced("alice", 150),
      bidPlaced("bob", 200),
      bidPlaced("alice", 300),
      bidPlaced("charlie", 500),
    ]);

    expect(state.highestBid).toEqual({ bidderId: "charlie", amount: 500 });
    expect(state.bidCount).toBe(4);
  });

  it("should reflect closed status after AuctionClosed", () => {
    const state = evolveAggregate(Auction, [
      auctionCreated,
      bidPlaced("alice", 150),
      {
        name: "AuctionClosed",
        payload: { winnerId: "alice", winningBid: 150 },
      },
    ]);

    expect(state.status).toBe("closed");
    expect(state.highestBid).toEqual({ bidderId: "alice", amount: 150 });
  });
});
