import { afterAll, beforeAll, beforeEach } from "vitest";
import { execSync } from "child_process";
import path from "path";
import { PrismaClient } from "../../../node_modules/.prisma/integration-mysql";
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
import { createPrismaAdapter } from "../../builder";
import { PrismaAdvisoryLocker } from "../../advisory-locker";
import type { PrismaClient as SharedPrismaClient } from "@prisma/client";

let mysql_: StartedMysql;
let prisma: PrismaClient;

function mysqlUrl(my: StartedMysql): string {
  return `mysql://${my.username}:${encodeURIComponent(my.password)}@${my.host}:${my.port}/${my.database}`;
}

beforeAll(async () => {
  mysql_ = await startMysql();
  const url = mysqlUrl(mysql_);
  execSync(
    "npx prisma db push --schema prisma/integration/mysql.prisma --skip-generate --accept-data-loss",
    {
      cwd: path.resolve(__dirname, "../../.."),
      env: { ...process.env, DATABASE_URL: url },
      stdio: "pipe",
    },
  );
  prisma = new PrismaClient({ datasources: { db: { url } } });
  await prisma.$connect();
}, 240_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await mysql_?.stop();
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

definePersistenceContract("prisma/mysql", () => {
  const adapter = makeAdapter();
  return {
    eventSourced: adapter.eventSourcedPersistence,
    stateStored: adapter.stateStoredPersistence,
  };
});

defineSagaContract("prisma/mysql", () => {
  const adapter = makeAdapter();
  return { saga: adapter.sagaPersistence };
});

defineSnapshotContract("prisma/mysql", () => {
  const adapter = makeAdapter();
  return { snapshots: adapter.snapshotStore };
});

defineOutboxContract("prisma/mysql", () => {
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

defineUnitOfWorkContract("prisma/mysql", () => {
  const adapter = makeAdapter();
  return {
    eventSourced: adapter.eventSourcedPersistence,
    stateStored: adapter.stateStoredPersistence,
    uowFactory: adapter.unitOfWorkFactory,
  };
});

defineAdvisoryLockerContract("prisma/mysql", async () => {
  const raw = mysqlUrl(mysql_);
  const url = `${raw}${raw.includes("?") ? "&" : "?"}connection_limit=1`;
  const a = new PrismaClient({ datasources: { db: { url } } });
  const b = new PrismaClient({ datasources: { db: { url } } });
  await a.$connect();
  await b.$connect();
  let killedA = false;
  return {
    lockerA: new PrismaAdvisoryLocker(
      a as unknown as SharedPrismaClient,
      "mysql",
    ),
    lockerB: new PrismaAdvisoryLocker(
      b as unknown as SharedPrismaClient,
      "mysql",
    ),
    // Disconnecting the pinned (connection_limit=1) client ends its single
    // MySQL session, which releases the GET_LOCK it held without release().
    killSessionA: async () => {
      killedA = true;
      await a.$disconnect();
    },
    cleanup: async () => {
      if (!killedA) await a.$disconnect().catch(() => {});
      await b.$disconnect().catch(() => {});
    },
  };
});
