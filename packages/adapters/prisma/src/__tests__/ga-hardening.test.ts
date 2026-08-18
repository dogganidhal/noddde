import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { createPrismaAdapter } from "../index";

const TEST_DB = path.resolve(__dirname, "../../prisma/test-ga.db");
const DATABASE_URL = `file:${TEST_DB}`;

let prisma: PrismaClient;
let infra: ReturnType<typeof createPrismaAdapter<{ outboxStore: true }>>;

async function setupDb() {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    cwd: path.resolve(__dirname, "../.."),
    env: { ...process.env, DATABASE_URL },
    stdio: "pipe",
  });
  prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  await prisma.$connect();
  infra = createPrismaAdapter(prisma, { outboxStore: true });
}

async function teardownDb() {
  await prisma.$disconnect();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
}

describe("AsyncLocalStorage transaction isolation (fixes #129 finding 1)", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("keeps two concurrently-committing UnitOfWorks from cross-contaminating", async () => {
    const uowA = infra.unitOfWorkFactory();
    const uowB = infra.unitOfWorkFactory();

    let sawTxInsideA: any;
    let sawTxInsideB: any;

    uowA.enlist(async () => {
      await infra.eventSourcedPersistence.save(
        "Account",
        "acc-a",
        [{ name: "AccountCreated", payload: { owner: "A" } }],
        0,
      );
      // Yield so uowB's commit can interleave before uowA's op loop resumes.
      await new Promise((r) => setTimeout(r, 20));
      sawTxInsideA = (infra.eventSourcedPersistence as any)[
        "txStore"
      ]?.als?.getStore?.();
    });
    uowB.enlist(async () => {
      await infra.eventSourcedPersistence.save(
        "Account",
        "acc-b",
        [{ name: "AccountCreated", payload: { owner: "B" } }],
        0,
      );
      sawTxInsideB = (infra.eventSourcedPersistence as any)[
        "txStore"
      ]?.als?.getStore?.();
    });

    await Promise.all([uowA.commit(), uowB.commit()]);

    // Each UoW's operations must have observed a distinct transaction handle.
    expect(sawTxInsideA).toBeDefined();
    expect(sawTxInsideB).toBeDefined();
    expect(sawTxInsideA).not.toBe(sawTxInsideB);

    const aEvents = await infra.eventSourcedPersistence.load(
      "Account",
      "acc-a",
    );
    const bEvents = await infra.eventSourcedPersistence.load(
      "Account",
      "acc-b",
    );
    expect(aEvents).toHaveLength(1);
    expect(bEvents).toHaveLength(1);
  });
});

describe("PrismaEventReader (fixes #131 finding 1)", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("streams every event in global append order across aggregates", async () => {
    await infra.eventSourcedPersistence.save(
      "Order",
      "o-1",
      [{ name: "OrderPlaced", payload: { total: 1 } }],
      0,
    );
    await infra.eventSourcedPersistence.save(
      "Order",
      "o-2",
      [{ name: "OrderPlaced", payload: { total: 2 } }],
      0,
    );
    await infra.eventSourcedPersistence.save(
      "Order",
      "o-1",
      [{ name: "OrderShipped", payload: {} }],
      1,
    );

    const seen: string[] = [];
    for await (const event of infra.eventReader.read()) {
      seen.push(event.name);
    }

    expect(seen).toEqual(["OrderPlaced", "OrderPlaced", "OrderShipped"]);
  });

  it("filters by aggregateName when provided", async () => {
    await infra.eventSourcedPersistence.save(
      "Order",
      "o-1",
      [{ name: "OrderPlaced", payload: {} }],
      0,
    );
    await infra.eventSourcedPersistence.save(
      "Account",
      "a-1",
      [{ name: "AccountCreated", payload: {} }],
      0,
    );

    const seen: string[] = [];
    for await (const event of infra.eventReader.read({
      aggregateName: "Order",
    })) {
      seen.push(event.name);
    }

    expect(seen).toEqual(["OrderPlaced"]);
  });

  it("yields nothing for an empty log", async () => {
    const seen: string[] = [];
    for await (const event of infra.eventReader.read()) {
      seen.push(event.name);
    }
    expect(seen).toEqual([]);
  });
});

describe("Outbox event_id indexed lookup (fixes #131 finding 3)", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("marks published by the indexed event_id column, not a JS scan", async () => {
    const metadata = (eventId: string) => ({
      eventId,
      timestamp: new Date().toISOString(),
      correlationId: "corr-1",
      causationId: "cause-1",
    });

    await infra.outboxStore.save([
      {
        id: "entry-1",
        event: {
          name: "OrderPlaced",
          payload: {},
          metadata: metadata("evt-1"),
        },
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        publishedAt: null,
      },
      {
        id: "entry-2",
        event: {
          name: "OrderConfirmed",
          payload: {},
          metadata: metadata("evt-2"),
        },
        createdAt: new Date("2024-01-01T00:00:01.000Z"),
        publishedAt: null,
      },
    ]);

    const row: any = await (prisma as any).nodddeOutboxEntry.findUnique({
      where: { id: "entry-1" },
    });
    expect(row.eventId).toBe("evt-1");

    await infra.outboxStore.markPublishedByEventIds(["evt-1"]);
    const unpublished = await infra.outboxStore.loadUnpublished();
    expect(unpublished).toHaveLength(1);
    expect(unpublished[0]!.id).toBe("entry-2");
  });
});
