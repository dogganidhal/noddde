import Fastify from "fastify";
import type { Domain } from "@noddde/engine";
import type { HotelInfrastructure } from "../types";
import metadataPlugin from "./plugins/metadata";
import errorHandlerPlugin from "./plugins/error-handler";
import { roomRoutes } from "./routes/rooms";
import { bookingRoutes } from "./routes/bookings";
import { queryRoutes } from "./routes/queries";

/**
 * Creates and configures a Fastify application wired to the domain.
 * Registers metadata extraction, error handling, and all route modules.
 *
 * @param domain - The initialized domain instance.
 * @returns A ready-to-listen Fastify instance.
 */
export function createApp(domain: Domain<HotelInfrastructure>) {
  const app = Fastify({ logger: false });

  // Plugins
  app.register(metadataPlugin);
  app.register(errorHandlerPlugin);

  // Routes
  app.register(roomRoutes, { domain });
  app.register(bookingRoutes, { domain });
  app.register(queryRoutes, { domain });

  // Health check
  app.get("/health", async () => ({ status: "ok" }));

  return app;
}
