import { defineSaga } from "@noddde/core";
import type { HotelInfrastructure } from "../../infrastructure/types";
import type { BookingEvent } from "../write-model/booking/events";
import type { BookingCommand } from "../write-model/booking/commands";

// ── Narrow event type — only payment lifecycle events ────────────

type PaymentEvent = Extract<
  BookingEvent,
  | { name: "PaymentRequested" }
  | { name: "PaymentCompleted" }
  | { name: "PaymentFailed" }
>;

// ── Saga state ──────────────────────────────────────────────────

export type PaymentProcessingStatus =
  | "idle"
  | "charging"
  | "completed"
  | "failed";

export interface PaymentProcessingState {
  bookingId: string;
  guestId: string;
  paymentId: string;
  amount: number;
  status: PaymentProcessingStatus;
}

// ── Types bundle ────────────────────────────────────────────────

type PaymentProcessingDef = {
  state: PaymentProcessingState;
  events: PaymentEvent;
  commands: BookingCommand;
  infrastructure: HotelInfrastructure;
};

// ── Saga definition ─────────────────────────────────────────────

/**
 * Processes payment charges by calling the PaymentGateway when a
 * payment is requested. Closes the loop between the BookingFulfillment
 * saga (which dispatches RequestPayment) and the booking aggregate
 * (which expects CompletePayment or FailPayment).
 *
 * Flow:
 *   PaymentRequested → paymentGateway.charge() → CompletePayment | FailPayment
 *
 * In a production system, the charge call would be replaced by an async
 * payment provider integration (e.g., Stripe webhook), and the saga's
 * persisted state would correlate the callback to the correct booking.
 */
export const PaymentProcessingSaga = defineSaga<PaymentProcessingDef>({
  initialState: {
    bookingId: "",
    guestId: "",
    paymentId: "",
    amount: 0,
    status: "idle",
  },

  startedBy: ["PaymentRequested"],

  on: {
    // ─── Payment requested → charge via gateway ───────────────────
    PaymentRequested: {
      id: (event) => event.payload.bookingId,
      handle: async (event, _state, { paymentGateway }) => {
        try {
          const { transactionId } = await paymentGateway.charge(
            event.payload.guestId,
            event.payload.amount,
          );

          return {
            state: {
              bookingId: event.payload.bookingId,
              guestId: event.payload.guestId,
              paymentId: event.payload.paymentId,
              amount: event.payload.amount,
              status: "charging" as const,
            },
            commands: {
              name: "CompletePayment" as const,
              targetAggregateId: event.payload.bookingId,
              payload: {
                paymentId: event.payload.paymentId,
                transactionId,
                amount: event.payload.amount,
              },
            },
          };
        } catch (error: any) {
          return {
            state: {
              bookingId: event.payload.bookingId,
              guestId: event.payload.guestId,
              paymentId: event.payload.paymentId,
              amount: event.payload.amount,
              status: "failed" as const,
            },
            commands: {
              name: "FailPayment" as const,
              targetAggregateId: event.payload.bookingId,
              payload: {
                paymentId: event.payload.paymentId,
                reason: error.message ?? "Payment gateway error",
              },
            },
          };
        }
      },
    },

    // ─── Observation: payment completed ───────────────────────────
    PaymentCompleted: {
      id: (event) => event.payload.bookingId,
      handle: (_event, state) => ({
        state: { ...state, status: "completed" as const },
      }),
    },

    // ─── Observation: payment failed ──────────────────────────────
    PaymentFailed: {
      id: (event) => event.payload.bookingId,
      handle: (_event, state) => ({
        state: { ...state, status: "failed" as const },
      }),
    },
  },
});
