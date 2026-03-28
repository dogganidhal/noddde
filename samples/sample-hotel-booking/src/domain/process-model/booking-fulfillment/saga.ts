import { randomUUID } from "crypto";
import { defineSaga } from "@noddde/core";
import type { HotelInfrastructure } from "../../../infrastructure/types";
import type { BookingEvent } from "../../event-model";
import type { BookingCommand } from "../../write-model/aggregates/booking/commands";
import type { RoomCommand } from "../../write-model/aggregates/room/commands";
import type { BookingFulfillmentState } from "./state";
import { initialBookingFulfillmentState } from "./state";

/** Type bundle for the BookingFulfillment saga. */
type BookingFulfillmentDef = {
  state: BookingFulfillmentState;
  events: BookingEvent;
  commands: BookingCommand | RoomCommand;
  infrastructure: HotelInfrastructure;
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
    // --- Booking created -> request payment ---
    BookingCreated: {
      id: (event) => event.payload.bookingId,
      handle: (event) => {
        const paymentId = randomUUID();
        return {
          state: {
            bookingId: event.payload.bookingId,
            guestId: event.payload.guestId,
            roomType: event.payload.roomType,
            checkIn: event.payload.checkIn,
            checkOut: event.payload.checkOut,
            totalAmount: event.payload.totalAmount,
            paymentId,
            roomId: null,
            status: "awaiting_payment" as const,
          },
          commands: {
            name: "RequestPayment",
            targetAggregateId: event.payload.bookingId,
            payload: {
              paymentId,
              amount: event.payload.totalAmount,
            },
          },
        };
      },
    },

    // --- Payment completed -> find room, confirm booking, reserve room ---
    PaymentCompleted: {
      id: (event) => event.payload.bookingId,
      handle: async (event, state, infrastructure) => {
        const availableRooms = (await infrastructure.queryBus.dispatch({
          name: "SearchAvailableRooms",
          payload: { type: state.roomType },
        })) as any[];

        const room = availableRooms?.[0];
        if (!room) {
          return {
            state: { ...state, status: "cancelled" as const },
            commands: {
              name: "CancelBooking",
              targetAggregateId: state.bookingId,
              payload: { reason: "No available room of requested type" },
            },
          };
        }

        return {
          state: {
            ...state,
            status: "confirmed" as const,
            roomId: room.roomId,
          },
          commands: [
            {
              name: "ConfirmBooking",
              targetAggregateId: state.bookingId,
              payload: { roomId: room.roomId },
            },
            {
              name: "ReserveRoom",
              targetAggregateId: room.roomId,
              payload: {
                bookingId: state.bookingId,
                guestId: state.guestId,
                checkIn: state.checkIn,
                checkOut: state.checkOut,
              },
            },
          ],
        };
      },
    },

    // --- Payment failed -> cancel booking ---
    PaymentFailed: {
      id: (event) => event.payload.bookingId,
      handle: (event, state) => ({
        state: { ...state, status: "cancelled" as const },
        commands: {
          name: "CancelBooking",
          targetAggregateId: state.bookingId,
          payload: { reason: `Payment failed: ${event.payload.reason}` },
        },
      }),
    },

    // --- Booking cancelled -> refund only if payment was completed ---
    BookingCancelled: {
      id: (event) => event.payload.bookingId,
      handle: (_event, state) => ({
        state: { ...state, status: "cancelled" as const },
        commands:
          state.status === "confirmed" && state.paymentId
            ? {
                name: "RefundPayment" as const,
                targetAggregateId: state.bookingId,
                payload: {
                  paymentId: state.paymentId,
                  amount: state.totalAmount,
                },
              }
            : undefined,
      }),
    },

    // --- Events observed for state tracking, no commands ---
    BookingConfirmed: {
      id: (event) => event.payload.bookingId,
      handle: (_event, state) => ({
        state: { ...state, status: "confirmed" as const },
      }),
    },

    BookingModified: {
      id: (event) => event.payload.bookingId,
      handle: (event, state) => ({
        state: {
          ...state,
          checkIn: event.payload.newCheckIn,
          checkOut: event.payload.newCheckOut,
          totalAmount: event.payload.newTotalAmount,
        },
      }),
    },

    PaymentRequested: {
      id: (event) => event.payload.bookingId,
      handle: (_event, state) => ({ state }),
    },

    PaymentRefunded: {
      id: (event) => event.payload.bookingId,
      handle: (_event, state) => ({
        state: { ...state, status: "cancelled" as const },
      }),
    },
  },
});
