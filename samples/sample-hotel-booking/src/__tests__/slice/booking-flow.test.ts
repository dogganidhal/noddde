import { describe, expect, it } from "vitest";
import { testDomain } from "@noddde/testing";
import { InMemoryViewStore } from "@noddde/engine";
import type { HotelInfrastructure } from "../../infrastructure/types";
import { FixedClock } from "../../infrastructure/services/clock";
import { InMemoryEmailService } from "../../infrastructure/services/email-service";
import { InMemorySmsService } from "../../infrastructure/services/sms-service";
import { InMemoryPaymentGateway } from "../../infrastructure/services/payment-gateway";
import { InMemoryRoomAvailabilityViewStore } from "../../infrastructure/services/room-availability-view-store";
import { Room } from "../../domain/write-model/aggregates/room";
import { Booking } from "../../domain/write-model/aggregates/booking";
import { BookingFulfillmentSaga } from "../../domain/process-model/booking-fulfillment";

function createTestInfrastructure(): HotelInfrastructure {
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

describe("Booking flow (slice)", () => {
  it("should complete full booking lifecycle via domain", async () => {
    const infra = createTestInfrastructure();
    const { domain, spy } = await testDomain<HotelInfrastructure>({
      aggregates: { Room, Booking },
      sagas: { BookingFulfillment: BookingFulfillmentSaga },
      infrastructure: infra,
    });

    // Create a booking
    await domain.dispatchCommand({
      name: "CreateBooking",
      targetAggregateId: "b-1",
      payload: {
        guestId: "guest-1",
        roomType: "double" as const,
        checkIn: "2026-04-10",
        checkOut: "2026-04-15",
        totalAmount: 500,
      },
    });

    // Verify BookingCreated event was published
    expect(spy.publishedEvents).toContainEqual(
      expect.objectContaining({ name: "BookingCreated" }),
    );

    // The saga should have dispatched RequestPayment
    expect(spy.dispatchedCommands).toContainEqual(
      expect.objectContaining({
        name: "RequestPayment",
        targetAggregateId: "b-1",
      }),
    );
  });

  it("should create room and track events via domain", async () => {
    const infra = createTestInfrastructure();
    const { domain, spy } = await testDomain<HotelInfrastructure>({
      aggregates: { Room },
      infrastructure: infra,
    });

    await domain.dispatchCommand({
      name: "CreateRoom",
      targetAggregateId: "room-101",
      payload: {
        roomNumber: "101",
        type: "double" as const,
        floor: 2,
        pricePerNight: 200,
      },
    });

    await domain.dispatchCommand({
      name: "MakeRoomAvailable",
      targetAggregateId: "room-101",
    });

    expect(spy.publishedEvents).toHaveLength(2);
    expect(spy.publishedEvents[0]).toMatchObject({ name: "RoomCreated" });
    expect(spy.publishedEvents[1]).toMatchObject({ name: "RoomMadeAvailable" });
  });

  it("should handle room reservation after booking", async () => {
    const infra = createTestInfrastructure();
    const { domain, spy } = await testDomain<HotelInfrastructure>({
      aggregates: { Room, Booking },
      infrastructure: infra,
    });

    // Create and make room available
    await domain.dispatchCommand({
      name: "CreateRoom",
      targetAggregateId: "room-101",
      payload: {
        roomNumber: "101",
        type: "double" as const,
        floor: 2,
        pricePerNight: 200,
      },
    });

    await domain.dispatchCommand({
      name: "MakeRoomAvailable",
      targetAggregateId: "room-101",
    });

    // Reserve the room
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

    expect(spy.publishedEvents).toContainEqual(
      expect.objectContaining({
        name: "RoomReserved",
        payload: expect.objectContaining({ roomId: "room-101" }),
      }),
    );
  });

  it("should update room availability projection after reservation", async () => {
    const infra = createTestInfrastructure();
    const { domain, spy } = await testDomain<HotelInfrastructure>({
      aggregates: { Room },
      infrastructure: infra,
    });

    // Create a room, make it available, then reserve it
    await domain.dispatchCommand({
      name: "CreateRoom",
      targetAggregateId: "room-201",
      payload: {
        roomNumber: "201",
        type: "single" as const,
        floor: 2,
        pricePerNight: 150,
      },
    });

    await domain.dispatchCommand({
      name: "MakeRoomAvailable",
      targetAggregateId: "room-201",
    });

    await domain.dispatchCommand({
      name: "ReserveRoom",
      targetAggregateId: "room-201",
      payload: {
        bookingId: "b-2",
        guestId: "guest-2",
        checkIn: "2026-05-01",
        checkOut: "2026-05-05",
      },
    });

    // Check spy events contain the expected sequence
    const eventNames = spy.publishedEvents.map((e) => e.name);
    expect(eventNames).toEqual([
      "RoomCreated",
      "RoomMadeAvailable",
      "RoomReserved",
    ]);
  });
});
