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
depends_on: [engine/domain, edd/event, core/persistence/event-reader]
docs:
  - running/persistence.mdx
  - read-model/projection-rebuild.mdx
---

# InMemoryAggregatePersistence

> Two in-memory persistence implementations for aggregates: `InMemoryEventSourcedAggregatePersistence` stores event streams in a Map, and `InMemoryStateStoredAggregatePersistence` stores state snapshots in a Map. Both use a composite key of `(aggregateName, aggregateId)` for namespaced storage. Data is lost when the process exits. The event-sourced implementation ALSO implements `EventReader`, enabling [projection rebuild](../projection-rebuild.spec.md) on the in-memory path without an explicit adapter. Suitable for development, testing, and prototyping.

## Type Contract

```ts
class InMemoryEventSourcedAggregatePersistence
  implements EventSourcedAggregatePersistence, PartialEventLoad, EventReader
{
  load(aggregateName: string, aggregateId: string): Promise<Event[]>;
  save(
    aggregateName: string,
    aggregateId: string,
    events: Event[],
    expectedVersion: number,
  ): Promise<void>;
  loadAfterVersion(
    aggregateName: string,
    aggregateId: string,
    afterVersion: number,
  ): Promise<Event[]>;
  read(options?: EventReadOptions): AsyncIterable<Event>;
}

class InMemoryStateStoredAggregatePersistence
  implements StateStoredAggregatePersistence
{
  load(
    aggregateName: string,
    aggregateId: string,
  ): Promise<{ state: any; version: number; stateVersion?: number } | null>;
  save(
    aggregateName: string,
    aggregateId: string,
    state: any,
    expectedVersion: number,
    stateVersion?: number,
  ): Promise<void>;
}
```

- Both implement their respective interfaces from `engine/domain`.
- Both use `Promise`-based APIs for consistency with durable persistence implementations, even though the in-memory operations are synchronous.
- `InMemoryStateStoredAggregatePersistence`'s optional `stateVersion` parameter (API Freeze decision 8, see `specs/api-freeze.spec.md`) is stored and returned as-is alongside `state`/`version`; the implementation performs no upcasting on it.
- `InMemoryEventSourcedAggregatePersistence` additionally implements `EventReader` so the in-memory development/test path supports `Domain.rebuildProjection` without requiring a separate adapter.

## Behavioral Requirements

### InMemoryEventSourcedAggregatePersistence

1. **Save appends events with version check** -- `save(name, id, events, expectedVersion)` appends the given events to the existing event stream for `(name, id)`. Before appending, checks that `expectedVersion` equals the current stream length. If not, throws `ConcurrencyError`. If no stream exists (length 0), `expectedVersion` must be 0.
2. **Load returns full stream** -- `load(name, id)` returns all events previously saved for `(name, id)`, in insertion order. The version is implicitly `events.length`.
3. **Load returns empty array for unknown aggregate** -- If no events have been saved for `(name, id)`, `load` returns `[]` (not `null` or `undefined`). Version is implicitly 0.
4. **Namespace isolation** -- Events for `("Order", "1")` and `("Account", "1")` are stored independently. The aggregate name acts as a namespace.
5. **Event ordering** -- Events are returned in the order they were appended across all `save` calls. If `save` is called twice with `[e1, e2]` then `[e3]`, `load` returns `[e1, e2, e3]`.
6. **Concurrency error on version mismatch** -- If `expectedVersion !== currentStreamLength`, `save` throws `ConcurrencyError` with the aggregate name, ID, expected version, and actual version (stream length).
7. **loadAfterVersion returns partial stream** -- `loadAfterVersion(name, id, afterVersion)` returns events starting at position `afterVersion` in the stream (0-indexed). Equivalent to `allEvents.slice(afterVersion)`. Returns `[]` if `afterVersion >= streamLength`. Returns all events if `afterVersion === 0`.
8. **read() yields every persisted event** -- `read()` (no options) returns an `AsyncIterable<Event>` that yields every event in the internal map. The traversal order MUST be: iterate aggregate keys in `Map.prototype.entries` insertion order; for each key, yield its events in stored order (0..length-1). Each event MUST be yielded exactly once per `read()` call.
9. **read({ aggregateName }) filters by aggregate name** -- When `options.aggregateName` is provided, `read()` MUST yield only events whose internal map key starts with `${aggregateName}:`. Events from other aggregate names MUST be skipped.
10. **read({ after }) is not supported** -- The in-memory implementation does NOT support cursoring. When `options.after` is provided, `read()` MUST throw `new Error("EventReader: 'after' cursor is not supported by InMemoryEventSourcedAggregatePersistence")` from the first `next()` call of the returned iterator.
11. **read() on empty store yields nothing** -- When no events have been saved, `read()` returns an iterable that immediately terminates.
12. **read() and save() are concurrent-safe within a single async context** -- Iterating with `read()` while `save()` is awaiting in a parallel async task is undefined per the spec but MUST NOT corrupt internal state. The implementation MAY include or omit events saved during iteration; documentation recommends halting writes before iterating.

