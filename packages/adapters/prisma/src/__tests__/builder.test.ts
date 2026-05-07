import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { ConcurrencyError, isPersistenceAdapter } from "@noddde/core";
import {
  createPrismaAdapter,
  createPrismaPersistence,
  jsonStateMapper,
  PrismaAdapter,
} from "../index";
import type { PrismaStateMapper } from "../index";
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

// ═══════════════════════════════════════════════════════════════════
// createPrismaAdapter factory
// ═══════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════
// PrismaAdapter class
// ═══════════════════════════════════════════════════════════════════

describe("PrismaAdapter class", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("implements PersistenceAdapter", () => {
    const adapter = new PrismaAdapter(prisma);
    expect(isPersistenceAdapter(adapter)).toBe(true);
  });

  it("provides all stores", () => {
    const adapter = new PrismaAdapter(prisma);

    expect(adapter.unitOfWorkFactory).toBeDefined();
    expect(adapter.eventSourcedPersistence).toBeDefined();
    expect(adapter.stateStoredPersistence).toBeDefined();
    expect(adapter.sagaPersistence).toBeDefined();
    expect(adapter.snapshotStore).toBeDefined();
    expect(adapter.outboxStore).toBeDefined();
  });

  it("stateStored returns dedicated persistence", () => {
    const adapter = new PrismaAdapter(prisma);
    const dedicated = adapter.stateStored("nodddeAggregateState", {
      mapper: jsonStateMapper(),
    });

    expect(dedicated).toBeDefined();
    expect(typeof dedicated.save).toBe("function");
    expect(typeof dedicated.load).toBe("function");
  });

  it("close disconnects client", async () => {
    const disconnectSpy = vi
      .spyOn(prisma, "$disconnect")
      .mockResolvedValue(undefined);
    const adapter = new PrismaAdapter(prisma);
    await adapter.close();

    expect(disconnectSpy).toHaveBeenCalledOnce();
  });
});

// ═══════════════════════════════════════════════════════════════════
// PrismaDedicatedStateStoredPersistence (unit — mapper-based)
// ═══════════════════════════════════════════════════════════════════

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

  function makeMapperPersistence(
    delegate: ReturnType<typeof createMockDelegate>,
  ) {
    const mockPrismaInst = { order: delegate } as any;
    const txStore = { current: null };
    const mapper = jsonStateMapper();
    return new PrismaDedicatedStateStoredPersistence(
      mockPrismaInst,
      txStore,
      "order",
      mapper,
    );
  }

  it("save and load roundtrip", async () => {
    const delegate = createMockDelegate();
    const persistence = makeMapperPersistence(delegate);

    await persistence.save("Order", "order-1", { total: 100 }, 0);
    const loaded = await persistence.load("Order", "order-1");

    expect(loaded).toEqual({ state: { total: 100 }, version: 1 });
  });

  it("should return null for nonexistent aggregate", async () => {
    const delegate = createMockDelegate();
    const persistence = makeMapperPersistence(delegate);

    const loaded = await persistence.load("Order", "nonexistent");
    expect(loaded).toBeNull();
  });

  it("should throw ConcurrencyError on version mismatch", async () => {
    const delegate = createMockDelegate();
    const persistence = makeMapperPersistence(delegate);

    await persistence.save("Order", "order-1", { total: 100 }, 0);
    await expect(
      persistence.save("Order", "order-1", { total: 200 }, 0),
    ).rejects.toThrow(ConcurrencyError);
  });

  it("should use txStore.current when inside a transaction", async () => {
    const delegate = createMockDelegate();
    const txDelegate = createMockDelegate();
    const mockPrismaInst = { order: delegate } as any;
    const txStore: { current: any } = { current: null };
    const mapper = jsonStateMapper();
    const persistence = new PrismaDedicatedStateStoredPersistence(
      mockPrismaInst,
      txStore,
      "order",
      mapper,
    );

    txStore.current = { order: txDelegate };
    await persistence.save("Order", "order-1", { total: 100 }, 0);

    expect(txDelegate.create).toHaveBeenCalled();
    expect(delegate.create).not.toHaveBeenCalled();

    txStore.current = null;
  });

  it("mapper.toRow is called once per save", async () => {
    const delegate = createMockDelegate();
    const mockPrismaInst = { order: delegate } as any;
    const txStore = { current: null };
    const mapper = jsonStateMapper();
    const toRowSpy = vi.spyOn(mapper, "toRow");

    const persistence = new PrismaDedicatedStateStoredPersistence(
      mockPrismaInst,
      txStore,
      "order",
      mapper,
    );

    await persistence.save("Order", "order-1", { total: 100 }, 0);
    expect(toRowSpy).toHaveBeenCalledOnce();

    await persistence.save("Order", "order-1", { total: 200 }, 1);
    expect(toRowSpy).toHaveBeenCalledTimes(2);
  });

  it("mapper.fromRow is called once per loaded row", async () => {
    const delegate = createMockDelegate();
    const mockPrismaInst = { order: delegate } as any;
    const txStore = { current: null };
    const mapper = jsonStateMapper();
    const fromRowSpy = vi.spyOn(mapper, "fromRow");

    const persistence = new PrismaDedicatedStateStoredPersistence(
      mockPrismaInst,
      txStore,
      "order",
      mapper,
    );

    await persistence.save("Order", "order-1", { total: 100 }, 0);
    await persistence.load("Order", "order-1");

    expect(fromRowSpy).toHaveBeenCalledOnce();
  });
});

