import type { DefineEvents } from "@noddde/core";

export type VenueEvent = DefineEvents<{
  VenueCreated: { venueId: string; seatIds: string[] };
  SeatReserved: { seatId: string; customerId: string };
  SeatReleased: { seatId: string };
  ReservationRejected: { seatId: string; customerId: string; reason: string };
}>;
