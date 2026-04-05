---
title: "Outbox Delivery"
module: integration/outbox-delivery
source_file:
  - packages/engine/src/domain.ts
  - packages/engine/src/outbox-relay.ts
  - packages/engine/src/implementations/in-memory-outbox-store.ts
status: implemented
exports: []
depends_on:
  - engine/domain
  - core/persistence/outbox
  - engine/outbox-relay
  - engine/implementations/in-memory-outbox-store
docs:
  - running/outbox-pattern.mdx
---

# Outbox Delivery

> Validates the full transactional outbox flow end-to-end: command dispatch writes outbox entries atomically with aggregate persistence, events are published on the happy path, the relay recovers unpublished entries after simulated crashes, and explicit `withUnitOfWork()` boundaries correctly integrate with the outbox.

## Involved Components

- **`Domain`** -- orchestrates command dispatch with outbox integration.
- **`InMemoryOutboxStore`** -- in-memory outbox store for test inspection.
- **`OutboxRelay`** -- background relay that dispatches unpublished entries.
- **`Domain.processOutboxOnce()`** -- manual relay trigger for deterministic testing.
- **`Domain.withUnitOfWork()`** -- explicit unit of work boundary with outbox marking.
- **`EventEmitterEventBus`** -- event bus that receives dispatched events.

## Behavioral Requirements

1. **Atomic outbox writes**: When a command is dispatched with outbox configured, outbox entries are written atomically with aggregate persistence within the same UoW.
2. **Happy-path delivery**: On the happy path, events are dispatched immediately via the EventBus after UoW commit, and outbox entries are marked as published.
3. **Entry content**: Each outbox entry contains the fully enriched event (with metadata), aggregate name/id, and a createdAt timestamp.
4. **Relay recovery**: If outbox entries remain unpublished (simulating a crash between commit and dispatch), `processOutboxOnce()` dispatches them and marks them published.
5. **Explicit UoW + outbox**: `withUnitOfWork()` writes outbox entries for all commands in the batch, dispatches events after commit, and marks entries as published.
6. **No outbox without config**: When outbox is not configured, no outbox entries are written and `processOutboxOnce()` returns 0.
7. **Multiple commands produce multiple entries**: A command that produces N events creates N outbox entries.

## Test Scenarios

### Command dispatch writes outbox entries atomically with persistence

```ts
import { describe, it, expect, vi } from "vitest";
import type { DefineCommands, DefineEvents } from "@noddde/core";
import { defineAggregate } from "@noddde/core";
import {
  defineDomain,
  wireDomain,
  InMemoryOutboxStore,
  InMemoryEventSourcedAggregatePersistence,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
} from "@noddde/engine";

type OrderCommands = DefineCommands<{
  PlaceOrder: { total: number };
}>;

type OrderEvents = DefineEvents<{
  OrderPlaced: { total: number };
}>;

const Order = defineAggregate<{
  state: { placed: boolean };
  events: OrderEvents;
  commands: OrderCommands;
  id: string;
  ports: {};
}>({
  name: "Order",
  initialState: { placed: false },
  decide: {
    PlaceOrder: (cmd) => ({
      name: "OrderPlaced" as const,
      payload: { total: cmd.payload.total },
    }),
  },
  evolve: {
    OrderPlaced: (payload, state) => ({ ...state, placed: true }),
  },
});

describe("Outbox Delivery", () => {
  it("should write outbox entries atomically with aggregate persistence", async () => {
    const outboxStore = new InMemoryOutboxStore();
    const domain = await wireDomain(
      defineDomain({
        writeModel: { aggregates: { Order } },
        readModel: { projections: {} },
      }),
      {
        outbox: { store: () => outboxStore },
      },
    );

    await domain.dispatchCommand({
      name: "PlaceOrder",
      targetAggregateId: "order-1",
      payload: { total: 99.99 },
    });

    const entries = outboxStore.findAll();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.event.name).toBe("OrderPlaced");
    expect(entries[0]!.event.payload).toEqual({ total: 99.99 });
    expect(entries[0]!.aggregateName).toBe("Order");
    expect(entries[0]!.aggregateId).toBe("order-1");
    expect(entries[0]!.event.metadata).toBeDefined();
    expect(entries[0]!.event.metadata!.eventId).toBeDefined();
  });
});
```

### Happy path marks outbox entries as published

