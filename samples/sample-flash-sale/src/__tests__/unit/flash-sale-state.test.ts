import { describe, expect, it } from "vitest";
import { evolveAggregate } from "@noddde/testing";
import { stripMetadata } from "@noddde/testing";
import { FlashSaleItem } from "../../domain/write-model/aggregates/flash-sale-item";
import { initialFlashSaleState } from "../../domain/write-model/aggregates/flash-sale-item/state";

// ---- Shared fixtures ----

const flashSaleCreated = {
  name: "FlashSaleCreated" as const,
  payload: { itemId: "item-1", initialStock: 5 },
};

const itemPurchased = (buyerId: string, quantity = 1) => ({
  name: "ItemPurchased" as const,
  payload: { buyerId, quantity },
});

const purchaseRejected = (buyerId: string) => ({
  name: "PurchaseRejected" as const,
  payload: { buyerId, reason: "out_of_stock" },
});

// ═══════════════════════════════════════════════════════════════════
// State reconstruction via evolveAggregate
// ═══════════════════════════════════════════════════════════════════

describe("FlashSaleItem state reconstruction", () => {
  it("should reconstruct state from a full event history", () => {
    const state = evolveAggregate(FlashSaleItem, [
      flashSaleCreated,
      itemPurchased("alice"),
      itemPurchased("bob"),
      purchaseRejected("charlie"),
      itemPurchased("dave"),
    ]);

    expect(state.stock).toBe(2);
    expect(state.sold).toBe(3);
    expect(state.buyers).toEqual(["alice", "bob", "dave"]);
  });

  it("should return initialState for empty event history", () => {
    const state = evolveAggregate(FlashSaleItem, []);

    expect(state).toEqual(initialFlashSaleState);
    expect(state.stock).toBe(0);
    expect(state.sold).toBe(0);
    expect(state.buyers).toEqual([]);
  });

  it("should ignore PurchaseRejected in stock calculations", () => {
    const state = evolveAggregate(FlashSaleItem, [
      flashSaleCreated,
      itemPurchased("alice"),
      purchaseRejected("bob"),
      purchaseRejected("charlie"),
      itemPurchased("dave"),
    ]);

    // Only 2 purchases succeeded, so stock = 5 - 2 = 3
    expect(state.stock).toBe(3);
    expect(state.sold).toBe(2);
    expect(state.buyers).toEqual(["alice", "dave"]);
  });

  it("should correctly calculate remaining stock after many purchases", () => {
    const events = [
      flashSaleCreated,
      ...Array.from({ length: 5 }, (_, i) => itemPurchased(`buyer-${i}`)),
    ];

    const state = evolveAggregate(FlashSaleItem, events);

    expect(state.stock).toBe(0);
    expect(state.sold).toBe(5);
    expect(state.buyers).toHaveLength(5);
  });

  it("should preserve buyer ordering through reconstruction", () => {
    const state = evolveAggregate(FlashSaleItem, [
      flashSaleCreated,
      itemPurchased("charlie"),
      itemPurchased("alice"),
      itemPurchased("bob"),
    ]);

    expect(state.buyers).toEqual(["charlie", "alice", "bob"]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// stripMetadata in state tests
// ═══════════════════════════════════════════════════════════════════

describe("stripMetadata in state tests", () => {
  it("should allow comparing events without metadata noise", () => {
    // Events with metadata (as they would appear from a real domain)
    const eventsWithMetadata = [
      {
        name: "FlashSaleCreated" as const,
        payload: { itemId: "item-1", initialStock: 3 },
        metadata: {
          eventId: "evt-1",
          timestamp: "2024-01-01T00:00:00.000Z",
          correlationId: "corr-1",
          causationId: "cause-1",
          aggregateName: "FlashSaleItem",
          aggregateId: "item-1",
          sequenceNumber: 1,
        },
      },
      {
        name: "ItemPurchased" as const,
        payload: { buyerId: "alice", quantity: 1 },
        metadata: {
          eventId: "evt-2",
          timestamp: "2024-01-01T00:00:01.000Z",
          correlationId: "corr-2",
          causationId: "cause-2",
          aggregateName: "FlashSaleItem",
          aggregateId: "item-1",
          sequenceNumber: 2,
        },
      },
    ];

    const stripped = stripMetadata(eventsWithMetadata);

    expect(stripped).toEqual([
      {
        name: "FlashSaleCreated",
        payload: { itemId: "item-1", initialStock: 3 },
      },
      { name: "ItemPurchased", payload: { buyerId: "alice", quantity: 1 } },
    ]);

    // Verify metadata is not present on stripped events
    for (const event of stripped) {
      expect(event).not.toHaveProperty("metadata");
    }
  });
});
