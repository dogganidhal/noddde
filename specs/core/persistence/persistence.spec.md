---
title: "Persistence Interface Contracts"
module: persistence
source_file: packages/core/src/persistence/index.ts
status: implemented
exports:
  [
    StateStoredAggregatePersistence,
    EventSourcedAggregatePersistence,
    SagaPersistence,
    ConcurrencyError,
  ]
depends_on: [edd/event]
docs:
  - domain-configuration/persistence.mdx
---

# Persistence Interface Contracts

> Defines the three persistence contracts that decouple the domain engine from storage infrastructure: `StateStoredAggregatePersistence` for aggregate state snapshots, `EventSourcedAggregatePersistence` for append-only event streams, and `SagaPersistence` for saga workflow state. These interfaces are the seam through which the framework supports pluggable storage backends (in-memory, PostgreSQL, EventStoreDB, DynamoDB, etc.).

## Type Contract

```ts
interface StateStoredAggregatePersistence {
  save(
    aggregateName: string,
    aggregateId: string,
    state: any,
    expectedVersion: number,
  ): Promise<void>;
  load(
    aggregateName: string,
    aggregateId: string,
  ): Promise<{ state: any; version: number } | null>;
}

interface EventSourcedAggregatePersistence {
  save(
    aggregateName: string,
    aggregateId: string,
    events: Event[],
    expectedVersion: number,
  ): Promise<void>;
  load(aggregateName: string, aggregateId: string): Promise<Event[]>;
}

type PersistenceConfiguration =
  | StateStoredAggregatePersistence
  | EventSourcedAggregatePersistence;

interface SagaPersistence {
  save(sagaName: string, sagaId: string, state: any): Promise<void>;
  load(sagaName: string, sagaId: string): Promise<any | undefined | null>;
}

class ConcurrencyError extends Error {
  readonly name: "ConcurrencyError";
  readonly aggregateName: string;
  readonly aggregateId: string;
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(
    aggregateName: string,
    aggregateId: string,
    expectedVersion: number,
    actualVersion: number,
  );
}
```

- `PersistenceConfiguration` is a union type. The domain engine must determine at runtime which variant is in use (event-sourced vs. state-stored) to decide the load/save/replay strategy.
- All methods return Promises, enabling async storage backends (databases, network stores).
- The `any` state type is intentional: persistence is generic across all aggregate/saga types. Type safety is enforced at the aggregate/saga definition layer, not the persistence layer.
- `ConcurrencyError` is thrown by `save()` when the actual version in the store does not match `expectedVersion`. For event-sourced persistence, the version is the event count (`events.length`). For state-stored persistence, the version is an integer stored alongside the state.
- `StateStoredAggregatePersistence.load()` returns `{ state, version }` or `null` for new aggregates (version 0). This differs from event-sourced where version is derived from `events.length`.

## Behavioral Requirements

### StateStoredAggregatePersistence

1. **save(aggregateName, aggregateId, state, expectedVersion)** -- Persists the full state snapshot. Implementations must overwrite any previously stored state for the same `(aggregateName, aggregateId)` pair. Before writing, implementations must verify that the current version in the store matches `expectedVersion`. If the versions differ, implementations must throw `ConcurrencyError`. On success, the stored version is incremented (to `expectedVersion + 1`).
2. **load(aggregateName, aggregateId)** -- Returns the latest state snapshot and version as `{ state, version }`. If no state exists, returns `null`. The domain engine interprets `null` as a "new aggregate" (version 0) and uses `Aggregate.initialState`.
3. **Namespace semantics** -- `aggregateName` serves as a namespace. Two aggregates with the same ID but different names are entirely separate.
4. **Optimistic concurrency** -- The version is a monotonically increasing integer starting at 0 (new aggregate). Each successful `save()` increments the version by 1. Concurrent saves with the same `expectedVersion` result in one succeeding and the other throwing `ConcurrencyError`.

### EventSourcedAggregatePersistence

1. **save(aggregateName, aggregateId, events, expectedVersion)** -- Appends new events to the aggregate's event stream. Must preserve ordering. Must not overwrite previously stored events. Before appending, implementations must verify that the current event count (stream length) matches `expectedVersion`. If it differs, implementations must throw `ConcurrencyError`.
2. **load(aggregateName, aggregateId)** -- Returns the full event stream in insertion order. If no events exist, returns an empty array `[]` (never `null` or `undefined`). The version is derived as `events.length` by the caller.
3. **Append-only invariant** -- Events in the stream are immutable once saved. Implementations must not allow deletion or modification of stored events.
4. **Namespace semantics** -- Same as state-stored: `aggregateName` is a namespace.
5. **Optimistic concurrency** -- The version is the event count in the stream. `expectedVersion` must equal the number of events currently stored. This prevents concurrent appends from producing an inconsistent event stream.

