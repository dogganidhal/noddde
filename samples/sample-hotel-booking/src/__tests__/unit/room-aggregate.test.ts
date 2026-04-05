import { describe, expect, it } from "vitest";
import { testAggregate } from "@noddde/testing";
import { InMemoryViewStore } from "@noddde/engine";
import { Room } from "../../domain/write-model/aggregates/room";
import { FixedClock } from "../../infrastructure/services/clock";
import type { HotelPorts } from "../../infrastructure/types";
import { InMemoryEmailService } from "../../infrastructure/services/email-service";
import { InMemorySmsService } from "../../infrastructure/services/sms-service";
import { InMemoryPaymentGateway } from "../../infrastructure/services/payment-gateway";
import { InMemoryRoomAvailabilityViewStore } from "../../infrastructure/services/room-availability-view-store";

const fixedDate = new Date("2026-04-01T10:00:00Z");

const infra: HotelPorts = {
  clock: new FixedClock(fixedDate),
  emailService: new InMemoryEmailService(),
  smsService: new InMemorySmsService(),
  paymentGateway: new InMemoryPaymentGateway(),
  roomAvailabilityViewStore: new InMemoryRoomAvailabilityViewStore(),
  guestHistoryViewStore: new InMemoryViewStore(),
  revenueViewStore: new InMemoryViewStore(),
};

