import { describe, expect, it } from "vitest";
import { testDomain } from "@noddde/testing";
import { InMemoryViewStore } from "@noddde/engine";
import type { HotelPorts } from "../../infrastructure/types";
import { FixedClock } from "../../infrastructure/services/clock";
import { InMemoryEmailService } from "../../infrastructure/services/email-service";
import { InMemorySmsService } from "../../infrastructure/services/sms-service";
import { InMemoryPaymentGateway } from "../../infrastructure/services/payment-gateway";
import { InMemoryRoomAvailabilityViewStore } from "../../infrastructure/services/room-availability-view-store";
import { Room } from "../../domain/write-model/aggregates/room";
import { Booking } from "../../domain/write-model/aggregates/booking";

function createTestInfrastructure(): HotelPorts {
  return {
    clock: new FixedClock(new Date("2026-04-01T10:00:00Z")),
    emailService: new InMemoryEmailService(),
    smsService: new InMemorySmsService(),
    paymentGateway: new InMemoryPaymentGateway(),
    roomAvailabilityViewStore: new InMemoryRoomAvailabilityViewStore(),
    guestHistoryViewStore: new InMemoryViewStore(),
    revenueViewStore: new InMemoryViewStore(),
  };
}

describe("Group booking (slice)", () => {
  it("should create multiple bookings and rooms atomically via UoW", async () => {
    const infra = createTestInfrastructure();
    const { domain, spy } = await testDomain<HotelPorts>({
      aggregates: { Room, Booking },
      ports: infra,
    });

    // Set up two rooms
    await domain.dispatchCommand({
      name: "CreateRoom",
      targetAggregateId: "room-101",
      payload: {
        roomNumber: "101",
        type: "double" as const,
        floor: 1,
        pricePerNight: 200,
      },
    });
    await domain.dispatchCommand({
      name: "MakeRoomAvailable",
      targetAggregateId: "room-101",
    });

    await domain.dispatchCommand({
      name: "CreateRoom",
      targetAggregateId: "room-102",
      payload: {
        roomNumber: "102",
        type: "single" as const,
        floor: 1,
        pricePerNight: 100,
      },
    });
    await domain.dispatchCommand({
      name: "MakeRoomAvailable",
      targetAggregateId: "room-102",
    });

    // Group booking: create two bookings and reserve both rooms atomically
    await domain.withUnitOfWork(async () => {
      await domain.dispatchCommand({
        name: "CreateBooking",
        targetAggregateId: "b-1",
        payload: {
          guestId: "guest-1",
          roomType: "double" as const,
          checkIn: "2026-04-10",
          checkOut: "2026-04-15",
          totalAmount: 1000,
        },
      });

      await domain.dispatchCommand({
        name: "ReserveRoom",
        targetAggregateId: "room-101",
        payload: {
          bookingId: "b-1",
          guestId: "guest-1",
          checkIn: "2026-04-10",
          checkOut: "2026-04-15",
        },
      });

      await domain.dispatchCommand({
        name: "CreateBooking",
        targetAggregateId: "b-2",
        payload: {
          guestId: "guest-1",
          roomType: "single" as const,
          checkIn: "2026-04-10",
          checkOut: "2026-04-15",
          totalAmount: 500,
        },
      });

      await domain.dispatchCommand({
        name: "ReserveRoom",
        targetAggregateId: "room-102",
        payload: {
          bookingId: "b-2",
          guestId: "guest-1",
          checkIn: "2026-04-10",
          checkOut: "2026-04-15",
        },
      });
    });

    // Verify all events were published
    const bookingCreatedEvents = spy.publishedEvents.filter(
      (e) => e.name === "BookingCreated",
    );
    const roomReservedEvents = spy.publishedEvents.filter(
      (e) => e.name === "RoomReserved",
    );

    expect(bookingCreatedEvents).toHaveLength(2);
    expect(roomReservedEvents).toHaveLength(2);
  });

  it("should allow booking multiple rooms for the same guest", async () => {
    const infra = createTestInfrastructure();
    const { domain, spy } = await testDomain<HotelPorts>({
      aggregates: { Booking },
      ports: infra,
    });

    await domain.dispatchCommand({
      name: "CreateBooking",
      targetAggregateId: "b-1",
      payload: {
        guestId: "guest-1",
        roomType: "double" as const,
        checkIn: "2026-04-10",
        checkOut: "2026-04-15",
        totalAmount: 1000,
      },
    });

    await domain.dispatchCommand({
      name: "CreateBooking",
      targetAggregateId: "b-2",
      payload: {
        guestId: "guest-1",
        roomType: "suite" as const,
        checkIn: "2026-04-10",
        checkOut: "2026-04-15",
        totalAmount: 3000,
      },
    });

    const events = spy.publishedEvents.filter(
      (e) => e.name === "BookingCreated",
    );
    expect(events).toHaveLength(2);
  });
});
