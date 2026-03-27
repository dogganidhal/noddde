---
title: "InMemorySnapshotStore"
module: engine/implementations/in-memory-snapshot-store
source_file: packages/engine/src/implementations/in-memory-snapshot-store.ts
status: implemented
exports: [InMemorySnapshotStore]
depends_on: [persistence/snapshot]
docs:
  - running/persistence.mdx
---

# InMemorySnapshotStore

> In-memory `SnapshotStore` implementation that stores aggregate state snapshots in a `Map`. Snapshots are keyed by a composite `${aggregateName}:${aggregateId}` string. Each `save` call overwrites the previously stored snapshot. `load` returns the latest snapshot or `null` if none exists. Data is lost when the process exits. Suitable for development, testing, and prototyping.

## Type Contract

```ts
import type { SnapshotStore, Snapshot } from "@noddde/core";

class InMemorySnapshotStore implements SnapshotStore {
  load(aggregateName: string, aggregateId: string): Promise<Snapshot | null>;
  save(
    aggregateName: string,
    aggregateId: string,
    snapshot: Snapshot,
  ): Promise<void>;
}
```

- Implements the `SnapshotStore` interface from `@noddde/core`.
- Uses `Promise`-based APIs for consistency with durable snapshot store implementations, even though the in-memory operations are synchronous.

## Behavioral Requirements

1. **Save overwrites snapshot** -- `save(name, id, snapshot)` stores the snapshot, replacing any previously stored snapshot for the same `(name, id)` pair.
2. **Load returns latest snapshot** -- `load(name, id)` returns the most recently saved snapshot for `(name, id)`.
3. **Load returns null for unknown aggregate** -- If no snapshot has been saved for `(name, id)`, `load` returns `null`.
4. **Namespace isolation** -- Snapshots for `("Order", "1")` and `("Account", "1")` are stored independently.
5. **Instance isolation** -- Snapshots for `("Order", "1")` and `("Order", "2")` are stored independently.

## Invariants

- Purely in-memory. No filesystem, database, or network I/O.
- Supports arbitrary aggregate names and IDs (any string).
- Does not perform validation on the snapshot data being stored.
- Single-process, non-thread-safe. Concurrent access from multiple async contexts is safe (JavaScript is single-threaded).

## Edge Cases

- **Save then overwrite** -- Saving a new snapshot for the same aggregate replaces the previous one entirely. Only the latest snapshot is accessible.
- **Save snapshot with version 0** -- Valid but useless (represents initialState). The store does not reject it.

## Integration Points

- **DomainWiring.aggregates.snapshots** -- Factory function that creates and returns an `InMemorySnapshotStore`.
- **Domain.executeCommandLifecycle()** -- The domain loads the snapshot before loading events, and saves a new snapshot after successful commit if the strategy triggers.

## Test Scenarios

### Save and load round-trip

```ts
import { describe, it, expect } from "vitest";
import { InMemorySnapshotStore } from "@noddde/core";

describe("InMemorySnapshotStore", () => {
  it("should store and retrieve a snapshot", async () => {
    const store = new InMemorySnapshotStore();
    const snapshot = { state: { balance: 250, owner: "Alice" }, version: 5 };

    await store.save("BankAccount", "acc-1", snapshot);
    const loaded = await store.load("BankAccount", "acc-1");

    expect(loaded).toEqual(snapshot);
  });
});
```

### Load returns null for unknown aggregate

```ts
import { describe, it, expect } from "vitest";
import { InMemorySnapshotStore } from "@noddde/core";

describe("InMemorySnapshotStore", () => {
  it("should return null when no snapshot exists", async () => {
    const store = new InMemorySnapshotStore();
    const loaded = await store.load("BankAccount", "nonexistent");

    expect(loaded).toBeNull();
  });
});
```

### Save overwrites previous snapshot

```ts
import { describe, it, expect } from "vitest";
import { InMemorySnapshotStore } from "@noddde/core";

describe("InMemorySnapshotStore", () => {
  it("should overwrite the snapshot on subsequent saves", async () => {
    const store = new InMemorySnapshotStore();

    await store.save("BankAccount", "acc-1", {
      state: { balance: 100 },
      version: 3,
    });
    await store.save("BankAccount", "acc-1", {
      state: { balance: 200 },
      version: 7,
    });

    const loaded = await store.load("BankAccount", "acc-1");
    expect(loaded).toEqual({ state: { balance: 200 }, version: 7 });
  });
});
```

### Namespace isolation between aggregate types

```ts
import { describe, it, expect } from "vitest";
import { InMemorySnapshotStore } from "@noddde/core";

describe("InMemorySnapshotStore", () => {
  it("should isolate snapshots between different aggregate names", async () => {
    const store = new InMemorySnapshotStore();

    await store.save("Order", "1", { state: { total: 50 }, version: 2 });
    await store.save("Account", "1", { state: { balance: 999 }, version: 5 });

    const orderSnapshot = await store.load("Order", "1");
    const accountSnapshot = await store.load("Account", "1");

    expect(orderSnapshot).toEqual({ state: { total: 50 }, version: 2 });
    expect(accountSnapshot).toEqual({ state: { balance: 999 }, version: 5 });
  });
});
```

### Instance isolation between aggregate IDs

```ts
import { describe, it, expect } from "vitest";
import { InMemorySnapshotStore } from "@noddde/core";

describe("InMemorySnapshotStore", () => {
  it("should isolate snapshots between different aggregate IDs", async () => {
    const store = new InMemorySnapshotStore();

    await store.save("BankAccount", "acc-1", {
      state: { balance: 100 },
      version: 3,
    });
    await store.save("BankAccount", "acc-2", {
      state: { balance: 500 },
      version: 8,
    });

    const acc1 = await store.load("BankAccount", "acc-1");
    const acc2 = await store.load("BankAccount", "acc-2");

    expect(acc1).toEqual({ state: { balance: 100 }, version: 3 });
    expect(acc2).toEqual({ state: { balance: 500 }, version: 8 });
  });
});
```
