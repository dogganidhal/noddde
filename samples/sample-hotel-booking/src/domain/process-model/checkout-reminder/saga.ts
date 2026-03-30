import { defineSaga } from "@noddde/core";
import type { HotelInfrastructure } from "../../../infrastructure/types";
import type { RoomEvent } from "../../event-model";
import type { RoomCommand } from "../../write-model/aggregates/room/commands";
import type { CheckoutReminderState } from "./state";
import { initialCheckoutReminderState } from "./state";
import {
  onGuestCheckedIn,
  onGuestCheckedOut,
  onRoomCreated,
  onRoomMadeAvailable,
  onRoomReserved,
  onRoomUnderMaintenance,
} from "./on-entries";

/** Type bundle for the CheckoutReminder saga. */
export type CheckoutReminderDef = {
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
    GuestCheckedIn: onGuestCheckedIn,
    GuestCheckedOut: onGuestCheckedOut,
    RoomReserved: onRoomReserved,
    RoomCreated: onRoomCreated,
    RoomMadeAvailable: onRoomMadeAvailable,
    RoomUnderMaintenance: onRoomUnderMaintenance,
  },
});
