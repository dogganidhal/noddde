import { defineSaga } from "@noddde/core";
import type { HotelInfrastructure } from "../../infrastructure/types";
import type { RoomEvent } from "../write-model/room/events";
import type { RoomCommand } from "../write-model/room/commands";

// ── Saga state ──────────────────────────────────────────────────

export type CheckoutReminderStatus = "idle" | "guest_checked_in" | "completed";

export interface CheckoutReminderState {
  roomId: string;
  bookingId: string;
  guestId: string;
  status: CheckoutReminderStatus;
}

// ── Types bundle ────────────────────────────────────────────────

type CheckoutReminderDef = {
  state: CheckoutReminderState;
  events: RoomEvent;
  commands: RoomCommand;
  infrastructure: HotelInfrastructure;
};

// ── Saga definition ─────────────────────────────────────────────

/**
 * Tracks guest stays and sends checkout reminders. Starts when a guest
 * checks in and completes when they check out.
 *
 * Uses the smsService from infrastructure to send notifications,
 * demonstrating saga side effects via infrastructure.
 */
export const CheckoutReminderSaga = defineSaga<CheckoutReminderDef>({
  initialState: {
    roomId: "",
    bookingId: "",
    guestId: "",
    status: "idle",
  },

  startedBy: ["GuestCheckedIn"],

  associations: {
    RoomCreated: (event) => event.payload.roomId,
    RoomMadeAvailable: (event) => event.payload.roomId,
    RoomReserved: (event) => event.payload.roomId,
    GuestCheckedIn: (event) => event.payload.roomId,
    GuestCheckedOut: (event) => event.payload.roomId,
    RoomUnderMaintenance: (event) => event.payload.roomId,
  },

  handlers: {
    // ─── Guest checked in → record stay, send welcome SMS ────────
    GuestCheckedIn: async (event, state, { smsService }) => {
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

    // ─── Guest checked out → send farewell, complete saga ────────
    GuestCheckedOut: async (event, state, { smsService }) => {
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

    // ─── Room reserved → observation (no action needed) ──────────
    RoomReserved: (_event, state) => ({ state }),

    // ─── Events observed but not acted upon ──────────────────────
    RoomCreated: (_event, state) => ({ state }),
    RoomMadeAvailable: (_event, state) => ({ state }),
    RoomUnderMaintenance: (_event, state) => ({ state }),
  },
});
