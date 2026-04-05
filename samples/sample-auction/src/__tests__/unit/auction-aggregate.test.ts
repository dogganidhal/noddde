import { describe, expect, it } from "vitest";
import { testAggregate } from "@noddde/testing";
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

const clockAt = (date: Date) => ({ clock: { now: () => date } });

// ═════════════════════════════════════════════════════════════════
// CreateAuction
// ═════════════════════════════════════════════════════════════════

describe("Auction aggregate — CreateAuction", () => {
  it("should emit AuctionCreated with the given parameters", async () => {
    const result = await testAggregate(Auction)
      .when({
        name: "CreateAuction",
        targetAggregateId: "auction-1",
        payload: {
          item: "Vintage Watch",
          startingPrice: 100,
          endsAt: futureDate,
        },
      })
      .execute();

    expect(result.events).toEqual([auctionCreated]);
  });

  it("should produce correct initial state after creation", async () => {
    const result = await testAggregate(Auction)
      .when({
        name: "CreateAuction",
        targetAggregateId: "auction-1",
        payload: {
          item: "Vintage Watch",
          startingPrice: 100,
          endsAt: futureDate,
        },
      })
      .execute();

    expect(result.state.item).toBe("Vintage Watch");
    expect(result.state.startingPrice).toBe(100);
    expect(result.state.status).toBe("open");
    expect(result.state.highestBid).toBeNull();
    expect(result.state.bidCount).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════
// PlaceBid
// ═════════════════════════════════════════════════════════════════

describe("Auction aggregate — PlaceBid", () => {
  it("should accept a bid above the starting price", async () => {
    const result = await testAggregate(Auction)
      .given(auctionCreated)
      .when({
        name: "PlaceBid",
        targetAggregateId: "auction-1",
        payload: { bidderId: "alice", amount: 150 },
      })
      .withPorts(clockAt(now))
      .execute();

    expect(result.events[0]!.name).toBe("BidPlaced");
    expect(result.state.highestBid).toEqual({
      bidderId: "alice",
      amount: 150,
    });
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
      .withPorts(clockAt(now))
      .execute();

    expect(result.events[0]!.name).toBe("BidPlaced");
    expect(result.state.highestBid).toEqual({
      bidderId: "bob",
      amount: 200,
    });
    expect(result.state.bidCount).toBe(2);
  });

  it("should reject a bid below the starting price", async () => {
    const result = await testAggregate(Auction)
      .given(auctionCreated)
      .when({
        name: "PlaceBid",
        targetAggregateId: "auction-1",
        payload: { bidderId: "alice", amount: 50 },
      })
      .withPorts(clockAt(now))
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
      .withPorts(clockAt(now))
      .execute();

    expect(result.events[0]!.name).toBe("BidRejected");
    expect((result.events[0]!.payload as any).reason).toContain("200");
  });

  it("should reject a bid after the auction has ended (time-based)", async () => {
    const result = await testAggregate(Auction)
      .given(auctionCreated)
      .when({
        name: "PlaceBid",
        targetAggregateId: "auction-1",
        payload: { bidderId: "alice", amount: 500 },
      })
      .withPorts(clockAt(new Date("2031-01-01T00:00:00Z")))
      .execute();

    expect(result.events[0]!.name).toBe("BidRejected");
    expect((result.events[0]!.payload as any).reason).toBe("Auction has ended");
  });

  it("should reject a bid on a closed auction", async () => {
    const result = await testAggregate(Auction)
      .given(auctionCreated, {
        name: "AuctionClosed",
        payload: { winnerId: null, winningBid: null },
      })
      .when({
        name: "PlaceBid",
        targetAggregateId: "auction-1",
        payload: { bidderId: "alice", amount: 500 },
      })
      .withPorts(clockAt(now))
      .execute();

    expect(result.events[0]!.name).toBe("BidRejected");
    expect((result.events[0]!.payload as any).reason).toBe("Auction is closed");
  });

  it("should not change state on BidRejected", async () => {
    const result = await testAggregate(Auction)
      .given(auctionCreated, bidPlaced("alice", 150))
      .when({
        name: "PlaceBid",
        targetAggregateId: "auction-1",
        payload: { bidderId: "bob", amount: 100 },
      })
      .withPorts(clockAt(now))
      .execute();

    expect(result.events[0]!.name).toBe("BidRejected");
    // State unchanged: highest bid remains alice at 150
    expect(result.state.highestBid).toEqual({
      bidderId: "alice",
      amount: 150,
    });
    expect(result.state.bidCount).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════
// CloseAuction
// ═════════════════════════════════════════════════════════════════

describe("Auction aggregate — CloseAuction", () => {
  it("should close with the winner when bids exist", async () => {
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

  it("should close with no winner when no bids were placed", async () => {
    const result = await testAggregate(Auction)
      .given(auctionCreated)
      .when({ name: "CloseAuction", targetAggregateId: "auction-1" })
      .execute();

    expect(result.events[0]).toEqual({
      name: "AuctionClosed",
      payload: { winnerId: null, winningBid: null },
    });
  });

  it("should close with the correct winner after 3+ bidders", async () => {
    const result = await testAggregate(Auction)
      .given(
        auctionCreated,
        bidPlaced("alice", 150),
        bidPlaced("bob", 250),
        bidPlaced("charlie", 400),
      )
      .when({ name: "CloseAuction", targetAggregateId: "auction-1" })
      .execute();

    expect(result.events[0]).toEqual({
      name: "AuctionClosed",
      payload: { winnerId: "charlie", winningBid: 400 },
    });
    expect(result.state.status).toBe("closed");
    expect(result.state.bidCount).toBe(3);
  });
});
