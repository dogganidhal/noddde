/**
 * Integration test environment uses in-memory SQLite for speed.
 * The production main.ts uses PostgreSQL via docker-compose.
 * Unit and slice tests are adapter-agnostic (use @noddde/testing harnesses).
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { DrizzleAdapter } from "@noddde/drizzle";
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
import { everyNEvents, type Command } from "@noddde/core";
import type { HotelInfrastructure } from "../../infrastructure/types";
import type {
  GuestHistoryView,
  RevenueView,
  SearchQuery,
} from "../../domain/read-model/queries";
import { FixedClock } from "../../infrastructure/services/clock";
import { InMemoryEmailService } from "../../infrastructure/services/email-service";
import { InMemorySmsService } from "../../infrastructure/services/sms-service";
import { InMemoryPaymentGateway } from "../../infrastructure/services/payment-gateway";
import { InMemoryRoomAvailabilityViewStore } from "../../infrastructure/services/room-availability-view-store";
import { Room } from "../../domain/write-model/aggregates/room";
import { Booking } from "../../domain/write-model/aggregates/booking";
import { Inventory } from "../../domain/write-model/aggregates/inventory";
import { RoomAvailabilityProjection } from "../../domain/read-model/projections/room-availability";
import { GuestHistoryProjection } from "../../domain/read-model/projections/guest-history";
import { RevenueProjection } from "../../domain/read-model/projections/revenue";
import { SearchAvailableRoomsHandler } from "../../domain/read-model/query-handlers";
import { BookingFulfillmentSaga } from "../../domain/process-model/booking-fulfillment";
import { CheckoutReminderSaga } from "../../domain/process-model/checkout-reminder";
import { PaymentProcessingSaga } from "../../domain/process-model/payment-processing";
import { createApp } from "../../infrastructure/http/app";

/**
 * Creates a fully wired test environment with in-memory SQLite,
 * Drizzle persistence, and a Fastify app. Returns everything
 * needed for integration tests.
 */
export async function createTestEnvironment() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE noddde_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      aggregate_name TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      sequence_number INTEGER NOT NULL,
      event_name TEXT NOT NULL,
      payload TEXT NOT NULL,
      metadata TEXT
    );
    CREATE UNIQUE INDEX noddde_events_stream_version_idx
      ON noddde_events(aggregate_name, aggregate_id, sequence_number);
    CREATE TABLE noddde_aggregate_states (
      aggregate_name TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      state TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (aggregate_name, aggregate_id)
    );
    CREATE TABLE noddde_saga_states (
      saga_name TEXT NOT NULL,
      saga_id TEXT NOT NULL,
      state TEXT NOT NULL,
      PRIMARY KEY (saga_name, saga_id)
    );
    CREATE TABLE noddde_snapshots (
      aggregate_name TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      state TEXT NOT NULL,
      version INTEGER NOT NULL,
      PRIMARY KEY (aggregate_name, aggregate_id)
    );
    CREATE TABLE hotel_views (
      view_type TEXT NOT NULL,
      view_id TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (view_type, view_id)
    );
  `);

  const db = drizzle(sqlite);
  const drizzleInfra = new DrizzleAdapter(db)
    .withEventStore(events)
    .withStateStore(aggregateStates)
    .withSagaStore(sagaStates)
    .withSnapshotStore(snapshots)
    .build();

  const emailService = new InMemoryEmailService();
  const smsService = new InMemorySmsService();
  const paymentGateway = new InMemoryPaymentGateway();
  const roomAvailabilityViewStore = new InMemoryRoomAvailabilityViewStore();
  const guestHistoryViewStore = new InMemoryViewStore<GuestHistoryView>();
  const revenueViewStore = new InMemoryViewStore<RevenueView>();

  // Define the domain structure (pure, sync)
  const hotelDomain = defineDomain<HotelInfrastructure, Command, SearchQuery>({
    writeModel: {
      aggregates: { Room, Booking, Inventory },
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

  // Wire with infrastructure (async)
  const domain = await wireDomain(hotelDomain, {
    infrastructure: (): HotelInfrastructure => ({
      clock: new FixedClock(new Date("2026-04-01T10:00:00Z")),
      emailService,
      smsService,
      paymentGateway,
      roomAvailabilityViewStore,
      guestHistoryViewStore,
      revenueViewStore,
    }),
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
    projections: {
      RoomAvailability: {
        viewStore: () => roomAvailabilityViewStore,
      },
      GuestHistory: {
        viewStore: () => guestHistoryViewStore,
      },
      Revenue: {
        viewStore: () => revenueViewStore,
      },
    },
    sagas: {
      persistence: () => drizzleInfra.sagaPersistence,
    },
    buses: () => ({
      commandBus: new InMemoryCommandBus(),
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    }),
    unitOfWork: () => drizzleInfra.unitOfWorkFactory,
    idempotency: () => new InMemoryIdempotencyStore(),
  });

  const app = createApp(domain);

  return {
    app,
    domain,
    sqlite,
    services: { emailService, smsService, paymentGateway },
  };
}
