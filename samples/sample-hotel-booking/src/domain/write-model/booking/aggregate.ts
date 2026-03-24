import { defineAggregate } from "@noddde/core";
import type { RoomType } from "../../../infrastructure/types";
import type { HotelInfrastructure } from "../../../infrastructure/types";
import type { BookingCommand } from "./commands";
import type { BookingEvent } from "./events";

export type BookingStatus =
  | "pending"
  | "awaiting_payment"
  | "confirmed"
  | "cancelled"
  | "modified";

export interface BookingState {
  guestId: string | null;
  roomType: RoomType | null;
  checkIn: string | null;
  checkOut: string | null;
  totalAmount: number;
  status: BookingStatus;
  roomId: string | null;
  paymentId: string | null;
  transactionId: string | null;
}

type BookingDef = {
  state: BookingState;
  events: BookingEvent;
  commands: BookingCommand;
  infrastructure: HotelInfrastructure;
};

export const Booking = defineAggregate<BookingDef>({
  initialState: {
    guestId: null,
    roomType: null,
    checkIn: null,
    checkOut: null,
    totalAmount: 0,
    status: "pending",
    roomId: null,
    paymentId: null,
    transactionId: null,
  },

  commands: {
    CreateBooking: (command, state, { clock }) => {
      if (state.guestId !== null) {
        throw new Error("Booking already created");
      }
      return {
        name: "BookingCreated",
        payload: {
          bookingId: command.targetAggregateId,
          guestId: command.payload.guestId,
          roomType: command.payload.roomType,
          checkIn: command.payload.checkIn,
          checkOut: command.payload.checkOut,
          totalAmount: command.payload.totalAmount,
          createdAt: clock.now().toISOString(),
        },
      };
    },

    ConfirmBooking: (command, state, { clock }) => {
      if (state.status !== "awaiting_payment" && state.status !== "pending") {
        throw new Error(`Cannot confirm booking in ${state.status} status`);
      }
      return {
        name: "BookingConfirmed",
        payload: {
          bookingId: command.targetAggregateId,
          roomId: command.payload.roomId,
          confirmedAt: clock.now().toISOString(),
        },
      };
    },

    CancelBooking: (command, state, { clock }) => {
      if (state.status === "cancelled") {
        throw new Error("Booking already cancelled");
      }
      return {
        name: "BookingCancelled",
        payload: {
          bookingId: command.targetAggregateId,
          reason: command.payload.reason,
          cancelledAt: clock.now().toISOString(),
        },
      };
    },

    ModifyBooking: (command, state, { clock }) => {
      if (state.status === "cancelled") {
        throw new Error("Cannot modify cancelled booking");
      }
      return {
        name: "BookingModified",
        payload: {
          bookingId: command.targetAggregateId,
          newCheckIn: command.payload.newCheckIn,
          newCheckOut: command.payload.newCheckOut,
          newTotalAmount: command.payload.newTotalAmount,
          modifiedAt: clock.now().toISOString(),
        },
      };
    },

    RequestPayment: (command, state) => {
      if (state.status !== "pending") {
        throw new Error(`Cannot request payment in ${state.status} status`);
      }
      return {
        name: "PaymentRequested",
        payload: {
          bookingId: command.targetAggregateId,
          guestId: state.guestId!,
          paymentId: command.payload.paymentId,
          amount: command.payload.amount,
        },
      };
    },

    CompletePayment: (command, state, { clock }) => {
      if (state.status !== "awaiting_payment") {
        throw new Error(`Cannot complete payment in ${state.status} status`);
      }
      return {
        name: "PaymentCompleted",
        payload: {
          bookingId: command.targetAggregateId,
          paymentId: command.payload.paymentId,
          transactionId: command.payload.transactionId,
          amount: command.payload.amount,
          completedAt: clock.now().toISOString(),
        },
      };
    },

    FailPayment: (command, state) => {
      if (state.status !== "awaiting_payment") {
        throw new Error(`Cannot fail payment in ${state.status} status`);
      }
      return {
        name: "PaymentFailed",
        payload: {
          bookingId: command.targetAggregateId,
          paymentId: command.payload.paymentId,
          reason: command.payload.reason,
        },
      };
    },

    RefundPayment: (command, state, { clock }) => {
      if (state.transactionId === null) {
        throw new Error("No payment to refund");
      }
      return {
        name: "PaymentRefunded",
        payload: {
          bookingId: command.targetAggregateId,
          paymentId: command.payload.paymentId,
          amount: command.payload.amount,
          refundedAt: clock.now().toISOString(),
        },
      };
    },
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
