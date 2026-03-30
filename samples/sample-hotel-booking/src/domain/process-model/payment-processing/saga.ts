import { defineSaga } from "@noddde/core";
import type { HotelInfrastructure } from "../../../infrastructure/types";
import type { BookingEvent } from "../../event-model";
import type { BookingCommand } from "../../write-model/aggregates/booking/commands";
import type { PaymentProcessingState } from "./state";
import { initialPaymentProcessingState } from "./state";
import {
  onPaymentCompleted,
  onPaymentFailed,
  onPaymentRequested,
} from "./on-entries";

/** Narrow event type -- only payment lifecycle events. */
export type PaymentEvent = Extract<
  BookingEvent,
  | { name: "PaymentRequested" }
  | { name: "PaymentCompleted" }
  | { name: "PaymentFailed" }
>;

/** Type bundle for the PaymentProcessing saga. */
export type PaymentProcessingDef = {
  state: PaymentProcessingState;
  events: PaymentEvent;
  commands: BookingCommand;
  infrastructure: HotelInfrastructure;
};

/**
 * Processes payment charges by calling the PaymentGateway when a
 * payment is requested. Closes the loop between the BookingFulfillment
 * saga (which dispatches RequestPayment) and the booking aggregate
 * (which expects CompletePayment or FailPayment).
 *
 * Flow:
 *   PaymentRequested -> paymentGateway.charge() -> CompletePayment | FailPayment
 *
 * In a production system, the charge call would be replaced by an async
 * payment provider integration (e.g., Stripe webhook), and the saga's
 * persisted state would correlate the callback to the correct booking.
 */
export const PaymentProcessingSaga = defineSaga<PaymentProcessingDef>({
  initialState: initialPaymentProcessingState,

  startedBy: ["PaymentRequested"],

  on: {
    PaymentRequested: onPaymentRequested,
    PaymentCompleted: onPaymentCompleted,
    PaymentFailed: onPaymentFailed,
  },
});
