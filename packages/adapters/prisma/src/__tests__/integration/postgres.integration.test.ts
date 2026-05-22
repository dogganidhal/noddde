import { afterAll, beforeAll, beforeEach } from "vitest";
import { execSync } from "child_process";
import path from "path";
import { PrismaClient } from "../../../node_modules/.prisma/integration-postgres";
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
import { createPrismaAdapter } from "../../builder";
import { PrismaAdvisoryLocker } from "../../advisory-locker";
// We cast to the shared @prisma/client type so the rest of the integration
// suite is dialect-agnostic — runtime is the integration-postgres client.
import type { PrismaClient as SharedPrismaClient } from "@prisma/client";

let pg_: StartedPostgres;
let prisma: PrismaClient;

beforeAll(async () => {
  pg_ = await startPostgres();
  execSync(
    "npx prisma db push --schema prisma/integration/postgres.prisma --skip-generate --accept-data-loss",
    {
      cwd: path.resolve(__dirname, "../../.."),
      env: { ...process.env, DATABASE_URL: pg_.url },
      stdio: "pipe",
    },
  );
  prisma = new PrismaClient({ datasources: { db: { url: pg_.url } } });
  await prisma.$connect();
}, 240_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await pg_?.stop();
});

beforeEach(async () => {
  await prisma.nodddeOutboxEntry.deleteMany();
  await prisma.nodddeSnapshot.deleteMany();
  await prisma.nodddeSagaState.deleteMany();
  await prisma.nodddeAggregateState.deleteMany();
  await prisma.nodddeEvent.deleteMany();
});

function makeAdapter() {
  return createPrismaAdapter(prisma as unknown as SharedPrismaClient, {
    snapshotStore: true,
    outboxStore: true,
  });
}

definePersistenceContract("prisma/postgres", () => {
  const adapter = makeAdapter();
  return {
    eventSourced: adapter.eventSourcedPersistence,
    stateStored: adapter.stateStoredPersistence,
  };
});

defineSagaContract("prisma/postgres", () => {
  const adapter = makeAdapter();
  return { saga: adapter.sagaPersistence };
});

defineSnapshotContract("prisma/postgres", () => {
  const adapter = makeAdapter();
  return { snapshots: adapter.snapshotStore };
});

defineOutboxContract("prisma/postgres", () => {
  const adapter = makeAdapter();
  return { outbox: adapter.outboxStore };
});

defineUnitOfWorkContract("prisma/postgres", () => {
  const adapter = makeAdapter();
  return {
    eventSourced: adapter.eventSourcedPersistence,
    stateStored: adapter.stateStoredPersistence,
    uowFactory: adapter.unitOfWorkFactory,
  };
});

defineAdvisoryLockerContract("prisma/postgres", async () => {
  // Need *two* independent sessions for the lock contract. Prisma multiplexes
  // queries over an internal pool, so we cap each client to a single
  // connection (`connection_limit=1`) to guarantee that the lock and the
  // release land on the same pg session.
  const pinnedUrl = `${pg_.url}${pg_.url.includes("?") ? "&" : "?"}connection_limit=1`;
  const a = new PrismaClient({ datasources: { db: { url: pinnedUrl } } });
  const b = new PrismaClient({ datasources: { db: { url: pinnedUrl } } });
  await a.$connect();
  await b.$connect();
  return {
    lockerA: new PrismaAdvisoryLocker(
      a as unknown as SharedPrismaClient,
      "postgresql",
    ),
    lockerB: new PrismaAdvisoryLocker(
      b as unknown as SharedPrismaClient,
      "postgresql",
    ),
    cleanup: async () => {
      await a.$disconnect();
      await b.$disconnect();
    },
  };
});
