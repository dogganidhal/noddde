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
  return {
    lockerA: new TypeORMAdvisoryLocker(a),
    lockerB: new TypeORMAdvisoryLocker(b),
    cleanup: async () => {
      await a.destroy();
      await b.destroy();
    },
  };
});
