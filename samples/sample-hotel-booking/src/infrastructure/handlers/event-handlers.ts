import type { EventHandler } from "@noddde/core";
import type { HotelInfrastructure } from "../types";
import type { BookingEvent } from "../../domain/write-model/booking/events";
import type { RoomEvent } from "../../domain/write-model/room/events";

/**
 * Sends an email confirmation when a booking is confirmed.
 * Registered as a standalone event handler on the event bus.
 *
 * In production, this handler would query a read model (e.g. GuestHistory)
 * to resolve the guest's email from the bookingId. For the sample, we use
 * a placeholder recipient derived from the bookingId.
 */
export const SendBookingConfirmation: EventHandler<
  Extract<BookingEvent, { name: "BookingConfirmed" }>,
  HotelInfrastructure
> = async (event, { emailService }) => {
  // Real system: const guest = await queryBus.dispatch({ name: "GetGuestByBooking", ... });
  const recipient = `guest+${event.payload.bookingId}@hotel.example`;
  await emailService.send(
    recipient,
    "Booking Confirmed",
    `Your booking ${event.payload.bookingId} has been confirmed for room ${event.payload.roomId}.`,
  );
};

/**
 * Sends an SMS notification when a guest checks in.
 * Registered as a standalone event handler on the event bus.
 */
export const SendCheckInNotification: EventHandler<
  Extract<RoomEvent, { name: "GuestCheckedIn" }>,
  HotelInfrastructure
> = async (event, { smsService }) => {
  await smsService.send(
    event.payload.guestId,
    `Check-in confirmed for room. Booking: ${event.payload.bookingId}`,
  );
};
