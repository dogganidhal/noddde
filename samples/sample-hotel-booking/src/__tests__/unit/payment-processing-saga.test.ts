import { describe, expect, it } from "vitest";
import { testSaga } from "@noddde/testing";
import { InMemoryViewStore } from "@noddde/engine";
import {
  PaymentProcessingSaga,
  type PaymentProcessingState,
} from "../../domain/process-model/payment-processing";
import { InMemoryRoomAvailabilityViewStore } from "../../infrastructure/services/room-availability-view-store";

const chargingState: PaymentProcessingState = {
  bookingId: "b-1",
  guestId: "guest-1",
  paymentId: "pay-1",
  amount: 500,
  status: "charging",
};

describe("PaymentProcessing saga", () => {
  it("should call paymentGateway.charge and dispatch CompletePayment on success", async () => {
    const result = await testSaga(PaymentProcessingSaga)
      .when({
        name: "PaymentRequested",
        payload: {
          bookingId: "b-1",
          guestId: "guest-1",
          paymentId: "pay-1",
          amount: 500,
        },
      })
      .withPorts({
        clock: { now: () => new Date() },
        emailService: { send: async () => {} },
        smsService: { send: async () => {} },
        paymentGateway: {
          charge: async () => ({ transactionId: "txn-1" }),
          refund: async () => {},
        },
        roomAvailabilityViewStore: new InMemoryRoomAvailabilityViewStore(),
        guestHistoryViewStore: new InMemoryViewStore(),
        revenueViewStore: new InMemoryViewStore(),
      })
      .execute();

    expect(result.state.status).toBe("charging");
    expect(result.state.bookingId).toBe("b-1");
    expect(result.state.guestId).toBe("guest-1");
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]).toMatchObject({
      name: "CompletePayment",
      targetAggregateId: "b-1",
      payload: {
        paymentId: "pay-1",
        transactionId: "txn-1",
        amount: 500,
      },
    });
  });

  it("should dispatch FailPayment when paymentGateway.charge throws", async () => {
    const result = await testSaga(PaymentProcessingSaga)
      .when({
        name: "PaymentRequested",
        payload: {
          bookingId: "b-1",
          guestId: "guest-1",
          paymentId: "pay-1",
          amount: 500,
        },
      })
      .withPorts({
        clock: { now: () => new Date() },
        emailService: { send: async () => {} },
        smsService: { send: async () => {} },
        paymentGateway: {
          charge: async () => {
            throw new Error("Insufficient funds");
          },
          refund: async () => {},
        },
        roomAvailabilityViewStore: new InMemoryRoomAvailabilityViewStore(),
        guestHistoryViewStore: new InMemoryViewStore(),
        revenueViewStore: new InMemoryViewStore(),
      })
      .execute();

    expect(result.state.status).toBe("failed");
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]).toMatchObject({
      name: "FailPayment",
      targetAggregateId: "b-1",
      payload: {
        paymentId: "pay-1",
        reason: "Insufficient funds",
      },
    });
  });

  it("should transition to failed on PaymentFailed observation", async () => {
    const result = await testSaga(PaymentProcessingSaga)
      .givenState(chargingState)
      .when({
        name: "PaymentFailed",
        payload: {
          bookingId: "b-1",
          paymentId: "pay-1",
          reason: "Declined",
        },
      })
      .execute();
    expect(result.state.status).toBe("failed");
    expect(result.commands).toHaveLength(0);
  });

  it("should handle gateway returning undefined error message", async () => {
    const result = await testSaga(PaymentProcessingSaga)
      .when({
        name: "PaymentRequested",
        payload: {
          bookingId: "b-1",
          guestId: "guest-1",
          paymentId: "pay-1",
          amount: 500,
        },
      })
      .withPorts({
        clock: { now: () => new Date() },
        emailService: { send: async () => {} },
        smsService: { send: async () => {} },
        paymentGateway: {
          charge: async () => {
            throw { message: undefined };
          },
          refund: async () => {},
        },
        roomAvailabilityViewStore: new InMemoryRoomAvailabilityViewStore(),
        guestHistoryViewStore: new InMemoryViewStore(),
        revenueViewStore: new InMemoryViewStore(),
      })
      .execute();
    expect(result.state.status).toBe("failed");
    expect(result.commands[0]).toMatchObject({
      name: "FailPayment",
      payload: { reason: "Payment gateway error" },
    });
  });

  it("should transition to completed on PaymentCompleted (observation)", async () => {
    const result = await testSaga(PaymentProcessingSaga)
      .givenState(chargingState)
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
      .execute();

    expect(result.state.status).toBe("completed");
    expect(result.commands).toHaveLength(0);
  });
});