// ═══════════════════════════════════════════════════════════════════
// jsonStateMapper unit tests
// ═══════════════════════════════════════════════════════════════════

describe("jsonStateMapper", () => {
  it("uses conventional defaults when called with no arguments", () => {
    const mapper = jsonStateMapper();
    expect(mapper.aggregateIdField).toBe("aggregateId");
    expect(mapper.versionField).toBe("version");
  });

  it("toRow serializes state as JSON in the stateField", () => {
    const mapper = jsonStateMapper();
    const row = mapper.toRow({ balance: 100 });
    expect(row).toEqual({ state: JSON.stringify({ balance: 100 }) });
  });

  it("fromRow deserializes JSON string from the stateField", () => {
    const mapper = jsonStateMapper();
    const state = mapper.fromRow({ state: JSON.stringify({ balance: 100 }) });
    expect(state).toEqual({ balance: 100 });
  });

  it("fromRow handles pre-parsed objects", () => {
    const mapper = jsonStateMapper();
    const original = { balance: 100 };
    const state = mapper.fromRow({ state: original });
    expect(state).toEqual(original);
  });

  it("applies property-name overrides", () => {
    const mapper = jsonStateMapper({
      aggregateIdField: "id",
      versionField: "rev",
      stateField: "data",
    });
    expect(mapper.aggregateIdField).toBe("id");
    expect(mapper.versionField).toBe("rev");

    const row = mapper.toRow({ x: 1 });
    expect(row).toEqual({ data: JSON.stringify({ x: 1 }) });

    const state = mapper.fromRow({ data: JSON.stringify({ x: 1 }) });
    expect(state).toEqual({ x: 1 });
  });

  it("unspecified option fields fall back to defaults", () => {
    const mapper = jsonStateMapper({ stateField: "data" });
    expect(mapper.aggregateIdField).toBe("aggregateId");
    expect(mapper.versionField).toBe("version");

    const row = mapper.toRow("anything");
    expect("data" in row).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Typed-column mapper type safety (compile-time)
// ═══════════════════════════════════════════════════════════════════

describe("PrismaStateMapper typed-column type safety", () => {
  it("typed-column mapper: TS rejects configs missing the mapper", () => {
    // @ts-expect-error — `mapper` is required in PrismaAggregateStateTableConfig.
    const _bad: import("../index").PrismaAggregateStateTableConfig = {
      model: "order",
    };
    // silence unused-variable lint
    void _bad;
  });

  it("typed-column custom mapper satisfies PrismaStateMapper", () => {
    type OrderState = { customerId: string; total: number };
    const orderMapper: PrismaStateMapper<
      OrderState,
      Record<string, unknown>
    > = {
      aggregateIdField: "aggregateId",
      versionField: "version",
      toRow: (state) => ({
        customerId: state.customerId,
        total: state.total,
      }),
      fromRow: (row) => ({
        customerId: row["customerId"] as string,
        total: row["total"] as number,
      }),
    };

    const row = orderMapper.toRow({ customerId: "c-1", total: 500 });
    expect(row).toEqual({ customerId: "c-1", total: 500 });

    const state = orderMapper.fromRow({ customerId: "c-1", total: 500 });
    expect(state).toEqual({ customerId: "c-1", total: 500 });
  });
});
