import type { FastifyInstance } from "fastify";
import type { Domain } from "@noddde/engine";
import type { HotelInfrastructure } from "../../types";

export async function queryRoutes(
  fastify: FastifyInstance,
  opts: { domain: Domain<HotelInfrastructure> },
) {
  const { domain } = opts;

  // GET /rooms/:roomId/availability
  fastify.get<{ Params: { roomId: string } }>(
    "/rooms/:roomId/availability",
    async (request, reply) => {
      const result = await domain.dispatchQuery({
        name: "GetRoomAvailability",
        payload: { roomId: request.params.roomId },
      });
      if (result == null)
        return reply.status(404).send({ error: "Room not found" });
      return result;
    },
  );

  // GET /rooms/available?type=single
  fastify.get<{ Querystring: { type?: string } }>(
    "/rooms/available",
    async (request) => {
      return domain.dispatchQuery({
        name: "SearchAvailableRooms",
        payload: {
          type: request.query.type as "single" | "double" | "suite" | undefined,
        },
      });
    },
  );

  // GET /guests/:guestId/history
  fastify.get<{ Params: { guestId: string } }>(
    "/guests/:guestId/history",
    async (request, reply) => {
      const result = await domain.dispatchQuery({
        name: "GetGuestHistory",
        payload: { guestId: request.params.guestId },
      });
      if (result == null)
        return reply.status(404).send({ error: "Guest not found" });
      return result;
    },
  );

  // GET /revenue/:date
  fastify.get<{ Params: { date: string } }>(
    "/revenue/:date",
    async (request, reply) => {
      const result = await domain.dispatchQuery({
        name: "GetDailyRevenue",
        payload: { date: request.params.date },
      });
      if (result == null)
        return reply
          .status(404)
          .send({ error: "No revenue data for this date" });
      return result;
    },
  );
}