```ts
it("should mark outbox entries as published on happy path", async () => {
  const outboxStore = new InMemoryOutboxStore();
  const domain = await wireDomain(
    defineDomain({
      writeModel: { aggregates: { Order } },
      readModel: { projections: {} },
    }),
    {
      outbox: { store: () => outboxStore },
    },
  );

  await domain.dispatchCommand({
    name: "PlaceOrder",
    targetAggregateId: "order-1",
    payload: { total: 50 },
  });

  const entries = outboxStore.findAll();
  expect(entries).toHaveLength(1);
  expect(entries[0]!.publishedAt).not.toBeNull();
});
```

### Relay recovers unpublished entries after simulated crash

```ts
it("should recover unpublished entries via processOutboxOnce", async () => {
  const outboxStore = new InMemoryOutboxStore();
  const eventBus = new EventEmitterEventBus();
  const dispatchSpy = vi.spyOn(eventBus, "dispatch");

  const domain = await wireDomain(
    defineDomain({
      writeModel: { aggregates: { Order } },
      readModel: { projections: {} },
    }),
    {
      outbox: { store: () => outboxStore },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus,
        queryBus: new InMemoryQueryBus(),
      }),
    },
  );

  // Manually insert an unpublished outbox entry (simulating crash)
  await outboxStore.save([
    {
      id: "crash-entry-1",
      event: {
        name: "OrderPlaced",
        payload: { total: 42 },
        metadata: { eventId: "evt-crash-1" },
      },
      aggregateName: "Order",
      aggregateId: "order-crash",
      createdAt: new Date().toISOString(),
      publishedAt: null,
    },
  ]);

  dispatchSpy.mockClear();

  const dispatched = await domain.processOutboxOnce();
  expect(dispatched).toBe(1);

  // Event was dispatched via EventBus
  expect(dispatchSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "OrderPlaced",
      payload: { total: 42 },
    }),
  );

  // Entry is now marked as published
  const unpublished = await outboxStore.loadUnpublished();
  expect(unpublished).toHaveLength(0);
});
```

### withUnitOfWork writes outbox entries for all commands

```ts
it("should write outbox entries for all commands in withUnitOfWork", async () => {
  const outboxStore = new InMemoryOutboxStore();
  const domain = await wireDomain(
    defineDomain({
      writeModel: { aggregates: { Order } },
      readModel: { projections: {} },
    }),
    {
      outbox: { store: () => outboxStore },
    },
  );

  await domain.withUnitOfWork(async () => {
    await domain.dispatchCommand({
      name: "PlaceOrder",
      targetAggregateId: "order-1",
      payload: { total: 100 },
    });
    await domain.dispatchCommand({
      name: "PlaceOrder",
      targetAggregateId: "order-2",
      payload: { total: 200 },
    });
  });

  const entries = outboxStore.findAll();
  expect(entries).toHaveLength(2);

  const eventNames = entries.map((e) => e.event.name);
  expect(eventNames).toEqual(["OrderPlaced", "OrderPlaced"]);

  const aggregateIds = entries.map((e) => e.aggregateId);
  expect(aggregateIds).toContain("order-1");
  expect(aggregateIds).toContain("order-2");

  // All should be marked published (happy path)
  expect(entries.every((e) => e.publishedAt !== null)).toBe(true);
});
```

### processOutboxOnce returns 0 when no outbox configured

```ts
it("should return 0 from processOutboxOnce when no outbox configured", async () => {
  const domain = await wireDomain(
    defineDomain({
      writeModel: { aggregates: { Order } },
      readModel: { projections: {} },
    }),
    {
      // No outbox configured
    },
  );

  const dispatched = await domain.processOutboxOnce();
  expect(dispatched).toBe(0);
});
```

### Relay does not re-dispatch already published entries

```ts
it("should not re-dispatch already published entries", async () => {
  const outboxStore = new InMemoryOutboxStore();
  const eventBus = new EventEmitterEventBus();
  const dispatchSpy = vi.spyOn(eventBus, "dispatch");

  const domain = await wireDomain(
    defineDomain({
      writeModel: { aggregates: { Order } },
      readModel: { projections: {} },
    }),
    {
      outbox: { store: () => outboxStore },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus,
        queryBus: new InMemoryQueryBus(),
      }),
    },
  );

  await domain.dispatchCommand({
    name: "PlaceOrder",
    targetAggregateId: "order-1",
    payload: { total: 75 },
  });

  // Entry is already published from happy path
  const entries = outboxStore.findAll();
  expect(entries[0]!.publishedAt).not.toBeNull();

  dispatchSpy.mockClear();

  // Relay should find nothing to dispatch
  const dispatched = await domain.processOutboxOnce();
  expect(dispatched).toBe(0);
  expect(dispatchSpy).not.toHaveBeenCalled();
});
```
