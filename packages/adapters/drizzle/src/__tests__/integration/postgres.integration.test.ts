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
