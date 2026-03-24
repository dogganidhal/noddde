import { DefineQueries } from "@noddde/core";
import type { ViewStore } from "@noddde/core";
import type { RoomType } from "../../infrastructure/types";

// ── View types ──────────────────────────────────────────────────

export interface RoomAvailabilityView {
  roomId: string;
  roomNumber: string;
  type: RoomType;
  floor: number;
  pricePerNight: number;
  status: string;
  currentGuestId: string | null;
}

export interface GuestHistoryView {
  guestId: string;
  bookings: Array<{
    bookingId: string;
    roomType: RoomType;
    checkIn: string;
    checkOut: string;
    status: string;
  }>;
}

export interface RevenueView {
  date: string;
  totalRevenue: number;
  bookingCount: number;
}

// ── View store interfaces ───────────────────────────────────────

/**
 * Extended view store for room availability. Adds domain-specific
 * query methods that push filtering to the database instead of
 * loading all views into memory.
 */
export interface RoomAvailabilityViewStore
  extends ViewStore<RoomAvailabilityView> {
  /** Finds available rooms, optionally filtered by room type. */
  // eslint-disable-next-line no-unused-vars
  findAvailable(type?: RoomType): Promise<RoomAvailabilityView[]>;
}

// ── Query types ─────────────────────────────────────────────────

export type RoomAvailabilityQuery = DefineQueries<{
  GetRoomAvailability: {
    payload: { roomId: string };
    result: RoomAvailabilityView | null;
  };
  ListAvailableRooms: {
    payload: { type?: RoomType };
    result: RoomAvailabilityView[];
  };
}>;

export type GuestHistoryQuery = DefineQueries<{
  GetGuestHistory: {
    payload: { guestId: string };
    result: GuestHistoryView | null;
  };
}>;

export type RevenueQuery = DefineQueries<{
  GetDailyRevenue: {
    payload: { date: string };
    result: RevenueView | null;
  };
}>;

export type SearchQuery = DefineQueries<{
  SearchAvailableRooms: {
    payload: { type?: RoomType };
    result: RoomAvailabilityView[];
  };
}>;
