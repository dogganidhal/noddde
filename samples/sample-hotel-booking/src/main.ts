/**
 * Hotel Booking Sample — Full-Stack Bootstrap
 *
 * Demonstrates >90% of @noddde framework features:
 * - Per-aggregate persistence (event-sourced + state-stored)
 * - Snapshots, idempotency, optimistic concurrency
 * - Multiple projections (strong + eventual consistency)
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
  configureDomain,
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

import { Room } from "./domain/write-model/room/aggregate";
import { Booking } from "./domain/write-model/booking/aggregate";
import { Inventory } from "./domain/write-model/inventory/aggregate";

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
  // ── Database setup ──────────────────────────────────────────────
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

  // ── Configure the domain ────────────────────────────────────────
  const domain = await configureDomain<
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
        RoomAvailability: {
          projection: RoomAvailabilityProjection,
          viewStore: (infra: HotelInfrastructure) =>
            infra.roomAvailabilityViewStore,
        },
        GuestHistory: {
          projection: GuestHistoryProjection,
          viewStore: (infra: HotelInfrastructure) =>
            infra.guestHistoryViewStore,
        },
        Revenue: {
          projection: RevenueProjection,
          viewStore: (infra: HotelInfrastructure) => infra.revenueViewStore,
        },
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

    infrastructure: {
      // Per-aggregate persistence: Room + Booking = event-sourced, Inventory = state-stored
      aggregatePersistence: {
        Room: () => drizzleInfra.eventSourcedPersistence,
        Booking: () => drizzleInfra.eventSourcedPersistence,
        Inventory: () => drizzleInfra.stateStoredPersistence,
      } as any, // TS can't discriminate function vs Record in the union

      // Optimistic concurrency with retries
      aggregateConcurrency: { maxRetries: 3 },

      // Saga persistence via Drizzle
      sagaPersistence: () => drizzleInfra.sagaPersistence,

      // Snapshots for Room aggregate (many events over time)
      snapshotStore: () => drizzleInfra.snapshotStore!,
      snapshotStrategy: everyNEvents(50),

      // Idempotency for payment commands
      idempotencyStore: () => new InMemoryIdempotencyStore(),

      // Unit of work for atomic operations
      unitOfWorkFactory: () => drizzleInfra.unitOfWorkFactory,

      // Custom infrastructure services
      provideInfrastructure: (): HotelInfrastructure => ({
        clock: new SystemClock(),
        emailService: new ConsoleEmailService(),
        smsService: new ConsoleSmsService(),
        paymentGateway: new FakePaymentGateway(),
        roomAvailabilityViewStore: new DrizzleRoomAvailabilityViewStore(db),
        guestHistoryViewStore: new InMemoryViewStore<GuestHistoryView>(),
        revenueViewStore: new InMemoryViewStore<RevenueView>(),
      }),

      // CQRS buses
      cqrsInfrastructure: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    },

    // MetadataProvider reads from AsyncLocalStorage set by Fastify plugin
    metadataProvider: () => requestMetadataStorage.getStore() ?? {},
  });

  // ── Register standalone event handlers on the event bus ─────────
  const eventBus = domain.infrastructure.eventBus as EventEmitterEventBus;
  const infra = domain.infrastructure;

  eventBus.on("BookingConfirmed", async (event) => {
    await SendBookingConfirmation(event as any, infra);
  });

  eventBus.on("GuestCheckedIn", async (event) => {
    await SendCheckInNotification(event as any, infra);
  });

  // ── Start Fastify HTTP server ──────────────────────────────────
  const app = createApp(domain);
  const address = await app.listen({ port: 3000, host: "0.0.0.0" });
  console.log(`Hotel Booking API listening on ${address}`);
}

main().catch((error) => {
  console.error("Failed to start:", error);
  process.exit(1);
});
