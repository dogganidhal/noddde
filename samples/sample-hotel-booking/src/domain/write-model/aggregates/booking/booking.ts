import { defineAggregate } from "@noddde/core";
import type { HotelInfrastructure } from "../../../../infrastructure/types";
import type { BookingEvent } from "../../../event-model";
import type { BookingCommand } from "./commands";
import type { BookingState } from "./state";
import { initialBookingState } from "./state";
import { handleCreateBooking } from "./command-handlers/handle-create-booking";
import { handleConfirmBooking } from "./command-handlers/handle-confirm-booking";
import { handleCancelBooking } from "./command-handlers/handle-cancel-booking";
import { handleModifyBooking } from "./command-handlers/handle-modify-booking";
import { handleRequestPayment } from "./command-handlers/handle-request-payment";
import { handleCompletePayment } from "./command-handlers/handle-complete-payment";
import { handleFailPayment } from "./command-handlers/handle-fail-payment";
import { handleRefundPayment } from "./command-handlers/handle-refund-payment";
import {
  applyBookingCreated,
  applyBookingConfirmed,
  applyBookingCancelled,
  applyBookingModified,
  applyPaymentRequested,
  applyPaymentCompleted,
  applyPaymentFailed,
  applyPaymentRefunded,
} from "./apply-handlers";

/** Type bundle for the Booking aggregate. */
export type BookingDef = {
  state: BookingState;
  events: BookingEvent;
  commands: BookingCommand;
  infrastructure: HotelInfrastructure;
};

/**
 * Booking aggregate definition.
 *
 * Models the booking lifecycle: creation, payment, confirmation,
 * modification, and cancellation. All handlers are extracted to
 * separate files for maintainability.
 */
export const Booking = defineAggregate<BookingDef>({
  initialState: initialBookingState,

  commands: {
    CreateBooking: handleCreateBooking,
    ConfirmBooking: handleConfirmBooking,
    CancelBooking: handleCancelBooking,
    ModifyBooking: handleModifyBooking,
    RequestPayment: handleRequestPayment,
    CompletePayment: handleCompletePayment,
    FailPayment: handleFailPayment,
    RefundPayment: handleRefundPayment,
  },

  apply: {
    BookingCreated: applyBookingCreated,
    BookingConfirmed: applyBookingConfirmed,
    BookingCancelled: applyBookingCancelled,
    BookingModified: applyBookingModified,
    PaymentRequested: applyPaymentRequested,
    PaymentCompleted: applyPaymentCompleted,
    PaymentFailed: applyPaymentFailed,
    PaymentRefunded: applyPaymentRefunded,
  },
});
