import { describe, expect, it } from "vitest";
import { testAggregate } from "@noddde/testing";
import { InMemoryViewStore } from "@noddde/engine";
import { Booking } from "../../domain/write-model/aggregates/booking";
import { FixedClock } from "../../infrastructure/services/clock";
import type { HotelInfrastructure } from "../../infrastructure/types";
import { InMemoryEmailService } from "../../infrastructure/services/email-service";
import { InMemorySmsService } from "../../infrastructure/services/sms-service";
import { InMemoryPaymentGateway } from "../../infrastructure/services/payment-gateway";
import { InMemoryRoomAvailabilityViewStore } from "../../infrastructure/services/room-availability-view-store";

const fixedDate = new Date("2026-04-01T10:00:00Z");

const infra: HotelInfrastructure = {
  clock: new FixedClock(fixedDate),
  emailService: new InMemoryEmailService(),
  smsService: new InMemorySmsService(),
  paymentGateway: new InMemoryPaymentGateway(),
  roomAvailabilityViewStore: new InMemoryRoomAvailabilityViewStore(),
  guestHistoryViewStore: new InMemoryViewStore(),
  revenueViewStore: new InMemoryViewStore(),
};

const bookingCreated = {
  name: "BookingCreated" as const,
  payload: {
    bookingId: "b-1",
    guestId: "guest-1",
    roomType: "double" as const,
    checkIn: "2026-04-10",
    checkOut: "2026-04-15",
    totalAmount: 500,
    createdAt: fixedDate.toISOString(),
  },
};

