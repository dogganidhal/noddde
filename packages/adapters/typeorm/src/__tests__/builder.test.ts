import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "reflect-metadata";
import { DataSource, Entity, PrimaryColumn, Column } from "typeorm";
import { ConcurrencyError } from "@noddde/core";
import {
  TypeORMAdapter,
  createTypeORMPersistence,
  NodddeEventEntity,
  NodddeAggregateStateEntity,
  NodddeSagaStateEntity,
  NodddeSnapshotEntity,
  NodddeOutboxEntryEntity,
} from "@noddde/typeorm";

// Custom entity for per-aggregate state table testing
@Entity("orders")
class OrderEntity {
  @PrimaryColumn({ name: "aggregate_id" })
  aggregateId!: string;

  @Column({ type: "text" })
  state!: string;

  @Column({ type: "int", default: 0 })
  version!: number;
}

// Custom entity with non-standard column names
@Entity("custom_orders")
class CustomOrderEntity {
  @PrimaryColumn({ name: "order_id" })
  orderId!: string;

  @Column({ type: "text", name: "order_data" })
  orderData!: string;

  @Column({ type: "int", name: "rev", default: 0 })
  rev!: number;
}

let dataSource: DataSource;

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
      OrderEntity,
      CustomOrderEntity,
    ],
    synchronize: true,
  });
  await dataSource.initialize();
}

async function teardownDb() {
  if (dataSource?.isInitialized) await dataSource.destroy();
}

describe("TypeORMAdapter Builder", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("should create all stores when fully configured", () => {
    const result = new TypeORMAdapter(dataSource)
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
      new TypeORMAdapter(dataSource).withSagaStore().build();
    }).toThrow(
      "TypeORMAdapter requires withEventStore() to be called before build()",
    );
  });

  it("should throw if withSagaStore was not called", () => {
    expect(() => {
      new TypeORMAdapter(dataSource).withEventStore().build();
    }).toThrow(
      "TypeORMAdapter requires withSagaStore() to be called before build()",
    );
  });

  it("should have stateStoredPersistence undefined when withStateStore not called", () => {
    const result = new TypeORMAdapter(dataSource)
      .withEventStore()
      .withSagaStore()
      .build();

    expect(result.stateStoredPersistence).toBeUndefined();
    expect(result.snapshotStore).toBeUndefined();
    expect(result.outboxStore).toBeUndefined();
  });

  it("createTypeORMPersistence backwards compatibility", () => {
    const infra = createTypeORMPersistence(dataSource);

    expect(infra.eventSourcedPersistence).toBeDefined();
    expect(infra.stateStoredPersistence).toBeDefined();
    expect(infra.sagaPersistence).toBeDefined();
    expect(infra.snapshotStore).toBeDefined();
    expect(infra.outboxStore).toBeDefined();
    expect(infra.unitOfWorkFactory).toBeDefined();
  });

  it("stateStoreFor should throw for unknown aggregate", () => {
    const result = new TypeORMAdapter(dataSource)
      .withEventStore()
      .withSagaStore()
      .build();

    expect(() => result.stateStoreFor("Unknown")).toThrow(
      'No dedicated state table configured for aggregate "Unknown"',
    );
  });
});

describe("TypeORMAdapter Per-Aggregate State Tables", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("should save and load via dedicated entity", async () => {
    const result = new TypeORMAdapter(dataSource)
      .withEventStore()
      .withSagaStore()
      .withAggregateStateTable("Order", { entity: OrderEntity })
      .build();

    const orderStore = result.stateStoreFor("Order");

    await orderStore.save("Order", "order-1", { total: 100 }, 0);
    const loaded = await orderStore.load("Order", "order-1");

    expect(loaded).toEqual({ state: { total: 100 }, version: 1 });
  });

  it("should return null for nonexistent aggregate", async () => {
    const result = new TypeORMAdapter(dataSource)
      .withEventStore()
      .withSagaStore()
      .withAggregateStateTable("Order", { entity: OrderEntity })
      .build();

    const loaded = await result
      .stateStoreFor("Order")
      .load("Order", "nonexistent");
    expect(loaded).toBeNull();
  });

  it("should throw ConcurrencyError on version mismatch", async () => {
    const result = new TypeORMAdapter(dataSource)
      .withEventStore()
      .withSagaStore()
      .withAggregateStateTable("Order", { entity: OrderEntity })
      .build();

    const orderStore = result.stateStoreFor("Order");

    await orderStore.save("Order", "order-1", { total: 100 }, 0);
    await expect(
      orderStore.save("Order", "order-1", { total: 200 }, 0),
    ).rejects.toThrow(ConcurrencyError);
  });

  it("should use custom column mapping", async () => {
    const result = new TypeORMAdapter(dataSource)
      .withEventStore()
      .withSagaStore()
      .withAggregateStateTable("Order", {
        entity: CustomOrderEntity,
        columns: {
          aggregateId: "orderId",
          state: "orderData",
          version: "rev",
        },
      })
      .build();

    const orderStore = result.stateStoreFor("Order");

    await orderStore.save("Order", "order-1", { total: 250 }, 0);
    const loaded = await orderStore.load("Order", "order-1");

    expect(loaded).toEqual({ state: { total: 250 }, version: 1 });
  });

  it("should participate in UoW transaction", async () => {
    const result = new TypeORMAdapter(dataSource)
      .withEventStore()
      .withSagaStore()
      .withAggregateStateTable("Order", { entity: OrderEntity })
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
