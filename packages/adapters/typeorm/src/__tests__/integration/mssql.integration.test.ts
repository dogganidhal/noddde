import { afterAll, beforeAll, beforeEach } from "vitest";
import { DataSource } from "typeorm";
import {
  definePersistenceContract,
  defineSagaContract,
  defineSnapshotContract,
  defineOutboxContract,
  defineUnitOfWorkContract,
  defineAdvisoryLockerContract,
  startMssql,
  type StartedMssql,
} from "@noddde/testing-integration";
import { buildAdapter, makeDataSource, truncateAll } from "./helpers";
import { TypeORMAdvisoryLocker } from "../../advisory-locker";

let mssql_: StartedMssql;
let ds: DataSource;

beforeAll(async () => {
  mssql_ = await startMssql();
  ds = await makeDataSource({
    type: "mssql",
    host: mssql_.host,
    port: mssql_.port,
    username: mssql_.username,
    password: mssql_.password,
    database: mssql_.database,
    options: { encrypt: false, trustServerCertificate: true },
  });
}, 300_000);

afterAll(async () => {
  await ds?.destroy();
  await mssql_?.stop();
});

beforeEach(async () => {
  await truncateAll(ds);
});

definePersistenceContract("typeorm/mssql", () => {
  const a = buildAdapter(ds);
  return {
    eventSourced: a.eventSourcedPersistence,
    stateStored: a.stateStoredPersistence,
    // The MSSQL DataSource registers the `nvarchar(max)` entity variant
    // (createNodddeEntities("mssql")), so supplementary-plane Unicode
    // round-trips — the contract runs with unicodeSafe defaulting to true.
  };
});
defineSagaContract("typeorm/mssql", () => ({
  saga: buildAdapter(ds).sagaPersistence,
}));
defineSnapshotContract("typeorm/mssql", () => ({
  snapshots: buildAdapter(ds).snapshotStore,
}));
defineOutboxContract("typeorm/mssql", () => ({
  outbox: buildAdapter(ds).outboxStore,
  // Raw read of every row so the deletePublished(olderThan) cases can
  // observe which published rows survived (there is no "load published").
  // Resolve the outbox entity by table name: on MSSQL the DataSource
  // registers the dialect-specific `nvarchar(max)` variant from
  // createNodddeEntities("mssql"), not the exported static class.
  loadAll: async () => {
    const meta = ds.entityMetadatas.find(
      (m) => m.tableName === "noddde_outbox",
    );
    if (!meta) throw new Error("noddde_outbox entity not registered");
    const rows = await ds
      .getRepository<{
        id: string;
        event: unknown;
        aggregateName: string | null;
        aggregateId: string | null;
        createdAt: Date | string;
        publishedAt: Date | string | null;
      }>(meta.target)
      .find();
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
defineUnitOfWorkContract("typeorm/mssql", () => {
  const a = buildAdapter(ds);
  return {
    eventSourced: a.eventSourcedPersistence,
    stateStored: a.stateStoredPersistence,
    uowFactory: a.unitOfWorkFactory,
  };
});
defineAdvisoryLockerContract("typeorm/mssql", async () => {
  // MSSQL sp_getapplock is session-scoped. Each DataSource is its own pool.
  const a = await makeDataSource({
    type: "mssql",
    host: mssql_.host,
    port: mssql_.port,
    username: mssql_.username,
    password: mssql_.password,
    database: mssql_.database,
    options: { encrypt: false, trustServerCertificate: true },
    pool: { max: 1 },
  } as any);
  const b = await makeDataSource({
    type: "mssql",
    host: mssql_.host,
    port: mssql_.port,
    username: mssql_.username,
    password: mssql_.password,
    database: mssql_.database,
    options: { encrypt: false, trustServerCertificate: true },
    pool: { max: 1 },
  } as any);
  let killedA = false;
  return {
    lockerA: new TypeORMAdvisoryLocker(a),
    lockerB: new TypeORMAdvisoryLocker(b),
    // Destroying the DataSource closes its (single, pool max:1) connection,
    // ending the session — MSSQL releases the session-scoped sp_getapplock,
    // exactly as it would on a crash.
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
