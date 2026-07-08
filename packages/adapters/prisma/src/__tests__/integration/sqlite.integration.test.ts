import { afterAll, beforeAll, beforeEach } from "vitest";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import {
  definePersistenceContract,
  defineSagaContract,
  defineSnapshotContract,
  defineOutboxContract,
  defineUnitOfWorkContract,
} from "@noddde/testing-integration";
import { createPrismaAdapter } from "../../builder";

const TEST_DB = path.resolve(
  __dirname,
  "../../../prisma/integration-sqlite.db",
);
const DATABASE_URL = `file:${TEST_DB}`;
let prisma: PrismaClient;

beforeAll(async () => {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    cwd: path.resolve(__dirname, "../../.."),
    env: { ...process.env, DATABASE_URL },
    stdio: "pipe",
  });
  prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  await prisma.$connect();
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

beforeEach(async () => {
  // Wipe every table without dropping schema.
  await prisma.nodddeOutboxEntry.deleteMany();
  await prisma.nodddeSnapshot.deleteMany();
  await prisma.nodddeSagaState.deleteMany();
  await prisma.nodddeAggregateState.deleteMany();
  await prisma.nodddeEvent.deleteMany();
});

function makeAdapter() {
  return createPrismaAdapter(prisma, {
    snapshotStore: true,
    outboxStore: true,
  });
}

definePersistenceContract("prisma/sqlite", () => {
  const adapter = makeAdapter();
  return {
    eventSourced: adapter.eventSourcedPersistence,
    stateStored: adapter.stateStoredPersistence,
  };
});

defineSagaContract("prisma/sqlite", () => {
  const adapter = makeAdapter();
  return { saga: adapter.sagaPersistence };
});

defineSnapshotContract("prisma/sqlite", () => {
  const adapter = makeAdapter();
  return { snapshots: adapter.snapshotStore };
});

defineOutboxContract("prisma/sqlite", () => {
  const adapter = makeAdapter();
  return {
    outbox: adapter.outboxStore,
    // Raw read of every row so the deletePublished(olderThan) cases can
    // observe which published rows survived (there is no "load published").
    loadAll: async () => {
      const rows = await prisma.nodddeOutboxEntry.findMany();
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

defineUnitOfWorkContract("prisma/sqlite", () => {
  const adapter = makeAdapter();
  return {
    eventSourced: adapter.eventSourcedPersistence,
    stateStored: adapter.stateStoredPersistence,
    uowFactory: adapter.unitOfWorkFactory,
  };
});
