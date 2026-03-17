---
title: "Persistence Interface Contracts"
module: engine/domain
source_file: packages/core/src/engine/domain.ts
status: ready
exports: [StateStoredAggregatePersistence, EventSourcedAggregatePersistence, SagaPersistence]
depends_on: [edd/event]
---

# Persistence Interface Contracts

> Defines the three persistence contracts that decouple the domain engine from storage infrastructure: `StateStoredAggregatePersistence` for aggregate state snapshots, `EventSourcedAggregatePersistence` for append-only event streams, and `SagaPersistence` for saga workflow state. These interfaces are the seam through which the framework supports pluggable storage backends (in-memory, PostgreSQL, EventStoreDB, DynamoDB, etc.).

## Type Contract

```ts
interface StateStoredAggregatePersistence {
  save(aggregateName: string, aggregateId: string, state: any): Promise<void>;
  load(aggregateName: string, aggregateId: string): Promise<any>;
}

interface EventSourcedAggregatePersistence {
  save(aggregateName: string, aggregateId: string, events: Event[]): Promise<void>;
  load(aggregateName: string, aggregateId: string): Promise<Event[]>;
}

type PersistenceConfiguration =
  | StateStoredAggregatePersistence
  | EventSourcedAggregatePersistence;

interface SagaPersistence {
  save(sagaName: string, sagaId: string, state: any): Promise<void>;
  load(sagaName: string, sagaId: string): Promise<any | undefined | null>;
}
```

- `PersistenceConfiguration` is a union type. The domain engine must determine at runtime which variant is in use (event-sourced vs. state-stored) to decide the load/save/replay strategy.
- All methods return Promises, enabling async storage backends (databases, network stores).
- The `any` state type is intentional: persistence is generic across all aggregate/saga types. Type safety is enforced at the aggregate/saga definition layer, not the persistence layer.

## Behavioral Requirements

### StateStoredAggregatePersistence

1. **save(aggregateName, aggregateId, state)** -- Persists the full state snapshot. Implementations must overwrite any previously stored state for the same `(aggregateName, aggregateId)` pair.
2. **load(aggregateName, aggregateId)** -- Returns the latest state snapshot. If no state exists, implementations should return `undefined` or `null`. The domain engine interprets the absence as a "new aggregate" and uses `Aggregate.initialState`.
3. **Namespace semantics** -- `aggregateName` serves as a namespace. Two aggregates with the same ID but different names are entirely separate.

### EventSourcedAggregatePersistence

1. **save(aggregateName, aggregateId, events)** -- Appends new events to the aggregate's event stream. Must preserve ordering. Must not overwrite previously stored events.
2. **load(aggregateName, aggregateId)** -- Returns the full event stream in insertion order. If no events exist, returns an empty array `[]` (never `null` or `undefined`).
3. **Append-only invariant** -- Events in the stream are immutable once saved. Implementations must not allow deletion or modification of stored events.
4. **Namespace semantics** -- Same as state-stored: `aggregateName` is a namespace.

### SagaPersistence

1. **save(sagaName, sagaId, state)** -- Persists the saga instance state, overwriting any previously stored state.
2. **load(sagaName, sagaId)** -- Returns the saga instance state, or `undefined`/`null` if no instance exists. The domain engine uses this sentinel to decide whether to create a new saga (via `initialState`) or update an existing one.
3. **Namespace semantics** -- `sagaName` is a namespace. Different saga types with the same instance ID are independent.

### PersistenceConfiguration (union discrimination)

The domain engine must distinguish between the two aggregate persistence strategies. Possible discrimination approaches:
- **Duck typing** -- Check the behavior of `load`: event-sourced always returns `Event[]`; state-stored returns a state object. This is fragile.
- **Marker property** -- Add a `type: "event-sourced" | "state-stored"` discriminant. This is the recommended approach.
- **instanceof** -- Check `instanceof InMemoryEventSourcedAggregatePersistence`. Only works with concrete classes, not custom implementations.

The framework should define a clear discrimination mechanism so that custom persistence implementations can be plugged in without ambiguity.

