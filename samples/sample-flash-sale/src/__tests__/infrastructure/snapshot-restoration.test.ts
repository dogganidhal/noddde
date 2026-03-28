import { describe, expect, it } from "vitest";
import { evolveAggregate } from "@noddde/testing";
import { FlashSaleItem } from "../../domain/write-model/aggregates/flash-sale-item";
import { initialFlashSaleState } from "../../domain/write-model/aggregates/flash-sale-item/state";

// ── Shared fixtures ──────────────────────────────────────────────

const flashSaleCreated = {
  name: "FlashSaleCreated" as const,
  payload: { itemId: "item-1", initialStock: 10 },
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
// Snapshot verification
//
// Pattern: evolveAggregate(aggregate, allEvents) should produce
// identical state to evolveAggregate(aggregate, eventsAfterSnapshot, snapshotState).
// This validates that any intermediate state can serve as a snapshot
// point without data loss.
// ═══════════════════════════════════════════════════════════════════

describe("FlashSaleItem snapshot verification", () => {
  it("should produce identical state whether replayed from events or loaded from snapshot", () => {
    const allEvents = [
      flashSaleCreated,
      itemPurchased("alice"),
      itemPurchased("bob"),
      purchaseRejected("charlie"),
      itemPurchased("dave"),
      itemPurchased("eve"),
    ];

    // Full replay from the beginning
    const fullReplayState = evolveAggregate(FlashSaleItem, allEvents);

    // Snapshot after first 3 events, then replay remaining
    const snapshotPoint = 3;
    const eventsBeforeSnapshot = allEvents.slice(0, snapshotPoint);
    const eventsAfterSnapshot = allEvents.slice(snapshotPoint);
    const snapshotState = evolveAggregate(FlashSaleItem, eventsBeforeSnapshot);
    const fromSnapshotState = evolveAggregate(
      FlashSaleItem,
      eventsAfterSnapshot,
      snapshotState,
    );

    expect(fromSnapshotState).toEqual(fullReplayState);
  });

  it("should produce correct state from events after a mid-stream snapshot point", () => {
    const allEvents = [
      flashSaleCreated,
      itemPurchased("alice"),
      itemPurchased("bob"),
      itemPurchased("charlie"),
      itemPurchased("dave"),
      purchaseRejected("eve"),
      itemPurchased("frank"),
    ];

    // Take snapshot at different points and verify consistency
    for (let snapshotAt = 1; snapshotAt < allEvents.length; snapshotAt++) {
      const eventsBeforeSnapshot = allEvents.slice(0, snapshotAt);
      const eventsAfterSnapshot = allEvents.slice(snapshotAt);

      const snapshotState = evolveAggregate(
        FlashSaleItem,
        eventsBeforeSnapshot,
      );
      const fromSnapshotState = evolveAggregate(
        FlashSaleItem,
        eventsAfterSnapshot,
        snapshotState,
      );
      const fullReplayState = evolveAggregate(FlashSaleItem, allEvents);

      expect(fromSnapshotState).toEqual(fullReplayState);
    }
  });

  it("should handle snapshot of empty initial state", () => {
    const events = [flashSaleCreated, itemPurchased("alice")];

    // Snapshot at the very beginning (initial state)
    const fromSnapshotState = evolveAggregate(
      FlashSaleItem,
      events,
      initialFlashSaleState,
    );
    const fullReplayState = evolveAggregate(FlashSaleItem, events);

    expect(fromSnapshotState).toEqual(fullReplayState);
    expect(fromSnapshotState.stock).toBe(9);
    expect(fromSnapshotState.sold).toBe(1);
    expect(fromSnapshotState.buyers).toEqual(["alice"]);
  });
});
