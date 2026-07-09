import { afterAll, beforeAll, beforeEach } from "vitest";
import { DataSource } from "typeorm";
import {
  definePersistenceContract,
  defineSagaContract,
  defineSnapshotContract,
  defineOutboxContract,
  defineUnitOfWorkContract,
  defineAdvisoryLockerContract,
  startMysql,
  type StartedMysql,
} from "@noddde/testing-integration";
import { buildAdapter, makeDataSource, truncateAll } from "./helpers";
import { TypeORMAdvisoryLocker } from "../../advisory-locker";
import { NodddeOutboxEntryEntity } from "../../entities";

let mysql_: StartedMysql;
let ds: DataSource;

beforeAll(async () => {
  mysql_ = await startMysql();
  ds = await makeDataSource({
    type: "mysql",
    host: mysql_.host,
    port: mysql_.port,
    username: mysql_.username,
    password: mysql_.password,
    database: mysql_.database,
  });
}, 240_000);

afterAll(async () => {
  await ds?.destroy();
  await mysql_?.stop();
});

beforeEach(async () => {
  await truncateAll(ds);
});

definePersistenceContract("typeorm/mysql", () => {
  const a = buildAdapter(ds);
  return {
    eventSourced: a.eventSourcedPersistence,
    stateStored: a.stateStoredPersistence,
  };
});
defineSagaContract("typeorm/mysql", () => ({
  saga: buildAdapter(ds).sagaPersistence,
}));
defineSnapshotContract("typeorm/mysql", () => ({
  snapshots: buildAdapter(ds).snapshotStore,
}));
defineOutboxContract("typeorm/mysql", () => ({
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
defineUnitOfWorkContract("typeorm/mysql", () => {
  const a = buildAdapter(ds);
  return {
    eventSourced: a.eventSourcedPersistence,
    stateStored: a.stateStoredPersistence,
    uowFactory: a.unitOfWorkFactory,
  };
});
defineAdvisoryLockerContract("typeorm/mysql", async () => {
  const a = await makeDataSource({
    type: "mysql",
    host: mysql_.host,
    port: mysql_.port,
    username: mysql_.username,
    password: mysql_.password,
    database: mysql_.database,
    extra: { connectionLimit: 1 },
  });
  const b = await makeDataSource({
    type: "mysql",
    host: mysql_.host,
    port: mysql_.port,
    username: mysql_.username,
    password: mysql_.password,
    database: mysql_.database,
    extra: { connectionLimit: 1 },
  });
  let killedA = false;
  return {
    lockerA: new TypeORMAdvisoryLocker(a),
    lockerB: new TypeORMAdvisoryLocker(b),
    // Destroying the DataSource closes its (single, connectionLimit:1) pool
    // connection, ending the session — MySQL releases the GET_LOCK held by
    // that session, exactly as it would on a crash.
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
