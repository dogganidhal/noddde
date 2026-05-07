import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { expectTypeOf } from "vitest";
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
  jsonStateMapper,
  type TypeORMAggregateStateTableConfig,
  type TypeORMStateMapper,
} from "../index";

// ─── Entities ────────────────────────────────────────────────────────────────

/** Entity for opaque JSON tests (jsonStateMapper default column names). */
@Entity("orders")
class OrderStateEntity {
  @PrimaryColumn() aggregateId!: string;
  @Column({ type: "text" }) state!: string;
  @Column({ type: "int", default: 0 }) version!: number;
}

/** Entity for typed-column mapper tests. */
type OrderState = {
  customerId: string;
  total: number;
  status: "open" | "paid" | "cancelled";
};

@Entity("typed_orders")
class OrderTypedEntity {
  @PrimaryColumn({ type: "text" }) aggregateId!: string;
  @Column({ type: "text", name: "customer_id" }) customerId!: string;
  @Column({ type: "int", name: "total_cents" }) total!: number;
  @Column({ type: "text" }) status!: OrderState["status"];
  @Column({ type: "int", default: 0 }) version!: number;
}

/** Typed-column mapper for {@link OrderTypedEntity}. */
const orderMapper: TypeORMStateMapper<OrderState, OrderTypedEntity> = {
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
    status: row.status!,
  }),
};

// ─── Database setup ───────────────────────────────────────────────────────────

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
      OrderStateEntity,
      OrderTypedEntity,
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

// ─── createTypeORMAdapter factory ─────────────────────────────────────────────

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

  it("stateStoreFor throws for unconfigured aggregate", () => {
    const result = createTypeORMAdapter(dataSource, {
      aggregateStates: {
        Order: {
          entity: OrderStateEntity,
          mapper: jsonStateMapper<OrderStateEntity>(),
        },
      },
    });

    expect(() => result.stateStoreFor("Foo" as any)).toThrow(
      /No dedicated state table configured for aggregate "Foo"/,
    );
  });
});

// ─── Per-aggregate state entity: jsonStateMapper roundtrip ───────────────────

describe("Per-aggregate state entity: jsonStateMapper", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("per-aggregate state entity: jsonStateMapper save and load roundtrip", async () => {
    const adapter = createTypeORMAdapter(dataSource, {
      aggregateStates: {
        Order: {
          entity: OrderStateEntity,
          mapper: jsonStateMapper<OrderStateEntity>(),
        },
      },
    });

    const persistence = adapter.stateStoreFor("Order");
    await persistence.save("Order", "o-1", { status: "placed", total: 100 }, 0);

    const loaded = await persistence.load("Order", "o-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.state).toEqual({ status: "placed", total: 100 });
    expect(loaded!.version).toBe(1);
  });

  it("returns null for nonexistent aggregate", async () => {
    const adapter = createTypeORMAdapter(dataSource, {
      aggregateStates: {
        Order: {
          entity: OrderStateEntity,
          mapper: jsonStateMapper<OrderStateEntity>(),
        },
      },
    });

    const loaded = await adapter
      .stateStoreFor("Order")
      .load("Order", "nonexistent");
    expect(loaded).toBeNull();
  });

  it("throws ConcurrencyError on version mismatch", async () => {
    const adapter = createTypeORMAdapter(dataSource, {
      aggregateStates: {
        Order: {
          entity: OrderStateEntity,
          mapper: jsonStateMapper<OrderStateEntity>(),
        },
      },
    });

    const persistence = adapter.stateStoreFor("Order");
    await persistence.save("Order", "o-1", { total: 100 }, 0);
    await expect(
      persistence.save("Order", "o-1", { total: 200 }, 0),
    ).rejects.toThrow(ConcurrencyError);
  });

  it("jsonStateMapper with custom field names", async () => {
    @Entity("custom_orders")
    class CustomOrderEntity {
      @PrimaryColumn() id!: string;
      @Column({ type: "text" }) data!: string;
      @Column({ type: "int", default: 0 }) rev!: number;
    }

    const localDs = new DataSource({
      type: "better-sqlite3",
      database: ":memory:",
      entities: [
        NodddeEventEntity,
        NodddeAggregateStateEntity,
        NodddeSagaStateEntity,
        NodddeSnapshotEntity,
        NodddeOutboxEntryEntity,
        CustomOrderEntity,
      ],
      synchronize: true,
    });
    await localDs.initialize();

    try {
      const adapter = createTypeORMAdapter(localDs, {
        aggregateStates: {
          Order: {
            entity: CustomOrderEntity,
            mapper: jsonStateMapper<CustomOrderEntity>({
              aggregateIdField: "id",
              stateField: "data",
              versionField: "rev",
            }),
          },
        },
      });

      const persistence = adapter.stateStoreFor("Order");
      await persistence.save("Order", "order-1", { total: 100 }, 0);
      const loaded = await persistence.load("Order", "order-1");

      expect(loaded).toEqual({ state: { total: 100 }, version: 1 });
    } finally {
      await localDs.destroy();
    }
  });
});

// ─── Per-aggregate state entity: typed-column mapper ─────────────────────────

describe("Per-aggregate state entity: typed-column mapper", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("per-aggregate state entity: typed-column mapper writes typed rows", async () => {
    const adapter = createTypeORMAdapter(dataSource, {
      aggregateStates: {
        Order: { entity: OrderTypedEntity, mapper: orderMapper },
      },
    });

    const persistence = adapter.stateStoreFor("Order");
    await persistence.save(
      "Order",
      "o-1",
      { customerId: "c-7", total: 4200, status: "open" },
      0,
    );

    const repo = dataSource.getRepository(OrderTypedEntity);
    const raw = await repo.findOne({ where: { aggregateId: "o-1" } });
    expect(raw!.customerId).toBe("c-7");
    expect(raw!.total).toBe(4200);
    expect(raw!.status).toBe("open");
    expect(raw!.version).toBe(1);

    const loaded = await persistence.load("Order", "o-1");
    expect(loaded!.state).toEqual({
      customerId: "c-7",
      total: 4200,
      status: "open",
    });
    expect(loaded!.version).toBe(1);
  });

  it("typed-column mapper: throws ConcurrencyError on version mismatch", async () => {
    const adapter = createTypeORMAdapter(dataSource, {
      aggregateStates: {
        Order: { entity: OrderTypedEntity, mapper: orderMapper },
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

  it("typed-column mapper: TS rejects configs missing the mapper", () => {
    // @ts-expect-error — `mapper` is required in TypeORMAggregateStateTableConfig.
    // eslint-disable-next-line no-unused-vars
    const _bad: TypeORMAggregateStateTableConfig<OrderState, OrderTypedEntity> =
      {
        entity: OrderTypedEntity,
      };
    void _bad;

    expectTypeOf(orderMapper.toRow).returns.toMatchTypeOf<
      Partial<OrderTypedEntity>
    >();
  });
});
