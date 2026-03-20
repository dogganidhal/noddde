import { describe, expect, it } from "vitest";
import { testAggregate, evolveAggregate, testDomain } from "@noddde/testing";
import { FlashSaleItem } from "../aggregate";

// ---- Shared fixtures ----

const flashSaleCreated = {
  name: "FlashSaleCreated" as const,
  payload: { itemId: "item-1", initialStock: 5 },
};

const itemPurchased = (buyerId: string, quantity = 1) => ({
  name: "ItemPurchased" as const,
  payload: { buyerId, quantity },
});

// ═══════════════════════════════════════════════════════════════════
// UNIT TESTS — testAggregate (handler isolation)
// ═══════════════════════════════════════════════════════════════════

describe("FlashSaleItem aggregate — unit tests", () => {
  describe("CreateFlashSale", () => {
    it("should create a flash sale with the given stock", async () => {
      const result = await testAggregate(FlashSaleItem)
        .when({
          name: "CreateFlashSale",
          targetAggregateId: "item-1",
          payload: { initialStock: 5 },
        })
        .execute();

      expect(result.events).toEqual([flashSaleCreated]);
      expect(result.state.stock).toBe(5);
      expect(result.state.sold).toBe(0);
      expect(result.state.buyers).toEqual([]);
    });
  });

  describe("PurchaseItem", () => {
    it("should accept a purchase when stock is available", async () => {
      const result = await testAggregate(FlashSaleItem)
        .given(flashSaleCreated)
        .when({
          name: "PurchaseItem",
          targetAggregateId: "item-1",
          payload: { buyerId: "alice", quantity: 1 },
        })
        .execute();

      expect(result.events[0]!.name).toBe("ItemPurchased");
      expect(result.state.stock).toBe(4);
      expect(result.state.sold).toBe(1);
      expect(result.state.buyers).toEqual(["alice"]);
    });

    it("should reject a purchase when out of stock", async () => {
      const result = await testAggregate(FlashSaleItem)
        .given(
          flashSaleCreated,
          ...Array.from({ length: 5 }, (_, i) => itemPurchased(`buyer-${i}`)),
        )
        .when({
          name: "PurchaseItem",
          targetAggregateId: "item-1",
          payload: { buyerId: "latecomer", quantity: 1 },
        })
        .execute();

      expect(result.events[0]!.name).toBe("PurchaseRejected");
      expect(result.events[0]!.payload).toMatchObject({
        buyerId: "latecomer",
        reason: "out_of_stock",
      });
      // PurchaseRejected is a no-op — state unchanged
      expect(result.state.stock).toBe(0);
      expect(result.state.sold).toBe(5);
    });

    it("should track multiple buyers in order", async () => {
      const result = await testAggregate(FlashSaleItem)
        .given(flashSaleCreated, itemPurchased("alice"), itemPurchased("bob"))
        .when({
          name: "PurchaseItem",
          targetAggregateId: "item-1",
          payload: { buyerId: "charlie", quantity: 1 },
        })
        .execute();

      expect(result.state.buyers).toEqual(["alice", "bob", "charlie"]);
      expect(result.state.stock).toBe(2);
      expect(result.state.sold).toBe(3);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// evolveAggregate — state reconstruction
// ═══════════════════════════════════════════════════════════════════

describe("FlashSaleItem — evolveAggregate", () => {
  it("should reconstruct state from a full event history", () => {
    const state = evolveAggregate(FlashSaleItem, [
      flashSaleCreated,
      itemPurchased("alice"),
      itemPurchased("bob"),
      {
        name: "PurchaseRejected",
        payload: { buyerId: "charlie", reason: "out_of_stock" },
      },
      itemPurchased("dave"),
    ]);

    expect(state.stock).toBe(2);
    expect(state.sold).toBe(3);
    expect(state.buyers).toEqual(["alice", "bob", "dave"]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SLICE TEST — testDomain (full dispatch cycle)
// ═══════════════════════════════════════════════════════════════════

describe("FlashSaleItem domain — slice test", () => {
  it("should run a complete flash sale lifecycle", async () => {
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
});
