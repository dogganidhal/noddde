import { beforeAll, afterAll } from "vitest";
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
