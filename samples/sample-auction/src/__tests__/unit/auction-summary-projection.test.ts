import { describe, expect, it } from "vitest";
import { testProjection } from "@noddde/testing";
import {
  AuctionSummaryProjection,
  initialAuctionSummaryView,
} from "../../domain/read-model/projections/auction-summary";

// ── Shared fixtures ──────────────────────────────────────────────

const now = new Date("2025-06-15T12:00:00Z");
const futureDate = new Date("2030-01-01T00:00:00Z");

const auctionCreated = {
  name: "AuctionCreated" as const,
  payload: { item: "Vintage Watch", startingPrice: 100, endsAt: futureDate },
};

const bidPlaced = (bidderId: string, amount: number) => ({
  name: "BidPlaced" as const,
  payload: { bidderId, amount, timestamp: now },
});

const auctionClosed = (winnerId: string | null, winningBid: number | null) => ({
  name: "AuctionClosed" as const,
  payload: { winnerId, winningBid },
});

const baseView = { ...initialAuctionSummaryView, auctionId: "auction-1" };

// ═════════════════════════════════════════════════════════════════
// AuctionSummary projection tests
// ═════════════════════════════════════════════════════════════════

describe("AuctionSummary projection", () => {
  it("should initialize view from AuctionCreated", async () => {
    const result = await testProjection(AuctionSummaryProjection)
      .initialView(baseView)
      .given(auctionCreated)
      .execute();

    expect(result.view).toMatchObject({
      auctionId: "auction-1",
      item: "Vintage Watch",
      currentHighBid: null,
      currentLeader: null,
      bidCount: 0,
      status: "open",
    });
  });

  it("should update currentHighBid and currentLeader on BidPlaced", async () => {
    const result = await testProjection(AuctionSummaryProjection)
      .initialView(baseView)
      .given(auctionCreated, bidPlaced("alice", 150))
      .execute();

    expect(result.view.currentHighBid).toBe(150);
    expect(result.view.currentLeader).toBe("alice");
    expect(result.view.bidCount).toBe(1);
  });

  it("should increment bidCount on each BidPlaced", async () => {
    const result = await testProjection(AuctionSummaryProjection)
      .initialView(baseView)
      .given(
        auctionCreated,
        bidPlaced("alice", 150),
        bidPlaced("bob", 200),
        bidPlaced("charlie", 300),
      )
      .execute();

    expect(result.view.bidCount).toBe(3);
    expect(result.view.currentHighBid).toBe(300);
    expect(result.view.currentLeader).toBe("charlie");
  });

  it("should set status to closed on AuctionClosed", async () => {
    const result = await testProjection(AuctionSummaryProjection)
      .initialView(baseView)
      .given(
        auctionCreated,
        bidPlaced("alice", 150),
        auctionClosed("alice", 150),
      )
      .execute();

    expect(result.view.status).toBe("closed");
  });

  it("should reflect full lifecycle in view", async () => {
    const result = await testProjection(AuctionSummaryProjection)
      .initialView(baseView)
      .given(
        auctionCreated,
        bidPlaced("alice", 150),
        bidPlaced("bob", 250),
        bidPlaced("charlie", 400),
        auctionClosed("charlie", 400),
      )
      .execute();

    expect(result.view).toEqual({
      auctionId: "auction-1",
      item: "Vintage Watch",
      currentHighBid: 400,
      currentLeader: "charlie",
      bidCount: 3,
      status: "closed",
    });
  });

  it("should show no leader on close with no bids", async () => {
    const result = await testProjection(AuctionSummaryProjection)
      .initialView(baseView)
      .given(auctionCreated, auctionClosed(null, null))
      .execute();

    expect(result.view.currentHighBid).toBeNull();
    expect(result.view.currentLeader).toBeNull();
    expect(result.view.bidCount).toBe(0);
    expect(result.view.status).toBe("closed");
  });
});
