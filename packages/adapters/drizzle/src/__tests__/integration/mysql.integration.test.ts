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
    // MySQL's native `json` column type re-parses and re-emits numeric
    // literals through its own storage engine (fewer significant digits
    // than IEEE-754 doubles need for guaranteed round-trip). Now that
    // payload/state are stored as native JSON (fixes #130 finding 2's
    // double-encoding bug) instead of an opaque stringified blob, this
    // adapter-dialect combination is genuinely subject to that limitation.
    jsonNumberPrecision: "lossy",
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
  const db = drizzle(pool);
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
  };
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

// Regression for ROBUSTNESS §3.1: the timestamp encoding changed to
// `mode: "string"` emitting `YYYY-MM-DD HH:MM:SS.fff`. On MySQL the previous
// encoding also produced space-separated timestamps (no `Z` — MySQL rejects
// it), so a mid-migration `noddde_outbox` mixes rows with and without the
// fractional-second component. `created_at` is a native `TIMESTAMP(3)` column,
// so MySQL parses both and `ORDER BY created_at` is temporal. Proven here.
describe("outbox created_at ordering across mixed timestamp formats (§3.1)", () => {
  it("orders whole-second and fractional-second rows temporally", async () => {
    await truncate();
    const rows: Array<{ id: string; ts: string }> = [
      { id: "b-frac-middle", ts: "2024-01-02 00:00:00.500" }, // new format
      { id: "a-whole-earliest", ts: "2024-01-01 00:00:00" }, // old format
      { id: "c-frac-latest", ts: "2024-01-03 00:00:00.250" }, // new format
    ];
    for (const r of rows) {
      await pool.query(
        `INSERT INTO noddde_outbox (id, event, created_at, published_at)
         VALUES (?, ?, ?, NULL)`,
        [r.id, JSON.stringify({ name: "E", payload: {} }), r.ts],
      );
    }

    const adapter = makeAdapter();
    const loaded = await adapter.outboxStore!.loadUnpublished(100);
    expect(loaded.map((e) => e.id)).toEqual([
      "a-whole-earliest",
      "b-frac-middle",
      "c-frac-latest",
    ]);
    const times = loaded.map((e) => e.createdAt.getTime());
    expect(times).toEqual([...times].sort((x, y) => x - y));
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
  let killedA = false;
  return {
    lockerA,
    lockerB,
    killSessionA: async () => {
      killedA = true;
      // destroy() closes the socket immediately (no COM_QUIT) — a crash,
      // not a graceful disconnect. MySQL releases GET_LOCK held by the
      // session when it dies.
      connA.destroy();
    },
    cleanup: async () => {
      if (!killedA) await connA.end().catch(() => {});
      await connB.end().catch(() => {});
    },
  };
});
