import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { ConcurrencyError } from "@noddde/core";
import type {
  PartialEventLoad,
  EventSourcedAggregatePersistence,
} from "@noddde/core";
import {
  createPrismaPersistence,
  createPrismaAdapter,
  PrismaAdvisoryLocker,
  jsonStateMapper,
} from "../index";
import type { OutboxEntry } from "@noddde/core";

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
    await infra.eventSourcedPersistence.save(
      "Account",
      "acc-1",
      [
        { name: "AccountCreated", payload: { owner: "Alice" } },
        { name: "DepositMade", payload: { amount: 100 } },
      ],
      0,
    );

    const events = await infra.eventSourcedPersistence.load("Account", "acc-1");
    expect(events).toEqual([
      { name: "AccountCreated", payload: { owner: "Alice" } },
      { name: "DepositMade", payload: { amount: 100 } },
    ]);
  });

  it("should return empty array for unknown aggregate", async () => {
    const events = await infra.eventSourcedPersistence.load(
      "Account",
      "nonexistent",
    );
    expect(events).toEqual([]);
  });

  it("should append events across multiple saves", async () => {
    await infra.eventSourcedPersistence.save(
      "Account",
      "acc-1",
      [{ name: "AccountCreated", payload: { owner: "Alice" } }],
      0,
    );
    await infra.eventSourcedPersistence.save(
      "Account",
      "acc-1",
      [{ name: "DepositMade", payload: { amount: 50 } }],
      1,
    );

    const events = await infra.eventSourcedPersistence.load("Account", "acc-1");
    expect(events).toHaveLength(2);
    expect(events[0]!.name).toBe("AccountCreated");
    expect(events[1]!.name).toBe("DepositMade");
  });

  it("should isolate by aggregate name", async () => {
    await infra.eventSourcedPersistence.save(
      "Order",
      "1",
      [{ name: "OrderPlaced", payload: { total: 200 } }],
      0,
    );
    await infra.eventSourcedPersistence.save(
      "Account",
      "1",
      [{ name: "AccountCreated", payload: { owner: "Bob" } }],
      0,
    );

    const orderEvents = await infra.eventSourcedPersistence.load("Order", "1");
    const accountEvents = await infra.eventSourcedPersistence.load(
      "Account",
      "1",
    );
    expect(orderEvents).toHaveLength(1);
    expect(accountEvents).toHaveLength(1);
  });

  it("should throw ConcurrencyError on duplicate sequence number", async () => {
    await infra.eventSourcedPersistence.save(
      "Account",
      "acc-1",
      [{ name: "AccountCreated", payload: { owner: "Alice" } }],
      0,
    );

    await expect(
      infra.eventSourcedPersistence.save(
        "Account",
        "acc-1",
        [{ name: "DepositMade", payload: { amount: 50 } }],
        0,
      ),
    ).rejects.toThrow(ConcurrencyError);
  });
});

// ═══════════════════════════════════════════════════════════════════
// State-Stored Aggregate Persistence
// ═══════════════════════════════════════════════════════════════════

