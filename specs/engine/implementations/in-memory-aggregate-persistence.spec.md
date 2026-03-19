---
title: "InMemoryAggregatePersistence"
module: engine/implementations/in-memory-aggregate-persistence
source_file: packages/engine/src/implementations/in-memory-aggregate-persistence.ts
status: implemented
exports:
  [
    InMemoryEventSourcedAggregatePersistence,
    InMemoryStateStoredAggregatePersistence,
  ]
depends_on: [engine/domain, edd/event]
docs:
  - infrastructure/in-memory-implementations.mdx
---

# InMemoryAggregatePersistence

> Two in-memory persistence implementations for aggregates: `InMemoryEventSourcedAggregatePersistence` stores event streams in a Map, and `InMemoryStateStoredAggregatePersistence` stores state snapshots in a Map. Both use a composite key of `(aggregateName, aggregateId)` for namespaced storage. Data is lost when the process exits. Suitable for development, testing, and prototyping.

## Type Contract

```ts
class InMemoryEventSourcedAggregatePersistence
  implements EventSourcedAggregatePersistence
{
  load(aggregateName: string, aggregateId: string): Promise<Event[]>;
  save(
    aggregateName: string,
    aggregateId: string,
    events: Event[],
    expectedVersion: number,
  ): Promise<void>;
}

class InMemoryStateStoredAggregatePersistence
  implements StateStoredAggregatePersistence
{
  load(
    aggregateName: string,
    aggregateId: string,
  ): Promise<{ state: any; version: number } | null>;
  save(
    aggregateName: string,
    aggregateId: string,
    state: any,
    expectedVersion: number,
  ): Promise<void>;
}
```

- Both implement their respective interfaces from `engine/domain`.
- Both use `Promise`-based APIs for consistency with durable persistence implementations, even though the in-memory operations are synchronous.

## Behavioral Requirements

### InMemoryEventSourcedAggregatePersistence

1. **Save appends events with version check** -- `save(name, id, events, expectedVersion)` appends the given events to the existing event stream for `(name, id)`. Before appending, checks that `expectedVersion` equals the current stream length. If not, throws `ConcurrencyError`. If no stream exists (length 0), `expectedVersion` must be 0.
2. **Load returns full stream** -- `load(name, id)` returns all events previously saved for `(name, id)`, in insertion order. The version is implicitly `events.length`.
3. **Load returns empty array for unknown aggregate** -- If no events have been saved for `(name, id)`, `load` returns `[]` (not `null` or `undefined`). Version is implicitly 0.
4. **Namespace isolation** -- Events for `("Order", "1")` and `("Account", "1")` are stored independently. The aggregate name acts as a namespace.
5. **Event ordering** -- Events are returned in the order they were appended across all `save` calls. If `save` is called twice with `[e1, e2]` then `[e3]`, `load` returns `[e1, e2, e3]`.
6. **Concurrency error on version mismatch** -- If `expectedVersion !== currentStreamLength`, `save` throws `ConcurrencyError` with the aggregate name, ID, expected version, and actual version (stream length).

### InMemoryStateStoredAggregatePersistence

1. **Save overwrites state with version check** -- `save(name, id, state, expectedVersion)` stores the state snapshot, replacing any previously stored state. Before writing, checks that `expectedVersion` matches the current stored version (0 for new aggregates). If not, throws `ConcurrencyError`. On success, the stored version becomes `expectedVersion + 1`.
2. **Load returns latest state and version** -- `load(name, id)` returns `{ state, version }` for the most recently saved state, or `null` if no state exists. Version starts at 0 for new aggregates and increments by 1 on each successful save.
3. **Load returns null for unknown aggregate** -- If no state has been saved for `(name, id)`, `load` returns `null`.
4. **Namespace isolation** -- State for `("Order", "1")` and `("Account", "1")` are stored independently.
5. **State is stored by reference** -- The in-memory implementation may store the state object by reference. Callers should treat loaded state as immutable to avoid aliasing bugs.
6. **Concurrency error on version mismatch** -- If `expectedVersion !== currentVersion`, `save` throws `ConcurrencyError` with the aggregate name, ID, expected version, and actual version.

## Invariants

