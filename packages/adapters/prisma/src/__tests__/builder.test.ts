import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { ConcurrencyError } from "@noddde/core";
import { createPrismaAdapter, createPrismaPersistence } from "../index";
import { PrismaDedicatedStateStoredPersistence } from "../dedicated-state-persistence";

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

describe("createPrismaAdapter", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("creates base stores with no config", () => {
    const result = createPrismaAdapter(prisma);

    expect(result.eventSourcedPersistence).toBeDefined();
    expect(result.stateStoredPersistence).toBeDefined();
    expect(result.sagaPersistence).toBeDefined();
    expect(result.unitOfWorkFactory).toBeDefined();
    expect((result as any).snapshotStore).toBeUndefined();
    expect((result as any).outboxStore).toBeUndefined();
  });

  it("creates all stores when fully configured", () => {
    const result = createPrismaAdapter(prisma, {
      snapshotStore: true,
      outboxStore: true,
    });

    expect(result.eventSourcedPersistence).toBeDefined();
    expect(result.stateStoredPersistence).toBeDefined();
    expect(result.sagaPersistence).toBeDefined();
    expect(result.unitOfWorkFactory).toBeDefined();
    expect(result.snapshotStore).toBeDefined();
    expect(result.outboxStore).toBeDefined();
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
});

describe("PrismaDedicatedStateStoredPersistence (unit)", () => {
  function createMockDelegate() {
    const store = new Map<
      string,
      { aggregateId: string; state: string; version: number }
    >();
    return {
      create: vi.fn(async ({ data }: any) => {
        if (store.has(data.aggregateId)) {
          const error: any = new Error("Unique constraint failed");
          error.code = "P2002";
          throw error;
        }
        store.set(data.aggregateId, { ...data });
        return data;
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        return store.get(where.aggregateId) ?? null;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const existing = store.get(where.aggregateId);
        if (!existing || existing.version !== where.version) {
          return { count: 0 };
        }
        Object.assign(existing, data);
        return { count: 1 };
      }),
    };
  }

  it("save and load roundtrip", async () => {
    const delegate = createMockDelegate();
    const mockPrisma = { order: delegate } as any;
    const txStore = { current: null };
    const persistence = new PrismaDedicatedStateStoredPersistence(
      mockPrisma,
      txStore,
      "order",
      { aggregateId: "aggregateId", state: "state", version: "version" },
    );

    await persistence.save("Order", "order-1", { total: 100 }, 0);
    const loaded = await persistence.load("Order", "order-1");

    expect(loaded).toEqual({ state: { total: 100 }, version: 1 });
  });

  it("should return null for nonexistent aggregate", async () => {
    const delegate = createMockDelegate();
    const mockPrisma = { order: delegate } as any;
    const txStore = { current: null };
    const persistence = new PrismaDedicatedStateStoredPersistence(
      mockPrisma,
      txStore,
      "order",
      { aggregateId: "aggregateId", state: "state", version: "version" },
    );

    const loaded = await persistence.load("Order", "nonexistent");
    expect(loaded).toBeNull();
  });

  it("should throw ConcurrencyError on version mismatch", async () => {
    const delegate = createMockDelegate();
    const mockPrisma = { order: delegate } as any;
    const txStore = { current: null };
    const persistence = new PrismaDedicatedStateStoredPersistence(
      mockPrisma,
      txStore,
      "order",
      { aggregateId: "aggregateId", state: "state", version: "version" },
    );

    await persistence.save("Order", "order-1", { total: 100 }, 0);
    await expect(
      persistence.save("Order", "order-1", { total: 200 }, 0),
    ).rejects.toThrow(ConcurrencyError);
  });

  it("should use txStore.current when inside a transaction", async () => {
    const delegate = createMockDelegate();
    const txDelegate = createMockDelegate();
    const mockPrisma = { order: delegate } as any;
    const txStore: { current: any } = { current: null };
    const persistence = new PrismaDedicatedStateStoredPersistence(
      mockPrisma,
      txStore,
      "order",
      { aggregateId: "aggregateId", state: "state", version: "version" },
    );

    txStore.current = { order: txDelegate };
    await persistence.save("Order", "order-1", { total: 100 }, 0);

    expect(txDelegate.create).toHaveBeenCalled();
    expect(delegate.create).not.toHaveBeenCalled();

    txStore.current = null;
  });
});
