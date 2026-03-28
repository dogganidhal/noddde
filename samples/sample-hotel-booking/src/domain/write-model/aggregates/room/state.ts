import type { RoomType } from "../../../../infrastructure/types";

/** Room lifecycle status. */
export type RoomStatus =
  | "created"
  | "available"
  | "reserved"
  | "occupied"
  | "maintenance";

/** Room aggregate state. */
export interface RoomState {
  roomNumber: string | null;
  type: RoomType | null;
  floor: number;
  pricePerNight: number;
  status: RoomStatus;
  currentBookingId: string | null;
  currentGuestId: string | null;
}

/** Initial state for a new room aggregate. */
export const initialRoomState: RoomState = {
  roomNumber: null,
  type: null,
  floor: 0,
  pricePerNight: 0,
  status: "created",
  currentBookingId: null,
  currentGuestId: null,
};
