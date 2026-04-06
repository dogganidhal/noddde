/**
 * Hotel Booking Sample — Full-Stack Bootstrap
 *
 * Demonstrates >90% of @noddde framework features:
 * - Per-aggregate persistence (event-sourced + state-stored)
 * - Per-aggregate snapshots and concurrency
 * - Multiple projections with wired view stores
 * - Multiple sagas with cross-aggregate orchestration
 * - Standalone event/command/query handlers
 * - MetadataProvider via AsyncLocalStorage
 * - Fastify HTTP layer
 * - Drizzle + PostgreSQL persistence (via docker-compose)
 */
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { DrizzleAdapter, generateDrizzleMigration } from "@noddde/drizzle";
import {
  defineDomain,
  wireDomain,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
  InMemoryIdempotencyStore,
  InMemoryViewStore,
} from "@noddde/engine";
import { everyNEvents } from "@noddde/core";

import { SystemClock } from "./infrastructure/services/clock";
import { ConsoleEmailService } from "./infrastructure/services/email-service";
import { ConsoleSmsService } from "./infrastructure/services/sms-service";
import { FakePaymentGateway } from "./infrastructure/services/payment-gateway";

import { Room } from "./domain/write-model/aggregates/room";
import { Booking } from "./domain/write-model/aggregates/booking";
import { Inventory } from "./domain/write-model/aggregates/inventory";

import { RoomAvailabilityProjection } from "./domain/read-model/projections/room-availability";
import { GuestHistoryProjection } from "./domain/read-model/projections/guest-history";
import { RevenueProjection } from "./domain/read-model/projections/revenue";
import { SearchAvailableRoomsHandler } from "./domain/read-model/query-handlers";

import { BookingFulfillmentSaga } from "./domain/process-model/booking-fulfillment";
import { CheckoutReminderSaga } from "./domain/process-model/checkout-reminder";
import { PaymentProcessingSaga } from "./domain/process-model/payment-processing";

import { RunNightlyAuditHandler } from "./infrastructure/handlers/command-handlers";
import {
  SendBookingConfirmation,
  SendCheckInNotification,
} from "./infrastructure/handlers/event-handlers";

import { requestMetadataStorage } from "./infrastructure/http/plugins/metadata";
import { createApp } from "./infrastructure/http/app";
import { DrizzleRoomAvailabilityViewStore } from "./infrastructure/persistence/drizzle-view-store";

import type {
  GuestHistoryView,
  RevenueView,
} from "./domain/read-model/queries";

async function main() {
  // -- Database setup --
  const pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgres://noddde:noddde@localhost:5432/hotel_booking",
  });

  // Auto-create noddde tables + hotel_views using migration generation
  const migrationSql = generateDrizzleMigration("postgresql", {
    sharedTables: { snapshots: true },
  });
  await pool.query(migrationSql);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hotel_views (
      view_type TEXT NOT NULL,
      view_id TEXT NOT NULL,
      data JSONB NOT NULL,
      PRIMARY KEY (view_type, view_id)
    );
  `);

  const db = drizzle(pool);
  const adapter = new DrizzleAdapter(db);

  // -- Define the domain structure (pure, sync) --
  const hotelDomain = defineDomain({
    writeModel: {
      aggregates: { Room, Booking, Inventory },
      standaloneCommandHandlers: {
        RunNightlyAudit: RunNightlyAuditHandler,
      },
    },

    readModel: {
      projections: {
        RoomAvailability: RoomAvailabilityProjection,
        GuestHistory: GuestHistoryProjection,
        Revenue: RevenueProjection,
      },
      standaloneQueryHandlers: {
        SearchAvailableRooms: SearchAvailableRoomsHandler,
      },
    },

    processModel: {
      sagas: {
        BookingFulfillment: BookingFulfillmentSaga,
        CheckoutReminder: CheckoutReminderSaga,
        PaymentProcessing: PaymentProcessingSaga,
      },
    },
  });

  // -- Wire with infrastructure (async) --
  const domain = await wireDomain(hotelDomain, {
    // Persistence adapter — handles event store, state store, sagas, snapshots, UoW
    persistenceAdapter: adapter,

    // Custom infrastructure services (what handlers receive)
    infrastructure: () => ({
      clock: new SystemClock(),
      emailService: new ConsoleEmailService(),
      smsService: new ConsoleSmsService(),
      paymentGateway: new FakePaymentGateway(),
      roomAvailabilityViewStore: new DrizzleRoomAvailabilityViewStore(db),
      guestHistoryViewStore: new InMemoryViewStore<GuestHistoryView>(),
      revenueViewStore: new InMemoryViewStore<RevenueView>(),
    }),

    // Per-aggregate persistence and concurrency
    aggregates: {
      Room: {
        persistence: "event-sourced",
        concurrency: { maxRetries: 3 },
        snapshots: { strategy: everyNEvents(50) },
      },
      Booking: {
        persistence: "event-sourced",
        concurrency: { maxRetries: 3 },
      },
      Inventory: {
        // Defaults to state-stored from adapter
      },
    },

    // Projection view stores
    projections: {
      RoomAvailability: {
        viewStore: (infra) => infra.roomAvailabilityViewStore,
      },
      GuestHistory: {
        viewStore: (infra) => infra.guestHistoryViewStore,
      },
      Revenue: {
        viewStore: (infra) => infra.revenueViewStore,
      },
    },

    // CQRS buses
    buses: () => ({
      commandBus: new InMemoryCommandBus(),
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    }),

    // Idempotency for payment commands
    idempotency: () => new InMemoryIdempotencyStore(),

    // MetadataProvider reads from AsyncLocalStorage set by Fastify plugin
    metadataProvider: () => requestMetadataStorage.getStore() ?? {},
  });

  // -- Register standalone event handlers on the event bus --
  const eventBus = domain.infrastructure.eventBus as EventEmitterEventBus;
  const infra = domain.infrastructure;

  eventBus.on("BookingConfirmed", async (event) => {
    await SendBookingConfirmation(event as any, infra);
  });

  eventBus.on("GuestCheckedIn", async (event) => {
    await SendCheckInNotification(event as any, infra);
  });

  // -- Start Fastify HTTP server --
  const app = createApp(domain);
  const address = await app.listen({ port: 3000, host: "0.0.0.0" });
  console.log(`Hotel Booking API listening on ${address}`);
}

main().catch((error) => {
  console.error("Failed to start:", error);
  process.exit(1);
});
