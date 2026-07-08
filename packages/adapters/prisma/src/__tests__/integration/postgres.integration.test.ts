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
  // Need *two* independent sessions for the lock contract. `fromUrl` owns a
  // client pinned to connection_limit=1 internally, guaranteeing that each
  // locker's acquire()/release() land on the same pg session — no manual
  // connection_limit workaround needed here. clientFactory supplies the
  // dialect-specific generated client (fromUrl passes it the pinned URL).
  const lockerA = PrismaAdvisoryLocker.fromUrl(pg_.url, "postgresql", {
    clientFactory: (url) =>
      new PrismaClient({
        datasources: { db: { url } },
      }) as unknown as SharedPrismaClient,
  });
  const lockerB = PrismaAdvisoryLocker.fromUrl(pg_.url, "postgresql", {
    clientFactory: (url) =>
      new PrismaClient({
        datasources: { db: { url } },
      }) as unknown as SharedPrismaClient,
  });
  return {
    lockerA,
    lockerB,
    cleanup: async () => {
      await lockerA.close();
      await lockerB.close();
    },
  };
});