### ConcurrencyError

1. **Thrown on version mismatch** -- When `save()` detects that `actualVersion !== expectedVersion`, it throws a `ConcurrencyError` with the aggregate name, ID, expected version, and actual version.
2. **Error properties** -- `aggregateName`, `aggregateId`, `expectedVersion`, `actualVersion` are public readonly properties. `name` is `"ConcurrencyError"`. `message` includes all four values for diagnostics.
3. **Extends Error** -- `ConcurrencyError` extends the built-in `Error` class. It can be caught with `instanceof ConcurrencyError`.

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
- `save()` must throw `ConcurrencyError` if `actualVersion !== expectedVersion`. This is a hard invariant for all implementations.
- For event-sourced persistence, the version is always equal to the number of stored events (stream length). `expectedVersion` on `save()` must equal the current stream length.
- For state-stored persistence, the version starts at 0 for new aggregates and increments by 1 on each successful `save()`.

## Edge Cases

- **Concurrent saves to the same aggregate** -- Both persistence strategies use optimistic concurrency control via version checking. The first save succeeds; subsequent saves with the same `expectedVersion` throw `ConcurrencyError`. The domain engine may retry on `ConcurrencyError` (configurable via `aggregateConcurrency.maxRetries`).
- **Save with expectedVersion 0 on new aggregate** -- For event-sourced: appends events to a new stream (stream was empty, so `length === 0 === expectedVersion`). For state-stored: inserts new state at version 1.
- **Save with expectedVersion 0 on existing aggregate** -- Must throw `ConcurrencyError` (the aggregate already has events/state at a higher version).
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
  function runContractTests(
    createPersistence: () => StateStoredAggregatePersistence,
  ) {
    it("should return the saved state and version on load", async () => {
      const persistence = createPersistence();
      const state = { balance: 100, owner: "Alice" };

      await persistence.save("BankAccount", "acc-1", state, 0);
      const loaded = await persistence.load("BankAccount", "acc-1");

      expect(loaded).toEqual({ state, version: 1 });
    });

    it("should return null for an unknown aggregate", async () => {
      const persistence = createPersistence();
      const loaded = await persistence.load("BankAccount", "nonexistent");

      expect(loaded).toBeNull();
    });

    it("should overwrite state on repeated saves with correct versions", async () => {
      const persistence = createPersistence();

      await persistence.save("BankAccount", "acc-1", { balance: 100 }, 0);
      await persistence.save("BankAccount", "acc-1", { balance: 200 }, 1);
      const loaded = await persistence.load("BankAccount", "acc-1");

      expect(loaded).toEqual({ state: { balance: 200 }, version: 2 });
    });

    it("should isolate by aggregate name", async () => {
      const persistence = createPersistence();

      await persistence.save("Order", "1", { total: 50 }, 0);
      await persistence.save("Account", "1", { balance: 999 }, 0);

      const order = await persistence.load("Order", "1");
      const account = await persistence.load("Account", "1");

      expect(order).toEqual({ state: { total: 50 }, version: 1 });
      expect(account).toEqual({ state: { balance: 999 }, version: 1 });
    });
  }

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

      await persistence.save("BankAccount", "acc-1", events, 0);
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

      await persistence.save(
        "BankAccount",
        "acc-1",
        [{ name: "AccountCreated", payload: { id: "acc-1" } }],
        0,
      );
      await persistence.save(
        "BankAccount",
        "acc-1",
        [{ name: "DepositMade", payload: { amount: 50 } }],
        1,
      );

      const loaded = await persistence.load("BankAccount", "acc-1");

      expect(loaded).toHaveLength(2);
      expect(loaded[0].name).toBe("AccountCreated");
      expect(loaded[1].name).toBe("DepositMade");
    });

    it("should isolate by aggregate name", async () => {
      const persistence = createPersistence();

      await persistence.save(
        "Order",
        "1",
        [{ name: "OrderPlaced", payload: { total: 200 } }],
        0,
      );
      await persistence.save(
        "Account",
        "1",
        [{ name: "AccountCreated", payload: { owner: "Bob" } }],
        0,
      );

      const orderEvents = await persistence.load("Order", "1");
      const accountEvents = await persistence.load("Account", "1");

      expect(orderEvents).toHaveLength(1);
      expect(orderEvents[0].name).toBe("OrderPlaced");
      expect(accountEvents).toHaveLength(1);
      expect(accountEvents[0].name).toBe("AccountCreated");
    });
  }

  describe("InMemoryEventSourcedAggregatePersistence", () => {
    const {
      InMemoryEventSourcedAggregatePersistence,
    } = require("@noddde/core");
    runContractTests(() => new InMemoryEventSourcedAggregatePersistence());
  });
});
```

### ConcurrencyError: event-sourced save throws on version mismatch

```ts
import { describe, it, expect } from "vitest";
import {
  InMemoryEventSourcedAggregatePersistence,
  ConcurrencyError,
} from "@noddde/core";

