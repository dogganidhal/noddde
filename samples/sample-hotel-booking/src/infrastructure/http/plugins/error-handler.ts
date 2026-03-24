import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

/**
 * Fastify plugin that maps domain errors to HTTP status codes.
 * - ConcurrencyError → 409 Conflict
 * - "already" / "cannot" in message → 409
 * - "not found" → 404
 * - Other errors → 500
 */
export default fp(
  async (fastify: FastifyInstance) => {
    fastify.setErrorHandler(async (err, _request, reply) => {
      const error = err as Error;
      const message = error.message ?? "Internal server error";
      const lower = message.toLowerCase();

      if (
        error.name === "ConcurrencyError" ||
        lower.includes("already") ||
        lower.includes("cannot")
      ) {
        return reply.status(409).send({ error: message });
      }

      if (lower.includes("not found")) {
        return reply.status(404).send({ error: message });
      }

      return reply.status(500).send({ error: message });
    });
  },
  { name: "error-handler-plugin" },
);
