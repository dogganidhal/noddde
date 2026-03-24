import { describe, expect, it } from "vitest";
import { testProjection } from "@noddde/testing";
import { RoomAvailabilityProjection } from "../../domain/read-model/projections/room-availability";

describe("RoomAvailability projection", () => {
  it("should create a view from RoomCreated", async () => {
    const result = await testProjection(RoomAvailabilityProjection)
      .given({
        name: "RoomCreated",
        payload: {
          roomId: "room-101",
          roomNumber: "101",
          type: "single" as const,
          floor: 1,
          pricePerNight: 100,
        },
      })
      .execute();

    expect(result.view).toMatchObject({
      roomId: "room-101",
      roomNumber: "101",
      type: "single",
      status: "created",
      currentGuestId: null,
    });
  });

  it("should track status through full lifecycle", async () => {
    const result = await testProjection(RoomAvailabilityProjection)
      .given(
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
      )
      .execute();

    expect(result.view.status).toBe("occupied");
    expect(result.view.currentGuestId).toBe("guest-1");
  });

  it("should reset to available after checkout", async () => {
    const result = await testProjection(RoomAvailabilityProjection)
      .given(
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
        { name: "RoomMadeAvailable", payload: { roomId: "room-101" } },
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
      )
      .execute();

    expect(result.view.status).toBe("available");
    expect(result.view.currentGuestId).toBeNull();
  });

  it("should reflect maintenance status", async () => {
    const result = await testProjection(RoomAvailabilityProjection)
      .given(
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
        { name: "RoomMadeAvailable", payload: { roomId: "room-101" } },
        {
          name: "RoomUnderMaintenance",
          payload: {
            roomId: "room-101",
            reason: "Plumbing",
            estimatedUntil: "2026-04-20",
          },
        },
      )
      .execute();

    expect(result.view.status).toBe("maintenance");
  });
});
