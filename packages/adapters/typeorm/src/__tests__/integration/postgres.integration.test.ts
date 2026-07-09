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
import { NodddeOutboxEntryEntity } from "../../entities";

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
  // Raw read of every row so the deletePublished(olderThan) cases can
  // observe which published rows survived (there is no "load published").
  loadAll: async () => {
    const rows = await ds.getRepository(NodddeOutboxEntryEntity).find();
    return rows.map((r) => ({
      id: r.id,
      event: typeof r.event === "string" ? JSON.parse(r.event) : r.event,
      aggregateName: r.aggregateName ?? undefined,
      aggregateId: r.aggregateId ?? undefined,
      createdAt: new Date(r.createdAt),
      publishedAt: r.publishedAt != null ? new Date(r.publishedAt) : null,
    }));
  },
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
  let killedA = false;
  return {
    lockerA: new TypeORMAdvisoryLocker(a),
    lockerB: new TypeORMAdvisoryLocker(b),
    // Destroying the DataSource closes its (single, max:1) pool connection,
    // ending the backend session — postgres reclaims the session-scoped
    // advisory lock, exactly as it would on a crash.
    killSessionA: async () => {
      killedA = true;
      await a.destroy();
    },
    cleanup: async () => {
      if (!killedA && a.isInitialized) await a.destroy();
      if (b.isInitialized) await b.destroy();
    },
  };
});
