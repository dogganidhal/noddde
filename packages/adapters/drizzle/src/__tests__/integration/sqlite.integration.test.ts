import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  definePersistenceContract,
  defineSagaContract,
  defineSnapshotContract,
  defineOutboxContract,
  defineUnitOfWorkContract,
} from "@noddde/testing-integration";
import {
  events,
  aggregateStates,
  sagaStates,
  snapshots,
  outbox,
} from "../../sqlite/schema";
import { createDrizzleAdapter } from "../../builder";
import { SQLITE_DDL } from "./schema-sql";

function makeDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(SQLITE_DDL);
  return { sqlite, db: drizzle(sqlite) };
}

function makeAdapter() {
  const { sqlite, db } = makeDb();
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    stateStore: aggregateStates,
    sagaStore: sagaStates,
    snapshotStore: snapshots,
    outboxStore: outbox,
  });
  return {
    adapter,
    cleanup: async () => {
      sqlite.close();
    },
  };
}

definePersistenceContract("drizzle/sqlite", () => {
  const { adapter, cleanup } = makeAdapter();
  return {
    eventSourced: adapter.eventSourcedPersistence,
    stateStored: adapter.stateStoredPersistence,
    cleanup,
  };
});

defineSagaContract("drizzle/sqlite", () => {
  const { adapter, cleanup } = makeAdapter();
  return { saga: adapter.sagaPersistence, cleanup };
});

defineSnapshotContract("drizzle/sqlite", () => {
  const { adapter, cleanup } = makeAdapter();
  return { snapshots: adapter.snapshotStore!, cleanup };
});

defineOutboxContract("drizzle/sqlite", () => {
  const { sqlite, db } = makeDb();
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    stateStore: aggregateStates,
    sagaStore: sagaStates,
    snapshotStore: snapshots,
    outboxStore: outbox,
  });
  return {
    outbox: adapter.outboxStore!,
    loadAll: async () => {
      const rows = await db.select().from(outbox);
      return rows.map((r) => ({
        id: r.id,
        event: typeof r.event === "string" ? JSON.parse(r.event) : r.event,
        aggregateName: r.aggregateName ?? undefined,
        aggregateId: r.aggregateId ?? undefined,
        createdAt: new Date(r.createdAt),
        publishedAt: r.publishedAt != null ? new Date(r.publishedAt) : null,
      }));
    },
    cleanup: async () => {
      sqlite.close();
    },
  };
});

defineUnitOfWorkContract("drizzle/sqlite", () => {
  const { adapter, cleanup } = makeAdapter();
  return {
    eventSourced: adapter.eventSourcedPersistence,
    stateStored: adapter.stateStoredPersistence,
    uowFactory: adapter.unitOfWorkFactory,
    cleanup,
  };
});
