---
title: "Snapshot Store & Strategy"
module: persistence/snapshot
source_file: packages/core/src/persistence/snapshot.ts
status: implemented
exports:
  [Snapshot, SnapshotStore, SnapshotStrategy, PartialEventLoad, everyNEvents]
depends_on: [edd/event]
docs:
  - running/persistence.mdx
  - running/domain-configuration.mdx
---

# Snapshot Store & Strategy

> Defines the snapshotting contracts for event-sourced aggregate persistence. A `SnapshotStore` saves and loads periodic state snapshots so the domain engine can skip replaying the full event stream. A `SnapshotStrategy` decides when to take a snapshot. `PartialEventLoad` is an optional interface that persistence implementations can adopt to load only events after a given version, avoiding full-stream I/O. `everyNEvents` is a built-in strategy factory.

## Type Contract

```ts
/**
 * A snapshot of an aggregate's state at a specific event stream version.
 */
interface Snapshot {
  /** The aggregate state at the time of the snapshot. */
  state: any;
  /** The event stream version (number of events) at which this snapshot was taken. */
  version: number;
}

/**
 * Storage interface for aggregate state snapshots.
 * Snapshots are an optimization for event-sourced aggregates — they allow
 * the domain engine to avoid replaying the full event stream on every command.
 *
 * Snapshots are not the source of truth — the event stream is. Deleting all
 * snapshots does not lose data; the engine falls back to full replay.
 */
interface SnapshotStore {
  /**
   * Loads the latest snapshot for an aggregate instance.
   * Returns `null` if no snapshot exists.
   */
  load(aggregateName: string, aggregateId: string): Promise<Snapshot | null>;

  /**
   * Saves a snapshot of an aggregate's state at a given version.
   * Overwrites any previously stored snapshot for the same instance.
   */
  save(
    aggregateName: string,
    aggregateId: string,
    snapshot: Snapshot,
  ): Promise<void>;
}

/**
 * Strategy function that decides whether to take a snapshot after
 * processing a command. Called by the domain engine after each
 * successful event-sourced command dispatch.
 */
type SnapshotStrategy = (context: {
  /** Current event stream version (total number of events after this command). */
  version: number;
  /** Version at which the last snapshot was taken (0 if no snapshot exists). */
  lastSnapshotVersion: number;
  /** Number of events since the last snapshot (`version - lastSnapshotVersion`). */
  eventsSinceSnapshot: number;
}) => boolean;

/**
 * Optional interface that event-sourced persistence implementations
 * can adopt to efficiently load only events after a given version.
 *
 * When the domain engine has a snapshot, it uses this method (if available)
 * to avoid loading the full event stream. If the persistence does not
 * implement this interface, the engine falls back to `load()` + `Array.slice()`.
 */
interface PartialEventLoad {
  /**
   * Loads events that occurred after the given version.
   * `afterVersion` is the number of events to skip from the beginning
   * of the stream. Returns events at positions `afterVersion, afterVersion+1, ...`.
   *
   * - `afterVersion = 0` returns all events (equivalent to `load()`).
   * - `afterVersion >= streamLength` returns an empty array.
   */
  loadAfterVersion(
    aggregateName: string,
    aggregateId: string,
    afterVersion: number,
  ): Promise<Event[]>;
}

/**
 * Creates a snapshot strategy that triggers every N events since the
 * last snapshot (or since the beginning if no snapshot exists).
 *
 * @param n - The number of events between snapshots. Must be >= 1.
 */
function everyNEvents(n: number): SnapshotStrategy;
```

- `Snapshot.state` is `any` for the same reason as persistence: type safety is enforced at the aggregate definition layer, not the snapshot layer.
- `Snapshot.version` corresponds to `events.length` at the time of the snapshot. It is always a non-negative integer.
- `SnapshotStore` is configured separately from `EventSourcedAggregatePersistence`. They may use different backends.
- `SnapshotStrategy` is a pure function — no side effects, no I/O. It receives computed context and returns a boolean.
- `PartialEventLoad` is checked via duck typing (`'loadAfterVersion' in persistence`), not via `instanceof`. Any persistence implementation can adopt it by adding the method.

## Behavioral Requirements

### SnapshotStore

