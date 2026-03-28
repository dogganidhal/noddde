import { describe, expect, it } from "vitest";
import { createTestMetadataFactory, stripMetadata } from "@noddde/testing";

// ═════════════════════════════════════════════════════════════════
// Metadata utility tests
// ═════════════════════════════════════════════════════════════════

describe("Auction metadata utilities", () => {
  it("should produce sequential eventIds by default", () => {
    const factory = createTestMetadataFactory();

    const meta1 = factory({
      aggregateName: "Auction",
      aggregateId: "auction-1",
      sequenceNumber: 1,
    });
    const meta2 = factory({
      aggregateName: "Auction",
      aggregateId: "auction-1",
      sequenceNumber: 2,
    });

    expect(meta1.eventId).toBe("evt-1");
    expect(meta2.eventId).toBe("evt-2");
  });

  it("should produce a fixed timestamp by default", () => {
    const factory = createTestMetadataFactory();

    const meta = factory({
      aggregateName: "Auction",
      aggregateId: "auction-1",
      sequenceNumber: 1,
    });

    expect(meta.timestamp).toBe("2024-01-01T00:00:00.000Z");
  });

  it("should use a custom correlationId when provided", () => {
    const factory = createTestMetadataFactory({
      correlationId: "my-correlation",
    });

    const meta = factory({
      aggregateName: "Auction",
      aggregateId: "auction-1",
      sequenceNumber: 1,
    });

    expect(meta.correlationId).toBe("my-correlation");
  });

  it("should strip metadata from events leaving only name and payload", () => {
    const events = [
      {
        name: "AuctionCreated" as const,
        payload: { item: "Watch", startingPrice: 100, endsAt: new Date(0) },
        metadata: {
          eventId: "evt-1",
          timestamp: "2024-01-01T00:00:00.000Z",
          correlationId: "c-1",
          causationId: "cmd-1",
          aggregateName: "Auction",
          aggregateId: "auction-1",
          sequenceNumber: 1,
        },
      },
      {
        name: "BidPlaced" as const,
        payload: {
          bidderId: "alice",
          amount: 150,
          timestamp: new Date("2025-06-15"),
        },
        metadata: {
          eventId: "evt-2",
          timestamp: "2024-01-01T00:00:00.000Z",
          correlationId: "c-1",
          causationId: "evt-1",
          aggregateName: "Auction",
          aggregateId: "auction-1",
          sequenceNumber: 2,
        },
      },
    ];

    const stripped = stripMetadata(events);

    expect(stripped).toHaveLength(2);
    expect(stripped[0]).toEqual({
      name: "AuctionCreated",
      payload: { item: "Watch", startingPrice: 100, endsAt: new Date(0) },
    });
    expect(stripped[1]).toEqual({
      name: "BidPlaced",
      payload: {
        bidderId: "alice",
        amount: 150,
        timestamp: new Date("2025-06-15"),
      },
    });
    // Verify metadata is actually gone
    expect((stripped[0] as any).metadata).toBeUndefined();
    expect((stripped[1] as any).metadata).toBeUndefined();
  });
});