- Both implementations are purely in-memory. No filesystem, database, or network I/O.
- Both support arbitrary aggregate names and IDs (any string).
- Neither implementation performs validation on the data being stored.
- Both are single-process, non-thread-safe. Concurrent access from multiple async contexts is safe (JavaScript is single-threaded), but sharing across worker threads is not supported.

## Edge Cases

- **Save empty events array** -- `save(name, id, [])` should be a no-op (append nothing). Subsequent `load` returns whatever was previously stored.
- **Save with `undefined` state** -- For state-stored, `save(name, id, undefined)` stores `undefined`. `load` then returns `undefined`, which is indistinguishable from "not found". Callers should avoid this.
- **Multiple aggregates with same ID but different names** -- Must be stored independently. `save("Order", "1", ...)` and `save("Account", "1", ...)` do not interfere.
- **Large event streams** -- No limit on the number of events stored. Memory is the only constraint.

## Integration Points

- **Domain.init()** -- The domain receives the persistence instance from `infrastructure.aggregatePersistence()` and uses it for all aggregate load/save operations.
- **Domain.dispatchCommand()** -- For event-sourced: loads the event stream, replays to rebuild state, executes the command handler, then saves new events. For state-stored: loads the snapshot, executes the handler, then saves the updated state.

## Test Scenarios

### Event-sourced: save and load round-trip

```ts
import { describe, it, expect } from "vitest";
import { InMemoryEventSourcedAggregatePersistence } from "@noddde/core";

describe("InMemoryEventSourcedAggregatePersistence", () => {
  it("should store and retrieve events for an aggregate", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    const events = [
      { name: "AccountCreated", payload: { id: "acc-1", owner: "Alice" } },
      { name: "DepositMade", payload: { amount: 100 } },
    ];

    await persistence.save("BankAccount", "acc-1", events, 0);

    const loaded = await persistence.load("BankAccount", "acc-1");

    expect(loaded).toEqual(events);
  });
});
```

### Event-sourced: load returns empty array for unknown aggregate

```ts
import { describe, it, expect } from "vitest";
import { InMemoryEventSourcedAggregatePersistence } from "@noddde/core";

describe("InMemoryEventSourcedAggregatePersistence", () => {
  it("should return an empty array when no events exist", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    const events = await persistence.load("BankAccount", "nonexistent");

    expect(events).toEqual([]);
  });
});
```

### Event-sourced: multiple saves append events in order

```ts
import { describe, it, expect } from "vitest";
import { InMemoryEventSourcedAggregatePersistence } from "@noddde/core";

describe("InMemoryEventSourcedAggregatePersistence", () => {
  it("should append events across multiple save calls", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    await persistence.save(
      "BankAccount",
      "acc-1",
      [{ name: "AccountCreated", payload: { id: "acc-1" } }],
      0,
    );
    await persistence.save(
      "BankAccount",
      "acc-1",
      [
        { name: "DepositMade", payload: { amount: 50 } },
        { name: "DepositMade", payload: { amount: 75 } },
      ],
      1,
    );

    const loaded = await persistence.load("BankAccount", "acc-1");

    expect(loaded).toHaveLength(3);
    expect(loaded[0]).toEqual({
      name: "AccountCreated",
      payload: { id: "acc-1" },
    });
    expect(loaded[1]).toEqual({ name: "DepositMade", payload: { amount: 50 } });
    expect(loaded[2]).toEqual({ name: "DepositMade", payload: { amount: 75 } });
  });
});
```

### Event-sourced: namespace isolation between aggregate types

```ts
import { describe, it, expect } from "vitest";
import { InMemoryEventSourcedAggregatePersistence } from "@noddde/core";

describe("InMemoryEventSourcedAggregatePersistence", () => {
  it("should isolate events between different aggregate names", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

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
});
```

### Event-sourced: saving empty array is a no-op

```ts
import { describe, it, expect } from "vitest";
import { InMemoryEventSourcedAggregatePersistence } from "@noddde/core";

describe("InMemoryEventSourcedAggregatePersistence", () => {
  it("should not alter the stream when saving an empty events array", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    await persistence.save(
      "BankAccount",
      "acc-1",
      [{ name: "AccountCreated", payload: { id: "acc-1" } }],
      0,
    );
    await persistence.save("BankAccount", "acc-1", [], 1);

    const loaded = await persistence.load("BankAccount", "acc-1");
    expect(loaded).toHaveLength(1);
  });
});
```

