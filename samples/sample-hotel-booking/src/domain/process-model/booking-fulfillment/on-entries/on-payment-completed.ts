import type { InferSagaOnEntry } from "@noddde/core";
import type { BookingFulfillmentDef } from "../saga";

export const onPaymentCompleted: InferSagaOnEntry<
  BookingFulfillmentDef,
  "PaymentCompleted"
> = {
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
};
