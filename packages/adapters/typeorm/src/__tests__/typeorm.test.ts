import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "reflect-metadata";
import { DataSource } from "typeorm";
import { ConcurrencyError, LockTimeoutError } from "@noddde/core";
import type { OutboxEntry } from "@noddde/core";
import { createTypeORMPersistence, TypeORMAdvisoryLocker } from "../index";
import {
  NodddeEventEntity,
  NodddeAggregateStateEntity,
  NodddeSagaStateEntity,
  NodddeSnapshotEntity,
  NodddeOutboxEntryEntity,
} from "../entities";
import { TypeORMEventSourcedAggregatePersistence } from "../persistence";

let dataSource: DataSource;
let infra: ReturnType<typeof createTypeORMPersistence>;

async function setupDb() {
  dataSource = new DataSource({
    type: "better-sqlite3",
    database: ":memory:",
    entities: [
      NodddeEventEntity,
      NodddeAggregateStateEntity,
      NodddeSagaStateEntity,
      NodddeSnapshotEntity,
      NodddeOutboxEntryEntity,
    ],
    synchronize: true,
  });
  await dataSource.initialize();
  infra = createTypeORMPersistence(dataSource);
}

async function teardownDb() {
  if (dataSource?.isInitialized) {
    await dataSource.destroy();
  }
}

// ═══════════════════════════════════════════════════════════════════
// Event-Sourced Aggregate Persistence
// ═══════════════════════════════════════════════════════════════════

