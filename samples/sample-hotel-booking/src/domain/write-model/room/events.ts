import { DefineEvents } from "@noddde/core";
import type { RoomType } from "../../../infrastructure/types";

export type RoomEvent = DefineEvents<{
  RoomCreated: {
    roomId: string;
    roomNumber: string;
    type: RoomType;
    floor: number;
    pricePerNight: number;
  };
  RoomMadeAvailable: {
    roomId: string;
  };
  RoomReserved: {
    roomId: string;
    bookingId: string;
    guestId: string;
    checkIn: string;
    checkOut: string;
  };
  GuestCheckedIn: {
    roomId: string;
    bookingId: string;
    guestId: string;
    checkedInAt: string;
  };
  GuestCheckedOut: {
    roomId: string;
    bookingId: string;
    guestId: string;
    checkedOutAt: string;
  };
  RoomUnderMaintenance: {
    roomId: string;
    reason: string;
    estimatedUntil: string;
  };
}>;
