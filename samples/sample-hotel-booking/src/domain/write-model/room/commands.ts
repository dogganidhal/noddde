import { DefineCommands } from "@noddde/core";
import type { RoomType } from "../../../infrastructure/types";

export type RoomCommand = DefineCommands<{
  CreateRoom: {
    roomNumber: string;
    type: RoomType;
    floor: number;
    pricePerNight: number;
  };
  MakeRoomAvailable: void;
  ReserveRoom: {
    bookingId: string;
    guestId: string;
    checkIn: string;
    checkOut: string;
  };
  CheckInGuest: {
    bookingId: string;
    guestId: string;
  };
  CheckOutGuest: {
    bookingId: string;
    guestId: string;
  };
  PutUnderMaintenance: {
    reason: string;
    estimatedUntil: string;
  };
}>;
