import { describe, expect, it } from "vitest";
import { testDomain, stripMetadata } from "@noddde/testing";
import { InMemoryViewStore } from "@noddde/engine";
import type { HotelInfrastructure } from "../../infrastructure/types";
import { FixedClock } from "../../infrastructure/services/clock";
import { InMemoryEmailService } from "../../infrastructure/services/email-service";
import { InMemorySmsService } from "../../infrastructure/services/sms-service";
import { InMemoryRoomAvailabilityViewStore } from "../../infrastructure/services/room-availability-view-store";
import { Room } from "../../domain/write-model/aggregates/room";
import { Booking } from "../../domain/write-model/aggregates/booking";
import { BookingFulfillmentSaga } from "../../domain/process-model/booking-fulfillment";
import { PaymentProcessingSaga } from "../../domain/process-model/payment-processing";

function createTestInfrastructure(): HotelInfrastructure {
  return {
    clock: new FixedClock(new Date("2026-04-01T10:00:00Z")),
    emailService: new InMemoryEmailService(),
    smsService: new InMemorySmsService(),
    paymentGateway: {
      charge: async () => ({ transactionId: "txn-1" }),
      refund: async () => {},
    },
    roomAvailabilityViewStore: new InMemoryRoomAvailabilityViewStore(),
    guestHistoryViewStore: new InMemoryViewStore(),
    revenueViewStore: new InMemoryViewStore(),
  };
}

describe("Payment failure compensation flow (slice)", () => {
  it("should cancel booking when payment gateway fails", async () => {
    const infra = createTestInfrastructure();
    infra.paymentGateway = {
      charge: async () => {
        throw new Error("Declined");
      },
      refund: async () => {},
    };

    const { domain, spy } = await testDomain<HotelInfrastructure>({
      aggregates: { Booking },
      sagas: {
        BookingFulfillment: BookingFulfillmentSaga,
        PaymentProcessing: PaymentProcessingSaga,
      },
      infrastructure: infra,
    });

    await domain.dispatchCommand({
      name: "CreateBooking",
      targetAggregateId: "b-1",
      payload: {
        guestId: "g-1",
        roomType: "double" as const,
        checkIn: "2026-04-10",
        checkOut: "2026-04-15",
        totalAmount: 500,
      },
    });

    // Verify: BookingCreated -> saga -> RequestPayment -> PaymentRequested
    // -> gateway fails -> FailPayment -> PaymentFailed -> CancelBooking -> BookingCancelled
    const eventNames = stripMetadata(spy.publishedEvents).map((e) => e.name);
    expect(eventNames).toContain("PaymentFailed");
    expect(eventNames).toContain("BookingCancelled");
  });

  it("should cancel booking when no room available after payment", async () => {
    const infra = createTestInfrastructure();

    const { domain, spy } = await testDomain<HotelInfrastructure>({
      aggregates: { Room, Booking },
      sagas: {
        BookingFulfillment: BookingFulfillmentSaga,
        PaymentProcessing: PaymentProcessingSaga,
      },
      infrastructure: infra,
    });

    // No rooms created -> no rooms available when saga queries
    await domain.dispatchCommand({
      name: "CreateBooking",
      targetAggregateId: "b-1",
      payload: {
        guestId: "g-1",
        roomType: "double" as const,
        checkIn: "2026-04-10",
        checkOut: "2026-04-15",
        totalAmount: 500,
      },
    });

    const events = stripMetadata(spy.publishedEvents);
    expect(events.map((e) => e.name)).toContain("BookingCancelled");
  });

  it("should use stripMetadata for clean compensation chain assertions", async () => {
    const infra = createTestInfrastructure();
    infra.paymentGateway = {
      charge: async () => {
        throw new Error("Declined");
      },
      refund: async () => {},
    };

    const { domain, spy } = await testDomain<HotelInfrastructure>({
      aggregates: { Booking },
      sagas: {
        BookingFulfillment: BookingFulfillmentSaga,
        PaymentProcessing: PaymentProcessingSaga,
      },
      infrastructure: infra,
    });

    await domain.dispatchCommand({
      name: "CreateBooking",
      targetAggregateId: "b-1",
      payload: {
        guestId: "g-1",
        roomType: "double" as const,
        checkIn: "2026-04-10",
        checkOut: "2026-04-15",
        totalAmount: 500,
      },
    });

    const cleanEvents = stripMetadata(spy.publishedEvents);
    // Verify all events have name and payload but no metadata
    for (const event of cleanEvents) {
      expect(event).toHaveProperty("name");
      expect(event).toHaveProperty("payload");
      expect(event).not.toHaveProperty("metadata");
    }
  });
});
