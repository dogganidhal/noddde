import { defineAggregate } from "@noddde/core";
import type { HotelInfrastructure } from "../../../../infrastructure/types";
import type { BookingEvent } from "../../../event-model";
import type { BookingCommand } from "./commands";
import type { BookingState } from "./state";
import { initialBookingState } from "./state";
import { decideCreateBooking } from "./deciders/decide-create-booking";
import { decideConfirmBooking } from "./deciders/decide-confirm-booking";
import { decideCancelBooking } from "./deciders/decide-cancel-booking";
import { decideModifyBooking } from "./deciders/decide-modify-booking";
import { decideRequestPayment } from "./deciders/decide-request-payment";
import { decideCompletePayment } from "./deciders/decide-complete-payment";
import { decideFailPayment } from "./deciders/decide-fail-payment";
import { decideRefundPayment } from "./deciders/decide-refund-payment";
import {
  evolveBookingCreated,
  evolveBookingConfirmed,
  evolveBookingCancelled,
  evolveBookingModified,
  evolvePaymentRequested,
  evolvePaymentCompleted,
  evolvePaymentFailed,
  evolvePaymentRefunded,
} from "./evolvers";

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

  decide: {
    CreateBooking: decideCreateBooking,
    ConfirmBooking: decideConfirmBooking,
    CancelBooking: decideCancelBooking,
    ModifyBooking: decideModifyBooking,
    RequestPayment: decideRequestPayment,
    CompletePayment: decideCompletePayment,
    FailPayment: decideFailPayment,
    RefundPayment: decideRefundPayment,
  },

  evolve: {
    BookingCreated: evolveBookingCreated,
    BookingConfirmed: evolveBookingConfirmed,
    BookingCancelled: evolveBookingCancelled,
    BookingModified: evolveBookingModified,
    PaymentRequested: evolvePaymentRequested,
    PaymentCompleted: evolvePaymentCompleted,
    PaymentFailed: evolvePaymentFailed,
    PaymentRefunded: evolvePaymentRefunded,
  },
});
