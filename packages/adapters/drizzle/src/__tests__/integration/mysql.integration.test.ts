import { beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
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
import {
  events,
  aggregateStates,
  sagaStates,
  snapshots,
  outbox,
} from "../../mysql/schema";
import { createDrizzleAdapter } from "../../builder";
import { DrizzleAdvisoryLocker } from "../../advisory-locker";
import { MYSQL_DDL, TRUNCATE_STATEMENTS } from "./schema-sql";

let mysql_: StartedMysql;
let pool: mysql.Pool;

beforeAll(async () => {
  mysql_ = await startMysql();
  pool = mysql.createPool({
    host: mysql_.host,
    port: mysql_.port,
    user: mysql_.username,
    password: mysql_.password,
    database: mysql_.database,
    multipleStatements: true,
    connectionLimit: 10,
  });
  await pool.query(MYSQL_DDL);
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await mysql_?.stop();
});

async function truncate(): Promise<void> {
  for (const stmt of TRUNCATE_STATEMENTS) {
    await pool.query(stmt);
  }
}

function makeAdapter() {
  const db = drizzle(pool);
  return createDrizzleAdapter(db, {
    eventStore: events,
    stateStore: aggregateStates,
    sagaStore: sagaStates,
    snapshotStore: snapshots,
    outboxStore: outbox,
  });
}

definePersistenceContract("drizzle/mysql", async () => {
  await truncate();
  const adapter = makeAdapter();
  return {
    eventSourced: adapter.eventSourcedPersistence,
    stateStored: adapter.stateStoredPersistence,
  };
});

defineSagaContract("drizzle/mysql", async () => {
  await truncate();
  const adapter = makeAdapter();
  return { saga: adapter.sagaPersistence };
});

defineSnapshotContract("drizzle/mysql", async () => {
  await truncate();
  const adapter = makeAdapter();
  return { snapshots: adapter.snapshotStore! };
});

defineOutboxContract("drizzle/mysql", async () => {
  await truncate();
  const adapter = makeAdapter();
  return { outbox: adapter.outboxStore! };
});

defineUnitOfWorkContract("drizzle/mysql", async () => {
  await truncate();
  const adapter = makeAdapter();
  return {
    eventSourced: adapter.eventSourcedPersistence,
    stateStored: adapter.stateStoredPersistence,
    uowFactory: adapter.unitOfWorkFactory,
  };
});

defineAdvisoryLockerContract("drizzle/mysql", async () => {
  // MySQL GET_LOCK is session-scoped — one connection per locker.
  const connA = await mysql.createConnection({
    host: mysql_.host,
    port: mysql_.port,
    user: mysql_.username,
    password: mysql_.password,
    database: mysql_.database,
  });
  const connB = await mysql.createConnection({
    host: mysql_.host,
    port: mysql_.port,
    user: mysql_.username,
    password: mysql_.password,
    database: mysql_.database,
  });
  const lockerA = new DrizzleAdvisoryLocker(drizzle(connA), "mysql");
  const lockerB = new DrizzleAdvisoryLocker(drizzle(connB), "mysql");
  return {
    lockerA,
    lockerB,
    cleanup: async () => {
      await connA.end();
      await connB.end();
    },
  };
});
