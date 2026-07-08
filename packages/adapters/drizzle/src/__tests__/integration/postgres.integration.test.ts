import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
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
import {
  events,
  aggregateStates,
  sagaStates,
  snapshots,
  outbox,
} from "../../pg/schema";
import { createDrizzleAdapter } from "../../builder";
import { DrizzleAdvisoryLocker } from "../../advisory-locker";
import { POSTGRES_DDL, TRUNCATE_STATEMENTS } from "./schema-sql";

let pg_: StartedPostgres;
let pool: pg.Pool;

beforeAll(async () => {
  pg_ = await startPostgres();
  pool = new pg.Pool({ connectionString: pg_.url, max: 8 });
  await pool.query(POSTGRES_DDL);
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await pg_?.stop();
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

definePersistenceContract("drizzle/postgres", async () => {
  await truncate();
  const adapter = makeAdapter();
  return {
    eventSourced: adapter.eventSourcedPersistence,
    stateStored: adapter.stateStoredPersistence,
  };
});

defineSagaContract("drizzle/postgres", async () => {
  await truncate();
  const adapter = makeAdapter();
  return { saga: adapter.sagaPersistence };
});

defineSnapshotContract("drizzle/postgres", async () => {
  await truncate();
  const adapter = makeAdapter();
  return { snapshots: adapter.snapshotStore! };
});

defineOutboxContract("drizzle/postgres", async () => {
  await truncate();
  const adapter = makeAdapter();
  return { outbox: adapter.outboxStore! };
});

defineUnitOfWorkContract("drizzle/postgres", async () => {
  await truncate();
  const adapter = makeAdapter();
  return {
    eventSourced: adapter.eventSourcedPersistence,
    stateStored: adapter.stateStoredPersistence,
    uowFactory: adapter.unitOfWorkFactory,
  };
});

describe("Drizzle Postgres — dialect-specific behaviour", () => {
  it("orders mixed-format timestamps temporally, not lexicographically (robustness §3.1)", async () => {
    // Regression test for packages/testing-integration/ROBUSTNESS.md §3.1: this
    // adapter used to write timestamps as ISO-with-Z (`2024-06-01T08:00:00.000Z`,
    // via mode: "date") and now writes space-separated, no-Z strings (via
    // toDbTimestamp, mode: "string"). The worry was that a mid-migration table
    // containing rows from both eras could sort incorrectly under
    // `ORDER BY created_at` if the comparison were lexicographic (`T` > space,
    // `Z` > nothing). Since `created_at` is a native TIMESTAMPTZ column, Postgres
    // parses both textual forms into the same internal temporal representation
    // before comparing, so ordering must remain correct regardless of which
    // format wrote which row. This inserts an old-format row with a later id but
    // earlier timestamp than a new-format row, and asserts the earlier timestamp
    // still sorts first.
    await truncate();
    await pool.query(
      `INSERT INTO noddde_outbox (id, event, created_at) VALUES
         ('new-format-late', $1::jsonb, '2024-06-01 12:00:00.000'::timestamptz),
         ('old-format-early', $1::jsonb, '2024-06-01T08:00:00.000Z'::timestamptz)`,
      [JSON.stringify({ name: "Warmup", payload: {} })],
    );

    const adapter = makeAdapter();
    const unpublished = await adapter.outboxStore!.loadUnpublished();

    expect(unpublished.map((e) => e.id)).toEqual([
      "old-format-early",
      "new-format-late",
    ]);
  });
});

defineAdvisoryLockerContract("drizzle/postgres", async () => {
  // Each AdvisoryLocker contract test needs two *independent* sessions
  // because postgres advisory locks are session-scoped. We allocate one
  // pg.Client per locker; tearing them down releases held locks even if
  // the test forgot to.
  const clientA = new pg.Client({ connectionString: pg_.url });
  const clientB = new pg.Client({ connectionString: pg_.url });
  await clientA.connect();
  await clientB.connect();
  const lockerA = new DrizzleAdvisoryLocker(drizzle(clientA), "pg");
  const lockerB = new DrizzleAdvisoryLocker(drizzle(clientB), "pg");
  return {
    lockerA,
    lockerB,
    cleanup: async () => {
      await clientA.end();
      await clientB.end();
    },
  };
});
