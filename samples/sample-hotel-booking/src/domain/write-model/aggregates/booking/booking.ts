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

/** Type bundle for the Booking aggregate. */
type BookingDef = {
  state: BookingState;
  events: BookingEvent;
  commands: BookingCommand;
  infrastructure: HotelInfrastructure;
};

/**
 * Booking aggregate definition.
 *
 * Models the booking lifecycle: creation, payment, confirmation,
 * modification, and cancellation. Command handlers are extracted;
 * apply handlers remain inline.
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
    BookingCreated: (event) => ({
      guestId: event.guestId,
      roomType: event.roomType,
      checkIn: event.checkIn,
      checkOut: event.checkOut,
      totalAmount: event.totalAmount,
      status: "pending" as const,
      roomId: null,
      paymentId: null,
      transactionId: null,
    }),

    BookingConfirmed: (event, state) => ({
      ...state,
      status: "confirmed" as const,
      roomId: event.roomId,
    }),

    BookingCancelled: (_event, state) => ({
      ...state,
      status: "cancelled" as const,
    }),

    BookingModified: (event, state) => ({
      ...state,
      checkIn: event.newCheckIn,
      checkOut: event.newCheckOut,
      totalAmount: event.newTotalAmount,
    }),

    PaymentRequested: (event, state) => ({
      ...state,
      status: "awaiting_payment" as const,
      paymentId: event.paymentId,
    }),

    PaymentCompleted: (event, state) => ({
      ...state,
      transactionId: event.transactionId,
    }),

    PaymentFailed: (_event, state) => ({
      ...state,
      status: "pending" as const,
      paymentId: null,
    }),

    PaymentRefunded: (_event, state) => ({
      ...state,
      transactionId: null,
    }),
  },
});