1. **save(aggregateName, aggregateId, snapshot)** -- Persists the snapshot, overwriting any previously stored snapshot for the same `(aggregateName, aggregateId)` pair. There is no versioned history of snapshots — only the latest snapshot is kept.
2. **load(aggregateName, aggregateId)** -- Returns the latest snapshot, or `null` if no snapshot exists for this aggregate instance.
3. **Namespace semantics** -- `aggregateName` serves as a namespace. Snapshots for `("Order", "1")` and `("Account", "1")` are independent.
4. **Snapshot is not the source of truth** -- Deleting or corrupting a snapshot is safe. The engine falls back to full event replay. Snapshot data is a cache, not authoritative.

### SnapshotStrategy

1. **Pure function** -- The strategy receives a context object and returns `true` (take snapshot) or `false` (skip). It must not have side effects.
2. **Context accuracy** -- `eventsSinceSnapshot` is always equal to `version - lastSnapshotVersion`. It is provided for convenience.

### everyNEvents

1. **Triggers at threshold** -- `everyNEvents(n)` returns `true` when `eventsSinceSnapshot >= n`.
2. **Does not trigger below threshold** -- Returns `false` when `eventsSinceSnapshot < n`.
3. **n = 1 always triggers** -- Every command produces at least one event, so `everyNEvents(1)` triggers after every command.
4. **n must be >= 1** -- Passing `n < 1` is undefined behavior (no runtime validation required).

### PartialEventLoad

1. **loadAfterVersion(aggregateName, aggregateId, afterVersion)** -- Returns events from the stream starting at position `afterVersion` (0-indexed). Equivalent to `allEvents.slice(afterVersion)`.
2. **afterVersion = 0** -- Returns all events, same as `load()`.
3. **afterVersion >= stream length** -- Returns an empty array.
4. **Ordering** -- Events are returned in insertion order, same as `load()`.

## Invariants

- `Snapshot.version` is always a non-negative integer.
- `SnapshotStore.save()` is idempotent for the same `(aggregateName, aggregateId)` — calling it twice with different snapshots simply keeps the latest.
- `PartialEventLoad.loadAfterVersion()` must return the same events as `load().slice(afterVersion)` for correctness. Implementations may use more efficient queries, but the result must be equivalent.
- Snapshot deletion is always safe. The domain engine must handle `null` from `SnapshotStore.load()` gracefully by falling back to full replay.

## Edge Cases

- **Snapshot at version 0** -- A snapshot with `version: 0` is effectively useless (state = initialState, no events to skip). The engine should handle it gracefully.
- **Snapshot version exceeds actual stream length** -- This can happen if events are deleted (which violates the append-only invariant). The engine should treat this as a corrupted snapshot and fall back to full replay.
- **Concurrent snapshot saves** -- Two commands complete simultaneously and both decide to snapshot. Last-write-wins is acceptable — both snapshots are valid, and the slightly newer one overwrites the slightly older one.
- **Empty event stream with no snapshot** -- Normal first-command case. The engine uses `initialState` and version 0.

## Integration Points

- **DomainConfiguration.infrastructure.snapshotStore** -- Factory function returning a `SnapshotStore`. Optional — if omitted, no snapshotting occurs.
- **DomainConfiguration.infrastructure.snapshotStrategy** -- A `SnapshotStrategy` function. Optional — if omitted (but snapshot store is provided), no automatic snapshotting occurs.
- **Domain.executeCommandLifecycle()** -- Uses `SnapshotStore.load()` before event loading and `SnapshotStore.save()` after successful commit.
- **EventSourcedAggregatePersistence** -- If the persistence implementation also implements `PartialEventLoad`, the engine uses `loadAfterVersion()` for optimized I/O.

## Test Scenarios

### everyNEvents returns false below threshold

```ts
import { describe, it, expect } from "vitest";
import { everyNEvents } from "@noddde/core";

describe("everyNEvents", () => {
  it("should return false when eventsSinceSnapshot is below n", () => {
    const strategy = everyNEvents(10);

    expect(
      strategy({ version: 5, lastSnapshotVersion: 0, eventsSinceSnapshot: 5 }),
    ).toBe(false);
    expect(
      strategy({ version: 9, lastSnapshotVersion: 0, eventsSinceSnapshot: 9 }),
    ).toBe(false);
    expect(
      strategy({
        version: 15,
        lastSnapshotVersion: 10,
        eventsSinceSnapshot: 5,
      }),
    ).toBe(false);
  });
});
```

### everyNEvents returns true at or above threshold