### InMemoryStateStoredAggregatePersistence

1. **Save overwrites state with version check** -- `save(name, id, state, expectedVersion, stateVersion?)` stores the state snapshot, replacing any previously stored state. Before writing, checks that `expectedVersion` matches the current stored version (0 for new aggregates). If not, throws `ConcurrencyError`. On success, the stored version becomes `expectedVersion + 1`. The optional `stateVersion` is stored as-is.
2. **Load returns latest state and version** -- `load(name, id)` returns `{ state, version, stateVersion? }` for the most recently saved state, or `null` if no state exists. Version starts at 0 for new aggregates and increments by 1 on each successful save. `stateVersion` is `undefined` unless it was provided on the corresponding `save`.
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
- **read() before any save** -- Returns an iterable that immediately terminates (zero iterations).
- **read({ aggregateName }) for an aggregate with no events** -- Returns an iterable that immediately terminates.
- **read({ aggregateName }) with multiple matching aggregates** -- Yields events from every matching aggregate, in map insertion order.
- **read({ after }) call** -- Throws on first `next()` because the cursor option is not supported.

## Integration Points

- **Domain.init()** -- The domain receives the persistence instance from `DomainWiring.aggregates.persistence` and uses it for all aggregate load/save operations.
- **Domain.dispatchCommand()** -- For event-sourced: loads the event stream, replays to rebuild state, executes the command handler, then saves new events. For state-stored: loads the snapshot, executes the handler, then saves the updated state.
- **Domain.rebuildProjection()** -- Detects that `InMemoryEventSourcedAggregatePersistence` structurally implements `EventReader` (via `typeof persistence.read === "function"`) and uses it as the rebuild event source when no explicit `adapter.eventReader` is wired. No additional wiring required for in-memory development.

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

### Event-sourced: loadAfterVersion returns partial stream

```ts
import { describe, it, expect } from "vitest";
import { InMemoryEventSourcedAggregatePersistence } from "@noddde/core";

describe("InMemoryEventSourcedAggregatePersistence", () => {
  it("should return events after the given version", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    await persistence.save(
      "BankAccount",
      "acc-1",
      [
        { name: "AccountCreated", payload: { id: "acc-1" } },
        { name: "DepositMade", payload: { amount: 50 } },
        { name: "DepositMade", payload: { amount: 75 } },
      ],
      0,
    );

    const events = await persistence.loadAfterVersion(
      "BankAccount",
      "acc-1",
      1,
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ name: "DepositMade", payload: { amount: 50 } });
    expect(events[1]).toEqual({
      name: "DepositMade",
      payload: { amount: 75 },
    });
  });

  it("should return all events when afterVersion is 0", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    await persistence.save(
      "BankAccount",
      "acc-1",
      [
        { name: "AccountCreated", payload: { id: "acc-1" } },
        { name: "DepositMade", payload: { amount: 50 } },
      ],
      0,
    );

    const events = await persistence.loadAfterVersion(
      "BankAccount",
      "acc-1",
      0,
    );

    expect(events).toHaveLength(2);
  });

  it("should return empty array when afterVersion >= stream length", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    await persistence.save(
      "BankAccount",
      "acc-1",
      [{ name: "AccountCreated", payload: { id: "acc-1" } }],
      0,
    );

    const events = await persistence.loadAfterVersion(
      "BankAccount",
      "acc-1",
      5,
    );

    expect(events).toEqual([]);
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

### Event-sourced: read() yields every event in append order

```ts
import { describe, it, expect } from "vitest";
import { InMemoryEventSourcedAggregatePersistence } from "@noddde/engine";

