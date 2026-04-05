import { describe, expect, it } from "vitest";
import { testDomain } from "@noddde/testing";
import { InMemoryViewStore } from "@noddde/engine";
import type { HotelPorts } from "../../infrastructure/types";
import { FixedClock } from "../../infrastructure/services/clock";
import { InMemoryEmailService } from "../../infrastructure/services/email-service";
import { InMemorySmsService } from "../../infrastructure/services/sms-service";
import { InMemoryPaymentGateway } from "../../infrastructure/services/payment-gateway";
import { InMemoryRoomAvailabilityViewStore } from "../../infrastructure/services/room-availability-view-store";
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

describe("Idempotency (slice)", () => {
  it("should process a booking command with commandId", async () => {
    const infra = createTestInfrastructure();
    const { domain, spy } = await testDomain<HotelPorts>({
      aggregates: { Booking },
      ports: infra,
    });

    await domain.dispatchCommand({
      name: "CreateBooking",
      targetAggregateId: "b-1",
      commandId: "cmd-1",
      payload: {
        guestId: "guest-1",
        roomType: "double" as const,
        checkIn: "2026-04-10",
        checkOut: "2026-04-15",
        totalAmount: 500,
      },
    });

    expect(spy.publishedEvents).toContainEqual(
      expect.objectContaining({ name: "BookingCreated" }),
    );
  });

  it("should process multiple different booking commands", async () => {
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
        roomType: "single" as const,
        checkIn: "2026-04-10",
        checkOut: "2026-04-12",
        totalAmount: 200,
      },
    });

    await domain.dispatchCommand({
      name: "CreateBooking",
      targetAggregateId: "b-2",
      payload: {
        guestId: "guest-2",
        roomType: "suite" as const,
        checkIn: "2026-05-01",
        checkOut: "2026-05-05",
        totalAmount: 2000,
      },
    });

    const bookingCreatedEvents = spy.publishedEvents.filter(
      (e) => e.name === "BookingCreated",
    );
    expect(bookingCreatedEvents).toHaveLength(2);
  });
});
