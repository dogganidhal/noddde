import { defineSaga } from "@noddde/core";
import type { HotelPorts } from "../../../infrastructure/types";
import type { BookingEvent } from "../../event-model";
import type { BookingCommand } from "../../write-model/aggregates/booking/commands";
import type { RoomCommand } from "../../write-model/aggregates/room/commands";
import type { BookingFulfillmentState } from "./state";
import { initialBookingFulfillmentState } from "./state";
import {
  onBookingCancelled,
  onBookingConfirmed,
  onBookingCreated,
  onBookingModified,
  onPaymentCompleted,
  onPaymentFailed,
  onPaymentRefunded,
  onPaymentRequested,
} from "./on-entries";

/** Type bundle for the BookingFulfillment saga. */
export type BookingFulfillmentDef = {
  state: BookingFulfillmentState;
  events: BookingEvent;
  commands: BookingCommand | RoomCommand;
  ports: HotelPorts;
};

/**
 * Orchestrates the booking lifecycle: creation -> payment -> confirmation.
 *
 * Cross-aggregate coordination: dispatches BookingCommand (to Booking)
 * and RoomCommand (to Room) from a single saga flow. Uses the queryBus
 * from CQRSInfrastructure to find available rooms when confirming.
 */
export const BookingFulfillmentSaga = defineSaga<BookingFulfillmentDef>({
  initialState: initialBookingFulfillmentState,

  startedBy: ["BookingCreated"],

  on: {
    BookingCreated: onBookingCreated,
    PaymentCompleted: onPaymentCompleted,
    PaymentFailed: onPaymentFailed,
    BookingCancelled: onBookingCancelled,
    BookingConfirmed: onBookingConfirmed,
    BookingModified: onBookingModified,
    PaymentRequested: onPaymentRequested,
    PaymentRefunded: onPaymentRefunded,
  },
});
