import { AsyncLocalStorage } from "node:async_hooks";
import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { MetadataContext } from "@noddde/engine";

/** AsyncLocalStorage holding per-request metadata context. */
export const requestMetadataStorage = new AsyncLocalStorage<MetadataContext>();

/**
 * Extracts metadata context from HTTP headers.
 * - `x-user-id` → `userId`
 * - `x-correlation-id` → `correlationId`
 */
function extractMetadata(request: FastifyRequest): MetadataContext {
  const headers = request.headers;
  return {
    userId:
      typeof headers["x-user-id"] === "string"
        ? headers["x-user-id"]
        : undefined,
    correlationId:
      typeof headers["x-correlation-id"] === "string"
        ? headers["x-correlation-id"]
        : undefined,
  };
}

/**
 * Fastify plugin that wraps each request in an AsyncLocalStorage context
 * with metadata extracted from HTTP headers. The domain's `metadataProvider`
 * reads from this storage.
 */
export default fp(
  async (fastify: FastifyInstance) => {
    // eslint-disable-next-line no-unused-vars
    fastify.addHook("preHandler", async (request, _reply) => {
      const metadata = extractMetadata(request);
      requestMetadataStorage.enterWith(metadata);
    });
  },
  { name: "metadata-plugin" },
);
