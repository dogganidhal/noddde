import { describe, expect, it } from "vitest";
import { testAggregate, evolveAggregate, testDomain } from "@noddde/testing";
import { Venue } from "../aggregate";
import type { VenueInfrastructure } from "../infrastructure";

// ---- Shared fixtures ----

const testClock: VenueInfrastructure = {
  clock: { now: () => new Date("2025-06-15T12:00:00Z") },
};

const venueCreated = {
  name: "VenueCreated" as const,
  payload: { venueId: "venue-1", seatIds: ["A1", "A2", "A3", "B1", "B2"] },
};

const seatReserved = (seatId: string, customerId: string) => ({
  name: "SeatReserved" as const,
  payload: { seatId, customerId },
});

// ═══════════════════════════════════════════════════════════════════
// UNIT TESTS — testAggregate (handler isolation)
// ═══════════════════════════════════════════════════════════════════

describe("Venue aggregate — unit tests", () => {
  describe("CreateVenue", () => {
    it("should create a venue with available seats", async () => {
      const result = await testAggregate(Venue)
        .when({
          name: "CreateVenue",
          targetAggregateId: "venue-1",
          payload: { seatIds: ["A1", "A2", "A3"] },
        })
        .execute();

      expect(result.events[0]!.name).toBe("VenueCreated");
      expect(result.state.seats).toEqual({
        A1: { status: "available" },
        A2: { status: "available" },
        A3: { status: "available" },
      });
    });
  });

  describe("ReserveSeat", () => {
    it("should reserve an available seat", async () => {
      const result = await testAggregate(Venue)
        .given(venueCreated)
        .when({
          name: "ReserveSeat",
          targetAggregateId: "venue-1",
          payload: { seatId: "A1", customerId: "alice" },
        })
        .withInfrastructure(testClock)
        .execute();

      expect(result.events[0]!.name).toBe("SeatReserved");
      expect(result.state.seats["A1"]).toEqual({
        status: "reserved",
        heldBy: "alice",
      });
      // Other seats remain available
      expect(result.state.seats["A2"]!.status).toBe("available");
    });

    it("should reject reservation for a nonexistent seat", async () => {
      const result = await testAggregate(Venue)
        .given(venueCreated)
        .when({
          name: "ReserveSeat",
          targetAggregateId: "venue-1",
          payload: { seatId: "Z99", customerId: "alice" },
        })
        .withInfrastructure(testClock)
        .execute();

      expect(result.events[0]!.name).toBe("ReservationRejected");
      expect(result.events[0]!.payload).toMatchObject({
        seatId: "Z99",
        reason: "seat_not_found",
      });
    });

    it("should reject reservation for an already reserved seat", async () => {
      const result = await testAggregate(Venue)
        .given(venueCreated, seatReserved("A1", "alice"))
        .when({
          name: "ReserveSeat",
          targetAggregateId: "venue-1",
          payload: { seatId: "A1", customerId: "bob" },
        })
        .withInfrastructure(testClock)
        .execute();

      expect(result.events[0]!.name).toBe("ReservationRejected");
      expect(result.events[0]!.payload).toMatchObject({
        seatId: "A1",
        customerId: "bob",
        reason: "seat_reserved_by_alice",
      });
      // State unchanged
      expect(result.state.seats["A1"]).toEqual({
        status: "reserved",
        heldBy: "alice",
      });
    });
  });

  describe("ReleaseSeat", () => {
    it("should release a reserved seat", async () => {
      const result = await testAggregate(Venue)
        .given(venueCreated, seatReserved("A1", "alice"))
        .when({
          name: "ReleaseSeat",
          targetAggregateId: "venue-1",
          payload: { seatId: "A1" },
        })
        .execute();

      expect(result.events[0]!.name).toBe("SeatReleased");
      expect(result.state.seats["A1"]).toEqual({ status: "available" });
    });

    it("should allow releasing an already available seat", async () => {
      const result = await testAggregate(Venue)
        .given(venueCreated)
        .when({
          name: "ReleaseSeat",
          targetAggregateId: "venue-1",
          payload: { seatId: "A1" },
        })
        .execute();

      expect(result.events[0]!.name).toBe("SeatReleased");
      expect(result.state.seats["A1"]).toEqual({ status: "available" });
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// evolveAggregate — state reconstruction
// ═══════════════════════════════════════════════════════════════════

describe("Venue — evolveAggregate", () => {
  it("should reconstruct state from a full event history", () => {
    const state = evolveAggregate(Venue, [
      venueCreated,
      seatReserved("A1", "alice"),
      seatReserved("B1", "bob"),
      { name: "SeatReleased", payload: { seatId: "A1" } },
      seatReserved("A1", "charlie"),
      {
        name: "ReservationRejected",
        payload: {
          seatId: "B1",
          customerId: "dave",
          reason: "seat_reserved_by_bob",
        },
      },
    ]);

    expect(state.seats["A1"]).toEqual({
      status: "reserved",
      heldBy: "charlie",
    });
    expect(state.seats["B1"]).toEqual({ status: "reserved", heldBy: "bob" });
    expect(state.seats["A2"]!.status).toBe("available");
    expect(state.seats["A3"]!.status).toBe("available");
    expect(state.seats["B2"]!.status).toBe("available");
  });
});

// ═══════════════════════════════════════════════════════════════════
// SLICE TEST — testDomain (full dispatch cycle)
// ═══════════════════════════════════════════════════════════════════

describe("Venue domain — slice test", () => {
  it("should run a complete reservation lifecycle", async () => {
    const { domain, spy } = await testDomain({
      aggregates: { Venue },
      infrastructure: testClock,
    });

    // Create venue
    await domain.dispatchCommand({
      name: "CreateVenue",
      targetAggregateId: "venue-1",
      payload: { seatIds: ["A1", "A2", "A3"] },
    });

    // Reserve two seats
    await domain.dispatchCommand({
      name: "ReserveSeat",
      targetAggregateId: "venue-1",
      payload: { seatId: "A1", customerId: "alice" },
    });

    await domain.dispatchCommand({
      name: "ReserveSeat",
      targetAggregateId: "venue-1",
      payload: { seatId: "A2", customerId: "bob" },
    });

    // Try to reserve an already taken seat
    await domain.dispatchCommand({
      name: "ReserveSeat",
      targetAggregateId: "venue-1",
      payload: { seatId: "A1", customerId: "charlie" },
    });

    // Release and re-reserve
    await domain.dispatchCommand({
      name: "ReleaseSeat",
      targetAggregateId: "venue-1",
      payload: { seatId: "A1" },
    });

    await domain.dispatchCommand({
      name: "ReserveSeat",
      targetAggregateId: "venue-1",
      payload: { seatId: "A1", customerId: "charlie" },
    });

    expect(spy.publishedEvents).toHaveLength(6);
    expect(spy.publishedEvents.map((e) => e.name)).toEqual([
      "VenueCreated",
      "SeatReserved",
      "SeatReserved",
      "ReservationRejected",
      "SeatReleased",
      "SeatReserved",
    ]);
  });
});
