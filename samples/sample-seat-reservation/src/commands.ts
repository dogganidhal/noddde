import type { DefineCommands } from "@noddde/core";

export type VenueCommand = DefineCommands<{
  CreateVenue: { seatIds: string[] };
  ReserveSeat: { seatId: string; customerId: string };
  ReleaseSeat: { seatId: string };
}>;
