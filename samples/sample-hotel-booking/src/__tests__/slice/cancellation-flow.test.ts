import { describe, expect, it } from "vitest";
import { testDomain } from "@noddde/testing";
import { InMemoryViewStore } from "@noddde/engine";
import type { HotelInfrastructure } from "../../infrastructure/types";
import { FixedClock } from "../../infrastructure/services/clock";
import { InMemoryEmailService } from "../../infrastructure/services/email-service";
import { InMemorySmsService } from "../../infrastructure/services/sms-service";
import { InMemoryPaymentGateway } from "../../infrastructure/services/payment-gateway";
import { InMemoryRoomAvailabilityViewStore } from "../../infrastructure/services/room-availability-view-store";
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

describe("Cancellation flow (slice)", () => {
  it("should dispatch CancelBooking when payment fails via saga", async () => {
    const infra = createTestInfrastructure();
    const { domain, spy } = await testDomain<HotelInfrastructure>({
      aggregates: { Booking },
      sagas: { BookingFulfillment: BookingFulfillmentSaga },
      infrastructure: infra,
    });

    // Create booking
    await domain.dispatchCommand({
      name: "CreateBooking",
      targetAggregateId: "b-1",
      payload: {
        guestId: "guest-1",
        roomType: "single" as const,
        checkIn: "2026-04-10",
        checkOut: "2026-04-12",
        totalAmount: 200,
      },
    });

    // Saga dispatches RequestPayment → triggers PaymentRequested
    // Now manually fail the payment
    await domain.dispatchCommand({
      name: "FailPayment",
      targetAggregateId: "b-1",
      payload: {
        paymentId: "any-payment-id",
        reason: "Insufficient funds",
      },
    });

    // Saga should react to PaymentFailed → dispatch CancelBooking
    expect(spy.dispatchedCommands).toContainEqual(
      expect.objectContaining({
        name: "CancelBooking",
      }),
    );

    // PaymentFailed event should be in published events
    expect(spy.publishedEvents).toContainEqual(
      expect.objectContaining({ name: "PaymentFailed" }),
    );
  });

  it("should cancel a pending booking directly", async () => {
    const infra = createTestInfrastructure();
    const { domain, spy } = await testDomain<HotelInfrastructure>({
      aggregates: { Booking },
      infrastructure: infra,
    });

    await domain.dispatchCommand({
      name: "CreateBooking",
      targetAggregateId: "b-1",
      payload: {
        guestId: "guest-1",
        roomType: "single" as const,
        checkIn: "2026-04-10",
        checkOut: "2026-04-12",
        totalAmount: 200,
      },
    });

    await domain.dispatchCommand({
      name: "CancelBooking",
      targetAggregateId: "b-1",
      payload: { reason: "Guest changed mind" },
    });

    expect(spy.publishedEvents).toContainEqual(
      expect.objectContaining({
        name: "BookingCancelled",
        payload: expect.objectContaining({ reason: "Guest changed mind" }),
      }),
    );
  });

  it("should reject cancelling an already cancelled booking", async () => {
    const infra = createTestInfrastructure();
    const { domain } = await testDomain<HotelInfrastructure>({
      aggregates: { Booking },
      infrastructure: infra,
    });

    await domain.dispatchCommand({
      name: "CreateBooking",
      targetAggregateId: "b-1",
      payload: {
        guestId: "guest-1",
        roomType: "single" as const,
        checkIn: "2026-04-10",
        checkOut: "2026-04-12",
        totalAmount: 200,
      },
    });

    await domain.dispatchCommand({
      name: "CancelBooking",
      targetAggregateId: "b-1",
      payload: { reason: "First cancellation" },
    });

    await expect(
      domain.dispatchCommand({
        name: "CancelBooking",
        targetAggregateId: "b-1",
        payload: { reason: "Second cancellation" },
      }),
    ).rejects.toThrow("already cancelled");
  });
});
