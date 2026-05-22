import { afterAll, beforeAll, beforeEach } from "vitest";
import { DataSource } from "typeorm";
import {
  definePersistenceContract,
  defineSagaContract,
  defineSnapshotContract,
  defineOutboxContract,
  defineUnitOfWorkContract,
  defineAdvisoryLockerContract,
  startPostgres,
  type StartedPostgres,
} from "@noddde/testing-integration";
import { buildAdapter, makeDataSource, truncateAll } from "./helpers";
import { TypeORMAdvisoryLocker } from "../../advisory-locker";

let pg_: StartedPostgres;
let ds: DataSource;

beforeAll(async () => {
  pg_ = await startPostgres();
  ds = await makeDataSource({
    type: "postgres",
    host: pg_.host,
    port: pg_.port,
    username: pg_.username,
    password: pg_.password,
    database: pg_.database,
  });
}, 240_000);

afterAll(async () => {
  await ds?.destroy();
  await pg_?.stop();
});

beforeEach(async () => {
  await truncateAll(ds);
});

definePersistenceContract("typeorm/postgres", () => {
  const a = buildAdapter(ds);
  return {
    eventSourced: a.eventSourcedPersistence,
    stateStored: a.stateStoredPersistence,
  };
});
defineSagaContract("typeorm/postgres", () => ({
  saga: buildAdapter(ds).sagaPersistence,
}));
defineSnapshotContract("typeorm/postgres", () => ({
  snapshots: buildAdapter(ds).snapshotStore,
}));
defineOutboxContract("typeorm/postgres", () => ({
  outbox: buildAdapter(ds).outboxStore,
}));
defineUnitOfWorkContract("typeorm/postgres", () => {
  const a = buildAdapter(ds);
  return {
    eventSourced: a.eventSourcedPersistence,
    stateStored: a.stateStoredPersistence,
    uowFactory: a.unitOfWorkFactory,
  };
});
defineAdvisoryLockerContract("typeorm/postgres", async () => {
  // The advisory locker needs distinct sessions — each DataSource has its
  // own pool. Cap each at maxConnections: 1 so a single inflight query
  // monopolizes the only connection, which makes the locker behave like a
  // single session.
  const a = await makeDataSource({
    type: "postgres",
    host: pg_.host,
    port: pg_.port,
    username: pg_.username,
    password: pg_.password,
    database: pg_.database,
    extra: { max: 1 },
  });
  const b = await makeDataSource({
    type: "postgres",
    host: pg_.host,
    port: pg_.port,
    username: pg_.username,
    password: pg_.password,
    database: pg_.database,
    extra: { max: 1 },
  });
  return {
    lockerA: new TypeORMAdvisoryLocker(a),
    lockerB: new TypeORMAdvisoryLocker(b),
    cleanup: async () => {
      await a.destroy();
      await b.destroy();
    },
  };
});
