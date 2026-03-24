import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import type { Domain } from "@noddde/engine";
import type { HotelInfrastructure } from "../../types";

export async function bookingRoutes(
  fastify: FastifyInstance,
  opts: { domain: Domain<HotelInfrastructure> },
) {
  const { domain } = opts;

  // POST /bookings — create a booking
  fastify.post<{
    Body: {
      guestId: string;
      roomType: "single" | "double" | "suite";
      checkIn: string;
      checkOut: string;
      totalAmount: number;
    };
  }>("/bookings", async (request, reply) => {
    const bookingId = randomUUID();
    await domain.dispatchCommand({
      name: "CreateBooking",
      targetAggregateId: bookingId,
      payload: request.body,
    });
    return reply.status(201).send({ bookingId });
  });

  // POST /bookings/:bookingId/confirm
  fastify.post<{
    Params: { bookingId: string };
    Body: { roomId: string };
  }>("/bookings/:bookingId/confirm", async (request, reply) => {
    await domain.dispatchCommand({
      name: "ConfirmBooking",
      targetAggregateId: request.params.bookingId,
      payload: { roomId: request.body.roomId },
    });
    return reply.status(200).send({ ok: true });
  });

  // POST /bookings/:bookingId/cancel
  fastify.post<{
    Params: { bookingId: string };
    Body: { reason: string };
  }>("/bookings/:bookingId/cancel", async (request, reply) => {
    await domain.dispatchCommand({
      name: "CancelBooking",
      targetAggregateId: request.params.bookingId,
      payload: { reason: request.body.reason },
    });
    return reply.status(200).send({ ok: true });
  });

  // POST /bookings/:bookingId/request-payment
  fastify.post<{
    Params: { bookingId: string };
    Body: { amount: number };
  }>("/bookings/:bookingId/request-payment", async (request, reply) => {
    const paymentId = randomUUID();
    await domain.dispatchCommand({
      name: "RequestPayment",
      targetAggregateId: request.params.bookingId,
      payload: { paymentId, amount: request.body.amount },
    });
    return reply.status(200).send({ paymentId });
  });

  // POST /bookings/:bookingId/complete-payment
  fastify.post<{
    Params: { bookingId: string };
    Body: { paymentId: string; transactionId: string; amount: number };
  }>("/bookings/:bookingId/complete-payment", async (request, reply) => {
    await domain.dispatchCommand({
      name: "CompletePayment",
      targetAggregateId: request.params.bookingId,
      payload: request.body,
    });
    return reply.status(200).send({ ok: true });
  });

  // POST /bookings/group — atomic group booking via UnitOfWork
  fastify.post<{
    Body: {
      guestId: string;
      rooms: Array<{
        roomId: string;
        roomType: "single" | "double" | "suite";
        checkIn: string;
        checkOut: string;
        totalAmount: number;
      }>;
    };
  }>("/bookings/group", async (request, reply) => {
    const { guestId, rooms } = request.body;
    const bookingIds: string[] = [];

    await domain.withUnitOfWork(async () => {
      for (const room of rooms) {
        const bookingId = randomUUID();
        bookingIds.push(bookingId);
        await domain.dispatchCommand({
          name: "CreateBooking",
          targetAggregateId: bookingId,
          payload: {
            guestId,
            roomType: room.roomType,
            checkIn: room.checkIn,
            checkOut: room.checkOut,
            totalAmount: room.totalAmount,
          },
        });
        await domain.dispatchCommand({
          name: "ReserveRoom",
          targetAggregateId: room.roomId,
          payload: {
            bookingId,
            guestId,
            checkIn: room.checkIn,
            checkOut: room.checkOut,
          },
        });
      }
    });

    return reply.status(201).send({ bookingIds });
  });
}
