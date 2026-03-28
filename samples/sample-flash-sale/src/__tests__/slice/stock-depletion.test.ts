import { describe, expect, it } from "vitest";
import { testDomain } from "@noddde/testing";
import { FlashSaleItem } from "../../domain/write-model/aggregates/flash-sale-item";

// ═══════════════════════════════════════════════════════════════════
// SLICE TESTS -- stock depletion scenarios
// ═══════════════════════════════════════════════════════════════════

describe("FlashSaleItem domain -- stock depletion", () => {
  it("should sell exactly N items when N commands sent for N stock", async () => {
    const N = 5;
    const { domain, spy } = await testDomain({
      aggregates: { FlashSaleItem },
    });

    await domain.dispatchCommand({
      name: "CreateFlashSale",
      targetAggregateId: "item-1",
      payload: { initialStock: N },
    });

    for (let i = 0; i < N; i++) {
      await domain.dispatchCommand({
        name: "PurchaseItem",
        targetAggregateId: "item-1",
        payload: { buyerId: `buyer-${i}`, quantity: 1 },
      });
    }

    const purchased = spy.publishedEvents.filter(
      (e) => e.name === "ItemPurchased",
    );
    expect(purchased).toHaveLength(N);
  });

  it("should reject all purchases after stock reaches zero", async () => {
    const { domain, spy } = await testDomain({
      aggregates: { FlashSaleItem },
    });

    await domain.dispatchCommand({
      name: "CreateFlashSale",
      targetAggregateId: "item-1",
      payload: { initialStock: 2 },
    });

    // Exhaust stock
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

    // All subsequent purchases should be rejected
    await domain.dispatchCommand({
      name: "PurchaseItem",
      targetAggregateId: "item-1",
      payload: { buyerId: "charlie", quantity: 1 },
    });
    await domain.dispatchCommand({
      name: "PurchaseItem",
      targetAggregateId: "item-1",
      payload: { buyerId: "dave", quantity: 1 },
    });

    const rejected = spy.publishedEvents.filter(
      (e) => e.name === "PurchaseRejected",
    );
    expect(rejected).toHaveLength(2);
    expect(rejected[0]!.payload).toMatchObject({ buyerId: "charlie" });
    expect(rejected[1]!.payload).toMatchObject({ buyerId: "dave" });
  });

  it("should handle rapid sequential purchases correctly", async () => {
    const { domain, spy } = await testDomain({
      aggregates: { FlashSaleItem },
    });

    await domain.dispatchCommand({
      name: "CreateFlashSale",
      targetAggregateId: "item-1",
      payload: { initialStock: 3 },
    });

    // Rapid sequential purchases (not concurrent -- testDomain is in-memory)
    const buyers = ["a", "b", "c", "d", "e"];
    for (const buyerId of buyers) {
      await domain.dispatchCommand({
        name: "PurchaseItem",
        targetAggregateId: "item-1",
        payload: { buyerId, quantity: 1 },
      });
    }

    const purchased = spy.publishedEvents.filter(
      (e) => e.name === "ItemPurchased",
    );
    const rejected = spy.publishedEvents.filter(
      (e) => e.name === "PurchaseRejected",
    );

    expect(purchased).toHaveLength(3);
    expect(rejected).toHaveLength(2);
  });

  it("should reject from the first purchase if initial stock is zero", async () => {
    const { domain, spy } = await testDomain({
      aggregates: { FlashSaleItem },
    });

    await domain.dispatchCommand({
      name: "CreateFlashSale",
      targetAggregateId: "item-1",
      payload: { initialStock: 0 },
    });

    await domain.dispatchCommand({
      name: "PurchaseItem",
      targetAggregateId: "item-1",
      payload: { buyerId: "alice", quantity: 1 },
    });

    const rejected = spy.publishedEvents.filter(
      (e) => e.name === "PurchaseRejected",
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.payload).toMatchObject({
      buyerId: "alice",
      reason: "out_of_stock",
    });

    // No items should have been purchased
    const purchased = spy.publishedEvents.filter(
      (e) => e.name === "ItemPurchased",
    );
    expect(purchased).toHaveLength(0);
  });
});
