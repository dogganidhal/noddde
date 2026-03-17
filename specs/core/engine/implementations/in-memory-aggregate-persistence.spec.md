---
title: "InMemoryAggregatePersistence"
module: engine/implementations/in-memory-aggregate-persistence
source_file: packages/core/src/engine/implementations/in-memory-aggregate-persistence.ts
status: ready
exports: [InMemoryEventSourcedAggregatePersistence, InMemoryStateStoredAggregatePersistence]
depends_on: [engine/domain, edd/event]
---

# InMemoryAggregatePersistence

> Two in-memory persistence implementations for aggregates: `InMemoryEventSourcedAggregatePersistence` stores event streams in a Map, and `InMemoryStateStoredAggregatePersistence` stores state snapshots in a Map. Both use a composite key of `(aggregateName, aggregateId)` for namespaced storage. Data is lost when the process exits. Suitable for development, testing, and prototyping.

## Type Contract

```ts
class InMemoryEventSourcedAggregatePersistence implements EventSourcedAggregatePersistence {
  load(aggregateName: string, aggregateId: string): Promise<Event[]>;
  save(aggregateName: string, aggregateId: string, events: Event[]): Promise<void>;
}

class InMemoryStateStoredAggregatePersistence implements StateStoredAggregatePersistence {
  load(aggregateName: string, aggregateId: string): Promise<any>;
  save(aggregateName: string, aggregateId: string, state: any): Promise<void>;
}
```

- Both implement their respective interfaces from `engine/domain`.
- Both use `Promise`-based APIs for consistency with durable persistence implementations, even though the in-memory operations are synchronous.

## Behavioral Requirements

### InMemoryEventSourcedAggregatePersistence

1. **Save appends events** -- `save(name, id, events)` appends the given events to the existing event stream for `(name, id)`. If no stream exists, it creates one.
2. **Load returns full stream** -- `load(name, id)` returns all events previously saved for `(name, id)`, in insertion order.
3. **Load returns empty array for unknown aggregate** -- If no events have been saved for `(name, id)`, `load` returns `[]` (not `null` or `undefined`).
4. **Namespace isolation** -- Events for `("Order", "1")` and `("Account", "1")` are stored independently. The aggregate name acts as a namespace.
5. **Event ordering** -- Events are returned in the order they were appended across all `save` calls. If `save` is called twice with `[e1, e2]` then `[e3]`, `load` returns `[e1, e2, e3]`.

### InMemoryStateStoredAggregatePersistence

1. **Save overwrites state** -- `save(name, id, state)` stores the state snapshot, replacing any previously stored state for `(name, id)`.
2. **Load returns latest state** -- `load(name, id)` returns the most recently saved state for `(name, id)`.
3. **Load returns undefined/null for unknown aggregate** -- If no state has been saved for `(name, id)`, `load` returns `undefined` or `null`.
4. **Namespace isolation** -- State for `("Order", "1")` and `("Account", "1")` are stored independently.
5. **State is stored by reference** -- The in-memory implementation may store the state object by reference. Callers should treat loaded state as immutable to avoid aliasing bugs.

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

    await persistence.save("BankAccount", "acc-1", events);

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

    await persistence.save("BankAccount", "acc-1", [
      { name: "AccountCreated", payload: { id: "acc-1" } },
    ]);
    await persistence.save("BankAccount", "acc-1", [
      { name: "DepositMade", payload: { amount: 50 } },
      { name: "DepositMade", payload: { amount: 75 } },
    ]);

    const loaded = await persistence.load("BankAccount", "acc-1");

    expect(loaded).toHaveLength(3);
    expect(loaded[0]).toEqual({ name: "AccountCreated", payload: { id: "acc-1" } });
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
});
```

### Event-sourced: saving empty array is a no-op

```ts
import { describe, it, expect } from "vitest";
import { InMemoryEventSourcedAggregatePersistence } from "@noddde/core";

describe("InMemoryEventSourcedAggregatePersistence", () => {
  it("should not alter the stream when saving an empty events array", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    await persistence.save("BankAccount", "acc-1", [
      { name: "AccountCreated", payload: { id: "acc-1" } },
    ]);
    await persistence.save("BankAccount", "acc-1", []);

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
    await persistence.save("BankAccount", "acc-1", state);

    const loaded = await persistence.load("BankAccount", "acc-1");

    expect(loaded).toEqual(state);
  });
});
```

### State-stored: load returns undefined for unknown aggregate

```ts
import { describe, it, expect } from "vitest";
import { InMemoryStateStoredAggregatePersistence } from "@noddde/core";

describe("InMemoryStateStoredAggregatePersistence", () => {
  it("should return undefined or null when no state exists", async () => {
    const persistence = new InMemoryStateStoredAggregatePersistence();

    const state = await persistence.load("BankAccount", "nonexistent");

    expect(state == null).toBe(true);
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

    await persistence.save("BankAccount", "acc-1", { balance: 100 });
    await persistence.save("BankAccount", "acc-1", { balance: 250 });

    const loaded = await persistence.load("BankAccount", "acc-1");

    expect(loaded).toEqual({ balance: 250 });
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

    await persistence.save("Order", "1", { status: "placed" });
    await persistence.save("Account", "1", { balance: 500 });

    const orderState = await persistence.load("Order", "1");
    const accountState = await persistence.load("Account", "1");

    expect(orderState).toEqual({ status: "placed" });
    expect(accountState).toEqual({ balance: 500 });
  });
});
```