describe("EventSourcedAggregatePersistence concurrency", () => {
  it("should throw ConcurrencyError when expectedVersion does not match stream length", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    await persistence.save(
      "Account",
      "acc-1",
      [{ name: "AccountCreated", payload: { id: "acc-1" } }],
      0,
    );

    // Attempt to save with stale version (0 instead of 1)
    await expect(
      persistence.save(
        "Account",
        "acc-1",
        [{ name: "DepositMade", payload: { amount: 50 } }],
        0,
      ),
    ).rejects.toThrow(ConcurrencyError);

    // Verify the error properties
    try {
      await persistence.save(
        "Account",
        "acc-1",
        [{ name: "DepositMade", payload: { amount: 50 } }],
        0,
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ConcurrencyError);
      const concurrencyError = error as ConcurrencyError;
      expect(concurrencyError.aggregateName).toBe("Account");
      expect(concurrencyError.aggregateId).toBe("acc-1");
      expect(concurrencyError.expectedVersion).toBe(0);
      expect(concurrencyError.actualVersion).toBe(1);
    }
  });

  it("should succeed when expectedVersion matches stream length", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    await persistence.save(
      "Account",
      "acc-1",
      [{ name: "AccountCreated", payload: { id: "acc-1" } }],
      0,
    );

    // Save with correct version
    await persistence.save(
      "Account",
      "acc-1",
      [{ name: "DepositMade", payload: { amount: 50 } }],
      1,
    );

    const loaded = await persistence.load("Account", "acc-1");
    expect(loaded).toHaveLength(2);
  });
});
```

### ConcurrencyError: state-stored save throws on version mismatch

```ts
import { describe, it, expect } from "vitest";
import {
  InMemoryStateStoredAggregatePersistence,
  ConcurrencyError,
} from "@noddde/core";

describe("StateStoredAggregatePersistence concurrency", () => {
  it("should throw ConcurrencyError when expectedVersion does not match stored version", async () => {
    const persistence = new InMemoryStateStoredAggregatePersistence();

    await persistence.save("Account", "acc-1", { balance: 100 }, 0);

    // Attempt to save with stale version (0 instead of 1)
    await expect(
      persistence.save("Account", "acc-1", { balance: 200 }, 0),
    ).rejects.toThrow(ConcurrencyError);

    // Verify the error properties
    try {
      await persistence.save("Account", "acc-1", { balance: 200 }, 0);
    } catch (error) {
      expect(error).toBeInstanceOf(ConcurrencyError);
      const concurrencyError = error as ConcurrencyError;
      expect(concurrencyError.aggregateName).toBe("Account");
      expect(concurrencyError.aggregateId).toBe("acc-1");
      expect(concurrencyError.expectedVersion).toBe(0);
      expect(concurrencyError.actualVersion).toBe(1);
    }
  });

  it("should succeed when expectedVersion matches stored version", async () => {
    const persistence = new InMemoryStateStoredAggregatePersistence();

    await persistence.save("Account", "acc-1", { balance: 100 }, 0);
    await persistence.save("Account", "acc-1", { balance: 200 }, 1);

    const loaded = await persistence.load("Account", "acc-1");
    expect(loaded).toEqual({ state: { balance: 200 }, version: 2 });
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

      expect(await persistence.load("OrderFulfillment", "1")).toEqual({
        a: true,
      });
      expect(await persistence.load("PaymentFlow", "1")).toEqual({ b: true });
    });
  }

  describe("InMemorySagaPersistence", () => {
    const { InMemorySagaPersistence } = require("@noddde/core");
    runContractTests(() => new InMemorySagaPersistence());
  });
});
```
