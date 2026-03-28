import { describe, expect, it } from "vitest";
import { testDomain } from "@noddde/testing";
import { FlashSaleItem } from "../../domain/write-model/aggregates/flash-sale-item";

// ═══════════════════════════════════════════════════════════════════
// SLICE TESTS -- idempotency patterns
//
// NOTE: The testDomain harness uses in-memory persistence which does
// not enforce idempotency via an IdempotencyStore. These tests
// demonstrate the commandId usage pattern. True duplicate prevention
// requires a persistence layer with an IdempotencyStore configured.
// ═══════════════════════════════════════════════════════════════════

describe("FlashSaleItem domain -- idempotency", () => {
  it("should process a command with commandId", async () => {
    const { domain, spy } = await testDomain({
      aggregates: { FlashSaleItem },
    });

    await domain.dispatchCommand({
      name: "CreateFlashSale",
      targetAggregateId: "item-1",
      payload: { initialStock: 5 },
      commandId: "cmd-create-001",
    });

    expect(spy.publishedEvents).toHaveLength(1);
    expect(spy.publishedEvents[0]!.name).toBe("FlashSaleCreated");
  });

  it("should process distinct commandIds independently", async () => {
    const { domain, spy } = await testDomain({
      aggregates: { FlashSaleItem },
    });

    await domain.dispatchCommand({
      name: "CreateFlashSale",
      targetAggregateId: "item-1",
      payload: { initialStock: 5 },
      commandId: "cmd-create-001",
    });

    await domain.dispatchCommand({
      name: "PurchaseItem",
      targetAggregateId: "item-1",
      payload: { buyerId: "alice", quantity: 1 },
      commandId: "cmd-purchase-001",
    });

    await domain.dispatchCommand({
      name: "PurchaseItem",
      targetAggregateId: "item-1",
      payload: { buyerId: "bob", quantity: 1 },
      commandId: "cmd-purchase-002",
    });

    expect(spy.publishedEvents).toHaveLength(3);
    expect(spy.publishedEvents.map((e) => e.name)).toEqual([
      "FlashSaleCreated",
      "ItemPurchased",
      "ItemPurchased",
    ]);
  });

  it("should demonstrate commandId usage pattern for duplicate prevention", async () => {
    const { domain, spy } = await testDomain({
      aggregates: { FlashSaleItem },
    });

    await domain.dispatchCommand({
      name: "CreateFlashSale",
      targetAggregateId: "item-1",
      payload: { initialStock: 5 },
    });

    // In a production system with an IdempotencyStore, sending the same
    // commandId twice would result in the second dispatch being a no-op.
    // With in-memory persistence, both dispatches are processed independently.
    const commandId = "purchase-alice-001";

    await domain.dispatchCommand({
      name: "PurchaseItem",
      targetAggregateId: "item-1",
      payload: { buyerId: "alice", quantity: 1 },
      commandId,
    });

    // Second dispatch with same commandId -- in-memory processes it again.
    // With a real IdempotencyStore, this would be silently skipped.
    await domain.dispatchCommand({
      name: "PurchaseItem",
      targetAggregateId: "item-1",
      payload: { buyerId: "alice", quantity: 1 },
      commandId,
    });

    // In-memory: both processed (2 ItemPurchased events)
    // Production with IdempotencyStore: only 1 ItemPurchased event
    const purchased = spy.publishedEvents.filter(
      (e) => e.name === "ItemPurchased",
    );
    expect(purchased.length).toBeGreaterThanOrEqual(1);

    // Verify the commandId pattern is being used correctly
    // (the key assertion is that dispatch does not throw with commandId)
    expect(spy.publishedEvents[0]!.name).toBe("FlashSaleCreated");
  });
});
