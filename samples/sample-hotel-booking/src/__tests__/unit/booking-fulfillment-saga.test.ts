import { describe, expect, it } from "vitest";
import { testSaga } from "@noddde/testing";
import {
  BookingFulfillmentSaga,
  type BookingFulfillmentState,
} from "../../domain/process-model/booking-fulfillment";

const awaitingPaymentState: BookingFulfillmentState = {
  bookingId: "b-1",
  guestId: "guest-1",
  roomType: "double",
  checkIn: "2026-04-10",
  checkOut: "2026-04-15",
  totalAmount: 500,
  paymentId: "pay-1",
  roomId: null,
  status: "awaiting_payment",
};

describe("BookingFulfillment saga", () => {
  it("should dispatch RequestPayment on BookingCreated", async () => {
    const result = await testSaga(BookingFulfillmentSaga)
      .when({
        name: "BookingCreated",
        payload: {
          bookingId: "b-1",
          guestId: "guest-1",
          roomType: "double" as const,
          checkIn: "2026-04-10",
          checkOut: "2026-04-15",
          totalAmount: 500,
          createdAt: "2026-04-01T10:00:00Z",
        },
      })
      .execute();

    expect(result.state.status).toBe("awaiting_payment");
    expect(result.state.bookingId).toBe("b-1");
    expect(result.state.paymentId).toBeTruthy();
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]).toMatchObject({
      name: "RequestPayment",
      targetAggregateId: "b-1",
      payload: { amount: 500 },
    });
  });

  it("should dispatch ConfirmBooking + ReserveRoom on PaymentCompleted when room available", async () => {
    const result = await testSaga(BookingFulfillmentSaga)
      .givenState(awaitingPaymentState)
      .when({
        name: "PaymentCompleted",
        payload: {
          bookingId: "b-1",
          paymentId: "pay-1",
          transactionId: "txn-1",
          amount: 500,
          completedAt: "2026-04-02T10:00:00Z",
        },
      })
      .withCQRSInfrastructure({
        queryBus: {
          dispatch: async () =>
            [
              { roomId: "room-101", type: "double", status: "available" },
            ] as any,
        },
      })
      .execute();

    expect(result.state.status).toBe("confirmed");
    expect(result.state.roomId).toBe("room-101");
    expect(result.commands).toHaveLength(2);
    expect(result.commands[0]).toMatchObject({
      name: "ConfirmBooking",
      targetAggregateId: "b-1",
      payload: { roomId: "room-101" },
    });
    expect(result.commands[1]).toMatchObject({
      name: "ReserveRoom",
      targetAggregateId: "room-101",
      payload: {
        bookingId: "b-1",
        guestId: "guest-1",
        checkIn: "2026-04-10",
        checkOut: "2026-04-15",
      },
    });
  });

  it("should dispatch CancelBooking on PaymentCompleted when no room available", async () => {
    const result = await testSaga(BookingFulfillmentSaga)
      .givenState(awaitingPaymentState)
      .when({
        name: "PaymentCompleted",
        payload: {
          bookingId: "b-1",
          paymentId: "pay-1",
          transactionId: "txn-1",
          amount: 500,
          completedAt: "2026-04-02T10:00:00Z",
        },
      })
      .withCQRSInfrastructure({
        queryBus: { dispatch: async () => [] as any },
      })
      .execute();

    expect(result.state.status).toBe("cancelled");
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]).toMatchObject({
      name: "CancelBooking",
      targetAggregateId: "b-1",
      payload: { reason: "No available room of requested type" },
    });
  });

  it("should dispatch CancelBooking on PaymentFailed", async () => {
    const result = await testSaga(BookingFulfillmentSaga)
      .givenState(awaitingPaymentState)
      .when({
        name: "PaymentFailed",
        payload: {
          bookingId: "b-1",
          paymentId: "pay-1",
          reason: "Insufficient funds",
        },
      })
      .execute();

    expect(result.state.status).toBe("cancelled");
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]).toMatchObject({
      name: "CancelBooking",
      payload: { reason: "Payment failed: Insufficient funds" },
    });
  });

  it("should dispatch RefundPayment on BookingCancelled when payment exists", async () => {
    const result = await testSaga(BookingFulfillmentSaga)
      .givenState({ ...awaitingPaymentState, status: "confirmed" })
      .when({
        name: "BookingCancelled",
        payload: {
          bookingId: "b-1",
          reason: "Guest requested",
          cancelledAt: "2026-04-03T10:00:00Z",
        },
      })
      .execute();

    expect(result.state.status).toBe("cancelled");
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]).toMatchObject({
      name: "RefundPayment",
      targetAggregateId: "b-1",
      payload: { paymentId: "pay-1", amount: 500 },
    });
  });

  it("should not dispatch refund on BookingCancelled when no payment", async () => {
    const result = await testSaga(BookingFulfillmentSaga)
      .givenState({ ...awaitingPaymentState, paymentId: null, status: "idle" })
      .when({
        name: "BookingCancelled",
        payload: {
          bookingId: "b-1",
          reason: "Guest changed mind",
          cancelledAt: "2026-04-03T10:00:00Z",
        },
      })
      .execute();

    expect(result.state.status).toBe("cancelled");
    expect(result.commands).toHaveLength(0);
  });

  it("should track BookingModified in state", async () => {
    const result = await testSaga(BookingFulfillmentSaga)
      .givenState(awaitingPaymentState)
      .when({
        name: "BookingModified",
        payload: {
          bookingId: "b-1",
          newCheckIn: "2026-04-12",
          newCheckOut: "2026-04-17",
          newTotalAmount: 600,
          modifiedAt: "2026-04-02T10:00:00Z",
        },
      })
      .execute();

    expect(result.state.checkIn).toBe("2026-04-12");
    expect(result.state.checkOut).toBe("2026-04-17");
    expect(result.state.totalAmount).toBe(600);
    expect(result.commands).toHaveLength(0);
  });
});
