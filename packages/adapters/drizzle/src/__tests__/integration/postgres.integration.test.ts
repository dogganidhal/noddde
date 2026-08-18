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
  defineScaleContract,
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
    // Raw read of every row so the deletePublished(olderThan) cases can
    // observe which published rows survived (there is no "load published").
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

// Slow-tagged high-volume smoke tests (§2.3). Skipped unless
// NODDDE_SLOW_TESTS=1 (set by the nightly workflow). One PG-backed adapter
// is enough to catch algorithmic regressions in these paths.
defineScaleContract("drizzle/postgres", async () => {
  await truncate();
  const adapter = makeAdapter();
  return {
    eventSourced: adapter.eventSourcedPersistence,
    outbox: adapter.outboxStore!,
  };
});

// Pins the on-disk format fixed by issue #130 finding 2: payload/state must
// be stored as a native jsonb object, not a double-encoded JSON string
// scalar, or `->>` and other jsonb operators silently return nothing.
describe("native jsonb storage (issue #130 finding 2)", () => {
  it("payload->>'total' is queryable directly in SQL", async () => {
    await truncate();
    const adapter = makeAdapter();
    await adapter.eventSourcedPersistence.save(
      "Order",
      "order-jsonb-1",
      [{ name: "OrderPlaced", payload: { total: 4200 } }],
      0,
    );

    const { rows } = await pool.query(
      `SELECT payload->>'total' AS total FROM noddde_events WHERE aggregate_id = $1`,
      ["order-jsonb-1"],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].total).toBe("4200");

    const typeCheck = await pool.query(
      `SELECT jsonb_typeof(payload) AS t FROM noddde_events WHERE aggregate_id = $1`,
      ["order-jsonb-1"],
    );
    expect(typeCheck.rows[0].t).toBe("object");
  });

  it("aggregate_states.state is stored as a jsonb object, not a string scalar", async () => {
    await truncate();
    const adapter = makeAdapter();
    await adapter.stateStoredPersistence.save(
      "Account",
      "acc-jsonb-1",
      { balance: 500 },
      0,
    );

    const { rows } = await pool.query(
      `SELECT state->>'balance' AS balance, jsonb_typeof(state) AS t
       FROM noddde_aggregate_states WHERE aggregate_id = $1`,
      ["acc-jsonb-1"],
    );
    expect(rows[0].balance).toBe("500");
    expect(rows[0].t).toBe("object");
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
  // Destroying the socket below makes pg emit an 'error' on the client;
  // swallow it so it doesn't surface as an unhandled exception.
  clientA.on("error", () => {});
  const lockerA = new DrizzleAdvisoryLocker(drizzle(clientA), "pg");
  const lockerB = new DrizzleAdvisoryLocker(drizzle(clientB), "pg");
  let killedA = false;
  return {
    lockerA,
    lockerB,
    killSessionA: async () => {
      killedA = true;
      // Sever A's TCP socket outright — the backend sees a reset (a crash),
      // not a graceful terminate, and reclaims its session-scoped advisory
      // locks.
      const stream = (
        clientA as unknown as {
          connection?: { stream?: { destroy?: () => void } };
        }
      ).connection?.stream;
      if (stream?.destroy) {
        stream.destroy();
      } else {
        await clientA.end();
      }
    },
    cleanup: async () => {
      if (!killedA) await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
    },
  };
});
