import { describe, expect, it } from "vitest";
import { testDomain, stripMetadata } from "@noddde/testing";
import { InMemoryViewStore } from "@noddde/engine";
import { Auction } from "../../domain/write-model/aggregates/auction";
import { AuctionSummaryProjection } from "../../domain/read-model/projections/auction-summary";
import type { AuctionInfrastructure } from "../../infrastructure";
import type { AuctionSummaryView } from "../../domain/read-model/projections/auction-summary";

// ── Shared fixtures ──────────────────────────────────────────────

const futureDate = new Date("2030-01-01T00:00:00Z");
const now = new Date("2025-06-15T12:00:00Z");

function createTestSetup() {
  const viewStore = new InMemoryViewStore<AuctionSummaryView>();
  return {
    viewStore,
    infrastructure: { clock: { now: () => now } } as AuctionInfrastructure,
    projectionViewStores: {
      AuctionSummary: {
        viewStore: () => viewStore,
      },
    },
  };
}

// ═════════════════════════════════════════════════════════════════
// Slice tests — full domain dispatch cycle
// ═════════════════════════════════════════════════════════════════

describe("Auction domain — slice tests", () => {
  it("should run a complete auction lifecycle via dispatch", async () => {
    const setup = createTestSetup();
    const { domain, spy } = await testDomain<AuctionInfrastructure>({
      aggregates: { Auction },
      projections: { AuctionSummary: AuctionSummaryProjection },
      projectionViewStores: setup.projectionViewStores,
      infrastructure: setup.infrastructure,
    });

    await domain.dispatchCommand({
      name: "CreateAuction",
      targetAggregateId: "auction-1",
      payload: {
        item: "Vintage Watch",
        startingPrice: 100,
        endsAt: futureDate,
      },
    });

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

    // Rejected bid (below current highest)
    await domain.dispatchCommand({
      name: "PlaceBid",
      targetAggregateId: "auction-1",
      payload: { bidderId: "charlie", amount: 100 },
    });

    await domain.dispatchCommand({
      name: "CloseAuction",
      targetAggregateId: "auction-1",
    });

    expect(spy.publishedEvents).toHaveLength(5);
    const stripped = stripMetadata(spy.publishedEvents);
    expect(stripped.map((e) => e.name)).toEqual([
      "AuctionCreated",
      "BidPlaced",
      "BidPlaced",
      "BidRejected",
      "AuctionClosed",
    ]);

    // Winner should be bob with 200
    const closeEvent = stripped[4]!;
    expect(closeEvent.payload).toEqual({
      winnerId: "bob",
      winningBid: 200,
    });
  });

  it("should update the projection view after bids", async () => {
    const setup = createTestSetup();
    const { domain } = await testDomain<AuctionInfrastructure>({
      aggregates: { Auction },
      projections: { AuctionSummary: AuctionSummaryProjection },
      projectionViewStores: setup.projectionViewStores,
      infrastructure: setup.infrastructure,
    });

    await domain.dispatchCommand({
      name: "CreateAuction",
      targetAggregateId: "auction-1",
      payload: {
        item: "Vintage Watch",
        startingPrice: 100,
        endsAt: futureDate,
      },
    });

    await domain.dispatchCommand({
      name: "PlaceBid",
      targetAggregateId: "auction-1",
      payload: { bidderId: "alice", amount: 150 },
    });

    await domain.dispatchCommand({
      name: "PlaceBid",
      targetAggregateId: "auction-1",
      payload: { bidderId: "bob", amount: 250 },
    });

    const view = await setup.viewStore.load("auction-1");
    expect(view).toBeDefined();
    expect(view!.currentHighBid).toBe(250);
    expect(view!.currentLeader).toBe("bob");
    expect(view!.bidCount).toBe(2);
  });

  it("should not corrupt the projection on a rejected bid", async () => {
    const setup = createTestSetup();
    const { domain } = await testDomain<AuctionInfrastructure>({
      aggregates: { Auction },
      projections: { AuctionSummary: AuctionSummaryProjection },
      projectionViewStores: setup.projectionViewStores,
      infrastructure: setup.infrastructure,
    });

    await domain.dispatchCommand({
      name: "CreateAuction",
      targetAggregateId: "auction-1",
      payload: {
        item: "Vintage Watch",
        startingPrice: 100,
        endsAt: futureDate,
      },
    });

    await domain.dispatchCommand({
      name: "PlaceBid",
      targetAggregateId: "auction-1",
      payload: { bidderId: "alice", amount: 150 },
    });

    // Rejected bid — below highest
    await domain.dispatchCommand({
      name: "PlaceBid",
      targetAggregateId: "auction-1",
      payload: { bidderId: "bob", amount: 50 },
    });

    const view = await setup.viewStore.load("auction-1");
    // BidRejected is not handled by the projection, so view is unchanged
    expect(view!.currentHighBid).toBe(150);
    expect(view!.currentLeader).toBe("alice");
    expect(view!.bidCount).toBe(1);
  });

  it("should handle multiple concurrent auctions", async () => {
    const setup = createTestSetup();
    const { domain, spy } = await testDomain<AuctionInfrastructure>({
      aggregates: { Auction },
      projections: { AuctionSummary: AuctionSummaryProjection },
      projectionViewStores: setup.projectionViewStores,
      infrastructure: setup.infrastructure,
    });

    // Auction 1
    await domain.dispatchCommand({
      name: "CreateAuction",
      targetAggregateId: "auction-1",
      payload: {
        item: "Guitar",
        startingPrice: 100,
        endsAt: futureDate,
      },
    });

    // Auction 2
    await domain.dispatchCommand({
      name: "CreateAuction",
      targetAggregateId: "auction-2",
      payload: {
        item: "Piano",
        startingPrice: 500,
        endsAt: futureDate,
      },
    });

    await domain.dispatchCommand({
      name: "PlaceBid",
      targetAggregateId: "auction-1",
      payload: { bidderId: "alice", amount: 200 },
    });

    await domain.dispatchCommand({
      name: "PlaceBid",
      targetAggregateId: "auction-2",
      payload: { bidderId: "bob", amount: 600 },
    });

    const view1 = await setup.viewStore.load("auction-1");
    const view2 = await setup.viewStore.load("auction-2");

    expect(view1!.item).toBe("Guitar");
    expect(view1!.currentHighBid).toBe(200);

    expect(view2!.item).toBe("Piano");
    expect(view2!.currentHighBid).toBe(600);

    expect(spy.publishedEvents).toHaveLength(4);
  });

  it("should produce clean events via stripMetadata", async () => {
    const setup = createTestSetup();
    const { domain, spy } = await testDomain<AuctionInfrastructure>({
      aggregates: { Auction },
      infrastructure: setup.infrastructure,
    });

    await domain.dispatchCommand({
      name: "CreateAuction",
      targetAggregateId: "auction-1",
      payload: {
        item: "Vintage Watch",
        startingPrice: 100,
        endsAt: futureDate,
      },
    });

    const stripped = stripMetadata(spy.publishedEvents);
    expect(stripped[0]).toEqual({
      name: "AuctionCreated",
      payload: {
        item: "Vintage Watch",
        startingPrice: 100,
        endsAt: futureDate,
      },
    });
    // Original events should still have metadata
    expect(spy.publishedEvents[0]!.metadata).toBeDefined();
  });
});
