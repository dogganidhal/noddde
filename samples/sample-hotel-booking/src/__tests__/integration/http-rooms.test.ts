import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestEnvironment } from "./setup";

describe("HTTP Rooms (integration)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const env = await createTestEnvironment();
    app = env.app;
  });

  afterEach(async () => {
    await app.close();
  });

  it("POST /rooms should create a room and return roomId", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/rooms",
      payload: {
        roomNumber: "101",
        type: "double",
        floor: 2,
        pricePerNight: 200,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.roomId).toBeTruthy();
  });

  it("POST /rooms/:roomId/make-available should succeed", async () => {
    // Create room first
    const createRes = await app.inject({
      method: "POST",
      url: "/rooms",
      payload: {
        roomNumber: "101",
        type: "single",
        floor: 1,
        pricePerNight: 100,
      },
    });
    const { roomId } = createRes.json();

    // Make available
    const response = await app.inject({
      method: "POST",
      url: `/rooms/${roomId}/make-available`,
    });

    expect(response.statusCode).toBe(200);
  });

  it("POST /rooms/:roomId/maintenance should put room under maintenance", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/rooms",
      payload: {
        roomNumber: "101",
        type: "single",
        floor: 1,
        pricePerNight: 100,
      },
    });
    const { roomId } = createRes.json();

    await app.inject({
      method: "POST",
      url: `/rooms/${roomId}/make-available`,
    });

    const response = await app.inject({
      method: "POST",
      url: `/rooms/${roomId}/maintenance`,
      payload: {
        reason: "Plumbing repair",
        estimatedUntil: "2026-04-20",
      },
    });

    expect(response.statusCode).toBe(200);
  });

  it("should return 409 for invalid state transitions", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/rooms",
      payload: {
        roomNumber: "101",
        type: "single",
        floor: 1,
        pricePerNight: 100,
      },
    });
    const { roomId } = createRes.json();

    // Try to reserve without making available first
    const response = await app.inject({
      method: "POST",
      url: `/rooms/${roomId}/reserve`,
      payload: {
        bookingId: "b-1",
        guestId: "guest-1",
        checkIn: "2026-04-10",
        checkOut: "2026-04-15",
      },
    });

    expect(response.statusCode).toBe(409);
  });
});
