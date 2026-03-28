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
 * - Drizzle + SQLite persistence
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createDrizzlePersistence } from "@noddde/drizzle";
import {
  events,
  aggregateStates,
  sagaStates,
  snapshots,
} from "@noddde/drizzle/sqlite";
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

import type { HotelInfrastructure } from "./infrastructure/types";
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

import {
  RunNightlyAuditHandler,
  type RunNightlyAuditCommand,
} from "./infrastructure/handlers/command-handlers";
import {
  SendBookingConfirmation,
  SendCheckInNotification,
} from "./infrastructure/handlers/event-handlers";

import { requestMetadataStorage } from "./infrastructure/http/plugins/metadata";
import { createApp } from "./infrastructure/http/app";
import { DrizzleRoomAvailabilityViewStore } from "./infrastructure/persistence/drizzle-view-store";

import type {
  SearchQuery,
  GuestHistoryView,
  RevenueView,
} from "./domain/read-model/queries";

async function main() {
  // -- Database setup --
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS noddde_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      aggregate_name TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      sequence_number INTEGER NOT NULL,
      event_name TEXT NOT NULL,
      payload TEXT NOT NULL,
      metadata TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS noddde_events_stream_version_idx
      ON noddde_events(aggregate_name, aggregate_id, sequence_number);

    CREATE TABLE IF NOT EXISTS noddde_aggregate_states (
      aggregate_name TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      state TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (aggregate_name, aggregate_id)
    );

    CREATE TABLE IF NOT EXISTS noddde_saga_states (
      saga_name TEXT NOT NULL,
      saga_id TEXT NOT NULL,
      state TEXT NOT NULL,
      PRIMARY KEY (saga_name, saga_id)
    );

    CREATE TABLE IF NOT EXISTS noddde_snapshots (
      aggregate_name TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      state TEXT NOT NULL,
      version INTEGER NOT NULL,
      PRIMARY KEY (aggregate_name, aggregate_id)
    );

    CREATE TABLE IF NOT EXISTS hotel_views (
      view_type TEXT NOT NULL,
      view_id TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (view_type, view_id)
    );
  `);

  const db = drizzle(sqlite);
  const drizzleInfra = createDrizzlePersistence(db, {
    events,
    aggregateStates,
    sagaStates,
    snapshots,
  });

  // -- Define the domain structure (pure, sync) --
  const hotelDomain = defineDomain<
    HotelInfrastructure,
    RunNightlyAuditCommand,
    SearchQuery
  >({
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
    // Custom infrastructure services (what handlers receive)
    infrastructure: (): HotelInfrastructure => ({
      clock: new SystemClock(),
      emailService: new ConsoleEmailService(),
      smsService: new ConsoleSmsService(),
      paymentGateway: new FakePaymentGateway(),
      roomAvailabilityViewStore: new DrizzleRoomAvailabilityViewStore(db),
      guestHistoryViewStore: new InMemoryViewStore<GuestHistoryView>(),
      revenueViewStore: new InMemoryViewStore<RevenueView>(),
    }),

    // Per-aggregate persistence, concurrency, and snapshots
    aggregates: {
      Room: {
        persistence: () => drizzleInfra.eventSourcedPersistence,
        concurrency: { maxRetries: 3 },
        snapshots: {
          store: () => drizzleInfra.snapshotStore!,
          strategy: everyNEvents(50),
        },
      },
      Booking: {
        persistence: () => drizzleInfra.eventSourcedPersistence,
        concurrency: { maxRetries: 3 },
      },
      Inventory: {
        persistence: () => drizzleInfra.stateStoredPersistence,
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

    // Saga persistence via Drizzle
    sagas: {
      persistence: () => drizzleInfra.sagaPersistence,
    },

    // CQRS buses
    buses: () => ({
      commandBus: new InMemoryCommandBus(),
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    }),

    // Unit of work for atomic operations
    unitOfWork: () => drizzleInfra.unitOfWorkFactory,

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
