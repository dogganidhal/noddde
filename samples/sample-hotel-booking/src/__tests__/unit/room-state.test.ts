import { describe, expect, it } from "vitest";
import { evolveAggregate } from "@noddde/testing";
import { Room } from "../../domain/write-model/aggregates/room";

describe("Room state reconstruction", () => {
  it("should reconstruct created state from RoomCreated", () => {
    const state = evolveAggregate(Room, [
      {
        name: "RoomCreated",
        payload: {
          roomId: "room-101",
          roomNumber: "101",
          type: "single" as const,
          floor: 1,
          pricePerNight: 100,
        },
      },
    ]);

    expect(state.roomNumber).toBe("101");
    expect(state.type).toBe("single");
    expect(state.floor).toBe(1);
    expect(state.pricePerNight).toBe(100);
    expect(state.status).toBe("created");
    expect(state.currentBookingId).toBeNull();
    expect(state.currentGuestId).toBeNull();
  });

  it("should reconstruct available state from create + make-available", () => {
    const state = evolveAggregate(Room, [
      {
        name: "RoomCreated",
        payload: {
          roomId: "room-101",
          roomNumber: "101",
          type: "double" as const,
          floor: 2,
          pricePerNight: 200,
        },
      },
      {
        name: "RoomMadeAvailable",
        payload: { roomId: "room-101" },
      },
    ]);

    expect(state.status).toBe("available");
    expect(state.roomNumber).toBe("101");
    expect(state.type).toBe("double");
    expect(state.currentBookingId).toBeNull();
    expect(state.currentGuestId).toBeNull();
  });

  it("should reconstruct occupied state from full check-in sequence", () => {
    const state = evolveAggregate(Room, [
      {
        name: "RoomCreated",
        payload: {
          roomId: "room-101",
          roomNumber: "101",
          type: "single" as const,
          floor: 1,
          pricePerNight: 100,
        },
      },
      {
        name: "RoomMadeAvailable",
        payload: { roomId: "room-101" },
      },
      {
        name: "RoomReserved",
        payload: {
          roomId: "room-101",
          bookingId: "b-1",
          guestId: "guest-1",
          checkIn: "2026-04-10",
          checkOut: "2026-04-15",
        },
      },
      {
        name: "GuestCheckedIn",
        payload: {
          roomId: "room-101",
          bookingId: "b-1",
          guestId: "guest-1",
          checkedInAt: "2026-04-10T14:00:00Z",
        },
      },
    ]);

    expect(state.status).toBe("occupied");
    expect(state.currentBookingId).toBe("b-1");
    expect(state.currentGuestId).toBe("guest-1");
  });

  it("should reconstruct available state after full checkout cycle", () => {
    const state = evolveAggregate(Room, [
      {
        name: "RoomCreated",
        payload: {
          roomId: "room-101",
          roomNumber: "101",
          type: "single" as const,
          floor: 1,
          pricePerNight: 100,
        },
      },
      {
        name: "RoomMadeAvailable",
        payload: { roomId: "room-101" },
      },
      {
        name: "RoomReserved",
        payload: {
          roomId: "room-101",
          bookingId: "b-1",
          guestId: "guest-1",
          checkIn: "2026-04-10",
          checkOut: "2026-04-15",
        },
      },
      {
        name: "GuestCheckedIn",
        payload: {
          roomId: "room-101",
          bookingId: "b-1",
          guestId: "guest-1",
          checkedInAt: "2026-04-10T14:00:00Z",
        },
      },
      {
        name: "GuestCheckedOut",
        payload: {
          roomId: "room-101",
          bookingId: "b-1",
          guestId: "guest-1",
          checkedOutAt: "2026-04-15T11:00:00Z",
        },
      },
    ]);

    expect(state.status).toBe("available");
    expect(state.currentBookingId).toBeNull();
    expect(state.currentGuestId).toBeNull();
  });

  it("should reconstruct maintenance state", () => {
    const state = evolveAggregate(Room, [
      {
        name: "RoomCreated",
        payload: {
          roomId: "room-101",
          roomNumber: "101",
          type: "single" as const,
          floor: 1,
          pricePerNight: 100,
        },
      },
      {
        name: "RoomMadeAvailable",
        payload: { roomId: "room-101" },
      },
      {
        name: "RoomUnderMaintenance",
        payload: {
          roomId: "room-101",
          reason: "Plumbing repair",
          estimatedUntil: "2026-04-20",
        },
      },
    ]);

    expect(state.status).toBe("maintenance");
    expect(state.currentBookingId).toBeNull();
    expect(state.currentGuestId).toBeNull();
  });

  it("should return initialState for empty event history", () => {
    const state = evolveAggregate(Room, []);

    expect(state.roomNumber).toBeNull();
    expect(state.type).toBeNull();
    expect(state.floor).toBe(0);
    expect(state.pricePerNight).toBe(0);
    expect(state.status).toBe("created");
    expect(state.currentBookingId).toBeNull();
    expect(state.currentGuestId).toBeNull();
  });

  it("should handle full lifecycle: create -> available -> reserve -> check-in -> check-out -> available", () => {
    const state = evolveAggregate(Room, [
      {
        name: "RoomCreated",
        payload: {
          roomId: "room-101",
          roomNumber: "101",
          type: "suite" as const,
          floor: 3,
          pricePerNight: 500,
        },
      },
      {
        name: "RoomMadeAvailable",
        payload: { roomId: "room-101" },
      },
      {
        name: "RoomReserved",
        payload: {
          roomId: "room-101",
          bookingId: "b-1",
          guestId: "guest-1",
          checkIn: "2026-04-10",
          checkOut: "2026-04-15",
        },
      },
      {
        name: "GuestCheckedIn",
        payload: {
          roomId: "room-101",
          bookingId: "b-1",
          guestId: "guest-1",
          checkedInAt: "2026-04-10T14:00:00Z",
        },
      },
      {
        name: "GuestCheckedOut",
        payload: {
          roomId: "room-101",
          bookingId: "b-1",
          guestId: "guest-1",
          checkedOutAt: "2026-04-15T11:00:00Z",
        },
      },
    ]);

    // After full lifecycle, room is available again
    expect(state.status).toBe("available");
    expect(state.roomNumber).toBe("101");
    expect(state.type).toBe("suite");
    expect(state.floor).toBe(3);
    expect(state.pricePerNight).toBe(500);
    expect(state.currentBookingId).toBeNull();
    expect(state.currentGuestId).toBeNull();
  });
});
