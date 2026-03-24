import { describe, expect, it } from "vitest";
import { testProjection } from "@noddde/testing";
import { GuestHistoryProjection } from "../../domain/read-model/projections/guest-history";

describe("GuestHistory projection", () => {
  it("should add a booking to guest history on BookingCreated", async () => {
    const result = await testProjection(GuestHistoryProjection)
      .initialView({ guestId: "", bookings: [] })
      .given({
        name: "BookingCreated",
        payload: {
          bookingId: "b-1",
          guestId: "guest-1",
          roomType: "double" as const,
          checkIn: "2026-04-10",
          checkOut: "2026-04-15",
          totalAmount: 500,
          createdAt: "2026-04-01T10:00:00Z",
        },
      })
      .execute();

    expect(result.view.guestId).toBe("guest-1");
    expect(result.view.bookings).toHaveLength(1);
    expect(result.view.bookings[0]).toMatchObject({
      bookingId: "b-1",
      roomType: "double",
      checkIn: "2026-04-10",
      checkOut: "2026-04-15",
      status: "pending",
    });
  });

  it("should accumulate multiple bookings for the same guest", async () => {
    const result = await testProjection(GuestHistoryProjection)
      .initialView({ guestId: "", bookings: [] })
      .given(
        {
          name: "BookingCreated",
          payload: {
            bookingId: "b-1",
            guestId: "guest-1",
            roomType: "single" as const,
            checkIn: "2026-04-10",
            checkOut: "2026-04-12",
            totalAmount: 200,
            createdAt: "2026-04-01T10:00:00Z",
          },
        },
        {
          name: "BookingCreated",
          payload: {
            bookingId: "b-2",
            guestId: "guest-1",
            roomType: "suite" as const,
            checkIn: "2026-05-01",
            checkOut: "2026-05-05",
            totalAmount: 2000,
            createdAt: "2026-04-20T10:00:00Z",
          },
        },
      )
      .execute();

    expect(result.view.bookings).toHaveLength(2);
    expect(result.view.bookings[0]!.bookingId).toBe("b-1");
    expect(result.view.bookings[1]!.bookingId).toBe("b-2");
  });
});
