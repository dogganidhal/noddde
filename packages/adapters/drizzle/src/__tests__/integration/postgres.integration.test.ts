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

// Regression for ROBUSTNESS §3.1: the timestamp encoding changed from
// `mode: "date"` to `mode: "string"` emitting `YYYY-MM-DD HH:MM:SS.fff` (no
// `Z`). A mid-migration `noddde_outbox` table can hold rows in BOTH the old
// ISO-with-Z format and the new space-separated format. Because `created_at`
// is a native `TIMESTAMPTZ` column (not text), Postgres parses both string
// formats to real timestamps, so `ORDER BY created_at` is temporal — not
// lexicographic. This test proves that empirically.
describe("outbox created_at ordering across mixed timestamp formats (§3.1)", () => {
  it("orders old ISO-with-Z and new space-separated rows temporally", async () => {
    await truncate();
    // Insert directly (bypassing the adapter) to simulate a mid-migration
    // table containing both encodings. Deliberately insert out of temporal
    // order so a naive string sort would get it wrong.
    const rows: Array<{ id: string; ts: string }> = [
      { id: "b-new-middle", ts: "2024-01-02 00:00:00.000" }, // new format
      { id: "a-old-earliest", ts: "2024-01-01T00:00:00.000Z" }, // old format
      { id: "c-old-latest", ts: "2024-01-03T00:00:00.000Z" }, // old format
    ];
    for (const r of rows) {
      await pool.query(
        `INSERT INTO noddde_outbox (id, event, created_at, published_at)
         VALUES ($1, $2::jsonb, $3, NULL)`,
        [r.id, JSON.stringify({ name: "E", payload: {} }), r.ts],
      );
    }

    const adapter = makeAdapter();
    const loaded = await adapter.outboxStore!.loadUnpublished(100);
    expect(loaded.map((e) => e.id)).toEqual([
      "a-old-earliest",
      "b-new-middle",
      "c-old-latest",
    ]);
    // And the parsed timestamps are strictly increasing.
    const times = loaded.map((e) => e.createdAt.getTime());
    expect(times).toEqual([...times].sort((x, y) => x - y));
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
