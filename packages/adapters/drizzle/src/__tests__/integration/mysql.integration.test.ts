import { beforeAll, afterAll, describe, it, expect } from "vitest";
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

describe("Drizzle MySQL — dialect-specific behaviour", () => {
  // Regression tests for packages/testing-integration/ROBUSTNESS.md §3.1.

  it("rejects the old ISO-with-Z timestamp format outright, rather than silently misordering rows", async () => {
    // Unlike Postgres, MySQL's TIMESTAMP(3) parser does not accept a
    // trailing "Z" — it fails the INSERT rather than storing a
    // misinterpreted or truncated value. That means a mid-migration table
    // can never actually contain a row written in the pre-migration
    // `mode: "date"` ISO-with-Z shape: any write attempt in that shape
    // fails loudly at INSERT time, so there is no silent-corruption path
    // for `ORDER BY created_at` to expose.
    await truncate();
    await expect(
      pool.query(
        "INSERT INTO noddde_outbox (id, event, created_at) VALUES (?, ?, ?)",
        [
          "z-format",
          JSON.stringify({ name: "Warmup", payload: {} }),
          "2024-06-01T08:00:00.000Z",
        ],
      ),
    ).rejects.toThrow(/incorrect datetime value/i);
  });

  it("orders mixed-but-valid timestamp shapes temporally, not lexicographically", async () => {
    // `T`-separated (no `Z`) and space-separated (current, `toDbTimestamp`)
    // forms are both accepted by MySQL. Since `created_at` is a native
    // TIMESTAMP(3) column, MySQL parses both into the same internal
    // representation before comparing, so ordering must remain correct
    // regardless of which shape wrote which row.
    await truncate();
    await pool.query(
      "INSERT INTO noddde_outbox (id, event, created_at) VALUES (?, ?, ?), (?, ?, ?)",
      [
        "new-format-late",
        JSON.stringify({ name: "Warmup", payload: {} }),
        "2024-06-01 12:00:00.000",
        "old-format-early",
        JSON.stringify({ name: "Warmup", payload: {} }),
        "2024-06-01T08:00:00.000",
      ],
    );

    const adapter = makeAdapter();
    const unpublished = await adapter.outboxStore!.loadUnpublished();

    expect(unpublished.map((e) => e.id)).toEqual([
      "old-format-early",
      "new-format-late",
    ]);
  });
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
