import { DefineCommands } from "@noddde/core";
import type { RoomType } from "../../../infrastructure/types";

export type BookingCommand = DefineCommands<{
  CreateBooking: {
    guestId: string;
    roomType: RoomType;
    checkIn: string;
    checkOut: string;
    totalAmount: number;
  };
  ConfirmBooking: {
    roomId: string;
  };
  CancelBooking: {
    reason: string;
  };
  ModifyBooking: {
    newCheckIn: string;
    newCheckOut: string;
    newTotalAmount: number;
  };
  RequestPayment: {
    paymentId: string;
    amount: number;
  };
  CompletePayment: {
    paymentId: string;
    transactionId: string;
    amount: number;
  };
  FailPayment: {
    paymentId: string;
    reason: string;
  };
  RefundPayment: {
    paymentId: string;
    amount: number;
  };
}>;
