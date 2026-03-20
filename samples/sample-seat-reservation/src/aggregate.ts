import { defineAggregate } from "@noddde/core";
import type { AggregateTypes } from "@noddde/core";
import type { VenueEvent } from "./events";
import type { VenueCommand } from "./commands";
import type { VenueInfrastructure } from "./infrastructure";

export type SeatInfo = {
  status: "available" | "reserved" | "sold";
  heldBy?: string;
};

export type VenueState = {
  seats: Record<string, SeatInfo>;
};

type VenueTypes = AggregateTypes & {
  state: VenueState;
  events: VenueEvent;
  commands: VenueCommand;
  infrastructure: VenueInfrastructure;
};

export const Venue = defineAggregate<VenueTypes>({
  initialState: { seats: {} },
  commands: {
    CreateVenue: (command) => ({
      name: "VenueCreated",
      payload: {
        venueId: command.targetAggregateId,
        seatIds: command.payload.seatIds,
      },
    }),
    ReserveSeat: (command, state, infrastructure) => {
      const { seatId, customerId } = command.payload;
      const seat = state.seats[seatId];

      if (!seat) {
        return {
          name: "ReservationRejected",
          payload: { seatId, customerId, reason: "seat_not_found" },
        };
      }

      if (seat.status !== "available") {
        return {
          name: "ReservationRejected",
          payload: {
            seatId,
            customerId,
            reason: `seat_${seat.status}${seat.heldBy ? `_by_${seat.heldBy}` : ""}`,
          },
        };
      }

      // Simulate expensive validation (adjacency rules, pricing, etc.)
      // In a real app this would query external services
      void infrastructure.clock.now();

      return {
        name: "SeatReserved",
        payload: { seatId, customerId },
      };
    },
    ReleaseSeat: (command, state) => {
      const { seatId } = command.payload;
      const seat = state.seats[seatId];

      if (!seat || seat.status !== "reserved") {
        return { name: "SeatReleased", payload: { seatId } };
      }

      return { name: "SeatReleased", payload: { seatId } };
    },
  },
  apply: {
    VenueCreated: (payload) => {
      const seats: Record<string, SeatInfo> = {};
      for (const seatId of payload.seatIds) {
        seats[seatId] = { status: "available" };
      }
      return { seats };
    },
    SeatReserved: (payload, state) => ({
      seats: {
        ...state.seats,
        [payload.seatId]: { status: "reserved", heldBy: payload.customerId },
      },
    }),
    SeatReleased: (payload, state) => ({
      seats: {
        ...state.seats,
        [payload.seatId]: { status: "available" },
      },
    }),
    ReservationRejected: (_payload, state) => state,
  },
});
