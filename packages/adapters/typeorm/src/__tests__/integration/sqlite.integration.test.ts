import { afterAll, beforeAll, beforeEach } from "vitest";
import { DataSource } from "typeorm";
import {
  definePersistenceContract,
  defineSagaContract,
  defineSnapshotContract,
  defineOutboxContract,
  defineUnitOfWorkContract,
} from "@noddde/testing-integration";
import { buildAdapter, makeDataSource, truncateAll } from "./helpers";

let ds: DataSource;

beforeAll(async () => {
  ds = await makeDataSource({
    type: "better-sqlite3",
    database: ":memory:",
  });
}, 30_000);

afterAll(async () => {
  await ds?.destroy();
});

beforeEach(async () => {
  await truncateAll(ds);
});

definePersistenceContract("typeorm/sqlite", () => {
  const a = buildAdapter(ds);
  return {
    eventSourced: a.eventSourcedPersistence,
    stateStored: a.stateStoredPersistence,
  };
});
defineSagaContract("typeorm/sqlite", () => ({
  saga: buildAdapter(ds).sagaPersistence,
}));
defineSnapshotContract("typeorm/sqlite", () => ({
  snapshots: buildAdapter(ds).snapshotStore,
}));
defineOutboxContract("typeorm/sqlite", () => ({
  outbox: buildAdapter(ds).outboxStore,
}));
defineUnitOfWorkContract("typeorm/sqlite", () => {
  const a = buildAdapter(ds);
  return {
    eventSourced: a.eventSourcedPersistence,
    stateStored: a.stateStoredPersistence,
    uowFactory: a.unitOfWorkFactory,
  };
});
