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
  return { outbox: adapter.outboxStore };
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
  const url = mysqlUrl(mysql_);
  const a = new PrismaClient({ datasources: { db: { url } } });
  const b = new PrismaClient({ datasources: { db: { url } } });
  await a.$connect();
  await b.$connect();
  return {
    lockerA: new PrismaAdvisoryLocker(
      a as unknown as SharedPrismaClient,
      "mysql",
    ),
    lockerB: new PrismaAdvisoryLocker(
      b as unknown as SharedPrismaClient,
      "mysql",
    ),
    cleanup: async () => {
      await a.$disconnect();
      await b.$disconnect();
    },
  };
});
