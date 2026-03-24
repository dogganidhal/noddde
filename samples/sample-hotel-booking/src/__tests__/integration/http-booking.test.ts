import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestEnvironment } from "./setup";
import type { InMemoryPaymentGateway } from "../../infrastructure/services/payment-gateway";

describe("HTTP Bookings (integration)", () => {
  let app: FastifyInstance;
  let services: Awaited<ReturnType<typeof createTestEnvironment>>["services"];
  let sqlite: any;

  beforeEach(async () => {
    const env = await createTestEnvironment();
    app = env.app;
    services = env.services;
    sqlite = env.sqlite;
  });

  afterEach(async () => {
    await app.close();
  });

  it("POST /bookings should create a booking", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/bookings",
      payload: {
        guestId: "guest-1",
        roomType: "double",
        checkIn: "2026-04-10",
        checkOut: "2026-04-15",
        totalAmount: 500,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.bookingId).toBeTruthy();
  });

  it("should auto-cancel booking when no room available (saga end-to-end)", async () => {
    // Create booking with no room of that type → saga auto-cancels
    const createRes = await app.inject({
      method: "POST",
      url: "/bookings",
      payload: {
        guestId: "guest-1",
        roomType: "single",
        checkIn: "2026-04-10",
        checkOut: "2026-04-12",
        totalAmount: 200,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const { bookingId } = createRes.json();

    // The saga chain auto-fires: RequestPayment → charge → CompletePayment
    // → SearchAvailableRooms (none found) → CancelBooking
    // Verify the booking was auto-cancelled by checking events
    const events = sqlite
      .prepare(
        "SELECT event_name FROM noddde_events WHERE aggregate_name = 'Booking' AND aggregate_id = ? ORDER BY sequence_number",
      )
      .all(bookingId);
    const eventNames = events.map((e: any) => e.event_name);

    expect(eventNames).toContain("BookingCreated");
    expect(eventNames).toContain("PaymentRequested");
    expect(eventNames).toContain("PaymentCompleted");
    expect(eventNames).toContain("BookingCancelled");
  });

  it("should auto-confirm and auto-reserve when room available (saga end-to-end)", async () => {
    // Create a room first
    const roomRes = await app.inject({
      method: "POST",
      url: "/rooms",
      payload: {
        roomNumber: "201",
        type: "double",
        floor: 2,
        pricePerNight: 250,
      },
    });
    const { roomId } = roomRes.json();
    await app.inject({
      method: "POST",
      url: `/rooms/${roomId}/make-available`,
    });

    // Create booking → saga auto-confirms and auto-reserves the room
    const createRes = await app.inject({
      method: "POST",
      url: "/bookings",
      payload: {
        guestId: "guest-1",
        roomType: "double",
        checkIn: "2026-04-10",
        checkOut: "2026-04-15",
        totalAmount: 500,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const { bookingId } = createRes.json();

    // Verify full saga chain fired
    const bookingEvents = sqlite
      .prepare(
        "SELECT event_name FROM noddde_events WHERE aggregate_name = 'Booking' AND aggregate_id = ? ORDER BY sequence_number",
      )
      .all(bookingId);
    const bookingEventNames = bookingEvents.map((e: any) => e.event_name);

    expect(bookingEventNames).toContain("BookingCreated");
    expect(bookingEventNames).toContain("PaymentRequested");
    expect(bookingEventNames).toContain("PaymentCompleted");
    expect(bookingEventNames).toContain("BookingConfirmed");

    // Verify room was auto-reserved
    const roomEvents = sqlite
      .prepare(
        "SELECT event_name FROM noddde_events WHERE aggregate_name = 'Room' AND aggregate_id = ? ORDER BY sequence_number",
      )
      .all(roomId);
    const roomEventNames = roomEvents.map((e: any) => e.event_name);

    expect(roomEventNames).toContain("RoomReserved");

    // Verify payment gateway was called
    expect(
      (services.paymentGateway as InMemoryPaymentGateway).charges,
    ).toHaveLength(1);
  });

  it("should handle full booking + room lifecycle (auto-saga flow)", async () => {
    // Create room
    const roomRes = await app.inject({
      method: "POST",
      url: "/rooms",
      payload: {
        roomNumber: "101",
        type: "double",
        floor: 2,
        pricePerNight: 200,
      },
    });
    const { roomId } = roomRes.json();
    await app.inject({
      method: "POST",
      url: `/rooms/${roomId}/make-available`,
    });

    // Create booking → saga auto-flow: payment → confirm → reserve
    const bookingRes = await app.inject({
      method: "POST",
      url: "/bookings",
      payload: {
        guestId: "guest-1",
        roomType: "double",
        checkIn: "2026-04-10",
        checkOut: "2026-04-15",
        totalAmount: 500,
      },
    });
    const { bookingId } = bookingRes.json();

    // Room is already reserved by the saga — check in directly
    const checkInRes = await app.inject({
      method: "POST",
      url: `/rooms/${roomId}/check-in`,
      payload: { bookingId, guestId: "guest-1" },
    });
    expect(checkInRes.statusCode).toBe(200);

    // Check out
    const checkOutRes = await app.inject({
      method: "POST",
      url: `/rooms/${roomId}/check-out`,
      payload: { bookingId, guestId: "guest-1" },
    });
    expect(checkOutRes.statusCode).toBe(200);
  });

  it("GET /health should return ok", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});
