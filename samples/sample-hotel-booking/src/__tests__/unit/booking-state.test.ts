import { describe, expect, it } from "vitest";
import { evolveAggregate } from "@noddde/testing";
import { Booking } from "../../domain/write-model/aggregates/booking";

const bookingCreated = {
  name: "BookingCreated" as const,
  payload: {
    bookingId: "b-1",
    guestId: "guest-1",
    roomType: "double" as const,
    checkIn: "2026-04-10",
    checkOut: "2026-04-15",
    totalAmount: 500,
    createdAt: "2026-04-01T10:00:00Z",
  },
};

describe("Booking state reconstruction", () => {
  it("should reconstruct pending state from BookingCreated", () => {
    const state = evolveAggregate(Booking, [bookingCreated]);

    expect(state.guestId).toBe("guest-1");
    expect(state.roomType).toBe("double");
    expect(state.checkIn).toBe("2026-04-10");
    expect(state.checkOut).toBe("2026-04-15");
    expect(state.totalAmount).toBe(500);
    expect(state.status).toBe("pending");
    expect(state.roomId).toBeNull();
    expect(state.paymentId).toBeNull();
    expect(state.transactionId).toBeNull();
  });

  it("should reconstruct awaiting_payment state after PaymentRequested", () => {
    const state = evolveAggregate(Booking, [
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
    ]);

    expect(state.status).toBe("awaiting_payment");
    expect(state.paymentId).toBe("pay-1");
  });

  it("should reconstruct confirmed state after full payment + confirm cycle", () => {
    const state = evolveAggregate(Booking, [
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
          completedAt: "2026-04-02T10:00:00Z",
        },
      },
      {
        name: "BookingConfirmed",
        payload: {
          bookingId: "b-1",
          roomId: "room-101",
          confirmedAt: "2026-04-02T10:01:00Z",
        },
      },
    ]);

    expect(state.status).toBe("confirmed");
    expect(state.roomId).toBe("room-101");
    expect(state.transactionId).toBe("txn-123");
  });

  it("should reconstruct cancelled state after cancellation", () => {
    const state = evolveAggregate(Booking, [
      bookingCreated,
      {
        name: "BookingCancelled",
        payload: {
          bookingId: "b-1",
          reason: "Guest request",
          cancelledAt: "2026-04-03T10:00:00Z",
        },
      },
    ]);

    expect(state.status).toBe("cancelled");
    expect(state.guestId).toBe("guest-1");
  });

  it("should reconstruct modified dates after BookingModified", () => {
    const state = evolveAggregate(Booking, [
      bookingCreated,
      {
        name: "BookingModified",
        payload: {
          bookingId: "b-1",
          newCheckIn: "2026-04-12",
          newCheckOut: "2026-04-17",
          newTotalAmount: 600,
          modifiedAt: "2026-04-02T10:00:00Z",
        },
      },
    ]);

    expect(state.checkIn).toBe("2026-04-12");
    expect(state.checkOut).toBe("2026-04-17");
    expect(state.totalAmount).toBe(600);
    expect(state.status).toBe("pending");
  });

  it("should nullify transactionId after PaymentRefunded", () => {
    const state = evolveAggregate(Booking, [
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
          completedAt: "2026-04-02T10:00:00Z",
        },
      },
      {
        name: "PaymentRefunded",
        payload: {
          bookingId: "b-1",
          paymentId: "pay-1",
          amount: 500,
          refundedAt: "2026-04-05T10:00:00Z",
        },
      },
    ]);

    expect(state.transactionId).toBeNull();
  });

  it("should reconstruct state from complex lifecycle with modification and refund", () => {
    const state = evolveAggregate(Booking, [
      bookingCreated,
      {
        name: "BookingModified",
        payload: {
          bookingId: "b-1",
          newCheckIn: "2026-04-12",
          newCheckOut: "2026-04-17",
          newTotalAmount: 600,
          modifiedAt: "2026-04-02T08:00:00Z",
        },
      },
      {
        name: "PaymentRequested",
        payload: {
          bookingId: "b-1",
          guestId: "guest-1",
          paymentId: "pay-1",
          amount: 600,
        },
      },
      {
        name: "PaymentCompleted",
        payload: {
          bookingId: "b-1",
          paymentId: "pay-1",
          transactionId: "txn-456",
          amount: 600,
          completedAt: "2026-04-02T10:00:00Z",
        },
      },
      {
        name: "BookingConfirmed",
        payload: {
          bookingId: "b-1",
          roomId: "room-201",
          confirmedAt: "2026-04-02T10:01:00Z",
        },
      },
      {
        name: "PaymentRefunded",
        payload: {
          bookingId: "b-1",
          paymentId: "pay-1",
          amount: 600,
          refundedAt: "2026-04-05T10:00:00Z",
        },
      },
      {
        name: "BookingCancelled",
        payload: {
          bookingId: "b-1",
          reason: "Guest changed plans",
          cancelledAt: "2026-04-05T10:01:00Z",
        },
      },
    ]);

    expect(state.status).toBe("cancelled");
    expect(state.checkIn).toBe("2026-04-12");
    expect(state.checkOut).toBe("2026-04-17");
    expect(state.totalAmount).toBe(600);
    expect(state.transactionId).toBeNull();
    expect(state.roomId).toBe("room-201");
  });
});
