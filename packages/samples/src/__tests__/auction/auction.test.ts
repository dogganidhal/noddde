import { describe, expect, it } from "vitest";
import { testAggregate, evolveAggregate, testDomain } from "@noddde/testing";
import { Auction } from "../../auction/aggregate";

// ---- Shared fixtures ----

const futureDate = new Date("2030-01-01T00:00:00Z");
const pastDate = new Date("2020-01-01T00:00:00Z");
const now = new Date("2025-06-15T12:00:00Z");

const auctionCreated = {
  name: "AuctionCreated" as const,
  payload: { item: "Vintage Watch", startingPrice: 100, endsAt: futureDate },
};

const bidPlaced = (bidderId: string, amount: number) => ({
  name: "BidPlaced" as const,
  payload: { bidderId, amount, timestamp: now },
});

const clockAt = (date: Date) => ({ clock: { now: () => date } });

// ═══════════════════════════════════════════════════════════════════
// UNIT TESTS — testAggregate (handler isolation)
// ═══════════════════════════════════════════════════════════════════

describe("Auction aggregate — unit tests", () => {
  describe("CreateAuction", () => {
    it("should create an auction with the given parameters", async () => {
      const result = await testAggregate(Auction)
        .when({
          name: "CreateAuction",
          targetAggregateId: "auction-1",
          payload: { item: "Vintage Watch", startingPrice: 100, endsAt: futureDate },
        })
        .execute();

      expect(result.events).toEqual([auctionCreated]);
      expect(result.state.item).toBe("Vintage Watch");
      expect(result.state.startingPrice).toBe(100);
      expect(result.state.status).toBe("open");
      expect(result.state.highestBid).toBeNull();
      expect(result.state.bidCount).toBe(0);
    });
  });

  describe("PlaceBid", () => {
    it("should accept a bid above starting price", async () => {
      const result = await testAggregate(Auction)
        .given(auctionCreated)
        .when({
          name: "PlaceBid",
          targetAggregateId: "auction-1",
          payload: { bidderId: "alice", amount: 150 },
        })
        .withInfrastructure(clockAt(now))
        .execute();

      expect(result.events[0]!.name).toBe("BidPlaced");
      expect(result.state.highestBid).toEqual({ bidderId: "alice", amount: 150 });
      expect(result.state.bidCount).toBe(1);
    });

    it("should accept a bid above the current highest bid", async () => {
      const result = await testAggregate(Auction)
        .given(auctionCreated, bidPlaced("alice", 150))
        .when({
          name: "PlaceBid",
          targetAggregateId: "auction-1",
          payload: { bidderId: "bob", amount: 200 },
        })
        .withInfrastructure(clockAt(now))
        .execute();

      expect(result.events[0]!.name).toBe("BidPlaced");
      expect(result.state.highestBid).toEqual({ bidderId: "bob", amount: 200 });
      expect(result.state.bidCount).toBe(2);
    });

    it("should reject a bid below starting price", async () => {
      const result = await testAggregate(Auction)
        .given(auctionCreated)
        .when({
          name: "PlaceBid",
          targetAggregateId: "auction-1",
          payload: { bidderId: "alice", amount: 50 },
        })
        .withInfrastructure(clockAt(now))
        .execute();

      expect(result.events[0]!.name).toBe("BidRejected");
      expect(result.events[0]!.payload).toMatchObject({
        bidderId: "alice",
        amount: 50,
        reason: "Bid must exceed 100",
      });
      // BidRejected is a no-op — state unchanged
      expect(result.state.highestBid).toBeNull();
    });

    it("should reject a bid below the current highest bid", async () => {
      const result = await testAggregate(Auction)
        .given(auctionCreated, bidPlaced("alice", 200))
        .when({
          name: "PlaceBid",
          targetAggregateId: "auction-1",
          payload: { bidderId: "bob", amount: 150 },
        })
        .withInfrastructure(clockAt(now))
        .execute();

      expect(result.events[0]!.name).toBe("BidRejected");
      expect(result.events[0]!.payload.reason).toContain("200");
    });

    it("should reject a bid after auction has ended (time-based)", async () => {
      const result = await testAggregate(Auction)
        .given(auctionCreated)
        .when({
          name: "PlaceBid",
          targetAggregateId: "auction-1",
          payload: { bidderId: "alice", amount: 500 },
        })
        .withInfrastructure(clockAt(new Date("2031-01-01T00:00:00Z")))
        .execute();

      expect(result.events[0]!.name).toBe("BidRejected");
      expect(result.events[0]!.payload.reason).toBe("Auction has ended");
    });

    it("should reject a bid on a closed auction", async () => {
      const result = await testAggregate(Auction)
        .given(
          auctionCreated,
          { name: "AuctionClosed", payload: { winnerId: null, winningBid: null } },
        )
        .when({
          name: "PlaceBid",
          targetAggregateId: "auction-1",
          payload: { bidderId: "alice", amount: 500 },
        })
        .withInfrastructure(clockAt(now))
        .execute();

      expect(result.events[0]!.name).toBe("BidRejected");
      expect(result.events[0]!.payload.reason).toBe("Auction is closed");
    });
  });

  describe("CloseAuction", () => {
    it("should close with winner when bids exist", async () => {
      const result = await testAggregate(Auction)
        .given(auctionCreated, bidPlaced("alice", 150), bidPlaced("bob", 250))
        .when({ name: "CloseAuction", targetAggregateId: "auction-1" })
        .execute();

      expect(result.events[0]).toEqual({
        name: "AuctionClosed",
        payload: { winnerId: "bob", winningBid: 250 },
      });
      expect(result.state.status).toBe("closed");
    });

    it("should close with no winner when no bids", async () => {
      const result = await testAggregate(Auction)
        .given(auctionCreated)
        .when({ name: "CloseAuction", targetAggregateId: "auction-1" })
        .execute();

      expect(result.events[0]).toEqual({
        name: "AuctionClosed",
        payload: { winnerId: null, winningBid: null },
      });
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// evolveAggregate — state reconstruction
// ═══════════════════════════════════════════════════════════════════

describe("Auction — evolveAggregate", () => {
  it("should reconstruct state from a full event history", () => {
    const state = evolveAggregate(Auction, [
      auctionCreated,
      bidPlaced("alice", 150),
      { name: "BidRejected", payload: { bidderId: "bob", amount: 100, reason: "Too low" } },
      bidPlaced("charlie", 300),
      { name: "AuctionClosed", payload: { winnerId: "charlie", winningBid: 300 } },
    ]);

    expect(state.item).toBe("Vintage Watch");
    expect(state.status).toBe("closed");
    expect(state.highestBid).toEqual({ bidderId: "charlie", amount: 300 });
    expect(state.bidCount).toBe(2); // BidRejected doesn't increment
  });
});

// ═══════════════════════════════════════════════════════════════════
// SLICE TEST — testDomain (full dispatch cycle)
// ═══════════════════════════════════════════════════════════════════

describe("Auction domain — slice test", () => {
  it("should run a complete auction lifecycle", async () => {
    const { domain, spy } = await testDomain({
      aggregates: { Auction },
      infrastructure: { clock: { now: () => now } },
    });

    // Create auction
    await domain.dispatchCommand({
      name: "CreateAuction",
      targetAggregateId: "auction-1",
      payload: { item: "Vintage Watch", startingPrice: 100, endsAt: futureDate },
    });

    // Place valid bids
    await domain.dispatchCommand({
      name: "PlaceBid",
      targetAggregateId: "auction-1",
      payload: { bidderId: "alice", amount: 150 },
    });

    await domain.dispatchCommand({
      name: "PlaceBid",
      targetAggregateId: "auction-1",
      payload: { bidderId: "bob", amount: 200 },
    });

    // Place invalid bid (below highest)
    await domain.dispatchCommand({
      name: "PlaceBid",
      targetAggregateId: "auction-1",
      payload: { bidderId: "charlie", amount: 100 },
    });

    // Close auction
    await domain.dispatchCommand({
      name: "CloseAuction",
      targetAggregateId: "auction-1",
    });

    expect(spy.publishedEvents).toHaveLength(5);
    expect(spy.publishedEvents.map((e) => e.name)).toEqual([
      "AuctionCreated",
      "BidPlaced",
      "BidPlaced",
      "BidRejected",
      "AuctionClosed",
    ]);

    // Winner should be bob with 200
    const closeEvent = spy.publishedEvents[4]!;
    expect(closeEvent.payload).toEqual({ winnerId: "bob", winningBid: 200 });
  });
});
