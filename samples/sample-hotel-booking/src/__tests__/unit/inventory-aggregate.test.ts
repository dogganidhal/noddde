import { describe, expect, it } from "vitest";
import { testAggregate } from "@noddde/testing";
import { InMemoryViewStore } from "@noddde/engine";
import { Inventory } from "../../domain/write-model/aggregates/inventory";
import { FixedClock } from "../../infrastructure/services/clock";
import type { HotelPorts } from "../../infrastructure/types";
import { InMemoryEmailService } from "../../infrastructure/services/email-service";
import { InMemorySmsService } from "../../infrastructure/services/sms-service";
import { InMemoryPaymentGateway } from "../../infrastructure/services/payment-gateway";
import { InMemoryRoomAvailabilityViewStore } from "../../infrastructure/services/room-availability-view-store";

const infra: HotelPorts = {
  clock: new FixedClock(new Date("2026-04-01T10:00:00Z")),
  emailService: new InMemoryEmailService(),
  smsService: new InMemorySmsService(),
  paymentGateway: new InMemoryPaymentGateway(),
  roomAvailabilityViewStore: new InMemoryRoomAvailabilityViewStore(),
  guestHistoryViewStore: new InMemoryViewStore(),
  revenueViewStore: new InMemoryViewStore(),
};

const initialCounts = {
  single: { total: 20, available: 15 },
  double: { total: 10, available: 8 },
  suite: { total: 5, available: 3 },
};

const inventoryInitialized = {
  name: "InventoryInitialized" as const,
  payload: {
    inventoryId: "hotel-1",
    roomCounts: initialCounts,
  },
};

describe("Inventory aggregate", () => {
  describe("InitializeInventory", () => {
    it("should emit InventoryInitialized", async () => {
      const result = await testAggregate(Inventory)
        .when({
          name: "InitializeInventory",
          targetAggregateId: "hotel-1",
          payload: { roomCounts: initialCounts },
        })
        .withPorts(infra)
        .execute();

      expect(result.events).toHaveLength(1);
      expect(result.events[0]!.name).toBe("InventoryInitialized");
      expect(result.state.initialized).toBe(true);
      expect(result.state.roomCounts.single.total).toBe(20);
      expect(result.state.roomCounts.double.available).toBe(8);
    });

    it("should reject duplicate initialization", async () => {
      const result = await testAggregate(Inventory)
        .given(inventoryInitialized)
        .when({
          name: "InitializeInventory",
          targetAggregateId: "hotel-1",
          payload: { roomCounts: initialCounts },
        })
        .withPorts(infra)
        .execute();

      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain("already initialized");
    });
  });

  describe("DecrementAvailability", () => {
    it("should decrease available count", async () => {
      const result = await testAggregate(Inventory)
        .given(inventoryInitialized)
        .when({
          name: "DecrementAvailability",
          targetAggregateId: "hotel-1",
          payload: { roomType: "double" },
        })
        .withPorts(infra)
        .execute();

      expect(result.events[0]!.name).toBe("AvailabilityDecremented");
      expect(result.state.roomCounts.double.available).toBe(7);
      expect(result.state.roomCounts.double.total).toBe(10);
    });

    it("should reject when no rooms available", async () => {
      const result = await testAggregate(Inventory)
        .given({
          name: "InventoryInitialized",
          payload: {
            inventoryId: "hotel-1",
            roomCounts: {
              single: { total: 1, available: 0 },
              double: { total: 0, available: 0 },
              suite: { total: 0, available: 0 },
            },
          },
        })
        .when({
          name: "DecrementAvailability",
          targetAggregateId: "hotel-1",
          payload: { roomType: "single" },
        })
        .withPorts(infra)
        .execute();

      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain("No single rooms available");
    });
  });

  describe("IncrementAvailability", () => {
    it("should increase available count", async () => {
      const result = await testAggregate(Inventory)
        .given(inventoryInitialized)
        .when({
          name: "IncrementAvailability",
          targetAggregateId: "hotel-1",
          payload: { roomType: "suite" },
        })
        .withPorts(infra)
        .execute();

      expect(result.events[0]!.name).toBe("AvailabilityIncremented");
      expect(result.state.roomCounts.suite.available).toBe(4);
    });
  });

  describe("UpdateRoomTypeCount", () => {
    it("should update counts for a room type", async () => {
      const result = await testAggregate(Inventory)
        .given(inventoryInitialized)
        .when({
          name: "UpdateRoomTypeCount",
          targetAggregateId: "hotel-1",
          payload: { roomType: "suite", total: 10, available: 7 },
        })
        .withPorts(infra)
        .execute();

      expect(result.events[0]!.name).toBe("RoomTypeCountUpdated");
      expect(result.state.roomCounts.suite).toEqual({
        total: 10,
        available: 7,
      });
    });

    it("should reject when inventory not initialized", async () => {
      const result = await testAggregate(Inventory)
        .when({
          name: "UpdateRoomTypeCount",
          targetAggregateId: "hotel-1",
          payload: { roomType: "suite", total: 10, available: 7 },
        })
        .withPorts(infra)
        .execute();

      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain("not initialized");
    });
  });
});
