import { describe, expect, it } from "vitest";
import { testAggregate } from "@noddde/testing";
import { FlashSaleItem } from "../../domain/write-model/aggregates/flash-sale-item";

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
// UNIT TESTS -- testAggregate (handler isolation)
// ═══════════════════════════════════════════════════════════════════

describe("FlashSaleItem aggregate -- unit tests", () => {
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
    });

    it("should set sold to zero and buyers to empty array", async () => {
      const result = await testAggregate(FlashSaleItem)
        .when({
          name: "CreateFlashSale",
          targetAggregateId: "item-1",
          payload: { initialStock: 10 },
        })
        .execute();

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
      expect(result.events[0]!.payload).toMatchObject({
        buyerId: "alice",
        quantity: 1,
      });
    });

    it("should decrement stock and increment sold on purchase", async () => {
      const result = await testAggregate(FlashSaleItem)
        .given(flashSaleCreated)
        .when({
          name: "PurchaseItem",
          targetAggregateId: "item-1",
          payload: { buyerId: "alice", quantity: 1 },
        })
        .execute();

      expect(result.state.stock).toBe(4);
      expect(result.state.sold).toBe(1);
    });

    it("should append buyerId to buyers list", async () => {
      const result = await testAggregate(FlashSaleItem)
        .given(flashSaleCreated, itemPurchased("alice"))
        .when({
          name: "PurchaseItem",
          targetAggregateId: "item-1",
          payload: { buyerId: "bob", quantity: 1 },
        })
        .execute();

      expect(result.state.buyers).toEqual(["alice", "bob"]);
    });

    it("should emit PurchaseRejected when out of stock", async () => {
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
    });

    it("should not modify state on PurchaseRejected", async () => {
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

      expect(result.state.stock).toBe(0);
      expect(result.state.sold).toBe(5);
      expect(result.state.buyers).toHaveLength(5);
      expect(result.state.buyers).not.toContain("latecomer");
    });

    it("should track multiple buyers in purchase order", async () => {
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