```ts
import { describe, it, expect } from "vitest";
import { everyNEvents } from "@noddde/core";

describe("everyNEvents", () => {
  it("should return true when eventsSinceSnapshot >= n", () => {
    const strategy = everyNEvents(10);

    expect(
      strategy({
        version: 10,
        lastSnapshotVersion: 0,
        eventsSinceSnapshot: 10,
      }),
    ).toBe(true);
    expect(
      strategy({
        version: 15,
        lastSnapshotVersion: 0,
        eventsSinceSnapshot: 15,
      }),
    ).toBe(true);
    expect(
      strategy({
        version: 20,
        lastSnapshotVersion: 10,
        eventsSinceSnapshot: 10,
      }),
    ).toBe(true);
  });
});
```

### everyNEvents with n=1 always triggers

```ts
import { describe, it, expect } from "vitest";
import { everyNEvents } from "@noddde/core";

describe("everyNEvents", () => {
  it("should always return true with n=1", () => {
    const strategy = everyNEvents(1);

    expect(
      strategy({ version: 1, lastSnapshotVersion: 0, eventsSinceSnapshot: 1 }),
    ).toBe(true);
    expect(
      strategy({
        version: 100,
        lastSnapshotVersion: 99,
        eventsSinceSnapshot: 1,
      }),
    ).toBe(true);
  });
});
```

### SnapshotStore contract: save then load returns the snapshot

```ts
import { describe, it, expect } from "vitest";
import type { SnapshotStore } from "@noddde/core";

describe("SnapshotStore contract", () => {
  function runContractTests(createStore: () => SnapshotStore) {
    it("should return the saved snapshot on load", async () => {
      const store = createStore();
      const snapshot = { state: { balance: 100, owner: "Alice" }, version: 5 };

      await store.save("BankAccount", "acc-1", snapshot);
      const loaded = await store.load("BankAccount", "acc-1");

      expect(loaded).toEqual(snapshot);
    });

    it("should return null for an unknown aggregate", async () => {
      const store = createStore();
      const loaded = await store.load("BankAccount", "nonexistent");

      expect(loaded).toBeNull();
    });

    it("should overwrite snapshot on repeated saves", async () => {
      const store = createStore();

      await store.save("BankAccount", "acc-1", {
        state: { balance: 100 },
        version: 5,
      });
      await store.save("BankAccount", "acc-1", {
        state: { balance: 200 },
        version: 10,
      });

      const loaded = await store.load("BankAccount", "acc-1");
      expect(loaded).toEqual({ state: { balance: 200 }, version: 10 });
    });

    it("should isolate by aggregate name", async () => {
      const store = createStore();

      await store.save("Order", "1", {
        state: { total: 50 },
        version: 3,
      });
      await store.save("Account", "1", {
        state: { balance: 999 },
        version: 7,
      });

      const orderSnapshot = await store.load("Order", "1");
      const accountSnapshot = await store.load("Account", "1");

      expect(orderSnapshot).toEqual({ state: { total: 50 }, version: 3 });
      expect(accountSnapshot).toEqual({
        state: { balance: 999 },
        version: 7,
      });
    });
  }

  describe("InMemorySnapshotStore", () => {
    const { InMemorySnapshotStore } = require("@noddde/core");
    runContractTests(() => new InMemorySnapshotStore());
  });
});
```

### PartialEventLoad contract: loadAfterVersion slices the stream

```ts
import { describe, it, expect } from "vitest";
import { InMemoryEventSourcedAggregatePersistence } from "@noddde/core";
import type { PartialEventLoad } from "@noddde/core";

describe("PartialEventLoad contract", () => {
  it("should return events after the given version", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    await persistence.save(
      "Account",
      "acc-1",
      [
        { name: "AccountCreated", payload: { id: "acc-1" } },
        { name: "DepositMade", payload: { amount: 50 } },
        { name: "DepositMade", payload: { amount: 75 } },
      ],
      0,
    );

    const partial = persistence as unknown as PartialEventLoad;
    const events = await partial.loadAfterVersion("Account", "acc-1", 1);

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
      "Account",
      "acc-1",
      [
        { name: "AccountCreated", payload: { id: "acc-1" } },
        { name: "DepositMade", payload: { amount: 50 } },
      ],
      0,
    );

    const partial = persistence as unknown as PartialEventLoad;
    const events = await partial.loadAfterVersion("Account", "acc-1", 0);

    expect(events).toHaveLength(2);
  });

  it("should return empty array when afterVersion >= stream length", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    await persistence.save(
      "Account",
      "acc-1",
      [{ name: "AccountCreated", payload: { id: "acc-1" } }],
      0,
    );

    const partial = persistence as unknown as PartialEventLoad;
    const events = await partial.loadAfterVersion("Account", "acc-1", 5);

    expect(events).toEqual([]);
  });
});
```