### State-stored: save and load round-trip

```ts
import { describe, it, expect } from "vitest";
import { InMemoryStateStoredAggregatePersistence } from "@noddde/core";

describe("InMemoryStateStoredAggregatePersistence", () => {
  it("should store and retrieve state for an aggregate", async () => {
    const persistence = new InMemoryStateStoredAggregatePersistence();

    const state = { id: "acc-1", balance: 250, owner: "Alice" };
    await persistence.save("BankAccount", "acc-1", state, 0);

    const loaded = await persistence.load("BankAccount", "acc-1");

    expect(loaded).toEqual({ state, version: 1 });
  });
});
```

### State-stored: load returns undefined for unknown aggregate

```ts
import { describe, it, expect } from "vitest";
import { InMemoryStateStoredAggregatePersistence } from "@noddde/core";

describe("InMemoryStateStoredAggregatePersistence", () => {
  it("should return null when no state exists", async () => {
    const persistence = new InMemoryStateStoredAggregatePersistence();

    const loaded = await persistence.load("BankAccount", "nonexistent");

    expect(loaded).toBeNull();
  });
});
```

### State-stored: save overwrites previous state

```ts
import { describe, it, expect } from "vitest";
import { InMemoryStateStoredAggregatePersistence } from "@noddde/core";

describe("InMemoryStateStoredAggregatePersistence", () => {
  it("should overwrite state on subsequent saves", async () => {
    const persistence = new InMemoryStateStoredAggregatePersistence();

    await persistence.save("BankAccount", "acc-1", { balance: 100 }, 0);
    await persistence.save("BankAccount", "acc-1", { balance: 250 }, 1);

    const loaded = await persistence.load("BankAccount", "acc-1");

    expect(loaded).toEqual({ state: { balance: 250 }, version: 2 });
  });
});
```

### State-stored: namespace isolation between aggregate types

```ts
import { describe, it, expect } from "vitest";
import { InMemoryStateStoredAggregatePersistence } from "@noddde/core";

describe("InMemoryStateStoredAggregatePersistence", () => {
  it("should isolate state between different aggregate names", async () => {
    const persistence = new InMemoryStateStoredAggregatePersistence();

    await persistence.save("Order", "1", { status: "placed" }, 0);
    await persistence.save("Account", "1", { balance: 500 }, 0);

    const orderState = await persistence.load("Order", "1");
    const accountState = await persistence.load("Account", "1");

    expect(orderState).toEqual({ state: { status: "placed" }, version: 1 });
    expect(accountState).toEqual({ state: { balance: 500 }, version: 1 });
  });
});
```

### Event-sourced: concurrency error on version mismatch

```ts
import { describe, it, expect } from "vitest";
import {
  InMemoryEventSourcedAggregatePersistence,
  ConcurrencyError,
} from "@noddde/core";

describe("InMemoryEventSourcedAggregatePersistence", () => {
  it("should throw ConcurrencyError when expectedVersion does not match stream length", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    await persistence.save(
      "Account",
      "acc-1",
      [{ name: "AccountCreated", payload: { id: "acc-1" } }],
      0,
    );

    await expect(
      persistence.save(
        "Account",
        "acc-1",
        [{ name: "DepositMade", payload: { amount: 50 } }],
        0,
      ),
    ).rejects.toThrow(ConcurrencyError);
  });
});
```

### State-stored: concurrency error on version mismatch

```ts
import { describe, it, expect } from "vitest";
import {
  InMemoryStateStoredAggregatePersistence,
  ConcurrencyError,
} from "@noddde/core";

describe("InMemoryStateStoredAggregatePersistence", () => {
  it("should throw ConcurrencyError when expectedVersion does not match stored version", async () => {
    const persistence = new InMemoryStateStoredAggregatePersistence();

    await persistence.save("Account", "acc-1", { balance: 100 }, 0);

    await expect(
      persistence.save("Account", "acc-1", { balance: 200 }, 0),
    ).rejects.toThrow(ConcurrencyError);
  });
});
```