describe("Booking aggregate", () => {
  describe("CreateBooking", () => {
    it("should emit BookingCreated", async () => {
      const result = await testAggregate(Booking)
        .when({
          name: "CreateBooking",
          targetAggregateId: "b-1",
          payload: {
            guestId: "guest-1",
            roomType: "double",
            checkIn: "2026-04-10",
            checkOut: "2026-04-15",
            totalAmount: 500,
          },
        })
        .withInfrastructure(infra)
        .execute();

      expect(result.events).toHaveLength(1);
      expect(result.events[0]!.name).toBe("BookingCreated");
      expect(result.events[0]!.payload).toMatchObject({
        bookingId: "b-1",
        guestId: "guest-1",
        roomType: "double",
        totalAmount: 500,
      });
      expect(result.state.status).toBe("pending");
    });

    it("should reject duplicate creation", async () => {
      const result = await testAggregate(Booking)
        .given(bookingCreated)
        .when({
          name: "CreateBooking",
          targetAggregateId: "b-1",
          payload: {
            guestId: "guest-2",
            roomType: "single",
            checkIn: "2026-05-01",
            checkOut: "2026-05-03",
            totalAmount: 200,
          },
        })
        .withInfrastructure(infra)
        .execute();

      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain("already created");
    });
  });

  describe("RequestPayment", () => {
    it("should emit PaymentRequested on pending booking", async () => {
      const result = await testAggregate(Booking)
        .given(bookingCreated)
        .when({
          name: "RequestPayment",
          targetAggregateId: "b-1",
          payload: { paymentId: "pay-1", amount: 500 },
        })
        .withInfrastructure(infra)
        .execute();

      expect(result.events[0]!.name).toBe("PaymentRequested");
      expect(result.state.status).toBe("awaiting_payment");
      expect(result.state.paymentId).toBe("pay-1");
    });
  });

  describe("CompletePayment", () => {
    it("should emit PaymentCompleted when awaiting payment", async () => {
      const result = await testAggregate(Booking)
        .given(bookingCreated, {
          name: "PaymentRequested",
          payload: {
            bookingId: "b-1",
            guestId: "guest-1",
            paymentId: "pay-1",
            amount: 500,
          },
        })
        .when({
          name: "CompletePayment",
          targetAggregateId: "b-1",
          payload: {
            paymentId: "pay-1",
            transactionId: "txn-123",
            amount: 500,
          },
        })
        .withInfrastructure(infra)
        .execute();

      expect(result.events[0]!.name).toBe("PaymentCompleted");
      expect(result.state.transactionId).toBe("txn-123");
    });

    it("should reject payment when not awaiting", async () => {
      const result = await testAggregate(Booking)
        .given(bookingCreated)
        .when({
          name: "CompletePayment",
          targetAggregateId: "b-1",
          payload: {
            paymentId: "pay-1",
            transactionId: "txn-123",
            amount: 500,
          },
        })
        .withInfrastructure(infra)
        .execute();

      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain("Cannot complete payment");
    });
  });

  describe("FailPayment", () => {
    it("should revert to pending status", async () => {
      const result = await testAggregate(Booking)
        .given(bookingCreated, {
          name: "PaymentRequested",
          payload: {
            bookingId: "b-1",
            guestId: "guest-1",
            paymentId: "pay-1",
            amount: 500,
          },
        })
        .when({
          name: "FailPayment",
          targetAggregateId: "b-1",
          payload: { paymentId: "pay-1", reason: "Insufficient funds" },
        })
        .withInfrastructure(infra)
        .execute();

      expect(result.events[0]!.name).toBe("PaymentFailed");
      expect(result.state.status).toBe("pending");
      expect(result.state.paymentId).toBeNull();
    });
  });

  describe("ConfirmBooking", () => {
    it("should confirm with room assignment", async () => {
      const result = await testAggregate(Booking)
        .given(bookingCreated, {
          name: "PaymentRequested",
          payload: {
            bookingId: "b-1",
            guestId: "guest-1",
            paymentId: "pay-1",
            amount: 500,
          },
        })
        .when({
          name: "ConfirmBooking",
          targetAggregateId: "b-1",
          payload: { roomId: "room-101" },
        })
        .withInfrastructure(infra)
        .execute();

      expect(result.events[0]!.name).toBe("BookingConfirmed");
      expect(result.state.status).toBe("confirmed");
      expect(result.state.roomId).toBe("room-101");
    });
  });

  describe("CancelBooking", () => {
    it("should cancel a pending booking", async () => {
      const result = await testAggregate(Booking)
        .given(bookingCreated)
        .when({
          name: "CancelBooking",
          targetAggregateId: "b-1",
          payload: { reason: "Guest request" },
        })
        .withInfrastructure(infra)
        .execute();

      expect(result.events[0]!.name).toBe("BookingCancelled");
      expect(result.state.status).toBe("cancelled");
    });

    it("should reject cancelling an already cancelled booking", async () => {
      const result = await testAggregate(Booking)
        .given(bookingCreated, {
          name: "BookingCancelled",
          payload: {
            bookingId: "b-1",
            reason: "First cancel",
            cancelledAt: fixedDate.toISOString(),
          },
        })
        .when({
          name: "CancelBooking",
          targetAggregateId: "b-1",
          payload: { reason: "Second cancel" },
        })
        .withInfrastructure(infra)
        .execute();

      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain("already cancelled");
    });
  });

  describe("ModifyBooking", () => {
    it("should modify dates and amount", async () => {
      const result = await testAggregate(Booking)
        .given(bookingCreated)
        .when({
          name: "ModifyBooking",
          targetAggregateId: "b-1",
          payload: {
            newCheckIn: "2026-04-12",
            newCheckOut: "2026-04-17",
            newTotalAmount: 600,
          },
        })
        .withInfrastructure(infra)
        .execute();

      expect(result.events[0]!.name).toBe("BookingModified");
      expect(result.state.checkIn).toBe("2026-04-12");
      expect(result.state.checkOut).toBe("2026-04-17");
      expect(result.state.totalAmount).toBe(600);
    });
  });

  describe("RefundPayment", () => {
    it("should refund a completed payment", async () => {
      const result = await testAggregate(Booking)
        .given(
          bookingCreated,
          {
            name: "PaymentRequested",
            payload: {
              bookingId: "b-1",
              guestId: "guest-1",
              paymentId: "pay-1",
              amount: 500,
            },
          },
          {
            name: "PaymentCompleted",
            payload: {
              bookingId: "b-1",
              paymentId: "pay-1",
              transactionId: "txn-123",
              amount: 500,
              completedAt: fixedDate.toISOString(),
            },
          },
        )
        .when({
          name: "RefundPayment",
          targetAggregateId: "b-1",
          payload: { paymentId: "pay-1", amount: 500 },
        })
        .withInfrastructure(infra)
        .execute();

      expect(result.events[0]!.name).toBe("PaymentRefunded");
      expect(result.state.transactionId).toBeNull();
    });

    it("should reject refund when no payment exists", async () => {
      const result = await testAggregate(Booking)
        .given(bookingCreated)
        .when({
          name: "RefundPayment",
          targetAggregateId: "b-1",
          payload: { paymentId: "pay-1", amount: 500 },
        })
        .withInfrastructure(infra)
        .execute();

      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain("No payment to refund");
    });
  });
});
