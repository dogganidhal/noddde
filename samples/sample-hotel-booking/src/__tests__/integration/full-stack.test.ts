import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Domain } from "@noddde/engine";
import type { HotelInfrastructure } from "../../infrastructure/types";
import { createTestEnvironment } from "./setup";

describe("Full-stack (integration)", () => {
  let app: FastifyInstance;
  let domain: Domain<HotelInfrastructure>;

  beforeEach(async () => {
    const env = await createTestEnvironment();
    app = env.app;
    domain = env.domain;
  });

  afterEach(async () => {
    await app.close();
  });

  it("should persist events to SQLite and survive domain operations", async () => {
    // Create room via HTTP
    const roomRes = await app.inject({
      method: "POST",
      url: "/rooms",
      payload: {
        roomNumber: "201",
        type: "suite",
        floor: 3,
        pricePerNight: 500,
      },
    });
    expect(roomRes.statusCode).toBe(201);
    const { roomId } = roomRes.json();

    // Make available
    await app.inject({
      method: "POST",
      url: `/rooms/${roomId}/make-available`,
    });

    // Create booking via HTTP
    const bookingRes = await app.inject({
      method: "POST",
      url: "/bookings",
      payload: {
        guestId: "guest-vip",
        roomType: "suite",
        checkIn: "2026-05-01",
        checkOut: "2026-05-10",
        totalAmount: 4500,
      },
    });
    expect(bookingRes.statusCode).toBe(201);
    const { bookingId } = bookingRes.json();

    // Reserve, check-in, check-out via HTTP
    await app.inject({
      method: "POST",
      url: `/rooms/${roomId}/reserve`,
      payload: {
        bookingId,
        guestId: "guest-vip",
        checkIn: "2026-05-01",
        checkOut: "2026-05-10",
      },
    });

    await app.inject({
      method: "POST",
      url: `/rooms/${roomId}/check-in`,
      payload: { bookingId, guestId: "guest-vip" },
    });

    await app.inject({
      method: "POST",
      url: `/rooms/${roomId}/check-out`,
      payload: { bookingId, guestId: "guest-vip" },
    });

    // The room should be available again — verify via domain dispatch
    // (This proves events are persisted and state is reconstructed)
    await domain.dispatchCommand({
      name: "ReserveRoom",
      targetAggregateId: roomId,
      payload: {
        bookingId: "b-next",
        guestId: "guest-next",
        checkIn: "2026-05-15",
        checkOut: "2026-05-20",
      },
    });

    // If we get here without error, the room was correctly restored to available
  });

  it("should handle metadata context from HTTP headers", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/rooms",
      headers: {
        "x-user-id": "admin-user",
        "x-correlation-id": "trace-abc",
      },
      payload: {
        roomNumber: "301",
        type: "single",
        floor: 3,
        pricePerNight: 100,
      },
    });

    expect(response.statusCode).toBe(201);
    // The metadata provider reads from AsyncLocalStorage —
    // in production this would enrich event metadata with userId/correlationId
  });

  it("should handle group booking via HTTP", async () => {
    // Create two rooms
    const room1Res = await app.inject({
      method: "POST",
      url: "/rooms",
      payload: {
        roomNumber: "401",
        type: "double",
        floor: 4,
        pricePerNight: 200,
      },
    });
    const room1Id = room1Res.json().roomId;
    await app.inject({
      method: "POST",
      url: `/rooms/${room1Id}/make-available`,
    });

    const room2Res = await app.inject({
      method: "POST",
      url: "/rooms",
      payload: {
        roomNumber: "402",
        type: "single",
        floor: 4,
        pricePerNight: 100,
      },
    });
    const room2Id = room2Res.json().roomId;
    await app.inject({
      method: "POST",
      url: `/rooms/${room2Id}/make-available`,
    });

    // Group booking
    const response = await app.inject({
      method: "POST",
      url: "/bookings/group",
      payload: {
        guestId: "guest-group",
        rooms: [
          {
            roomId: room1Id,
            roomType: "double",
            checkIn: "2026-06-01",
            checkOut: "2026-06-05",
            totalAmount: 800,
          },
          {
            roomId: room2Id,
            roomType: "single",
            checkIn: "2026-06-01",
            checkOut: "2026-06-05",
            totalAmount: 400,
          },
        ],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.bookingIds).toHaveLength(2);
  });
});