## Invariants

- All persistence operations are async. Even in-memory implementations wrap results in Promises for interface consistency.
- Persistence implementations must be stateless across different `(name, id)` pairs -- there is no cross-aggregate or cross-saga transactional guarantee at the interface level.
- The persistence layer does not enforce business rules. It stores and retrieves data as-is. Validation is the domain's responsibility.
- Persistence is configured via factory functions in `DomainConfiguration.infrastructure`. The factory is called once during `Domain.init()`.

## Edge Cases

- **Concurrent saves to the same aggregate** -- The interface does not define concurrency semantics. In-memory implementations are safe (single-threaded JS). Database-backed implementations should use optimistic concurrency (version checks) or pessimistic locks, but this is outside the interface contract.
- **Very large event streams** -- `EventSourcedAggregatePersistence.load` returns the full stream. For aggregates with thousands of events, implementations may want to support snapshots, but the current interface does not define a snapshot mechanism.
- **Null vs undefined** -- `SagaPersistence.load` returns `any | undefined | null`. The domain engine should check `state == null` (loose equality) to handle both.
- **Empty string as name or ID** -- Valid per the interface but likely a bug. Implementations should not reject them; validation belongs at a higher layer.

## Integration Points

- **DomainConfiguration.infrastructure.aggregatePersistence** -- Factory function returning a `PersistenceConfiguration` (either state-stored or event-sourced).
- **DomainConfiguration.infrastructure.sagaPersistence** -- Factory function returning a `SagaPersistence`.
- **Domain.init()** -- Calls both factories and stores the results for use during command dispatch and saga handling.
- **Domain.dispatchCommand()** -- Uses `PersistenceConfiguration` to load/save aggregate state or events.
- **Saga event handling** -- Uses `SagaPersistence` to load/save saga instance state.

## Test Scenarios

### StateStoredAggregatePersistence contract: save then load returns the state

```ts
import { describe, it, expect } from "vitest";
import type { StateStoredAggregatePersistence } from "@noddde/core";

describe("StateStoredAggregatePersistence contract", () => {
  /**
   * Contract test factory -- can be used to verify any implementation.
   * Replace `createPersistence` with the implementation under test.
   */
  function runContractTests(
    createPersistence: () => StateStoredAggregatePersistence,
  ) {
    it("should return the saved state on load", async () => {
      const persistence = createPersistence();
      const state = { balance: 100, owner: "Alice" };

      await persistence.save("BankAccount", "acc-1", state);
      const loaded = await persistence.load("BankAccount", "acc-1");

      expect(loaded).toEqual(state);
    });

    it("should return null or undefined for an unknown aggregate", async () => {
      const persistence = createPersistence();
      const loaded = await persistence.load("BankAccount", "nonexistent");

      expect(loaded == null).toBe(true);
    });

    it("should overwrite state on repeated saves", async () => {
      const persistence = createPersistence();

      await persistence.save("BankAccount", "acc-1", { balance: 100 });
      await persistence.save("BankAccount", "acc-1", { balance: 200 });
      const loaded = await persistence.load("BankAccount", "acc-1");

      expect(loaded).toEqual({ balance: 200 });
    });

    it("should isolate by aggregate name", async () => {
      const persistence = createPersistence();

      await persistence.save("Order", "1", { total: 50 });
      await persistence.save("Account", "1", { balance: 999 });

      expect(await persistence.load("Order", "1")).toEqual({ total: 50 });
      expect(await persistence.load("Account", "1")).toEqual({ balance: 999 });
    });
  }

  // Run contract against the in-memory implementation
  describe("InMemoryStateStoredAggregatePersistence", () => {
    const { InMemoryStateStoredAggregatePersistence } = require("@noddde/core");
    runContractTests(() => new InMemoryStateStoredAggregatePersistence());
  });
});
```

### EventSourcedAggregatePersistence contract: append and replay

