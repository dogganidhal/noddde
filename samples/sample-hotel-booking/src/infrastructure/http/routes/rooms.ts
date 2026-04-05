import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import type { Domain } from "@noddde/engine";
import type { HotelPorts } from "../../types";

export async function roomRoutes(
  fastify: FastifyInstance,
  opts: { domain: Domain<HotelPorts, any, any, any, any> },
) {
  const { domain } = opts;

  // POST /rooms — create a new room
  fastify.post<{
    Body: {
      roomNumber: string;
      type: "single" | "double" | "suite";
      floor: number;
      pricePerNight: number;
    };
  }>("/rooms", async (request, reply) => {
    const roomId = randomUUID();
    await domain.dispatchCommand({
      name: "CreateRoom",
      targetAggregateId: roomId,
      payload: request.body,
    });
    return reply.status(201).send({ roomId });
  });

  // POST /rooms/:roomId/make-available
  fastify.post<{ Params: { roomId: string } }>(
    "/rooms/:roomId/make-available",
    async (request, reply) => {
      await domain.dispatchCommand({
        name: "MakeRoomAvailable",
        targetAggregateId: request.params.roomId,
      });
      return reply.status(200).send({ ok: true });
    },
  );

  // POST /rooms/:roomId/reserve
  fastify.post<{
    Params: { roomId: string };
    Body: {
      bookingId: string;
      guestId: string;
      checkIn: string;
      checkOut: string;
    };
  }>("/rooms/:roomId/reserve", async (request, reply) => {
    await domain.dispatchCommand({
      name: "ReserveRoom",
      targetAggregateId: request.params.roomId,
      payload: request.body,
    });
    return reply.status(200).send({ ok: true });
  });

  // POST /rooms/:roomId/check-in
  fastify.post<{
    Params: { roomId: string };
    Body: { bookingId: string; guestId: string };
  }>("/rooms/:roomId/check-in", async (request, reply) => {
    await domain.dispatchCommand({
      name: "CheckInGuest",
      targetAggregateId: request.params.roomId,
      payload: request.body,
    });
    return reply.status(200).send({ ok: true });
  });

  // POST /rooms/:roomId/check-out
  fastify.post<{
    Params: { roomId: string };
    Body: { bookingId: string; guestId: string };
  }>("/rooms/:roomId/check-out", async (request, reply) => {
    await domain.dispatchCommand({
      name: "CheckOutGuest",
      targetAggregateId: request.params.roomId,
      payload: request.body,
    });
    return reply.status(200).send({ ok: true });
  });

  // POST /rooms/:roomId/maintenance
  fastify.post<{
    Params: { roomId: string };
    Body: { reason: string; estimatedUntil: string };
  }>("/rooms/:roomId/maintenance", async (request, reply) => {
    await domain.dispatchCommand({
      name: "PutUnderMaintenance",
      targetAggregateId: request.params.roomId,
      payload: request.body,
    });
    return reply.status(200).send({ ok: true });
  });
}
