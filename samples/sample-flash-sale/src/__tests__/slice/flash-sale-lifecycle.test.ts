import { describe, expect, it } from "vitest";
import { testDomain, stripMetadata } from "@noddde/testing";
import { FlashSaleItem } from "../../domain/write-model/aggregates/flash-sale-item";

// ═══════════════════════════════════════════════════════════════════
// SLICE TESTS -- testDomain (full dispatch cycle)
// ═══════════════════════════════════════════════════════════════════

describe("FlashSaleItem domain -- lifecycle", () => {
  it("should run a complete flash sale lifecycle via domain dispatch", async () => {
    const { domain, spy } = await testDomain({
      aggregates: { FlashSaleItem },
    });

    // Create flash sale with 3 items
    await domain.dispatchCommand({
      name: "CreateFlashSale",
      targetAggregateId: "item-1",
      payload: { initialStock: 3 },
    });

    // Three successful purchases
    await domain.dispatchCommand({
      name: "PurchaseItem",
      targetAggregateId: "item-1",
      payload: { buyerId: "alice", quantity: 1 },
    });

    await domain.dispatchCommand({
      name: "PurchaseItem",
      targetAggregateId: "item-1",
      payload: { buyerId: "bob", quantity: 1 },
    });

    await domain.dispatchCommand({
      name: "PurchaseItem",
      targetAggregateId: "item-1",
      payload: { buyerId: "charlie", quantity: 1 },
    });

    // Fourth purchase should be rejected (out of stock)
    await domain.dispatchCommand({
      name: "PurchaseItem",
      targetAggregateId: "item-1",
      payload: { buyerId: "dave", quantity: 1 },
    });

    expect(spy.publishedEvents).toHaveLength(5);
    expect(spy.publishedEvents.map((e) => e.name)).toEqual([
      "FlashSaleCreated",
      "ItemPurchased",
      "ItemPurchased",
      "ItemPurchased",
      "PurchaseRejected",
    ]);
  });

  it("should emit PurchaseRejected when stock is depleted", async () => {
    const { domain, spy } = await testDomain({
      aggregates: { FlashSaleItem },
    });

    await domain.dispatchCommand({
      name: "CreateFlashSale",
      targetAggregateId: "item-1",
      payload: { initialStock: 1 },
    });

    // First purchase succeeds
    await domain.dispatchCommand({
      name: "PurchaseItem",
      targetAggregateId: "item-1",
      payload: { buyerId: "alice", quantity: 1 },
    });

    // Second purchase is rejected
    await domain.dispatchCommand({
      name: "PurchaseItem",
      targetAggregateId: "item-1",
      payload: { buyerId: "bob", quantity: 1 },
    });

    const lastEvent = spy.publishedEvents[spy.publishedEvents.length - 1]!;
    expect(lastEvent.name).toBe("PurchaseRejected");
    expect(lastEvent.payload).toMatchObject({
      buyerId: "bob",
      reason: "out_of_stock",
    });
  });

  it("should strip metadata from spy.publishedEvents for clean assertions", async () => {
    const { domain, spy } = await testDomain({
      aggregates: { FlashSaleItem },
    });

    await domain.dispatchCommand({
      name: "CreateFlashSale",
      targetAggregateId: "item-1",
      payload: { initialStock: 2 },
    });

    await domain.dispatchCommand({
      name: "PurchaseItem",
      targetAggregateId: "item-1",
      payload: { buyerId: "alice", quantity: 1 },
    });

    const stripped = stripMetadata(spy.publishedEvents);

    // Stripped events have name and payload but no metadata
    expect(stripped).toEqual([
      {
        name: "FlashSaleCreated",
        payload: { itemId: "item-1", initialStock: 2 },
      },
      { name: "ItemPurchased", payload: { buyerId: "alice", quantity: 1 } },
    ]);

    for (const event of stripped) {
      expect(event).not.toHaveProperty("metadata");
    }
  });
});