```ts
import { describe, it, expect } from "vitest";
import type { EventSourcedAggregatePersistence } from "@noddde/core";

describe("EventSourcedAggregatePersistence contract", () => {
  function runContractTests(
    createPersistence: () => EventSourcedAggregatePersistence,
  ) {
    it("should return saved events on load", async () => {
      const persistence = createPersistence();
      const events = [
        { name: "AccountCreated", payload: { id: "acc-1" } },
        { name: "DepositMade", payload: { amount: 100 } },
      ];

      await persistence.save("BankAccount", "acc-1", events);
      const loaded = await persistence.load("BankAccount", "acc-1");

      expect(loaded).toEqual(events);
    });

    it("should return empty array for unknown aggregate", async () => {
      const persistence = createPersistence();
      const loaded = await persistence.load("BankAccount", "nonexistent");

      expect(loaded).toEqual([]);
    });

    it("should append events across multiple saves preserving order", async () => {
      const persistence = createPersistence();

      await persistence.save("BankAccount", "acc-1", [
        { name: "AccountCreated", payload: { id: "acc-1" } },
      ]);
      await persistence.save("BankAccount", "acc-1", [
        { name: "DepositMade", payload: { amount: 50 } },
      ]);

      const loaded = await persistence.load("BankAccount", "acc-1");

      expect(loaded).toHaveLength(2);
      expect(loaded[0].name).toBe("AccountCreated");
      expect(loaded[1].name).toBe("DepositMade");
    });

    it("should isolate by aggregate name", async () => {
      const persistence = createPersistence();

      await persistence.save("Order", "1", [
        { name: "OrderPlaced", payload: { total: 200 } },
      ]);
      await persistence.save("Account", "1", [
        { name: "AccountCreated", payload: { owner: "Bob" } },
      ]);

      const orderEvents = await persistence.load("Order", "1");
      const accountEvents = await persistence.load("Account", "1");

      expect(orderEvents).toHaveLength(1);
      expect(orderEvents[0].name).toBe("OrderPlaced");
      expect(accountEvents).toHaveLength(1);
      expect(accountEvents[0].name).toBe("AccountCreated");
    });
  }

  describe("InMemoryEventSourcedAggregatePersistence", () => {
    const { InMemoryEventSourcedAggregatePersistence } = require("@noddde/core");
    runContractTests(() => new InMemoryEventSourcedAggregatePersistence());
  });
});
```

### SagaPersistence contract: save, load, and not-found semantics

```ts
import { describe, it, expect } from "vitest";
import type { SagaPersistence } from "@noddde/core";

describe("SagaPersistence contract", () => {
  function runContractTests(createPersistence: () => SagaPersistence) {
    it("should return the saved state on load", async () => {
      const persistence = createPersistence();
      const state = { status: "awaiting_payment" };

      await persistence.save("OrderFulfillment", "order-1", state);
      const loaded = await persistence.load("OrderFulfillment", "order-1");

      expect(loaded).toEqual(state);
    });

    it("should return null or undefined for unknown saga instance", async () => {
      const persistence = createPersistence();
      const loaded = await persistence.load("OrderFulfillment", "nonexistent");

      expect(loaded == null).toBe(true);
    });

    it("should overwrite state on repeated saves", async () => {
      const persistence = createPersistence();

      await persistence.save("OrderFulfillment", "o-1", { step: 1 });
      await persistence.save("OrderFulfillment", "o-1", { step: 2 });

      const loaded = await persistence.load("OrderFulfillment", "o-1");
      expect(loaded).toEqual({ step: 2 });
    });

    it("should isolate by saga name", async () => {
      const persistence = createPersistence();

      await persistence.save("OrderFulfillment", "1", { a: true });
      await persistence.save("PaymentFlow", "1", { b: true });

      expect(await persistence.load("OrderFulfillment", "1")).toEqual({ a: true });
      expect(await persistence.load("PaymentFlow", "1")).toEqual({ b: true });
    });
  }

  describe("InMemorySagaPersistence", () => {
    const { InMemorySagaPersistence } = require("@noddde/core");
    runContractTests(() => new InMemorySagaPersistence());
  });
});
```
