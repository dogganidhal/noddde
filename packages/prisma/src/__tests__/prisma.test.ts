import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { createPrismaPersistence } from "../index";

const TEST_DB = path.resolve(__dirname, "../../prisma/test.db");
const DATABASE_URL = `file:${TEST_DB}`;

let prisma: PrismaClient;
let infra: ReturnType<typeof createPrismaPersistence>;

async function setupDb() {
  // Clean up any existing test db
  if (fs.existsSync(TEST_DB)) {
    fs.unlinkSync(TEST_DB);
  }

  // Push schema to create tables (no migrations needed for test)
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    cwd: path.resolve(__dirname, "../.."),
    env: { ...process.env, DATABASE_URL },
    stdio: "pipe",
  });

  prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  await prisma.$connect();
  infra = createPrismaPersistence(prisma);
}

async function teardownDb() {
  await prisma.$disconnect();
  if (fs.existsSync(TEST_DB)) {
    fs.unlinkSync(TEST_DB);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Event-Sourced Aggregate Persistence
// ═══════════════════════════════════════════════════════════════════

describe("PrismaEventSourcedAggregatePersistence", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("should save and load events", async () => {
    await infra.eventSourcedPersistence.save("Account", "acc-1", [
      { name: "AccountCreated", payload: { owner: "Alice" } },
      { name: "DepositMade", payload: { amount: 100 } },
    ]);

    const events = await infra.eventSourcedPersistence.load("Account", "acc-1");
    expect(events).toEqual([
      { name: "AccountCreated", payload: { owner: "Alice" } },
      { name: "DepositMade", payload: { amount: 100 } },
    ]);
  });

  it("should return empty array for unknown aggregate", async () => {
    const events = await infra.eventSourcedPersistence.load("Account", "nonexistent");
    expect(events).toEqual([]);
  });

  it("should append events across multiple saves", async () => {
    await infra.eventSourcedPersistence.save("Account", "acc-1", [
      { name: "AccountCreated", payload: { owner: "Alice" } },
    ]);
    await infra.eventSourcedPersistence.save("Account", "acc-1", [
      { name: "DepositMade", payload: { amount: 50 } },
    ]);

    const events = await infra.eventSourcedPersistence.load("Account", "acc-1");
    expect(events).toHaveLength(2);
    expect(events[0]!.name).toBe("AccountCreated");
    expect(events[1]!.name).toBe("DepositMade");
  });

  it("should isolate by aggregate name", async () => {
    await infra.eventSourcedPersistence.save("Order", "1", [
      { name: "OrderPlaced", payload: { total: 200 } },
    ]);
    await infra.eventSourcedPersistence.save("Account", "1", [
      { name: "AccountCreated", payload: { owner: "Bob" } },
    ]);

    const orderEvents = await infra.eventSourcedPersistence.load("Order", "1");
    const accountEvents = await infra.eventSourcedPersistence.load("Account", "1");
    expect(orderEvents).toHaveLength(1);
    expect(accountEvents).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// State-Stored Aggregate Persistence
// ═══════════════════════════════════════════════════════════════════

describe("PrismaStateStoredAggregatePersistence", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("should save and load state", async () => {
    await infra.stateStoredPersistence.save("Account", "acc-1", { balance: 100 });
    const state = await infra.stateStoredPersistence.load("Account", "acc-1");
    expect(state).toEqual({ balance: 100 });
  });

  it("should return undefined for unknown aggregate", async () => {
    const state = await infra.stateStoredPersistence.load("Account", "nonexistent");
    expect(state).toBeUndefined();
  });

  it("should overwrite state on repeated saves", async () => {
    await infra.stateStoredPersistence.save("Account", "acc-1", { balance: 100 });
    await infra.stateStoredPersistence.save("Account", "acc-1", { balance: 200 });
    const state = await infra.stateStoredPersistence.load("Account", "acc-1");
    expect(state).toEqual({ balance: 200 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Saga Persistence
// ═══════════════════════════════════════════════════════════════════

describe("PrismaSagaPersistence", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("should save and load saga state", async () => {
    await infra.sagaPersistence.save("Fulfillment", "o-1", { status: "pending" });
    const state = await infra.sagaPersistence.load("Fulfillment", "o-1");
    expect(state).toEqual({ status: "pending" });
  });

  it("should return undefined for unknown saga", async () => {
    const state = await infra.sagaPersistence.load("Fulfillment", "nonexistent");
    expect(state == null).toBe(true);
  });

  it("should overwrite state on repeated saves", async () => {
    await infra.sagaPersistence.save("Fulfillment", "o-1", { step: 1 });
    await infra.sagaPersistence.save("Fulfillment", "o-1", { step: 2 });
    const state = await infra.sagaPersistence.load("Fulfillment", "o-1");
    expect(state).toEqual({ step: 2 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// UnitOfWork
// ═══════════════════════════════════════════════════════════════════

describe("PrismaUnitOfWork", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("should commit all operations in a real database transaction", async () => {
    const uow = infra.unitOfWorkFactory();

    uow.enlist(() =>
      infra.eventSourcedPersistence.save("Account", "acc-1", [
        { name: "AccountCreated", payload: { owner: "Alice" } },
      ]),
    );
    uow.enlist(() =>
      infra.sagaPersistence.save("Fulfillment", "o-1", { step: 1 }),
    );
    uow.deferPublish({ name: "AccountCreated", payload: { owner: "Alice" } });

    const events = await uow.commit();
    expect(events).toHaveLength(1);

    const loaded = await infra.eventSourcedPersistence.load("Account", "acc-1");
    expect(loaded).toHaveLength(1);
    const sagaState = await infra.sagaPersistence.load("Fulfillment", "o-1");
    expect(sagaState).toEqual({ step: 1 });
  });

  it("should rollback without persisting anything", async () => {
    const uow = infra.unitOfWorkFactory();

    uow.enlist(() =>
      infra.eventSourcedPersistence.save("Account", "acc-1", [
        { name: "AccountCreated", payload: { owner: "Alice" } },
      ]),
    );

    await uow.rollback();

    const events = await infra.eventSourcedPersistence.load("Account", "acc-1");
    expect(events).toEqual([]);
  });
});
