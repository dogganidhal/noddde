import type { DefineCommands } from "@noddde/core";
import type { CreateBookingPayload } from "./create-booking";
import type { ConfirmBookingPayload } from "./confirm-booking";
import type { CancelBookingPayload } from "./cancel-booking";
import type { ModifyBookingPayload } from "./modify-booking";
import type { RequestPaymentPayload } from "./request-payment";
import type { CompletePaymentPayload } from "./complete-payment";
import type { FailPaymentPayload } from "./fail-payment";
import type { RefundPaymentPayload } from "./refund-payment";

export type { CreateBookingPayload } from "./create-booking";
export type { ConfirmBookingPayload } from "./confirm-booking";
export type { CancelBookingPayload } from "./cancel-booking";
export type { ModifyBookingPayload } from "./modify-booking";
export type { RequestPaymentPayload } from "./request-payment";
export type { CompletePaymentPayload } from "./complete-payment";
export type { FailPaymentPayload } from "./fail-payment";
export type { RefundPaymentPayload } from "./refund-payment";

/** Discriminated union of all booking commands. */
export type BookingCommand = DefineCommands<{
  CreateBooking: CreateBookingPayload;
  ConfirmBooking: ConfirmBookingPayload;
  CancelBooking: CancelBookingPayload;
  ModifyBooking: ModifyBookingPayload;
  RequestPayment: RequestPaymentPayload;
  CompletePayment: CompletePaymentPayload;
  FailPayment: FailPaymentPayload;
  RefundPayment: RefundPaymentPayload;
}>;
