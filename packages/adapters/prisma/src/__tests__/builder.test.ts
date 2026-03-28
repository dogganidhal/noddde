import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { ConcurrencyError } from "@noddde/core";
import { PrismaAdapter, createPrismaPersistence } from "../index";

const TEST_DB = path.resolve(__dirname, "../../prisma/test-builder.db");
const DATABASE_URL = `file:${TEST_DB}`;

let prisma: PrismaClient;

async function setupDb() {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    cwd: path.resolve(__dirname, "../.."),
    env: { ...process.env, DATABASE_URL },
    stdio: "pipe",
  });
  prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  await prisma.$connect();
}

async function teardownDb() {
  await prisma.$disconnect();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
}

describe("PrismaAdapter Builder", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("should create all stores when fully configured", () => {
    const result = new PrismaAdapter(prisma)
      .withEventStore()
      .withStateStore()
      .withSagaStore()
      .withSnapshotStore()
      .withOutboxStore()
      .build();

    expect(result.eventSourcedPersistence).toBeDefined();
    expect(result.stateStoredPersistence).toBeDefined();
    expect(result.sagaPersistence).toBeDefined();
    expect(result.unitOfWorkFactory).toBeDefined();
    expect(result.snapshotStore).toBeDefined();
    expect(result.outboxStore).toBeDefined();
    expect(typeof result.stateStoreFor).toBe("function");
  });

  it("should throw if withEventStore was not called", () => {
    expect(() => {
      new PrismaAdapter(prisma).withSagaStore().build();
    }).toThrow(
      "PrismaAdapter requires withEventStore() to be called before build()",
    );
  });

  it("should throw if withSagaStore was not called", () => {
    expect(() => {
      new PrismaAdapter(prisma).withEventStore().build();
    }).toThrow(
      "PrismaAdapter requires withSagaStore() to be called before build()",
    );
  });

  it("should have stateStoredPersistence undefined when withStateStore not called", () => {
    const result = new PrismaAdapter(prisma)
      .withEventStore()
      .withSagaStore()
      .build();

    expect(result.stateStoredPersistence).toBeUndefined();
    expect(result.snapshotStore).toBeUndefined();
    expect(result.outboxStore).toBeUndefined();
  });

  it("createPrismaPersistence backwards compatibility", () => {
    const infra = createPrismaPersistence(prisma);

    expect(infra.eventSourcedPersistence).toBeDefined();
    expect(infra.stateStoredPersistence).toBeDefined();
    expect(infra.sagaPersistence).toBeDefined();
    expect(infra.snapshotStore).toBeDefined();
    expect(infra.outboxStore).toBeDefined();
    expect(infra.unitOfWorkFactory).toBeDefined();
  });

  it("stateStoreFor should throw for unknown aggregate", () => {
    const result = new PrismaAdapter(prisma)
      .withEventStore()
      .withSagaStore()
      .build();

    expect(() => result.stateStoreFor("Unknown")).toThrow(
      'No dedicated state table configured for aggregate "Unknown"',
    );
  });
});

describe("PrismaAdapter Per-Aggregate State Tables", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("should save and load via dedicated table using shared model", async () => {
    // Use the nodddeAggregateState model as a stand-in for a dedicated table
    const result = new PrismaAdapter(prisma)
      .withEventStore()
      .withSagaStore()
      .withAggregateStateTable("Order", {
        model: "nodddeAggregateState",
        columns: {
          aggregateId: "aggregateId",
          state: "state",
          version: "version",
        },
      })
      .build();

    const orderStore = result.stateStoreFor("Order");

    await orderStore.save("Order", "order-1", { total: 100 }, 0);
    const loaded = await orderStore.load("Order", "order-1");

    expect(loaded).toEqual({ state: { total: 100 }, version: 1 });
  });

  it("should return null for nonexistent aggregate", async () => {
    const result = new PrismaAdapter(prisma)
      .withEventStore()
      .withSagaStore()
      .withAggregateStateTable("Order", {
        model: "nodddeAggregateState",
        columns: {
          aggregateId: "aggregateId",
          state: "state",
          version: "version",
        },
      })
      .build();

    const loaded = await result
      .stateStoreFor("Order")
      .load("Order", "nonexistent");
    expect(loaded).toBeNull();
  });

  it("should throw ConcurrencyError on version mismatch", async () => {
    const result = new PrismaAdapter(prisma)
      .withEventStore()
      .withSagaStore()
      .withAggregateStateTable("Order", {
        model: "nodddeAggregateState",
        columns: {
          aggregateId: "aggregateId",
          state: "state",
          version: "version",
        },
      })
      .build();

    const orderStore = result.stateStoreFor("Order");

    await orderStore.save("Order", "order-1", { total: 100 }, 0);
    await expect(
      orderStore.save("Order", "order-1", { total: 200 }, 0),
    ).rejects.toThrow(ConcurrencyError);
  });

  it("should participate in UoW transaction", async () => {
    const result = new PrismaAdapter(prisma)
      .withEventStore()
      .withSagaStore()
      .withAggregateStateTable("Order", {
        model: "nodddeAggregateState",
        columns: {
          aggregateId: "aggregateId",
          state: "state",
          version: "version",
        },
      })
      .build();

    const orderStore = result.stateStoreFor("Order");
    const uow = result.unitOfWorkFactory();

    uow.enlist(() => orderStore.save("Order", "order-1", { total: 100 }, 0));
    uow.enlist(() =>
      result.eventSourcedPersistence.save(
        "Order",
        "order-1",
        [{ name: "OrderPlaced", payload: { total: 100 } }],
        0,
      ),
    );

    await uow.commit();

    const loaded = await orderStore.load("Order", "order-1");
    expect(loaded).toEqual({ state: { total: 100 }, version: 1 });

    const events = await result.eventSourcedPersistence.load(
      "Order",
      "order-1",
    );
    expect(events).toHaveLength(1);
  });
});