describe("Room aggregate", () => {
  describe("CreateRoom", () => {
    it("should emit RoomCreated", async () => {
      const result = await testAggregate(Room)
        .when({
          name: "CreateRoom",
          targetAggregateId: "room-101",
          payload: {
            roomNumber: "101",
            type: "single",
            floor: 1,
            pricePerNight: 100,
          },
        })
        .withPorts(infra)
        .execute();

      expect(result.events).toHaveLength(1);
      expect(result.events[0]!.name).toBe("RoomCreated");
      expect(result.events[0]!.payload).toMatchObject({
        roomId: "room-101",
        roomNumber: "101",
        type: "single",
        floor: 1,
        pricePerNight: 100,
      });
      expect(result.state.roomNumber).toBe("101");
      expect(result.state.status).toBe("created");
    });

    it("should reject duplicate creation", async () => {
      const result = await testAggregate(Room)
        .given({
          name: "RoomCreated",
          payload: {
            roomId: "room-101",
            roomNumber: "101",
            type: "single",
            floor: 1,
            pricePerNight: 100,
          },
        })
        .when({
          name: "CreateRoom",
          targetAggregateId: "room-101",
          payload: {
            roomNumber: "101",
            type: "single",
            floor: 1,
            pricePerNight: 100,
          },
        })
        .withPorts(infra)
        .execute();

      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain("already created");
    });
  });

  describe("MakeRoomAvailable", () => {
    it("should transition to available", async () => {
      const result = await testAggregate(Room)
        .given({
          name: "RoomCreated",
          payload: {
            roomId: "room-101",
            roomNumber: "101",
            type: "single",
            floor: 1,
            pricePerNight: 100,
          },
        })
        .when({
          name: "MakeRoomAvailable",
          targetAggregateId: "room-101",
        })
        .withPorts(infra)
        .execute();

      expect(result.events[0]!.name).toBe("RoomMadeAvailable");
      expect(result.state.status).toBe("available");
    });
  });

  describe("ReserveRoom", () => {
    it("should reserve an available room", async () => {
      const result = await testAggregate(Room)
        .given(
          {
            name: "RoomCreated",
            payload: {
              roomId: "room-101",
              roomNumber: "101",
              type: "single",
              floor: 1,
              pricePerNight: 100,
            },
          },
          {
            name: "RoomMadeAvailable",
            payload: { roomId: "room-101" },
          },
        )
        .when({
          name: "ReserveRoom",
          targetAggregateId: "room-101",
          payload: {
            bookingId: "booking-1",
            guestId: "guest-1",
            checkIn: "2026-04-10",
            checkOut: "2026-04-15",
          },
        })
        .withPorts(infra)
        .execute();

      expect(result.events[0]!.name).toBe("RoomReserved");
      expect(result.state.status).toBe("reserved");
      expect(result.state.currentBookingId).toBe("booking-1");
    });

    it("should reject reservation on non-available room", async () => {
      const result = await testAggregate(Room)
        .given({
          name: "RoomCreated",
          payload: {
            roomId: "room-101",
            roomNumber: "101",
            type: "single",
            floor: 1,
            pricePerNight: 100,
          },
        })
        .when({
          name: "ReserveRoom",
          targetAggregateId: "room-101",
          payload: {
            bookingId: "booking-1",
            guestId: "guest-1",
            checkIn: "2026-04-10",
            checkOut: "2026-04-15",
          },
        })
        .withPorts(infra)
        .execute();

      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain("Cannot reserve room");
    });
  });

  describe("CheckInGuest", () => {
    it("should check in to a reserved room", async () => {
      const result = await testAggregate(Room)
        .given(
          {
            name: "RoomCreated",
            payload: {
              roomId: "room-101",
              roomNumber: "101",
              type: "single",
              floor: 1,
              pricePerNight: 100,
            },
          },
          { name: "RoomMadeAvailable", payload: { roomId: "room-101" } },
          {
            name: "RoomReserved",
            payload: {
              roomId: "room-101",
              bookingId: "booking-1",
              guestId: "guest-1",
              checkIn: "2026-04-10",
              checkOut: "2026-04-15",
            },
          },
        )
        .when({
          name: "CheckInGuest",
          targetAggregateId: "room-101",
          payload: { bookingId: "booking-1", guestId: "guest-1" },
        })
        .withPorts(infra)
        .execute();

      expect(result.events[0]!.name).toBe("GuestCheckedIn");
      expect(result.state.status).toBe("occupied");
    });

    it("should reject check-in with wrong booking ID", async () => {
      const result = await testAggregate(Room)
        .given(
          {
            name: "RoomCreated",
            payload: {
              roomId: "room-101",
              roomNumber: "101",
              type: "single",
              floor: 1,
              pricePerNight: 100,
            },
          },
          { name: "RoomMadeAvailable", payload: { roomId: "room-101" } },
          {
            name: "RoomReserved",
            payload: {
              roomId: "room-101",
              bookingId: "booking-1",
              guestId: "guest-1",
              checkIn: "2026-04-10",
              checkOut: "2026-04-15",
            },
          },
        )
        .when({
          name: "CheckInGuest",
          targetAggregateId: "room-101",
          payload: { bookingId: "wrong-booking", guestId: "guest-1" },
        })
        .withPorts(infra)
        .execute();

      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain("does not match");
    });
  });

  describe("CheckOutGuest", () => {
    it("should check out from an occupied room", async () => {
      const result = await testAggregate(Room)
        .given(
          {
            name: "RoomCreated",
            payload: {
              roomId: "room-101",
              roomNumber: "101",
              type: "single",
              floor: 1,
              pricePerNight: 100,
            },
          },
          { name: "RoomMadeAvailable", payload: { roomId: "room-101" } },
          {
            name: "RoomReserved",
            payload: {
              roomId: "room-101",
              bookingId: "booking-1",
              guestId: "guest-1",
              checkIn: "2026-04-10",
              checkOut: "2026-04-15",
            },
          },
          {
            name: "GuestCheckedIn",
            payload: {
              roomId: "room-101",
              bookingId: "booking-1",
              guestId: "guest-1",
              checkedInAt: "2026-04-10T14:00:00Z",
            },
          },
        )
        .when({
          name: "CheckOutGuest",
          targetAggregateId: "room-101",
          payload: { bookingId: "booking-1", guestId: "guest-1" },
        })
        .withPorts(infra)
        .execute();

      expect(result.events[0]!.name).toBe("GuestCheckedOut");
      expect(result.state.status).toBe("available");
      expect(result.state.currentBookingId).toBeNull();
    });
  });

  describe("PutUnderMaintenance", () => {
    it("should put an available room under maintenance", async () => {
      const result = await testAggregate(Room)
        .given(
          {
            name: "RoomCreated",
            payload: {
              roomId: "room-101",
              roomNumber: "101",
              type: "single",
              floor: 1,
              pricePerNight: 100,
            },
          },
          { name: "RoomMadeAvailable", payload: { roomId: "room-101" } },
        )
        .when({
          name: "PutUnderMaintenance",
          targetAggregateId: "room-101",
          payload: { reason: "Plumbing repair", estimatedUntil: "2026-04-20" },
        })
        .withPorts(infra)
        .execute();

      expect(result.events[0]!.name).toBe("RoomUnderMaintenance");
      expect(result.state.status).toBe("maintenance");
    });

    it("should reject maintenance on occupied room", async () => {
      const result = await testAggregate(Room)
        .given(
          {
            name: "RoomCreated",
            payload: {
              roomId: "room-101",
              roomNumber: "101",
              type: "single",
              floor: 1,
              pricePerNight: 100,
            },
          },
          { name: "RoomMadeAvailable", payload: { roomId: "room-101" } },
          {
            name: "RoomReserved",
            payload: {
              roomId: "room-101",
              bookingId: "b-1",
              guestId: "g-1",
              checkIn: "2026-04-10",
              checkOut: "2026-04-15",
            },
          },
          {
            name: "GuestCheckedIn",
            payload: {
              roomId: "room-101",
              bookingId: "b-1",
              guestId: "g-1",
              checkedInAt: "2026-04-10T14:00:00Z",
            },
          },
        )
        .when({
          name: "PutUnderMaintenance",
          targetAggregateId: "room-101",
          payload: { reason: "Plumbing repair", estimatedUntil: "2026-04-20" },
        })
        .withPorts(infra)
        .execute();

      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain("occupied");
    });
  });
});
