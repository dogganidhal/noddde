import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "reflect-metadata";
import { DataSource, Entity, PrimaryColumn, Column } from "typeorm";
import { ConcurrencyError } from "@noddde/core";
import {
  createTypeORMAdapter,
  createTypeORMPersistence,
  NodddeEventEntity,
  NodddeAggregateStateEntity,
  NodddeSagaStateEntity,
  NodddeSnapshotEntity,
  NodddeOutboxEntryEntity,
} from "../index";

// Custom entity for per-aggregate state table testing
@Entity("orders")
class OrderEntity {
  @PrimaryColumn() aggregateId!: string;
  @Column({ type: "text" }) state!: string;
  @Column({ type: "int", default: 0 }) version!: number;
}

// Custom entity with non-standard column names
@Entity("custom_orders")
class CustomOrderEntity {
  @PrimaryColumn() orderId!: string;
  @Column({ type: "text" }) orderData!: string;
  @Column({ type: "int", default: 0 }) rev!: number;
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
  if (dataSource?.isInitialized) {
    await dataSource.destroy();
  }
}

describe("createTypeORMAdapter", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("creates base stores with no config", () => {
    const result = createTypeORMAdapter(dataSource);

    expect(result.eventSourcedPersistence).toBeDefined();
    expect(result.stateStoredPersistence).toBeDefined();
    expect(result.sagaPersistence).toBeDefined();
    expect(result.unitOfWorkFactory).toBeDefined();
    expect((result as any).snapshotStore).toBeUndefined();
    expect((result as any).outboxStore).toBeUndefined();
  });

  it("creates all stores when fully configured", () => {
    const result = createTypeORMAdapter(dataSource, {
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

  it("createTypeORMPersistence backwards compatibility", () => {
    const infra = createTypeORMPersistence(dataSource);

    expect(infra.eventSourcedPersistence).toBeDefined();
    expect(infra.stateStoredPersistence).toBeDefined();
    expect(infra.sagaPersistence).toBeDefined();
    expect(infra.snapshotStore).toBeDefined();
    expect(infra.outboxStore).toBeDefined();
    expect(infra.unitOfWorkFactory).toBeDefined();
  });

  it("stateStoreFor returns dedicated persistence for configured aggregate", async () => {
    const result = createTypeORMAdapter(dataSource, {
      aggregateStates: {
        Order: { entity: OrderEntity },
      },
    });

    const orderStore = result.stateStoreFor("Order");
    await orderStore.save("Order", "order-1", { total: 100 }, 0);
    const loaded = await orderStore.load("Order", "order-1");

    expect(loaded).toEqual({ state: { total: 100 }, version: 1 });
  });

  it("returns null for nonexistent aggregate", async () => {
    const result = createTypeORMAdapter(dataSource, {
      aggregateStates: {
        Order: { entity: OrderEntity },
      },
    });

    const loaded = await result
      .stateStoreFor("Order")
      .load("Order", "nonexistent");
    expect(loaded).toBeNull();
  });

  it("throws ConcurrencyError on version mismatch", async () => {
    const result = createTypeORMAdapter(dataSource, {
      aggregateStates: {
        Order: { entity: OrderEntity },
      },
    });

    const orderStore = result.stateStoreFor("Order");
    await orderStore.save("Order", "order-1", { total: 100 }, 0);
    await expect(
      orderStore.save("Order", "order-1", { total: 200 }, 0),
    ).rejects.toThrow(ConcurrencyError);
  });

  it("supports custom column mapping", async () => {
    const result = createTypeORMAdapter(dataSource, {
      aggregateStates: {
        Order: {
          entity: CustomOrderEntity,
          columns: {
            aggregateId: "orderId",
            state: "orderData",
            version: "rev",
          },
        },
      },
    });

    const orderStore = result.stateStoreFor("Order");
    await orderStore.save("Order", "order-1", { total: 100 }, 0);
    const loaded = await orderStore.load("Order", "order-1");

    expect(loaded).toEqual({ state: { total: 100 }, version: 1 });
  });
});
