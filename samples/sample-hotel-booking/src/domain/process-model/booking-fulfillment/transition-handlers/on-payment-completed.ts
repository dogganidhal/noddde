import type { BookingFulfillmentState } from "../state";

/** Transition handler for PaymentCompleted: finds available room, confirms booking, reserves room. */
export const onPaymentCompleted = async (
  event: {
    payload: {
      bookingId: string;
      paymentId: string;
      transactionId: string;
      amount: number;
      completedAt: string;
    };
  },
  state: BookingFulfillmentState,
  infrastructure: any,
) => {
  const availableRooms = (await infrastructure.queryBus.dispatch({
    name: "SearchAvailableRooms",
    payload: { type: state.roomType },
  })) as any[];

  const room = availableRooms?.[0];
  if (!room) {
    return {
      state: { ...state, status: "cancelled" as const },
      commands: {
        name: "CancelBooking" as const,
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
        name: "ConfirmBooking" as const,
        targetAggregateId: state.bookingId,
        payload: { roomId: room.roomId },
      },
      {
        name: "ReserveRoom" as const,
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
};
