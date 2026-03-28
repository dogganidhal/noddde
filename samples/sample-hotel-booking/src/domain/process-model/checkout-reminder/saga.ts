import { defineSaga } from "@noddde/core";
import type { HotelInfrastructure } from "../../../infrastructure/types";
import type { RoomEvent } from "../../event-model";
import type { RoomCommand } from "../../write-model/aggregates/room/commands";
import type { CheckoutReminderState } from "./state";
import { initialCheckoutReminderState } from "./state";

/** Type bundle for the CheckoutReminder saga. */
type CheckoutReminderDef = {
  state: CheckoutReminderState;
  events: RoomEvent;
  commands: RoomCommand;
  infrastructure: HotelInfrastructure;
};

/**
 * Tracks guest stays and sends checkout reminders. Starts when a guest
 * checks in and completes when they check out.
 *
 * Uses the smsService from infrastructure to send notifications,
 * demonstrating saga side effects via infrastructure.
 */
export const CheckoutReminderSaga = defineSaga<CheckoutReminderDef>({
  initialState: initialCheckoutReminderState,

  startedBy: ["GuestCheckedIn"],

  on: {
    // --- Guest checked in -> record stay, send welcome SMS ---
    GuestCheckedIn: {
      id: (event) => event.payload.roomId,
      handle: async (event, state, { smsService }) => {
        await smsService.send(
          event.payload.guestId,
          `Welcome! Your checkout is expected at the end of your stay.`,
        );
        return {
          state: {
            ...state,
            roomId: event.payload.roomId,
            bookingId: event.payload.bookingId,
            guestId: event.payload.guestId,
            status: "guest_checked_in" as const,
          },
        };
      },
    },

    // --- Guest checked out -> send farewell, complete saga ---
    GuestCheckedOut: {
      id: (event) => event.payload.roomId,
      handle: async (event, state, { smsService }) => {
        await smsService.send(
          state.guestId,
          `Thank you for your stay! We hope to see you again.`,
        );
        return {
          state: {
            ...state,
            status: "completed" as const,
          },
        };
      },
    },

    // --- Room reserved -> observation (no action needed) ---
    RoomReserved: {
      id: (event) => event.payload.roomId,
      handle: (_event, state) => ({ state }),
    },

    // --- Events observed but not acted upon ---
    RoomCreated: {
      id: (event) => event.payload.roomId,
      handle: (_event, state) => ({ state }),
    },
    RoomMadeAvailable: {
      id: (event) => event.payload.roomId,
      handle: (_event, state) => ({ state }),
    },
    RoomUnderMaintenance: {
      id: (event) => event.payload.roomId,
      handle: (_event, state) => ({ state }),
    },
  },
});