describe("PrismaStateStoredAggregatePersistence", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("should save and load state with version", async () => {
    await infra.stateStoredPersistence.save(
      "Account",
      "acc-1",
      { balance: 100 },
      0,
    );
    const result = await infra.stateStoredPersistence.load("Account", "acc-1");
    expect(result).toEqual({ state: { balance: 100 }, version: 1 });
  });

  it("should return null for unknown aggregate", async () => {
    const result = await infra.stateStoredPersistence.load(
      "Account",
      "nonexistent",
    );
    expect(result).toBeNull();
  });

  it("should overwrite state on repeated saves and increment version", async () => {
    await infra.stateStoredPersistence.save(
      "Account",
      "acc-1",
      { balance: 100 },
      0,
    );
    await infra.stateStoredPersistence.save(
      "Account",
      "acc-1",
      { balance: 200 },
      1,
    );
    const result = await infra.stateStoredPersistence.load("Account", "acc-1");
    expect(result).toEqual({ state: { balance: 200 }, version: 2 });
  });

  it("should throw ConcurrencyError on version mismatch", async () => {
    await infra.stateStoredPersistence.save(
      "Account",
      "acc-1",
      { balance: 100 },
      0,
    );

    await expect(
      infra.stateStoredPersistence.save(
        "Account",
        "acc-1",
        { balance: 200 },
        0,
      ),
    ).rejects.toThrow(ConcurrencyError);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Saga Persistence
// ═══════════════════════════════════════════════════════════════════

describe("PrismaSagaPersistence", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("should save and load saga state", async () => {
    await infra.sagaPersistence.save("Fulfillment", "o-1", {
      status: "pending",
    });
    const state = await infra.sagaPersistence.load("Fulfillment", "o-1");
    expect(state).toEqual({ status: "pending" });
  });

  it("should return undefined for unknown saga", async () => {
    const state = await infra.sagaPersistence.load(
      "Fulfillment",
      "nonexistent",
    );
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
      infra.eventSourcedPersistence.save(
        "Account",
        "acc-1",
        [{ name: "AccountCreated", payload: { owner: "Alice" } }],
        0,
      ),
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
      infra.eventSourcedPersistence.save(
        "Account",
        "acc-1",
        [{ name: "AccountCreated", payload: { owner: "Alice" } }],
        0,
      ),
    );

    await uow.rollback();

    const events = await infra.eventSourcedPersistence.load("Account", "acc-1");
    expect(events).toEqual([]);
  });

  it("should expose the active Prisma transaction client via UnitOfWork.context", async () => {
    const uow = infra.unitOfWorkFactory();

    expect(uow.context).toBeUndefined();

    let observedDuringCommit: unknown = null;
    uow.enlist(async () => {
      observedDuringCommit = uow.context;
    });

    await uow.commit();

    // During the enlisted op, context must be a non-null object — the
    // transactional Prisma client passed into $transaction's callback.
    expect(observedDuringCommit).toBeDefined();
    expect(observedDuringCommit).not.toBeNull();
    expect(typeof observedDuringCommit).toBe("object");

    // After commit, context is cleared.
    expect(uow.context).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Snapshot Store
// ═══════════════════════════════════════════════════════════════════

describe("PrismaSnapshotStore", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("should save and load a snapshot", async () => {
    await infra.snapshotStore.save("Account", "acc-1", {
      state: { balance: 500 },
      version: 5,
    });
    const snapshot = await infra.snapshotStore.load("Account", "acc-1");
    expect(snapshot).toEqual({ state: { balance: 500 }, version: 5 });
  });

  it("should return null for unknown aggregate", async () => {
    const snapshot = await infra.snapshotStore.load("Account", "nonexistent");
    expect(snapshot).toBeNull();
  });

  it("should overwrite snapshot on repeated saves", async () => {
    await infra.snapshotStore.save("Account", "acc-1", {
      state: { balance: 100 },
      version: 2,
    });
    await infra.snapshotStore.save("Account", "acc-1", {
      state: { balance: 500 },
      version: 5,
    });
    const snapshot = await infra.snapshotStore.load("Account", "acc-1");
    expect(snapshot).toEqual({ state: { balance: 500 }, version: 5 });
  });

  it("should isolate snapshots by aggregate name", async () => {
    await infra.snapshotStore.save("Account", "1", {
      state: { balance: 100 },
      version: 2,
    });
    await infra.snapshotStore.save("Order", "1", {
      state: { total: 200 },
      version: 3,
    });
    const account = await infra.snapshotStore.load("Account", "1");
    const order = await infra.snapshotStore.load("Order", "1");
    expect(account).toEqual({ state: { balance: 100 }, version: 2 });
    expect(order).toEqual({ state: { total: 200 }, version: 3 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// PartialEventLoad (loadAfterVersion)
// ═══════════════════════════════════════════════════════════════════

describe("PrismaEventSourcedAggregatePersistence - PartialEventLoad", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("should load events after a given version", async () => {
    await infra.eventSourcedPersistence.save(
      "Account",
      "acc-1",
      [
        { name: "AccountCreated", payload: { owner: "Alice" } },
        { name: "DepositMade", payload: { amount: 100 } },
        { name: "DepositMade", payload: { amount: 200 } },
      ],
      0,
    );
    const persistence =
      infra.eventSourcedPersistence as EventSourcedAggregatePersistence &
        PartialEventLoad;
    const events = await persistence.loadAfterVersion("Account", "acc-1", 1);
    expect(events).toHaveLength(2);
    expect(events[0]!.name).toBe("DepositMade");
    expect(events[0]!.payload).toEqual({ amount: 100 });
  });

  it("should return empty array when afterVersion >= stream length", async () => {
    await infra.eventSourcedPersistence.save(
      "Account",
      "acc-1",
      [{ name: "AccountCreated", payload: { owner: "Alice" } }],
      0,
    );
    const persistence =
      infra.eventSourcedPersistence as EventSourcedAggregatePersistence &
        PartialEventLoad;
    const events = await persistence.loadAfterVersion("Account", "acc-1", 99);
    expect(events).toEqual([]);
  });

  it("should return all events when afterVersion is 0", async () => {
    await infra.eventSourcedPersistence.save(
      "Account",
      "acc-1",
      [
        { name: "AccountCreated", payload: { owner: "Alice" } },
        { name: "DepositMade", payload: { amount: 50 } },
      ],
      0,
    );
    const persistence =
      infra.eventSourcedPersistence as EventSourcedAggregatePersistence &
        PartialEventLoad;
    const events = await persistence.loadAfterVersion("Account", "acc-1", 0);
    expect(events).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Advisory Locker
// ═══════════════════════════════════════════════════════════════════

function mockPrisma() {
  return { $queryRawUnsafe: vi.fn() } as unknown as PrismaClient;
}

describe("PrismaAdvisoryLocker", () => {
  it("should accept postgresql dialect", () => {
    expect(
      () => new PrismaAdvisoryLocker(mockPrisma(), "postgresql"),
    ).not.toThrow();
  });

  it("should accept mysql dialect", () => {
    expect(() => new PrismaAdvisoryLocker(mockPrisma(), "mysql")).not.toThrow();
  });

  it("should accept mariadb dialect", () => {
    expect(
      () => new PrismaAdvisoryLocker(mockPrisma(), "mariadb"),
    ).not.toThrow();
  });

  it("should reject unsupported dialects", () => {
    expect(
      () => new PrismaAdvisoryLocker(mockPrisma(), "sqlite" as any),
    ).toThrow(/not supported/i);
  });

  it("should use GET_LOCK for mariadb acquire (same as mysql)", async () => {
    const client = mockPrisma();
    (
      client.$queryRawUnsafe as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue([{ acquired: 1n }]);
    const locker = new PrismaAdvisoryLocker(client, "mariadb");

    await locker.acquire("Order", "o-1", 5000);

    const sql = (client.$queryRawUnsafe as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0] as string;
    expect(sql).toContain("GET_LOCK");
  });

  it("should use RELEASE_LOCK for mariadb release (same as mysql)", async () => {
    const client = mockPrisma();
    (
      client.$queryRawUnsafe as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue([]);
    const locker = new PrismaAdvisoryLocker(client, "mariadb");

    await locker.release("Order", "o-1");

    const sql = (client.$queryRawUnsafe as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0] as string;
    expect(sql).toContain("RELEASE_LOCK");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Outbox Store
// ═══════════════════════════════════════════════════════════════════

describe("PrismaOutboxStore", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  function makeEntry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
    return {
      id: overrides.id ?? crypto.randomUUID(),
      event: overrides.event ?? {
        name: "TestEvent",
        payload: { value: 42 },
      },
      aggregateName: overrides.aggregateName,
      aggregateId: overrides.aggregateId,
      createdAt: overrides.createdAt ?? new Date(),
      publishedAt: overrides.publishedAt ?? null,
    };
  }

  it("should save and load unpublished entries", async () => {
    const entry1 = makeEntry({
      id: "entry-1",
      aggregateName: "Account",
      aggregateId: "acc-1",
    });
    const entry2 = makeEntry({
      id: "entry-2",
      aggregateName: "Order",
      aggregateId: "ord-1",
    });

    await infra.outboxStore.save([entry1, entry2]);
    const loaded = await infra.outboxStore.loadUnpublished();

    expect(loaded).toHaveLength(2);
    expect(loaded[0]!.id).toBe("entry-1");
    expect(loaded[0]!.event).toEqual({
      name: "TestEvent",
      payload: { value: 42 },
    });
    expect(loaded[0]!.aggregateName).toBe("Account");
    expect(loaded[0]!.aggregateId).toBe("acc-1");
    expect(loaded[0]!.publishedAt).toBeNull();
    expect(loaded[1]!.id).toBe("entry-2");
  });

  it("should mark entries as published via markPublished", async () => {
    const entry = makeEntry({ id: "entry-pub" });
    await infra.outboxStore.save([entry]);

    await infra.outboxStore.markPublished(["entry-pub"]);

    const unpublished = await infra.outboxStore.loadUnpublished();
    expect(unpublished).toHaveLength(0);
  });

  it("should mark entries as published by event metadata eventId", async () => {
    const entry = makeEntry({
      id: "entry-meta",
      event: {
        name: "AccountCreated",
        payload: { owner: "Alice" },
        metadata: {
          eventId: "evt-123",
          timestamp: new Date().toISOString(),
          correlationId: "corr-1",
          causationId: "cause-1",
        },
      },
    });
    await infra.outboxStore.save([entry]);

    await infra.outboxStore.markPublishedByEventIds(["evt-123"]);

    const unpublished = await infra.outboxStore.loadUnpublished();
    expect(unpublished).toHaveLength(0);
  });

  it("should delete only published entries via deletePublished", async () => {
    const published = makeEntry({ id: "entry-done" });
    const unpub = makeEntry({ id: "entry-pending" });
    await infra.outboxStore.save([published, unpub]);

    // Mark one as published
    await infra.outboxStore.markPublished(["entry-done"]);

    // Delete published entries
    await infra.outboxStore.deletePublished();

    // Only unpublished entry should remain
    const remaining = await infra.outboxStore.loadUnpublished();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe("entry-pending");
  });

  it("should save within a UoW transaction", async () => {
    const uow = infra.unitOfWorkFactory();
    const entry = makeEntry({ id: "entry-uow" });

    uow.enlist(() => infra.outboxStore.save([entry]));
    uow.enlist(() =>
      infra.eventSourcedPersistence.save(
        "Account",
        "acc-1",
        [{ name: "AccountCreated", payload: { owner: "Alice" } }],
        0,
      ),
    );

    await uow.commit();

    const loaded = await infra.outboxStore.loadUnpublished();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe("entry-uow");

    const events = await infra.eventSourcedPersistence.load("Account", "acc-1");
    expect(events).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Per-Aggregate Dedicated State Persistence (mapper-based)
// ═══════════════════════════════════════════════════════════════════

/**
 * Unit-style per-aggregate mapper tests use a mock PrismaClient so we can
 * run them without a real per-aggregate model in the schema.
 * Integration tests that need real typed columns would require a separate
 * schema with a custom model (e.g. `Order`) and are left as noted in the spec.
 */
describe("Per-aggregate state persistence — jsonStateMapper (unit)", () => {
  function createMockDelegate() {
    const store = new Map<string, Record<string, unknown>>();
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

  it("per-aggregate state model: jsonStateMapper save and load roundtrip", async () => {
    const delegate = createMockDelegate();
    const mockPrismaInst: any = { order: delegate };

    const adapter = createPrismaAdapter(mockPrismaInst as any, {
      aggregateStates: {
        Order: { model: "order", mapper: jsonStateMapper() },
      },
    });

    const persistence = adapter.stateStoreFor("Order");
    await persistence.save("Order", "o-1", { status: "placed", total: 100 }, 0);

    const loaded = await persistence.load("Order", "o-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.state).toEqual({ status: "placed", total: 100 });
    expect(loaded!.version).toBe(1);
  });

  it("stateStoreFor: throws when aggregate name not configured", () => {
    const mockPrismaInst: any = { order: createMockDelegate() };

    const adapter = createPrismaAdapter(mockPrismaInst as any, {
      aggregateStates: {
        Order: { model: "order", mapper: jsonStateMapper() },
      },
    });

    expect(() => adapter.stateStoreFor("Unknown" as any)).toThrow(
      /No dedicated state table configured for aggregate "Unknown"/,
    );
  });

  it("typed-column mapper: throws ConcurrencyError on version mismatch", async () => {
    const delegate = createMockDelegate();
    const mockPrismaInst: any = { order: delegate };

    const adapter = createPrismaAdapter(mockPrismaInst as any, {
      aggregateStates: {
        Order: { model: "order", mapper: jsonStateMapper() },
      },
    });

    const persistence = adapter.stateStoreFor("Order");
    await persistence.save("Order", "o-1", { total: 1000 }, 0);

    await expect(
      persistence.save("Order", "o-1", { total: 2000 }, 0),
    ).rejects.toThrow(ConcurrencyError);
  });

  it("dedicated persistence participates in UoW transaction via shared txStore", async () => {
    const delegate = createMockDelegate();
    const eventDelegate = {
      createMany: vi.fn(async () => ({})),
      findMany: vi.fn(async () => []),
    };
    const stateDelegate = {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 0 })),
    };
    const sagaDelegate = {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
    };

    // Minimal mock that exercises shared txStore routing
    const mockPrismaInst: any = {
      order: delegate,
      nodddeEvent: eventDelegate,
      nodddeAggregateState: stateDelegate,
      nodddeSagaState: sagaDelegate,
      $transaction: vi.fn(async (fn: any) => {
        const tx: any = {
          order: delegate,
          nodddeEvent: eventDelegate,
          nodddeAggregateState: stateDelegate,
          nodddeSagaState: sagaDelegate,
        };
        return fn(tx);
      }),
    };

    const adapter = createPrismaAdapter(mockPrismaInst as any, {
      aggregateStates: {
        Order: { model: "order", mapper: jsonStateMapper() },
      },
    });

    const uow = adapter.unitOfWorkFactory();
    const dedicated = adapter.stateStoreFor("Order");

    uow.enlist(() => dedicated.save("Order", "o-1", { total: 500 }, 0));
    await uow.commit();

    // The $transaction callback should have been called
    expect(mockPrismaInst.$transaction).toHaveBeenCalledOnce();
    // The dedicated delegate should have received the create call
    expect(delegate.create).toHaveBeenCalledOnce();
  });

  it("createPrismaAdapter throws when configured model not on PrismaClient", () => {
    const mockPrismaInst: any = {};

    expect(() =>
      createPrismaAdapter(mockPrismaInst as any, {
        aggregateStates: {
          Foo: { model: "nonexistent", mapper: jsonStateMapper() },
        },
      }),
    ).toThrow(/Prisma model "nonexistent" not found on PrismaClient/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Per-Aggregate Dedicated State Persistence — typed-column mapper (real DB)
// ═══════════════════════════════════════════════════════════════════

import type { PrismaStateMapper } from "../index";
import type { Prisma } from "@prisma/client";

type OrderState = {
  customerId: string;
  total: number;
  status: "open" | "paid" | "cancelled";
};

const orderTypedMapper: PrismaStateMapper<
  OrderState,
  Prisma.OrderUncheckedCreateInput
> = {
  aggregateIdField: "aggregateId",
  versionField: "version",
  toRow: (state) => ({
    customerId: state.customerId,
    total: state.total,
    status: state.status,
  }),
  fromRow: (row) => ({
    customerId: row.customerId!,
    total: row.total!,
    status: row.status as OrderState["status"],
  }),
};

describe("Per-aggregate state persistence — typed-column mapper (real DB)", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("typed-column mapper: writes and reads typed rows", async () => {
    const adapter = createPrismaAdapter(prisma, {
      aggregateStates: {
        Order: { model: "order", mapper: orderTypedMapper },
      },
    });

    const persistence = adapter.stateStoreFor("Order");
    await persistence.save(
      "Order",
      "o-1",
      { customerId: "c-7", total: 4200, status: "open" },
      0,
    );

    // Verify typed columns landed directly, no JSON blob
    const raw = await prisma.order.findUnique({
      where: { aggregateId: "o-1" },
    });
    expect(raw).not.toBeNull();
    expect(raw!.customerId).toBe("c-7");
    expect(raw!.total).toBe(4200);
    expect(raw!.status).toBe("open");
    expect(raw!.version).toBe(1);

    const loaded = await persistence.load("Order", "o-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.state).toEqual({
      customerId: "c-7",
      total: 4200,
      status: "open",
    });
    expect(loaded!.version).toBe(1);
  });

  it("typed-column mapper: throws ConcurrencyError on version mismatch", async () => {
    const adapter = createPrismaAdapter(prisma, {
      aggregateStates: {
        Order: { model: "order", mapper: orderTypedMapper },
      },
    });

    const persistence = adapter.stateStoreFor("Order");
    await persistence.save(
      "Order",
      "o-1",
      { customerId: "c-7", total: 1000, status: "open" },
      0,
    );

    await expect(
      persistence.save(
        "Order",
        "o-1",
        { customerId: "c-7", total: 2000, status: "paid" },
        0,
      ),
    ).rejects.toThrow(ConcurrencyError);
  });

  it("typed-column mapper: increments version on update", async () => {
    const adapter = createPrismaAdapter(prisma, {
      aggregateStates: {
        Order: { model: "order", mapper: orderTypedMapper },
      },
    });

    const persistence = adapter.stateStoreFor("Order");
    await persistence.save(
      "Order",
      "o-1",
      { customerId: "c-7", total: 1000, status: "open" },
      0,
    );
    await persistence.save(
      "Order",
      "o-1",
      { customerId: "c-7", total: 1000, status: "paid" },
      1,
    );

    const loaded = await persistence.load("Order", "o-1");
    expect(loaded!.state.status).toBe("paid");
    expect(loaded!.version).toBe(2);
  });
});