describe("InMemoryEventSourcedAggregatePersistence.read", () => {
  it("should yield every persisted event in insertion order", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    await persistence.save(
      "Account",
      "acc-1",
      [
        { name: "AccountCreated", payload: { id: "acc-1" } },
        { name: "DepositMade", payload: { amount: 50 } },
      ],
      0,
    );
    await persistence.save(
      "Account",
      "acc-2",
      [
        { name: "AccountCreated", payload: { id: "acc-2" } },
        { name: "DepositMade", payload: { amount: 75 } },
      ],
      0,
    );

    const collected: string[] = [];
    for await (const event of persistence.read()) {
      collected.push(event.name);
    }

    expect(collected).toEqual([
      "AccountCreated",
      "DepositMade",
      "AccountCreated",
      "DepositMade",
    ]);
  });
});
```

### Event-sourced: read() filters by aggregateName

```ts
import { describe, it, expect } from "vitest";
import { InMemoryEventSourcedAggregatePersistence } from "@noddde/engine";

describe("InMemoryEventSourcedAggregatePersistence.read aggregateName filter", () => {
  it("should yield only events from aggregates matching the filter", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    await persistence.save(
      "Order",
      "o-1",
      [{ name: "OrderPlaced", payload: { id: "o-1" } }],
      0,
    );
    await persistence.save(
      "Account",
      "a-1",
      [{ name: "AccountCreated", payload: { id: "a-1" } }],
      0,
    );

    const names: string[] = [];
    for await (const event of persistence.read({ aggregateName: "Order" })) {
      names.push(event.name);
    }

    expect(names).toEqual(["OrderPlaced"]);
  });
});
```

### Event-sourced: read() on empty store yields nothing

```ts
import { describe, it, expect } from "vitest";
import { InMemoryEventSourcedAggregatePersistence } from "@noddde/engine";

describe("InMemoryEventSourcedAggregatePersistence.read empty store", () => {
  it("should produce an iterable that immediately terminates", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    let count = 0;
    for await (const _ of persistence.read()) count++;
    expect(count).toBe(0);
  });
});
```

### Event-sourced: read({ after }) throws

```ts
import { describe, it, expect } from "vitest";
import { InMemoryEventSourcedAggregatePersistence } from "@noddde/engine";

describe("InMemoryEventSourcedAggregatePersistence.read after cursor", () => {
  it("should throw when an after cursor is provided", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    await persistence.save(
      "Order",
      "o-1",
      [{ name: "OrderPlaced", payload: {} }],
      0,
    );

    const iterator = persistence
      .read({
        after: { aggregateName: "Order", aggregateId: "o-1", version: 0 },
      })
      [Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toThrow(
      /'after' cursor is not supported/,
    );
  });
});
```

### Event-sourced: implements EventReader structurally

```ts
import { describe, it, expect } from "vitest";
import { InMemoryEventSourcedAggregatePersistence } from "@noddde/engine";

describe("InMemoryEventSourcedAggregatePersistence EventReader shape", () => {
  it("should expose a callable read() method (duck-typed EventReader)", () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    expect(typeof (persistence as { read?: unknown }).read).toBe("function");
  });
});
```

### State-stored: optional stateVersion envelope field

```ts
import { describe, it, expect } from "vitest";
import { InMemoryStateStoredAggregatePersistence } from "@noddde/engine";

describe("InMemoryStateStoredAggregatePersistence stateVersion", () => {
  it("should store and return the given stateVersion", async () => {
    const persistence = new InMemoryStateStoredAggregatePersistence();

    await persistence.save("Account", "acc-1", { balance: 100 }, 0, 2);
    const loaded = await persistence.load("Account", "acc-1");

    expect(loaded).toEqual({
      state: { balance: 100 },
      version: 1,
      stateVersion: 2,
    });
  });

  it("should omit stateVersion when not provided", async () => {
    const persistence = new InMemoryStateStoredAggregatePersistence();

    await persistence.save("Account", "acc-1", { balance: 100 }, 0);
    const loaded = await persistence.load("Account", "acc-1");

    expect(loaded?.stateVersion).toBeUndefined();
  });
});
```