describe("TypeORMEventSourcedAggregatePersistence", () => {
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
    expect(orderEvents[0]!.name).toBe("OrderPlaced");
    expect(accountEvents).toHaveLength(1);
    expect(accountEvents[0]!.name).toBe("AccountCreated");
  });

  it("should throw ConcurrencyError on version mismatch", async () => {
    await infra.eventSourcedPersistence.save(
      "Account",
      "acc-1",
      [{ name: "AccountCreated", payload: { owner: "Alice" } }],
      0,
    );

    // Attempt to save with stale expectedVersion (0 instead of 1)
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

describe("TypeORMStateStoredAggregatePersistence", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("should save and load state", async () => {
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

  it("should overwrite state on repeated saves", async () => {
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

  it("should throw ConcurrencyError when expectedVersion mismatches stored version", async () => {
    await infra.stateStoredPersistence.save(
      "Account",
      "acc-1",
      { balance: 100 },
      0,
    );

    // Attempt to save with stale expectedVersion (0 instead of 1)
    await expect(
      infra.stateStoredPersistence.save(
        "Account",
        "acc-1",
        { balance: 200 },
        0,
      ),
    ).rejects.toThrow(ConcurrencyError);
  });

  it("should throw ConcurrencyError when expectedVersion is non-zero for new aggregate", async () => {
    await expect(
      infra.stateStoredPersistence.save(
        "Account",
        "acc-new",
        { balance: 100 },
        5,
      ),
    ).rejects.toThrow(ConcurrencyError);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Saga Persistence
// ═══════════════════════════════════════════════════════════════════

describe("TypeORMSagaPersistence", () => {
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

describe("TypeORMUnitOfWork", () => {
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
});

// ═══════════════════════════════════════════════════════════════════
// Snapshot Store
// ═══════════════════════════════════════════════════════════════════

describe("TypeORMSnapshotStore", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("should save and load a snapshot", async () => {
    await infra.snapshotStore.save("Account", "acc-1", {
      state: { balance: 500 },
      version: 10,
    });
    const snapshot = await infra.snapshotStore.load("Account", "acc-1");
    expect(snapshot).toEqual({ state: { balance: 500 }, version: 10 });
  });

  it("should return null for unknown aggregate", async () => {
    const snapshot = await infra.snapshotStore.load("Account", "nonexistent");
    expect(snapshot).toBeNull();
  });

  it("should overwrite snapshot on repeated saves", async () => {
    await infra.snapshotStore.save("Account", "acc-1", {
      state: { balance: 100 },
      version: 5,
    });
    await infra.snapshotStore.save("Account", "acc-1", {
      state: { balance: 300 },
      version: 15,
    });
    const snapshot = await infra.snapshotStore.load("Account", "acc-1");
    expect(snapshot).toEqual({ state: { balance: 300 }, version: 15 });
  });

  it("should isolate snapshots by aggregate name and id", async () => {
    await infra.snapshotStore.save("Order", "1", {
      state: { total: 200 },
      version: 3,
    });
    await infra.snapshotStore.save("Account", "1", {
      state: { balance: 100 },
      version: 7,
    });

    const orderSnapshot = await infra.snapshotStore.load("Order", "1");
    const accountSnapshot = await infra.snapshotStore.load("Account", "1");
    expect(orderSnapshot).toEqual({ state: { total: 200 }, version: 3 });
    expect(accountSnapshot).toEqual({ state: { balance: 100 }, version: 7 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Partial Event Load (loadAfterVersion)
// ═══════════════════════════════════════════════════════════════════

describe("TypeORMEventSourcedAggregatePersistence (loadAfterVersion)", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("should load events after a given version", async () => {
    await infra.eventSourcedPersistence.save(
      "Account",
      "acc-1",
      [
        { name: "AccountCreated", payload: { owner: "Alice" } },
        { name: "DepositMade", payload: { amount: 100 } },
        { name: "DepositMade", payload: { amount: 50 } },
      ],
      0,
    );

    const persistence =
      infra.eventSourcedPersistence as TypeORMEventSourcedAggregatePersistence;
    const events = await persistence.loadAfterVersion("Account", "acc-1", 1);
    expect(events).toHaveLength(2);
    expect(events[0]!.name).toBe("DepositMade");
    expect(events[0]!.payload).toEqual({ amount: 100 });
    expect(events[1]!.name).toBe("DepositMade");
    expect(events[1]!.payload).toEqual({ amount: 50 });
  });

  it("should return all events when afterVersion is 0", async () => {
    await infra.eventSourcedPersistence.save(
      "Account",
      "acc-1",
      [
        { name: "AccountCreated", payload: { owner: "Alice" } },
        { name: "DepositMade", payload: { amount: 100 } },
      ],
      0,
    );

    const persistence =
      infra.eventSourcedPersistence as TypeORMEventSourcedAggregatePersistence;
    const events = await persistence.loadAfterVersion("Account", "acc-1", 0);
    expect(events).toHaveLength(2);
  });

  it("should return empty array when afterVersion >= stream length", async () => {
    await infra.eventSourcedPersistence.save(
      "Account",
      "acc-1",
      [{ name: "AccountCreated", payload: { owner: "Alice" } }],
      0,
    );

    const persistence =
      infra.eventSourcedPersistence as TypeORMEventSourcedAggregatePersistence;
    const events = await persistence.loadAfterVersion("Account", "acc-1", 10);
    expect(events).toEqual([]);
  });

  it("should return empty array for unknown aggregate", async () => {
    const persistence =
      infra.eventSourcedPersistence as TypeORMEventSourcedAggregatePersistence;
    const events = await persistence.loadAfterVersion(
      "Account",
      "nonexistent",
      0,
    );
    expect(events).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Advisory Locker
// ═══════════════════════════════════════════════════════════════════

function mockDataSource(type: string) {
  return { options: { type }, query: vi.fn() } as unknown as DataSource;
}

describe("TypeORMAdvisoryLocker", () => {
  it("should accept postgres database type", () => {
    expect(
      () => new TypeORMAdvisoryLocker(mockDataSource("postgres")),
    ).not.toThrow();
  });

  it("should accept mysql database type", () => {
    expect(
      () => new TypeORMAdvisoryLocker(mockDataSource("mysql")),
    ).not.toThrow();
  });

  it("should accept mariadb database type", () => {
    expect(
      () => new TypeORMAdvisoryLocker(mockDataSource("mariadb")),
    ).not.toThrow();
  });

  it("should accept mssql database type", () => {
    expect(
      () => new TypeORMAdvisoryLocker(mockDataSource("mssql")),
    ).not.toThrow();
  });

  it("should reject sqlite database type", () => {
    expect(() => new TypeORMAdvisoryLocker(mockDataSource("sqlite"))).toThrow(
      /not supported.*sqlite/i,
    );
  });

  it("should reject better-sqlite3 database type", () => {
    expect(
      () => new TypeORMAdvisoryLocker(mockDataSource("better-sqlite3")),
    ).toThrow(/not supported/i);
  });

  it("should call sp_getapplock for MSSQL acquire", async () => {
    const ds = mockDataSource("mssql");
    (ds.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { lockResult: 0 },
    ]);
    const locker = new TypeORMAdvisoryLocker(ds);

    await locker.acquire("Order", "o-1", 5000);

    expect(ds.query).toHaveBeenCalledTimes(1);
    const sql = (ds.query as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as string;
    expect(sql).toContain("sp_getapplock");
    expect(sql).toContain("Exclusive");
  });

  it("should throw LockTimeoutError on negative MSSQL return code", async () => {
    const ds = mockDataSource("mssql");
    (ds.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { lockResult: -1 },
    ]);
    const locker = new TypeORMAdvisoryLocker(ds);

    await expect(locker.acquire("Order", "o-1", 1000)).rejects.toThrow(
      LockTimeoutError,
    );
  });

  it("should throw LockTimeoutError on MSSQL deadlock victim", async () => {
    const ds = mockDataSource("mssql");
    (ds.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { lockResult: -3 },
    ]);
    const locker = new TypeORMAdvisoryLocker(ds);

    await expect(locker.acquire("Order", "o-1")).rejects.toThrow(
      LockTimeoutError,
    );
  });

  it("should call sp_releaseapplock for MSSQL release", async () => {
    const ds = mockDataSource("mssql");
    (ds.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const locker = new TypeORMAdvisoryLocker(ds);

    await locker.release("Order", "o-1");

    const sql = (ds.query as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as string;
    expect(sql).toContain("sp_releaseapplock");
  });

  it("should truncate MSSQL lock name to 255 characters", async () => {
    const ds = mockDataSource("mssql");
    (ds.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { lockResult: 0 },
    ]);
    const locker = new TypeORMAdvisoryLocker(ds);

    const longName = "A".repeat(300);
    await locker.acquire(longName, "id-1");

    const params = (ds.query as ReturnType<typeof vi.fn>).mock
      .calls[0]![1] as any[];
    expect((params[0] as string).length).toBe(255);
  });

  it("should silently handle MSSQL release errors for idempotency", async () => {
    const ds = mockDataSource("mssql");
    (ds.query as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("error 1223"),
    );
    const locker = new TypeORMAdvisoryLocker(ds);

    await expect(locker.release("Order", "o-1")).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Outbox Store
// ═══════════════════════════════════════════════════════════════════

describe("TypeORMOutboxStore", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  function makeEntry(
    overrides: Partial<OutboxEntry> & { id: string },
  ): OutboxEntry {
    return {
      event: { name: "TestEvent", payload: { value: 1 } },
      aggregateName: "TestAggregate",
      aggregateId: "agg-1",
      createdAt: new Date().toISOString(),
      publishedAt: null,
      ...overrides,
    };
  }

  it("should save and load unpublished entries", async () => {
    const entry1 = makeEntry({ id: "entry-1" });
    const entry2 = makeEntry({ id: "entry-2" });

    await infra.outboxStore.save([entry1, entry2]);

    const loaded = await infra.outboxStore.loadUnpublished();
    expect(loaded).toHaveLength(2);
    expect(loaded[0]!.id).toBe("entry-1");
    expect(loaded[0]!.event).toEqual({
      name: "TestEvent",
      payload: { value: 1 },
    });
    expect(loaded[0]!.aggregateName).toBe("TestAggregate");
    expect(loaded[0]!.aggregateId).toBe("agg-1");
    expect(loaded[0]!.publishedAt).toBeNull();
    expect(loaded[1]!.id).toBe("entry-2");
  });

  it("should mark entries as published", async () => {
    const entry = makeEntry({ id: "entry-pub" });
    await infra.outboxStore.save([entry]);

    await infra.outboxStore.markPublished(["entry-pub"]);

    const unpublished = await infra.outboxStore.loadUnpublished();
    expect(unpublished).toHaveLength(0);
  });

  it("should mark entries as published by event metadata eventId", async () => {
    const entry = makeEntry({
      id: "entry-eid",
      event: {
        name: "TestEvent",
        payload: { value: 1 },
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

  it("should delete only published entries", async () => {
    const entry1 = makeEntry({ id: "entry-del-1" });
    const entry2 = makeEntry({ id: "entry-del-2" });
    await infra.outboxStore.save([entry1, entry2]);

    // Publish only entry-del-1
    await infra.outboxStore.markPublished(["entry-del-1"]);

    // Delete all published
    await infra.outboxStore.deletePublished();

    // entry-del-2 should still be unpublished
    const remaining = await infra.outboxStore.loadUnpublished();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe("entry-del-2");
  });

  it("should save within a UoW transaction", async () => {
    const uow = infra.unitOfWorkFactory();
    const entry = makeEntry({ id: "entry-uow" });

    uow.enlist(() => infra.outboxStore.save([entry]));
    uow.deferPublish({ name: "TestEvent", payload: { value: 1 } });

    const events = await uow.commit();
    expect(events).toHaveLength(1);

    const loaded = await infra.outboxStore.loadUnpublished();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe("entry-uow");
  });
});
